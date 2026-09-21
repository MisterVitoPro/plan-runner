# ADR-0011: The task DAG is the only executor

Status: accepted
Date: 2026-09-20

## Context

ADR-0006 made the dependency-ready task DAG the default executor and kept the wave executor as
"a temporary rollback-compatible mode" and as the automatic path when Git or worktrees were
unavailable. One instrumented run on a repository without Git -- two fix cycles, 45 waves, about
25 hours of wall-clock -- showed what keeping it cost:

- Every wave waited at a barrier for its slowest agent, then for its gates, and (without a commit
  to pin a snapshot to) for its verifier. Waves averaged fewer than three agents against a cap of
  six, because file-disjointness and TDD test-then-impl ordering serialize a shared tree.
- A shared working tree forbids agents from running their own tests (another agent's half-written
  file breaks the build), so every defect waited for the next cycle. The repair loop was the
  cycle, and a cycle took hours.
- The skill carried two executors. The DAG overlay leaned on wave-step prose for prompt assembly,
  gates, verification, and reporting, so neither path was specified on its own, and every
  feature had to be written, tested, and kept honest twice.

## Options

1. **Keep both executors.** Preserves no-Git operation and a rollback switch, and keeps paying for
   all three costs above.
2. **DAG-shaped scheduling on a shared tree when Git is absent.** ADR-0006 already rejected this:
   without isolation, gates cannot run while other agents are editing, so the schedule degrades
   into barriers again, without the ownership and integration evidence worktrees provide.
3. **The task DAG only; Git with usable worktrees required.**

## Decision

Choose option 3. The wave executor, its no-Git fallback, wave slicing and per-wave commits,
configurable verification coverage (`per-agent` / `per-wave` / `last-wave-only`), pipelined
snapshot verification, and the wave-plan artifact are removed. Pre-flight STOPs, changing
nothing, when Git, a first commit, or worktree support is missing, and says how to prepare the
directory. `--execution-mode wave` and `execution.mode: wave` are hard errors; the removed
verification flags are accepted and ignored so old invocations do not crash.

Removing the fallback is what makes the rest possible: with every task in its own worktree, an
agent may run its own targeted tests, gates run without interference, verification reads a
pinned tree with no snapshot machinery, and integration can be gated on severity instead of
committing every wave whatever its bugs.

## Consequences

- A repository without Git can no longer run plan-runner. `git init` plus one commit is the
  migration, and the pre-flight message says so.
- Wave-era checkpoints cannot be resumed; their plans start a fresh run. Schemas only relax, so
  wave-era manifests, run-states, and bug reports still validate.
- A fresh worktree lacks untracked dependencies and build caches, so the skill gains a worktree
  bootstrap (`worktree.share` / `worktree.setup`). This is the main new operational surface.
- Verification is no longer a cost dial. Every task attempt gets one verifier; the saving comes
  from repairs happening per task, in minutes, instead of per cycle, in hours.
- A cycle's work lives on its run-owned branch, so a fix-plan re-run must be based on the
  previous cycle's branch (`--base`), and the pre-PR code-atlas sync is dropped: the operator's
  checkout does not change until the PR merges.
- This supersedes ADR-0006's retention of the wave executor and ADR-0003's wave-count phasing
  unit. ADR-0003's relay/stop phase model and ADR-0004's run-state checkpoint remain in force,
  with successful integrations as the only phase boundary.
