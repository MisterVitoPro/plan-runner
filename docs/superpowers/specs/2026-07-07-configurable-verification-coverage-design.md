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

A single setting, `verify_mode`, that controls how many verifier agents run and on
which waves — spanning from maximum coverage (per dev agent) down to none — set via
a committed YAML config file with a per-run flag override, and surfaced honestly
everywhere so unverified work is never silently presented as ready.

## Non-goals

- No "sample every N waves" mode (YAGNI — the four levels below cover the span).
- No change to the `plan-verifier` agent body. It already loops "for each dev
  agent," so every mode reuses it as-is.
- Not reconciling the pre-existing drift between the manifest schema's per-agent
  `verifier_status`/`bug_count` and what Step 4f actually writes. Out of scope.

## Behavior: the four-level dial

`verify_mode` takes one of four values:

| mode | verifiers dispatched | notes |
|------|----------------------|-------|
| `per-agent` | one verifier per dev agent, every wave | new; highest cost/coverage |
| `per-wave` | one verifier per wave, every wave | **default**; current behavior, unchanged |
| `last-wave-only` | one verifier (per-wave granularity), final wave only | new |
| `off` | none | new |

When no config and no flag are present, `verify_mode = per-wave` and the pipeline
runs byte-for-byte as it does today.

### How each mode maps onto Step 4b

- `per-wave` (default): dispatch ONE verifier for the wave with all dev agents in
  its `AGENTS IN THIS WAVE` block. Unchanged from today.
- `per-agent`: dispatch one verifier per dev agent, each with a single-agent
  `AGENTS IN THIS WAVE` block (one agent). Collect the N reports and merge into one
  `bugs/wave-<W>.json`: `bugs` = union of all reports' bugs; `agent_statuses` =
  each agent's own verdict; wave `verifier_status` = `CLEAN` if all agents clean,
  `BUGS_FOUND` if any agent has bugs, `UNVERIFIABLE` if any per-agent verifier's
  report is missing/unparseable. Token accounting appends one `verify`-phase entry
  per verifier (label `wave-<W>-agent-<n>-verifier`). Tear down each verifier after
  its report is captured (4c teardown, once per verifier).
- `last-wave-only`: on waves `1..W-1`, do not dispatch a verifier — write the
  `SKIPPED` bug JSON (below). On wave `W`, dispatch one per-wave verifier exactly
  as `per-wave`.
- `off`: never dispatch a verifier — every wave writes the `SKIPPED` bug JSON.

The `plan-verifier` agent body is untouched in all four modes.

## Config source and precedence

- **File:** optional `.plan-runner.yml` at the target repo root (committed by the
  user, NOT gitignored — it is a persistent project setting):

  ```yaml
  verification:
    mode: per-wave   # per-agent | per-wave | last-wave-only | off
  ```

- **Flag:** `--verify <mode>` overrides the file for a single run.
- **Precedence:** `--verify` flag > `.plan-runner.yml` > default (`per-wave`).
- **Validation:** an unrecognized mode (from either source) prints a clear error
  listing the four valid values and STOPs. No YAML-parser dependency at runtime —
  the orchestrator reads `.plan-runner.yml` with the Read tool and extracts the
  single `verification.mode` key; a malformed/absent file falls through to the
  default. Keep the file schema flat (one nested key) so extraction is trivial.

## The honesty core: `SKIPPED` is distinct from `UNVERIFIABLE`

Two states that must never be conflated:

- **`UNVERIFIABLE`** — verification *was requested* for the wave but the verdict
  never landed or could not be parsed. Unchanged: it is a bug, flows through the
  aggregate → fix-plan → re-run loop, and blocks a ready PR. Never silently closed.
- **`SKIPPED`** (new) — verification *was never requested* for the wave because the
  configured mode excluded it. Written deliberately to `bugs/wave-<W>.json` as
  `{"wave_id": <W>, "verifier_status": "SKIPPED", "agent_statuses": {}, "bugs": []}`.
  Contributes zero bugs. Loudly surfaced (see below), never silent.

### Coverage gate (Step 5.0) — the linchpin

The existing gate backfills `UNVERIFIABLE` for any wave whose `bugs/wave-<W>.json`
is missing or has a null `verifier_status`. The change: the gate reads `verify_mode`
to know which waves were *in scope* for verification.

- A wave that was in scope (would have been verified under the mode) but has a
  missing/null verdict → backfill `UNVERIFIABLE` (unchanged).
- A wave whose bug JSON carries a deliberate `verifier_status: "SKIPPED"` → left as
  is, no bug synthesized.

