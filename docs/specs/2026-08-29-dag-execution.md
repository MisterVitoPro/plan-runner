# Task-DAG execution for plan-runner - design spec

Date: 2026-08-29 / Status: approved / Author: MisterVitoPro

## Problem

Plan Runner's current file-disjoint wave executor waits at a global barrier after every wave. A
slow, unrelated task therefore delays all downstream-ready work, while large plans retain a
wave-shaped checkpoint model that is no longer the best unit of scheduling. The executor needs
task-level parallelism and recovery without sacrificing isolated changes, independent verification,
or human control of delivery.

## Existing system

Plan Runner is a dual-client Claude Code and Codex plugin whose Markdown skill and agent prose is
the executable product. The analyzer emits a DAG-ordered, file-disjoint wave plan of at most six
dev agents per wave. The run skill dispatches a whole wave, waits at its barrier, performs TDD
gates, commits the shared tree, and pipelines a snapshot verifier into the next wave. Phasing and
`run-state.json` checkpointing currently use wave completion; verifier reports, manifests, bug
aggregation, and the PR skill provide durable evidence. Git is optional today, and a successful
run creates or updates a PR for human review.

## Goals

- Replace wave barriers with default dependency-ready task scheduling in Git repositories.
- Isolate each task's writes in its own disposable Git worktree and integrate only verified commits.
- Preserve bounded concurrency, independent verification, TDD behavior, resumability, and
  human-controlled PR delivery.
- Run scoped deterministic checks for every task and complete-suite checks at dependency-frontier
  boundaries and before the PR.
- Make retries, conflicts, blocks, time, and token use reconstructable from durable artifacts.
- Retain a wave-mode rollback path and continue operating without Git through that path.

## Non-goals

- Automatic merge authority is excluded; all successful runs remain PRs for human review.
- DAG execution in repositories without Git/worktrees is excluded; those runs use the legacy wave
  executor instead.
- Unbounded autonomous repair is excluded; a task receives at most one evidence-backed retry.
- Immediate deletion of the wave executor is excluded; it remains a temporary rollback-compatible
  mode.
- One-PR-per-task delivery is excluded.

The Git-only DAG constraint conflicts with the existing no-Git capability; the conflict resolves
by retaining the existing wave executor automatically. The throughput goal conflicts with
unbounded retry and automatic merge; bounded repair and the existing human PR gate win.

## Users / consumers

The run skill and its analyzer, developer, verifier, aggregator, PR skill, and generated cycle
artifacts consume the design. Operators invoke it from Claude Code or Codex and review its final PR.

## Requirements

1. **MODIFIED — execution plan.** The analyzer SHALL produce a stable task graph containing task
   identifiers, explicit dependency edges, owned-file declarations, recommended model, TDD role,
   risk information, and verification scope. The graph SHALL preserve every ordering dependency
   that the source plan declares. (Ledger — approach)
2. **MODIFIED — executor selection.** In a Git repository with usable worktrees, the run skill
   SHALL select DAG execution by default. It SHALL retain a selectable wave executor as a rollback
   mode, and SHALL select wave execution when Git or worktrees are unavailable. (Ledger — migration;
   Git/no-git policy)
3. **ADDED — DAG preflight and branch ownership.** Before DAG dispatch, the scheduler SHALL capture
   the clean base commit, then create a run-owned integration
   branch. It SHALL never mutate the operator's active branch. If the checkout is dirty, it SHALL
   require an explicit stash-or-abort DAG decision before creating the integration branch. (Ledger —
   integration branch lifecycle)
4. **ADDED — dependency-ready scheduling.** The DAG scheduler SHALL dispatch only tasks whose
   declared dependencies have integrated successfully, and SHALL never schedule two active tasks
   with overlapping owned files. (Ledger — approach; inherited safety and portability constraints)
5. **ADDED — isolated task execution.** Every DAG task SHALL execute in a disposable branch and
   worktree rooted at the integration commit that satisfied its dependencies. A task agent SHALL
   write only its declared owned files plus its return artifact. (Ledger — execution and integration;
   inherited safety and portability constraints)
6. **ADDED — ownership conformance.** Before verification and again before integration, the
   scheduler SHALL compare the task commit's complete diff -- including added, deleted, renamed,
   generated, and shared files -- against its declared ownership semantics. It SHALL reject or
   block an undeclared write with durable evidence. If intervening integrations touch a task's
   owned files or verification inputs, it SHALL re-execute that task with scoped checks before
   integration. (Ledger — ownership enforcement)
