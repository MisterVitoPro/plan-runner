# Configurable verification coverage

**Date:** 2026-07-07
**Status:** Approved (design)
**Target version:** 1.9.0 (minor — new pipeline behavior)

## Problem

plan-runner dispatches one verifier per wave (Step 4b: "Dispatch wave verifier
(single agent, background)"). There is no way to trade verification thoroughness for
token cost, and no way to increase thoroughness to one-verifier-per-dev-agent for a
high-stakes run. Users who want a cheaper run have no dial; users who want maximum
scrutiny have no dial either. This feature adds a configurable coverage dial with an
honest representation of reduced coverage that does not weaken the project's
verification invariants.

## Goal

A single setting, `verify_mode`, that limits **how much** semantic verification runs
— from one verifier per dev agent, down to one verifier on the final wave only — set
via a committed YAML config file with a per-run flag override. Every run always has
at least one real semantic verifier; lower modes simply verify fewer waves. Reduced
coverage is surfaced honestly everywhere so unverified work is never presented as
verified.

## Non-goals

- No "sample every N waves" mode (YAGNI — the three levels cover the span).
- No `off` and no `structural` / zero-agent floor mode. The minimum, `last-wave-only`,
  always runs one real semantic verifier.
- No change to the `plan-verifier` agent body. It already loops "for each dev agent,"
  so every mode reuses it as-is.
- Not reconciling the pre-existing drift between the manifest schema's per-agent
  `verifier_status`/`bug_count` and what Step 4f actually writes. Out of scope.

## Behavior: the three-level dial

`verify_mode` takes one of three values:

| mode | semantic verifier | relative cost |
|------|-------------------|---------------|
| `per-agent` | one per dev agent, every wave | highest (new) |
| `per-wave` | one per wave, every wave | current, **default** |
| `last-wave-only` | final wave only; earlier waves unverified | least (new) |

When no config and no flag are present, `verify_mode = per-wave` and the pipeline
runs byte-for-byte as it does today.

Note on the token goal: `per-wave` is already the cheapest *full-coverage* mode, so
the only way to spend fewer verify tokens is to verify fewer waves —
`last-wave-only`. `per-agent` deliberately spends *more* (it is the max-scrutiny
option). Before assuming this feature solves a token problem, check a real
`manifest.json` `token_usage`: in the skill's own Token Report example, Verify is
~20-25% of a run and the dev agents dominate.

### How each mode maps onto Step 4b

- `per-wave` (default): dispatch ONE verifier for the wave with all dev agents in its
  `AGENTS IN THIS WAVE` block. Unchanged from today.
- `per-agent`: dispatch one verifier per dev agent, each with a single-agent `AGENTS
  IN THIS WAVE` block. Collect the N reports and merge into one `bugs/wave-<W>.json`:
  `bugs` = union of all reports' bugs; `agent_statuses` = each agent's own verdict;
  wave `verifier_status` = `CLEAN` if all clean, `BUGS_FOUND` if any has bugs,
  `UNVERIFIABLE` if any per-agent verifier's report is missing/unparseable. Token
  accounting appends one `verify`-phase entry per verifier (label
  `wave-<W>-agent-<n>-verifier`). Tear down each verifier after its report is
  captured.
- `last-wave-only`: on wave `W` (the final wave), dispatch one verifier exactly as
  `per-wave`. On waves `1..W-1`, no verifier — write the `SKIPPED` bug JSON (below).

The `plan-verifier` agent body is untouched in all three modes.

### Unverified (SKIPPED) waves

A wave with no semantic verifier (the earlier waves under `last-wave-only`) is
recorded honestly, not silently closed:

- The orchestrator writes `bugs/wave-<W>.json` as
  `{"wave_id": <W>, "verifier_status": "SKIPPED", "agent_statuses": {...}, "bugs": [<BLOCKED bugs only>]}`.
- **BLOCKED dev agents still surface.** The `BLOCKED → P0 missing_requirement` bug is
  normally synthesized by the verifier (`plan-verifier.md` step 1). On a SKIPPED wave
  the orchestrator synthesizes it instead, from the dev agent's own declared
  `dev_status` — a status the dev *declared*, not a correctness judgment, so no
  self-verify violation. This keeps a genuinely-stuck task from vanishing from the
  fix-plan. A SKIPPED wave's `bugs` array is otherwise empty.
- No file-content reading, no acceptance-criteria walk, no incorrect-implementation
  checks — those require a verifier and are exactly what the mode traded away.

### TDD interaction

`verify_mode` never touches test authoring. Test-author agents (`role: test-author`)
are dev agents, always dispatched by the wave plan. The red/green gates themselves
run in Step 4a-ter for **every** wave regardless of `verify_mode` — the orchestrator
runs the tests and records the raw `red_run` / `green_run` output in the manifest as
today. What a lower mode drops is the verifier's *judgment* of that output. So on a
SKIPPED wave in a TDD run the raw pass/fail is still recorded; `valid_red` stays
`null` (already means "not yet adjudicated"; no schema change). The
"invalid red → skip paired impl" short-circuit still fires on the
orchestrator-detectable case (new tests passed at exit 0).

### Edge cases

- Single-wave plan (`W = 1`) with `last-wave-only`: wave 1 *is* the last wave, so it
  gets the verifier. `waves_skipped = 0` → no draft/banner. A one-wave plan is never
  left unverified.
- `last-wave-only` on a multi-wave plan: `waves_skipped = W - 1 > 0` → draft + banner.

## Config source and precedence

- **File:** optional `.plan-runner.yml` at the target repo root (committed by the
  user, NOT gitignored — it is a persistent project setting):

  ```yaml
  verification:
    mode: per-wave   # per-agent | per-wave | last-wave-only
  ```

- **Flag:** `--verify <mode>` overrides the file for a single run.
- **Precedence:** `--verify` flag > `.plan-runner.yml` > default (`per-wave`).
- **Validation:** an unrecognized mode (from either source) prints a clear error
  listing the three valid values and STOPs. No YAML-parser dependency at runtime — the
  orchestrator reads `.plan-runner.yml` with the Read tool and extracts the single
  `verification.mode` key; a malformed/absent file falls through to the default. Keep
  the file schema flat (one nested key) so extraction is trivial.

## The honesty core: `SKIPPED` is distinct from `UNVERIFIABLE`

Three wave states that must never be conflated:

- **`CLEAN` / `BUGS_FOUND`** — a semantic verifier ran and returned a verdict.
- **`UNVERIFIABLE`** — a semantic verifier *was requested* for the wave but the
  verdict never landed or could not be parsed. Unchanged: it is a bug, flows through
  the aggregate → fix-plan → re-run loop, and blocks a ready PR. Never silently
  closed.
- **`SKIPPED`** (new) — no semantic verifier was requested for the wave because the
  mode excluded it. Written deliberately to `bugs/wave-<W>.json`, contributes only
  any BLOCKED bug, and is loudly surfaced. Never silent.

### Coverage gate (Step 5.0) — the linchpin

The existing gate backfills `UNVERIFIABLE` for any wave whose `bugs/wave-<W>.json` is
missing or has a null `verifier_status`. The change: the gate reads `verify_mode` to
know which waves were *in scope for a semantic verifier*.

- A wave in scope for a semantic verifier but with a missing/null verdict → backfill
  `UNVERIFIABLE` (unchanged).
- A wave carrying `verifier_status: "SKIPPED"` → left as is, no bug synthesized.

Because every wave writes a present, non-null status (a semantic verdict or
`SKIPPED`), a genuinely missing semantic verifier for an in-scope wave still trips
the gate. The invariant "structurally impossible to open a PR while a *requested*
verdict is outstanding" holds. `SKIPPED` records an intentional, transparent
reduction — not a silently-closed wave.

### "Clean" must not lie about depth (the summary + re-run surface)

A lower mode produces fewer bugs *because fewer waves were verified*, not because the
code is better. The success language must say so, or a reduced run reads as
verified-clean when it was not:

- **Step 7 zero-bug summary:** when `waves_skipped > 0`, do NOT print the plain
  `no bugs found`. Print e.g.
  `cycle <n> complete -- 0 issues found; <m> of <W> waves were not semantically verified (mode: <mode>).`
- **Step 6 convergence hint:** suppress or annotate the "cycle N had fewer bugs than
  N-1" line when the two cycles ran at different `verify_mode`s (fewer bugs may just
  mean shallower verification).