Because `SKIPPED` is *written* at 4c as a present, non-null status, a genuinely
missing verifier for an in-scope wave still trips the gate. The invariant
"structurally impossible to open a PR while a *requested* verdict is outstanding"
holds. `SKIPPED` records an intentional, transparent absence of a requested verdict
— not a silently-closed wave.

## Surfacing (reduced coverage is never silent)

- **Pre-flight:** print the resolved mode and its source, e.g.
  `Verification mode: last-wave-only (from --verify flag).`
- **Step 3 wave-plan display:** the "Estimated total agents" line counts verifiers
  under the chosen mode (per-agent: sum of dev agents; per-wave: W; last-wave-only:
  1; off: 0).
- **Wave dashboard (4d):** the verifier row shows `SKIPPED` for skipped waves.
- **Manifest:** new top-level `verification` block:
  `{"mode": "<mode>", "waves_total": <W>, "waves_verified": <n>, "waves_skipped": <n>}`.
  Optional field, "pre-1.9.0" back-compat note. Per-wave `wave_verifier_status`
  may now be `SKIPPED`.
- **Final summary / re-run prompt:** when coverage is reduced, print
  `Verification: <mode> — <verified>/<W> waves verified, <skipped> skipped (unverified).`
- **PR (skills/pr/SKILL.md):** when `verification.waves_skipped > 0`, force the PR
  to open as **draft** (regardless of bug count) and add a body banner:
  `⚠ Verification: <mode> — <skipped> of <W> waves unverified`. This is in addition
  to the existing draft-when-bugs-remain behavior.
- **Token Report:** the Verify phase row naturally shows 0 agents for `off`; no
  special-casing needed beyond omitting an empty phase row as today.

## Touch-points

- `skills/run/SKILL.md`
  - Argument parsing: add `--verify <mode>` (takes a value; strip before using the
    plan path).
  - New pre-flight sub-step (after the existing 1c/1d cluster): "Resolve
    verification mode" — read `.plan-runner.yml`, apply flag override, validate,
    default `per-wave`, print the resolved mode, store `verify_mode`.
  - Step 1e manifest init: add the `verification` block.
  - Step 3: verifier count in the agent estimate reflects the mode.
  - Step 4b: branch verifier dispatch on `verify_mode` (the four behaviors above).
  - Step 4c: write the `SKIPPED` bug JSON for skipped waves; per-agent merge logic.
  - Step 4d: dashboard shows `SKIPPED`.
  - Step 4f: manifest wave entry may carry `wave_verifier_status: "SKIPPED"`;
    update `verification` counters.
  - Step 5.0: coverage gate reads `verify_mode` (in-scope-missing → UNVERIFIABLE;
    SKIPPED → left alone).
  - Final summary (Step 6/7): the reduced-coverage line.
- `skills/pr/SKILL.md` — read manifest `verification`; draft + banner when
  `waves_skipped > 0`.
- `schemas/manifest.schema.json` — add optional `verification` object with the
  "pre-1.9.0" back-compat note; update `schemas/examples/manifest-valid.json` and
  keep `manifest-invalid.json` failing for the right reason (old manifests without
  `verification` must still validate).
- `tests/contract.test.js` — pin: the four modes exist in the run-skill prose; the
  precedence (flag > file > default); `SKIPPED` is distinct from `UNVERIFIABLE` and
  is NOT counted as a bug; the coverage gate reads the configured mode; the PR
  drafts + banners on skipped waves; the config file name `.plan-runner.yml`. Bump
  the pinned version assertion to `1.9.0`.
- Version bump (one commit, four places): `plugin.json` `version` 1.8.3 → 1.9.0;
  the contract version assertion; `package.json` `version`; a new `CHANGELOG.md`
  1.9.0 entry.
- `README.md` — document `.plan-runner.yml`, the four modes, and `--verify`.
- `plugin.json` `description` — add a clause noting configurable verification
  coverage.

`agents/plan-verifier.md` — untouched.

## Verification (from CLAUDE.md; run all three before claiming done)

```
node --test tests/contract.test.js
python tests/validate_schemas.py
claude plugin validate .
```

## Invariants preserved

- **No self-verify.** The orchestrator still never substitutes its own judgment for
  a verifier's verdict. `SKIPPED` is an explicit config-driven absence, not the
  orchestrator verifying in the verifier's place. `UNVERIFIABLE` behavior unchanged.
- **Coverage gate stays upstream of the PR step** on every path and still makes it
  impossible to open a PR while a *requested* verdict is outstanding. It now also
  distinguishes deliberate skips from missing verdicts.
- **Token accounting best-effort.** Per-agent mode appends one honest `verify`
  entry per verifier; unreported verifiers get `null` as today.
- **Least-privilege agents.** No agent tools change; the verifier stays read-only.
- **git optional.** No new git dependency; the PR draft/banner change is inside the
  already git-gated PR step.