7. **ADDED — deterministic integration.** A central integrator SHALL be the only component that
   mutates the integration branch. It SHALL accept a task commit only after its required scoped
   deterministic checks and independent verification have produced durable results. (Ledger —
   execution and integration; verification cadence; inherited safety and portability constraints)
8. **MODIFIED — verification cadence.** The system SHALL run scoped deterministic checks for each
   task, and SHALL run the full suite at dependency-frontier or integration-phase boundaries and
   before opening or updating a PR. (Ledger — verification cadence)
9. **ADDED — bounded repair.** If task checks or independent verification return actionable
   findings, the scheduler SHALL issue one evidence-backed repair attempt for that task. If the
   repair attempt fails, the task SHALL become blocked and retain its evidence. (Ledger — remediation)
10. **ADDED — conflict handling.** If the integrator cannot apply a verified task commit to the
   current integration branch, it SHALL recreate that task's worktree at the current integration
   commit, supply the conflict evidence, and retry once with scoped checks. A second integration
   conflict SHALL block the task. (Ledger — integration conflicts)
11. **MODIFIED — recovery state.** `run-state.json` SHALL persist every task's dependencies, status,
   attempt count, base/produced/integrated commits, verification artifact paths, and stop reason.
   An append-only `events.jsonl` SHALL record dispatch, integration, retry, and block
   decisions, plus the captured base ref, integration branch, and branch ownership. Resume SHALL
   read those artifacts and never infer an unfinished task from Git state alone. (Ledger — recovery
   and auditability; integration branch lifecycle)
12. **MODIFIED — long-run boundaries.** The scheduler SHALL checkpoint after a configurable count
   of successful integrations rather than a count of waves. It SHALL retain relay/stop behavior so
   small runs can continue through a lean driver and large runs can stop and resume with a fresh
   coordinator process. (Ledger — long-run lifecycle)
13. **MODIFIED — reporting.** Cycle artifacts and the final Run Report SHALL provide task-oriented
   outcome evidence without fabricating unreported token values. (Ledger — scope; recovery and
   auditability)
14. **MODIFIED — delivery.** The PR skill SHALL run only after every non-blocked DAG task required
   by the graph has an integration and the final verification boundary has passed. It SHALL retain
   the existing human-review PR endpoint and SHALL not auto-merge. (Ledger — delivery authority)

### Non-functional requirements

14. **Safety and correctness.** The DAG executor SHALL preserve file ownership enforcement,
    no-self-verification, verifier-coverage honesty, and the existing TDD red/green contracts.
    (Ledger — brownfield baseline; approach)
15. **Portability.** The DAG and wave fallback behavior SHALL be specified through the shared
    host-neutral orchestration prose and work for both Claude Code's and Codex's native subagent
    facilities. (Ledger — brownfield baseline)
16. **Bounded resources.** The scheduler SHALL enforce the existing maximum of six concurrent dev
    tasks and SHALL dispose of task worktrees after their final integration or block evidence is
    durable. (Ledger — brownfield baseline; approach)
17. **Observability.** The scheduler SHALL persist enough state and events for an operator to
    reconstruct why any task was dispatched, retried, integrated, or blocked after a
    process stop or crash. (Ledger — recovery and auditability)

## Chosen approach

Dependency-ready task DAG execution with isolated worktrees and deterministic central integration.
It supersedes the wave-based execution portion of ADR-0003 while retaining its bounded-memory and
durable-recovery intent. See [ADR-0006](../adr/0006-task-dag-execution.md).

Shared-tree DAG batches and one-branch/PR-per-task delivery were considered but not selected.

## Architecture & components

- **Graph analyzer** — emits the task graph and its scheduling/verification metadata.
- **Durable scheduler** — selects dependency-ready work and owns persistent task state.
- **Worktree executor** — runs one task in one disposable branch/worktree.
- **Verification controller** — runs scoped deterministic checks and coordinates independent
  semantic verification plus frontier/full-suite gates.
- **Deterministic integrator** — serially applies verified task commits to the integration branch.
- **Repair controller** — performs the single evidence-backed task or conflict retry.
- **Compatibility executor** — runs the current wave pipeline when selected or required without Git.

`Graph analyzer -> Durable scheduler -> Worktree executor -> Verification controller -> Deterministic integrator -> run-state/events/report -> PR skill`

## Data & interfaces

