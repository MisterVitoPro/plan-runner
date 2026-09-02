# ADR-0006: Dependency-ready DAG execution with isolated task worktrees

Status: accepted
Date: 2026-08-29

## Context

Plan Runner currently groups work into file-disjoint waves, imposes a barrier after every wave,
and checkpoints recovery at wave boundaries. The barrier leaves dependency-independent work idle
behind the slowest task in a wave. The planned executor must improve throughput without weakening
isolated execution, verification, crash recovery, dual-client portability, or human-controlled PR
delivery.

This ADR supersedes ADR-0003 only for its wave-based execution and phasing unit. Its durable-state
and process-memory-reclamation intent remains in force.

## Options

1. **Dependency-ready task DAG with isolated worktrees.** The analyzer emits explicit task
   dependencies. Each ready task runs in a disposable worktree; a deterministic integrator applies
   verified task commits to one integration branch. Durable task state supports restart and bounded
   retry.
2. **DAG-shaped batches on a shared tree.** Ready tasks run individually but mutate one working
   tree and commit in batches.
3. **One branch and PR per task.** Each task is an externally visible delivery unit, followed by an
   integration PR.

## Decision

Choose option 1. DAG execution is the default for Git repositories. The legacy wave executor is
retained as a rollback mode and remains the automatic path when Git or worktrees are unavailable.
The durable checkpoint boundary changes from a count of waves to a count of successful task
integrations; existing relay/stop semantics remain the mechanism for recovering coordinator memory.
DAG preflight captures a clean base commit and creates a run-owned integration branch without
mutating the operator's active branch; a dirty checkout requires explicit stash-or-abort handling.

## Consequences

- Independent work can begin as soon as its actual dependencies integrate rather than waiting for
  an unrelated task in the same former wave.
- The executor gains task-level branches, worktrees, integration state, and recovery evidence.
- The analyzer, state schema, manifests, contracts, fixtures, documentation, and both client
  execution paths require coordinated changes.
- Central integration serializes repository mutation deliberately; merge conflicts are retried once
  against current integration state, then surface as evidence-backed blocks.
- Ownership is enforced from the declared task graph through complete task-diff checks before
  verification and integration; stale task bases are re-executed rather than integrated blindly.
- The base ref, integration branch, and branch ownership are persisted so resume and PR handoff can
  never infer or overwrite operator work.
- No automatic merge authority is added; a completed run still produces a PR for human review.