- **Re-run handoff:** carry the *effective* `verify_mode` forward explicitly into the
  auto-re-run so a `--verify` one-off does not silently revert to the committed
  file's mode mid-loop, and the re-run's depth is a conscious, recorded choice.

## Surfacing (reduced coverage is never silent)

- **Pre-flight:** print the resolved mode and its source, e.g.
  `Verification mode: last-wave-only (from --verify flag).`
- **Step 3 wave-plan display:** the "Estimated total agents" line counts semantic
  verifiers under the mode (per-agent: sum of dev agents; per-wave: W;
  last-wave-only: 1).
- **Wave dashboard (4d):** the verifier row shows `SKIPPED` for unverified waves.
- **Manifest:** new top-level `verification` block:
  `{"mode": "<mode>", "waves_total": <W>, "waves_verified": <n>, "waves_skipped": <n>}`.
  Optional field, "pre-1.9.0" back-compat note. Per-wave `wave_verifier_status` may
  now be `SKIPPED`.
- **Final summary / re-run prompt:** the depth-honest lines above.
- **PR (skills/pr/SKILL.md):** when `verification.waves_skipped > 0`, force the PR to
  open as **draft** (regardless of bug count) and add a body banner using GitHub's
  native alert syntax (no emoji glyph):
  `> [!WARNING]` / `> Verification: <mode> — <m> of <W> waves not semantically verified`.
  In addition to the existing draft-when-bugs-remain behavior.
