# Configurable verification coverage

**Date:** 2026-07-07
**Status:** Approved (design)
**Target version:** 1.9.0 (minor — new pipeline behavior)

## Problem

plan-runner dispatches one verifier per wave (Step 4b: "Dispatch wave verifier
(single agent, background)"). There is no way to trade verification thoroughness
for token cost, and no way to increase thoroughness to one-verifier-per-dev-agent
for a high-stakes run. Users who want a cheaper run have no dial; users who want
maximum scrutiny have no dial either. This feature adds a configurable coverage
dial with an honest representation of reduced coverage that does not weaken the
project's verification invariants.

## Goal

A single setting, `verify_mode`, that controls the **semantic** verifier layer —
from one verifier per dev agent down to none — set via a committed YAML config file
with a per-run flag override. Below the semantic layer sits an always-on
**structural floor** so no wave ever closes having proven nothing, and every
reduced-coverage run is surfaced honestly so unverified work is never silently
presented as ready.

## Non-goals

- No "sample every N waves" mode (YAGNI — the four levels below cover the span).
- No `off` mode. The minimum is `structural` (the floor below), which always runs.
- No change to the `plan-verifier` agent body. It already loops "for each dev
  agent," so every semantic mode reuses it as-is.
- Not reconciling the pre-existing drift between the manifest schema's per-agent
  `verifier_status`/`bug_count` and what Step 4f actually writes. Out of scope.

## Two layers: the structural floor and the semantic verifier

**Structural floor (always on, orchestrator-only, ~zero LLM tokens).** The
orchestrator already holds every fact the floor needs, so it dispatches no agent and
reads no file contents. It is applied to any wave that does *not* get a semantic
verifier. Its checks:

1. **Owned-file existence** — for each non-BLOCKED dev agent, every path in
   `owned_files` must exist on disk (a `test -f` / Glob, no reading). A missing file
   is a P0 `missing_requirement` bug.
2. **BLOCKED dev agents** — synthesize the P0 `missing_requirement` bug from the dev
   agent's own declared `dev_status` (see plan-verifier.md step 1 for the shape). It
   is the dev's declaration, not a correctness judgment — no self-verify violation.
3. **TDD gate exit codes** (only if `tdd_enabled`) — from the gate output the
   orchestrator already captured in 4a-ter, using exit codes only:
   - GREEN gate (impl): any `tests_to_satisfy` file failing (exit != 0) → P0
     `missing_requirement`.
   - RED gate (test-author): the new tests *passed* at exit 0 → P1
     `incorrect_implementation` (an objectively invalid red).
   - Any previously-passing test now failing (suite diff vs `baseline_failing`) → P0
     `broken_existing`.

The floor never reads owned-file contents, never walks acceptance criteria, never
judges *incorrect implementations*, and never judges *why* a red failed (import vs
syntax). Those are semantic and require a verifier. A wave checked only by the floor
gets `verifier_status: "STRUCTURAL"` — it can never be reported `CLEAN`.

**Semantic verifier (the `plan-verifier` agent).** The deep, token-heavy pass:
reads every owned file, walks each acceptance criterion, spots incorrect
implementations, and (in TDD) adjudicates red genuineness / green completeness. This
is the layer `verify_mode` dials.

## Behavior: the four-level dial

`verify_mode` takes one of four values. It controls the semantic layer only; the
structural floor fills in wherever the semantic layer is absent.

| mode | semantic verifier | floor fills in | relative cost |
|------|-------------------|----------------|---------------|
| `per-agent` | one per dev agent, every wave | (none needed) | highest (new) |
| `per-wave` | one per wave, every wave | (none needed) | current, **default** |
| `last-wave-only` | final wave only | every earlier wave | low (new) |
| `structural` | none | every wave | ~zero verify tokens (new) |

When no config and no flag are present, `verify_mode = per-wave` and the pipeline
runs byte-for-byte as it does today.

### How each mode maps onto Step 4b

- `per-wave` (default): dispatch ONE semantic verifier for the wave with all dev
  agents in its `AGENTS IN THIS WAVE` block. Unchanged from today.
- `per-agent`: dispatch one semantic verifier per dev agent, each with a
  single-agent `AGENTS IN THIS WAVE` block. Collect the N reports and merge into one
  `bugs/wave-<W>.json`: `bugs` = union of all reports' bugs; `agent_statuses` = each
  agent's own verdict; wave `verifier_status` = `CLEAN` if all agents clean,
  `BUGS_FOUND` if any agent has bugs, `UNVERIFIABLE` if any per-agent verifier's
  report is missing/unparseable. Token accounting appends one `verify`-phase entry
  per verifier (label `wave-<W>-agent-<n>-verifier`). Tear down each verifier after
  its report is captured.
- `last-wave-only`: on waves `1..W-1`, run the structural floor (write the
  `STRUCTURAL` bug JSON, below). On wave `W`, dispatch one semantic verifier exactly
  as `per-wave`.
- `structural`: never dispatch a semantic verifier — every wave runs the structural
  floor.

The `plan-verifier` agent body is untouched in all four modes.

### The STRUCTURAL bug JSON (written by the orchestrator for floor-only waves)

```json
{"wave_id": <W>, "verifier_status": "STRUCTURAL", "agent_statuses": {"<agent_id>": "STRUCTURAL | BUGS_FOUND"}, "bugs": [<objective floor bugs, may be empty>]}
```

`verifier_status: "STRUCTURAL"` marks the *depth* (semantic verification did not
run); `bugs[]` still carries any objective failures the floor found. So a STRUCTURAL
wave's `bugs` array is empty only when the floor found nothing — a per-agent
`agent_statuses` entry is `BUGS_FOUND` when that agent tripped a floor check, else
`STRUCTURAL`. Bug counting keys off `bugs[]` length regardless of status.

### Edge cases

- Single-wave plan (`W = 1`) with `last-wave-only`: wave 1 *is* the last wave, so it
  gets the semantic verifier. `waves_structural_only = 0` → no draft/banner.
- `structural` on any plan: every wave is floor-only, `waves_semantically_verified =
  0`, PR draft + banner.
- BLOCKED / missing-file / failing-gate on a floor-only wave: caught by the floor and
  emitted as objective bugs (above), so a stuck or empty task never vanishes.

## TDD interaction

`verify_mode` never touches test authoring. Test-author agents (`role: test-author`)
are dev agents, always dispatched by the wave plan regardless of mode. What the
semantic verifier does in a TDD run is *judge* the red/green gate output — it never
writes or runs tests (it is read-only and told "Do NOT run tests yourself").

On a floor-only (`STRUCTURAL`) wave in a TDD run:

- The orchestrator **still runs** the red/green gates (Step 4a-ter) via Bash and
  records the raw `red_run` / `green_run` output in the manifest `tdd.tasks` exactly
  as today.
- The **structural floor adjudicates the objective parts** from exit codes (green
  fail → P0, new tests passing → P1 invalid red, newly-broken pre-existing test →
  P0), but the **semantic judgment** — whether a red failure is genuine (import /
  not-implemented) vs invalid (syntax / collection error) — is *not* made, so
  `valid_red` stays `null` (already means "not yet adjudicated"; no schema change).
- The "invalid red → skip paired impl" short-circuit still fires on the
  orchestrator-detectable case (new tests passed at exit 0); the verifier-judged
  invalid-red case does not apply since no verifier runs.

So a floor-only TDD wave keeps its tests, their raw run results, and the objective
pass/fail verdict; it drops only the verifier's judgment of red genuineness and any
deeper incorrect-implementation gaps.

## Config source and precedence

- **File:** optional `.plan-runner.yml` at the target repo root (committed by the
  user, NOT gitignored — it is a persistent project setting):

  ```yaml
  verification:
    mode: per-wave   # per-agent | per-wave | last-wave-only | structural
  ```

- **Flag:** `--verify <mode>` overrides the file for a single run.
- **Precedence:** `--verify` flag > `.plan-runner.yml` > default (`per-wave`).
- **Validation:** an unrecognized mode (from either source) prints a clear error
  listing the four valid values and STOPs. No YAML-parser dependency at runtime — the
  orchestrator reads `.plan-runner.yml` with the Read tool and extracts the single
  `verification.mode` key; a malformed/absent file falls through to the default. Keep
  the file schema flat (one nested key) so extraction is trivial.

## The honesty core: `STRUCTURAL` is distinct from `UNVERIFIABLE`

Three wave states that must never be conflated:

- **`CLEAN` / `BUGS_FOUND`** — a semantic verifier ran and returned a verdict.
- **`UNVERIFIABLE`** — a semantic verifier *was requested* for the wave but the
  verdict never landed or could not be parsed. Unchanged: it is a bug, flows through
  the aggregate → fix-plan → re-run loop, and blocks a ready PR. Never silently
  closed.
- **`STRUCTURAL`** (new) — no semantic verifier was requested for the wave; the
  orchestrator ran the structural floor instead. A real (if shallow) check ran, so
  the wave is never "unchecked," but it is surfaced as not-semantically-verified and
  forces the PR to draft + banner.

### Coverage gate (Step 5.0) — the linchpin

The existing gate backfills `UNVERIFIABLE` for any wave whose `bugs/wave-<W>.json` is
missing or has a null `verifier_status`. The change: the gate reads `verify_mode` to
know which waves were *in scope for a semantic verifier*.

- A wave in scope for a semantic verifier but with a missing/null verdict → backfill
  `UNVERIFIABLE` (unchanged). A dispatched verifier agent can fail to land; the floor
  cannot (it is deterministic and orchestrator-run).
- A wave carrying `verifier_status: "STRUCTURAL"` → left as is, no bug synthesized.

Because every wave writes a present, non-null status (a semantic verdict or
`STRUCTURAL`), a genuinely missing semantic verifier for an in-scope wave still trips
the gate. The invariant "structurally impossible to open a PR while a *requested*
verdict is outstanding" holds. `STRUCTURAL` records an intentional, transparent
reduction of depth — not a silently-closed wave.

## Surfacing (reduced coverage is never silent)

- **Pre-flight:** print the resolved mode and its source, e.g.
  `Verification mode: last-wave-only (from --verify flag).`
- **Step 3 wave-plan display:** the "Estimated total agents" line counts semantic
  verifiers under the chosen mode (per-agent: sum of dev agents; per-wave: W;
  last-wave-only: 1; structural: 0).
- **Wave dashboard (4d):** the verifier row shows `STRUCTURAL` for floor-only waves.
- **Manifest:** new top-level `verification` block:
  `{"mode": "<mode>", "waves_total": <W>, "waves_semantically_verified": <n>, "waves_structural_only": <n>}`.
  Optional field, "pre-1.9.0" back-compat note. Per-wave `wave_verifier_status` may
  now be `STRUCTURAL`.
- **Final summary / re-run prompt:** when coverage is reduced, print
  `Verification: <mode> — <n>/<W> waves semantically verified, <m> structural-only.`
- **PR (skills/pr/SKILL.md):** when `verification.waves_structural_only > 0`, force
  the PR to open as **draft** (regardless of bug count) and add a body banner:
  `⚠ Verification: <mode> — <m> of <W> waves structural-only (not semantically verified)`.
  In addition to the existing draft-when-bugs-remain behavior.
- **Token Report:** the Verify phase row shows 0 agents for `structural` (an empty
  phase row is already omitted as today).

## Touch-points

- `skills/run/SKILL.md`
  - Argument parsing: add `--verify <mode>` (takes a value; strip before using the
    plan path).
  - New pre-flight sub-step (after the existing 1c/1d cluster): "Resolve verification
    mode" — read `.plan-runner.yml`, apply flag override, validate, default
    `per-wave`, print the resolved mode, store `verify_mode`.
  - Step 1e manifest init: add the `verification` block.
  - Step 3: semantic-verifier count in the agent estimate reflects the mode.
  - Define the structural floor (the checks above) as a named sub-step the orchestrator
    applies to any floor-only wave.
  - Step 4b: branch on `verify_mode` — dispatch semantic verifier(s) or run the floor.
  - Step 4c: write the `STRUCTURAL` bug JSON for floor-only waves; per-agent merge
    logic for `per-agent` mode.
  - Step 4d: dashboard shows `STRUCTURAL`.
  - Step 4f: manifest wave entry may carry `wave_verifier_status: "STRUCTURAL"`;
    update the `verification` counters.
  - Step 5.0: coverage gate reads `verify_mode` (semantic-in-scope-missing →
    UNVERIFIABLE; STRUCTURAL → left alone).
  - Final summary (Step 6/7): the reduced-coverage line.
- `skills/pr/SKILL.md` — read manifest `verification`; draft + banner when
  `waves_structural_only > 0`.
- `schemas/manifest.schema.json` — add optional `verification` object with the
  "pre-1.9.0" back-compat note; update `schemas/examples/manifest-valid.json` and
  keep `manifest-invalid.json` failing for the right reason (old manifests without
  `verification` must still validate).
- `tests/contract.test.js` — pin: the four modes exist in the run-skill prose; the
  precedence (flag > file > default); the structural floor's checks; `STRUCTURAL` is
  distinct from `UNVERIFIABLE`; the coverage gate reads the configured mode; the PR
  drafts + banners on structural-only waves; the config file name `.plan-runner.yml`.
  Bump the pinned version assertion to `1.9.0`.
- Version bump (one commit, four places): `plugin.json` `version` 1.8.3 → 1.9.0; the
  contract version assertion; `package.json` `version`; a new `CHANGELOG.md` 1.9.0
  entry.
- `README.md` — document `.plan-runner.yml`, the four modes, and `--verify`.
- `plugin.json` `description` — add a clause noting configurable verification
  coverage with an always-on structural floor.

`agents/plan-verifier.md` — untouched.

## Verification (from CLAUDE.md; run all three before claiming done)

```
node --test tests/contract.test.js
python tests/validate_schemas.py
claude plugin validate .
```

## Invariants preserved

- **No self-verify.** The orchestrator still never substitutes its own judgment for a
  semantic verifier's verdict. The structural floor only relays objective facts the
  dev declared or the test runner produced (exit codes, file existence, BLOCKED
  status) — it never judges code correctness. `UNVERIFIABLE` behavior unchanged.
- **Coverage gate stays upstream of the PR step** on every path and still makes it
  impossible to open a PR while a *requested* semantic verdict is outstanding. It now
  also distinguishes intentional depth reduction (`STRUCTURAL`) from missing verdicts.
- **Token accounting best-effort.** Per-agent mode appends one honest `verify` entry
  per verifier; the structural floor dispatches no agent so it adds no verify entries;
  unreported verifiers get `null` as today.
- **Least-privilege agents.** No agent tools change; the verifier stays read-only.
- **git optional.** No new git dependency; the PR draft/banner change is inside the
  already git-gated PR step.