- **Task graph artifact:** replaces or extends the current wave-plan JSON with stable task IDs,
  `depends_on`, `owned_files`, ownership semantics for added/deleted/renamed/generated/shared files,
  TDD role, recommended model, risk metadata, and verification scope.
- **Executor configuration:** an execution-mode setting selects default DAG or legacy wave mode;
  an integration-count phase setting controls relay/stop boundaries. Exact key names are binding
  defaults in Assumptions.
- **Task state:** `run-state.json` gains schema-defined per-task lifecycle fields for attempts,
  dependency results, Git commit references, artifact references, and stop reason.
- **Event stream:** `events.jsonl` contains append-only machine-readable lifecycle events for the
  selected dispatch, integration, retry, and block categories; exact field names are schema details.
- **Integration branch boundary:** DAG preflight captures the base ref, then creates a run-owned
  integration branch. `run-state.json` and `events.jsonl` record the base ref, integration branch,
  and ownership; the PR handoff uses the run-owned branch without changing the operator's branch.
- **Worktree boundary:** one task branch/worktree is based on its dependency-satisfying integration
  commit. The integration branch remains the sole serial mutation target.
- **Reports:** cycle reports retain task-oriented outcome evidence and token-coverage honesty.

## Edge cases & error handling

- **No Git or no worktree support:** select the legacy wave executor automatically. (decided)
- **Dirty operator checkout:** require an explicit stash-or-abort DAG decision before branch
  creation; never base a DAG run on ambiguous local changes. (decided)
- **Overlapping task ownership:** defer the later task until overlap is absent; never run conflicting
  writers concurrently. (decided approach)
- **Undeclared or stale task changes:** reject or block a diff outside declared ownership, and
  re-execute a task against current integration state when intervening integrations touched its
  ownership or verification inputs. (decided)
- **Dependency failure or block:** do not schedule dependent tasks; record the dependency-derived
  block in state and events. (binding default)
- **First verification failure:** run one evidence-backed repair attempt, then block on failure.
  (decided)
- **Integration conflict:** rebuild at the current integration commit and retry once; block after a
  second conflict. (decided)
- **Coordinator crash or stop:** resume solely from durable task state and events; completed
  integrations do not run again. (decided)
- **Relay memory limit:** checkpoint at the configured integration count and use existing relay/stop
  semantics rather than retaining one unbounded coordinator. (decided)
- **Incomplete graph or corrupt state:** stop before dispatch and surface the malformed artifact;
  never guess dependencies or task completion. (binding default)

## Acceptance criteria (EARS)

1. WHEN a Git repository has usable worktrees and no explicit wave-mode override, THE SYSTEM SHALL
   execute the validated plan as a dependency-ready task DAG.
2. WHEN Git or worktree support is unavailable, THE SYSTEM SHALL execute the existing wave pipeline
   without attempting DAG worktree dispatch.
3. WHEN DAG preflight begins on a clean checkout, THE SYSTEM SHALL capture the base ref and create a
   run-owned integration branch without mutating the operator's active branch; IF the checkout is
   dirty, THEN THE SYSTEM SHALL require an explicit stash-or-abort DAG decision.
4. WHEN a task's dependencies are integrated, THE SYSTEM SHALL make that task eligible for dispatch
   without waiting for unrelated ready tasks to finish.
5. WHILE a task is active, THE SYSTEM SHALL run it in a disposable task worktree and SHALL prevent a
   concurrently active task from writing an overlapping owned file.
6. WHEN a task commit contains added, deleted, renamed, generated, or shared-file changes, THE
   SYSTEM SHALL validate them against declared ownership before verification and integration; IF an
   intervening integration touches that task's ownership or verification inputs, THEN THE SYSTEM
   SHALL re-execute the task with scoped checks before integration.
7. WHEN a task's scoped checks and independent verification pass, THE SYSTEM SHALL integrate its
   commit through the central integrator and record the resulting commit reference.
8. WHEN a task's deterministic checks or independent verification produce actionable findings, THE
   SYSTEM SHALL issue no more than one evidence-backed repair attempt before marking it blocked.
9. IF integration of a verified task conflicts with the current integration branch, THEN THE SYSTEM
   SHALL recreate the task worktree at the current integration commit and retry it once; IF that
   retry conflicts, THEN THE SYSTEM SHALL mark the task blocked.
10. WHEN a DAG run stops or crashes, THE SYSTEM SHALL resume from `run-state.json` and `events.jsonl`
   without redispatching an already integrated task.
