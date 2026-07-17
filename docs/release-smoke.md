# Release smoke check: large-plan memory and resume

Manual/scripted release-checklist item -- **not** run in CI. It exercises
the failure mode phasing exists to fix: a plan large enough that the
orchestrator's host process creeps toward its memory envelope, plus the
stop/resume machinery that lets a phased run survive across sessions.

Run this before cutting a release that touches `skills/run/SKILL.md`,
`schemas/run-state.schema.json`, or anything else load-bearing for phasing
or resume.

## What it checks

`test-fixtures/large-plan.md` is a 52-task, 13-wave fixture designed so
that, under a completely default `.plan-runner.yml` (no `phasing:`
overrides), it slices into 4 phases. See that file for the full
wave/phase breakdown. Because 4 phases exceeds the default
`auto_stop_phases` (`3`), the adaptive default (`mode: auto`) should pick
**stop** mode -- so a correct run of this fixture will hit at least one
stop boundary and require an explicit `--resume` to finish, not just relay
straight through in a single session.

Passing means:

- The host process running the orchestrator session stays within its
  memory envelope for the whole run -- no OOM, no crash, and no session's
  peak memory climbing far past a fresh-session baseline. A `stop`-mode
  boundary is expected to bring memory back down close to that baseline in
  the next (freshly started) session, since stop mode is the one that
  resets the host process, not just the agent's context (see "Phasing
  large plans" in `README.md`).
- The run completes end to end -- reaching `run-state.json` status
  `complete` -- using only the resume invocations plan-runner itself
  prints at each boundary, across as many resumed sessions as there are
  stop boundaries. No manual editing of `run-state.json` or the phase
  directories.

## How to run it

1. **Use a disposable copy of the repo**, e.g. a scratch git worktree or a
   throwaway clone -- never the primary working checkout. The run makes
   real per-wave commits and writes real scratch files under
   `test-fixtures/scratch/large-plan/`.
2. **Do not** pass `--phase-size`, `--phase-mode`, or `--no-phasing`, and
   do not add a `phasing:` block to `.plan-runner.yml` in the disposable
   copy. The point of this check is the *default* configuration.
3. Note a memory baseline for the host process before starting (e.g.
   `Get-Process -Id $PID` working set on Windows, `ps`/Activity
   Monitor/`top` elsewhere -- whatever tracks the process actually running
   the agent harness).
4. Start the run:

   ```bash
   # Claude Code
   /plan-runner:run test-fixtures/large-plan.md

   # Codex
   $plan-runner:run test-fixtures/large-plan.md
   ```

5. Watch host memory while waves 1-4 (phase 1) execute. When the session
   prints the phase-boundary block with a copy-pasteable resume invocation
   and ends, record memory again -- it should not be pinned near its peak
   once the session has actually exited.
6. Start a **new** session using the printed invocation:

   ```bash
   # Claude Code
   /plan-runner:run --resume

   # Codex
   $plan-runner:run --resume
   ```

   Repeat step 5-6 at each subsequent phase boundary (phases 2, 3, then
   the short phase 4) until the run reaches its terminal phase and prints
   the full Run Report.
7. Confirm `run-state.json` at the cycle root reports status `complete`,
   and that `test-fixtures/scratch/large-plan/stage-01/` through
   `stage-13/` all exist with their 4 notes each.

## If the defaults change

This check is only meaningful against the *shipped* defaults
(`max_waves_per_phase: 4`, `mode: auto`, `auto_stop_phases: 3`,
`relay_max_minutes: 90`). If a future change alters those defaults enough
that `test-fixtures/large-plan.md` no longer slices into 10+ waves and 3+
phases with at least one stop boundary, resize the fixture (add or remove
stages) rather than passing overrides here -- overrides would stop testing
the experience most large-plan users actually get.

## Optional secondary check

Spot check the kill switch on the same disposable copy: run
`/plan-runner:run test-fixtures/large-plan.md --no-phasing` (or the Codex
equivalent) and confirm it runs the full 13 waves in one uninterrupted
session with no phase directories and no `run-state.json` -- i.e. today's
pre-phasing behavior, unchanged.