- **Token Report:** the Verify phase row reflects the actual verifier count under the
  mode (an empty phase row is already omitted as today).

## Touch-points

- `skills/run/SKILL.md`
  - Argument parsing: add `--verify <mode>` (takes a value; strip before using the
    plan path).
  - New pre-flight sub-step (after the existing 1c/1d cluster): "Resolve verification
    mode" — read `.plan-runner.yml`, apply flag override, validate, default
    `per-wave`, print the resolved mode, store `verify_mode`.
  - Step 1e manifest init: add the `verification` block.
  - Step 3: semantic-verifier count in the agent estimate reflects the mode.
  - Step 4b: branch on `verify_mode` — dispatch semantic verifier(s), or (for a
    SKIPPED wave) write the SKIPPED bug JSON with any BLOCKED bug.
  - Step 4c: per-agent merge logic for `per-agent` mode.
  - Step 4d: dashboard shows `SKIPPED`.
  - Step 4f: manifest wave entry may carry `wave_verifier_status: "SKIPPED"`; update
    the `verification` counters.
  - Step 5.0: coverage gate reads `verify_mode` (semantic-in-scope-missing →
    UNVERIFIABLE; SKIPPED → left alone).
  - Step 6 / Step 7: the depth-honest summary + convergence hint; carry the effective
    mode into the re-run handoff.
- `skills/pr/SKILL.md` — read manifest `verification`; draft + banner when
  `waves_skipped > 0`.
- `schemas/manifest.schema.json` — add optional `verification` object with the
  "pre-1.9.0" back-compat note; update `schemas/examples/manifest-valid.json` and keep
  `manifest-invalid.json` failing for the right reason (old manifests without
  `verification` must still validate).
- `tests/contract.test.js` — pin: the three modes exist in the run-skill prose; the
  precedence (flag > file > default); `SKIPPED` is distinct from `UNVERIFIABLE`; the
  coverage gate reads the configured mode; the depth-honest "clean" summary; the PR
  drafts + banners on skipped waves; the config file name `.plan-runner.yml`. Bump the
  pinned version assertion to `1.9.0`.
- Version bump (one commit, four places): `plugin.json` `version` 1.8.3 → 1.9.0; the
  contract version assertion; `package.json` `version`; a new `CHANGELOG.md` 1.9.0
  entry.
- `README.md` — document `.plan-runner.yml`, the three modes, and `--verify`.
- `plugin.json` `description` — add a clause noting configurable verification coverage.

`agents/plan-verifier.md` — untouched.

## Verification (from CLAUDE.md; run all three before claiming done)

```
node --test tests/contract.test.js
python tests/validate_schemas.py
claude plugin validate .
```

## Invariants preserved

- **No self-verify.** The orchestrator still never substitutes its own judgment for a
  semantic verifier's verdict. The only orchestrator-emitted bug on a SKIPPED wave is
  the BLOCKED→P0, relayed from the dev's own declared status — not a code judgment.
  `UNVERIFIABLE` behavior unchanged.
- **Coverage gate stays upstream of the PR step** on every path and still makes it
  impossible to open a PR while a *requested* semantic verdict is outstanding. It now
  also distinguishes an intentional skip (`SKIPPED`) from a missing verdict.
- **Token accounting best-effort.** Per-agent mode appends one honest `verify` entry
  per verifier; SKIPPED waves dispatch no verifier so add no verify entries;
  unreported verifiers get `null` as today.
- **Least-privilege agents.** No agent tools change; the verifier stays read-only.
- **git optional.** No new git dependency; the PR draft/banner change is inside the
  already git-gated PR step.