11. WHEN the configured integration-count boundary is reached, THE SYSTEM SHALL checkpoint and apply
   relay or stop/resume behavior without using wave count as the boundary.
12. WHEN a dependency frontier closes and before the PR step, THE SYSTEM SHALL run the full test
    suite and retain its result as a verification artifact.
13. WHEN a task is retried, integrated, or blocked, THE SYSTEM SHALL persist an event and
    enough task state to explain that outcome after restart.
14. WHEN the task graph cannot be validated or durable state is corrupt, THE SYSTEM SHALL stop before
    dispatching work and SHALL not infer missing dependencies or task completion.
15. WHEN all required tasks are integrated and the final verification boundary passes, THE SYSTEM
    SHALL create or update a PR for human review and SHALL not auto-merge it.
16. WHILE DAG execution is active, THE SYSTEM SHALL preserve the existing six-concurrent-dev-task
    limit, TDD contracts, independent-verifier rule, and honest token coverage reporting.
17. WHEN an operator selects wave mode, THE SYSTEM SHALL preserve the legacy wave executor as the
    explicit rollback behavior.

## Verification strategy

- **unit:** graph/state schemas, clean-base/branch ownership preflight, scheduler eligibility,
  ownership-diff validation (including add/delete/rename/generated/shared paths), overlap exclusion,
  task transitions,
  retry caps, integration-conflict transitions, no-Git fallback, report counters, and back-compat
  fixtures. Covers criteria 1-9 and 11-12, 14-15.
- **integration:** a synthetic graph with independent slow and fast tasks demonstrates that a child
  begins after its own integrated dependency without waiting for an unrelated task; exercise task
  worktree integration, stale-base re-execution, scoped checks, frontier/full-suite gates, resume,
  and the one-conflict retry. Covers criteria 3-12 and 15.
- **manual:** run an equivalent representative plan through DAG and wave modes on both clients;
  confirm the DAG artifact trail, PR remains human-reviewed, and the no-Git path selects waves.
  Covers criteria 1-2, 8-9, 11, and 13-15.

## Assumptions (unconfirmed)

- **Binding default:** the existing six-dev-agent maximum remains the global DAG-task concurrency
  ceiling. Criterion 14.
- **Binding default:** the existing task metadata for recommended model and TDD role is preserved in
  the task graph. Criterion 1.
- **Binding default:** task identifiers are stable within a run and preserve source-plan ordering
  dependencies; task return artifacts are the sole owned-file exception; PR eligibility requires
  every non-blocked required task to be integrated after final verification. Criteria 1, 5, and 15.
- **Binding default:** each task worktree starts from the integration commit that satisfies its
  declared dependencies. Criterion 5.
- **Binding default:** durable task state is authoritative over Git inference; existing timing,
  token accounting, verifier coverage, PR gating, and durable artifacts carry forward to
  task-oriented reporting. Criteria 8, 11, 12, and 14.
- **Binding default:** the DAG-mode setting is named `execution.mode`, with `dag` as its default and
  `wave` as the rollback value. Criteria 1 and 15.
- **Binding default:** the integration-count phase setting is named
  `phasing.max_integrations_per_phase`; the existing relay/stop mode and guardrail semantics are
  retained. Criterion 9.
- **Binding default:** a dependency of a blocked task causes the dependent to be recorded as blocked
  rather than attempting speculative execution. Criterion 11.
- **Binding default:** malformed graph/state artifacts stop the run before dispatch. Criterion 12.
- **Binding default:** task branches and worktrees are removed after final evidence is durable;
  durable return, test, verifier, state, and event artifacts remain in the cycle directory.
  Criterion 14.
- **Binding default:** dependent tasks record a dependency-derived block rather than executing
  speculatively; exact lifecycle values and event-record fields are schema parameters. Criterion 11.
- **Binding default:** repository documentation and synchronized release/version validation
  obligations are updated by the implementation release.

## Open questions

None.

## Definition of done

- Task-graph, state, manifest, and event schemas plus valid/invalid/back-compat fixtures pass.
- Contract tests prove DAG scheduling, worktree isolation, bounded repair, integration-count
  phasing, and wave/no-Git fallback behavior on both client paths.
- Integration and manual smoke checks cover independent-task throughput, conflict retry, resume,
  full-suite frontiers, and human-reviewed PR delivery.
- Existing wave execution remains available as rollback behavior and all no-Git behavior remains
  functional.
- README, changelog, release smoke guidance, plugin metadata, and version pins are updated in the
  implementation release.
- Every acceptance criterion above passes.
