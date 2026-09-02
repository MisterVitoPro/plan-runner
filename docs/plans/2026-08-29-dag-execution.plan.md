# Task-DAG execution for plan-runner - implementation plan

Goal: Replace wave barriers with a safe, resumable, Git-worktree task-DAG executor while preserving wave rollback and human-reviewed PR delivery.
Source spec: docs/specs/2026-08-29-dag-execution.md
Flagged constraints (unconfirmed): Preserve the six-task ceiling; carry recommended model/TDD metadata and stable task IDs; permit only the return-artifact ownership exception; base each task at its dependency-satisfying integration commit; retain task-oriented state/reporting and existing honesty evidence; use `execution.mode` and `phasing.max_integrations_per_phase`; block malformed state/dependents safely; retain durable artifacts and release/documentation protocol.
Skeleton manifest: docs/plans/2026-08-29-dag-execution.skeleton.json
Dependency graph: docs/plans/2026-08-29-dag-execution.graph.json

### Task 1: Define the task graph, DAG scheduler, and durable task state
Task ID: dag-execution-t01
Owned files: skills/run/SKILL.md, agents/plan-analyzer.md, schemas/wave-plan.schema.json, schemas/run-state.schema.json, schemas/task-graph.schema.json, schemas/task-event.schema.json
Interfaces: consumes Markdown plans, existing `.plan-runner.yml`, Git/worktree capability, and the legacy wave artifact shape; produces a validated task graph, DAG/wave mode decision, run-owned integration branch contract, task-level run state, and append-only lifecycle events for Tasks 2-5.
Graph context: owns task:dag-execution-t01 and file nodes for `skills/run/SKILL.md`, `agents/plan-analyzer.md`, `schemas/wave-plan.schema.json`, `schemas/run-state.schema.json`, `schemas/task-graph.schema.json`, and `schemas/task-event.schema.json`; produces contract:task-graph and contract:task-state; edges task:dag-execution-t01 -owns-> each file node, task:dag-execution-t01 -produces-> contract:task-graph, task:dag-execution-t01 -produces-> contract:task-state.
Acceptance criteria:
- WHEN a Git repository has usable worktrees and no explicit wave-mode override, THE SYSTEM SHALL validate and execute the plan as a dependency-ready task graph with stable task IDs and declared dependency edges.
- WHEN Git or worktree support is unavailable, THE SYSTEM SHALL select the existing wave executor without attempting task-worktree dispatch.
- WHEN DAG preflight begins on a clean checkout, THE SYSTEM SHALL capture the base ref and create a run-owned integration branch without mutating the operator's active branch; IF the checkout is dirty, THEN THE SYSTEM SHALL require an explicit stash-or-abort DAG decision.
- WHEN a task's declared dependencies are integrated, THE SYSTEM SHALL make it eligible for dispatch without waiting for unrelated ready tasks, while enforcing the existing six-concurrent-dev-task ceiling.
- WHEN a task graph or durable task state is malformed, THE SYSTEM SHALL stop before dispatch and SHALL NOT infer missing dependencies or task completion.
- WHEN the configured integration-count boundary is reached, THE SYSTEM SHALL checkpoint task state and apply relay or stop/resume behavior without using wave count as the boundary.
- WHEN a DAG run stops or crashes, THE SYSTEM SHALL resume from task state and append-only events without redispatching an already integrated task.
Verification: run `node --test tests/contract.test.js` and `python tests/validate_schemas.py`; manually inspect a synthetic graph fixture for stable IDs, dependency edges, mode selection, clean-base capture, and resume pointers.
Non-goals:
- Does not remove the legacy wave executor.
- Does not add automatic merge authority or network dependencies.
Blocked by: none
Constraints: This is the walking skeleton and owns the execution hotspot files. Preserve all existing flags and compatibility behavior unless the approved spec explicitly changes it; keep shared orchestration host-neutral for Claude Code and Codex.

### Task 2: Define isolated task workers, ownership enforcement, and verifier handoffs
Task ID: dag-execution-t02
Owned files: agents/plan-integrator.md, agents/plan-dev.md, agents/plan-test-author.md, agents/plan-verifier.md, schemas/dev-return.schema.json, schemas/bug-report.schema.json
Interfaces: consumes contract:task-graph and contract:task-state from dag-execution-t01; produces task-worktree return, ownership-conformance, repair, integration, and independent-verifier contracts consumed by the scheduler and reporting tasks.
Graph context: owns task:dag-execution-t02 and file nodes for `agents/plan-integrator.md`, `agents/plan-dev.md`, `agents/plan-test-author.md`, `agents/plan-verifier.md`, `schemas/dev-return.schema.json`, and `schemas/bug-report.schema.json`; consumes contract:task-graph and contract:task-state; produces contract:task-worktree, contract:ownership-conformance, and contract:verification-result; edges task:dag-execution-t02 -depends-on-> task:dag-execution-t01 and task:dag-execution-t02 -consumes-> contract:task-graph/task-state.
Acceptance criteria:
- WHILE a DAG task is active, THE SYSTEM SHALL run it in a disposable branch/worktree based on the integration commit that satisfies its dependencies and SHALL prevent concurrent overlapping writers.
- WHEN a task commit contains added, deleted, renamed, generated, or shared-file changes, THE SYSTEM SHALL validate its complete diff against declared ownership before verification and integration; IF an undeclared write exists, THEN THE SYSTEM SHALL reject or block the task with durable evidence.
- IF intervening integrations touch a task's owned files or verification inputs, THEN THE SYSTEM SHALL re-execute that task with scoped checks before integration.
- WHEN scoped checks and independent verification pass, THE SYSTEM SHALL permit only the central integrator to apply the task commit to the run-owned integration branch.
- WHEN deterministic checks or independent verification produce actionable findings, THE SYSTEM SHALL issue no more than one evidence-backed repair attempt before marking the task blocked.
- IF a verified task conflicts with the current integration branch, THEN THE SYSTEM SHALL rebuild it at the current integration commit and retry once; IF the retry conflicts, THEN THE SYSTEM SHALL mark the task blocked.
- WHILE DAG execution is active, THE SYSTEM SHALL preserve the existing TDD red/green contracts, no-self-verification rule, and task return-artifact exception to owned-file scope.
Verification: run `node --test tests/contract.test.js` and `python tests/validate_schemas.py`; use an integration fixture with a renamed file, an undeclared write, a stale base, and two conflict attempts.
Non-goals:
- Does not let developers self-integrate or self-verify.
- Does not allow unbounded repair or conflict retry.
Blocked by: dag-execution-t01
Constraints: The integration role and every task agent must return distilled, file-backed evidence. Existing role paths remain resolved relative to the active skill; Codex must not depend on named-agent registration.

### Task 3: Make manifests, PR handoff, and reports task-oriented
Task ID: dag-execution-t03
Owned files: skills/pr/SKILL.md, schemas/manifest.schema.json, schemas/examples/manifest-valid.json, schemas/examples/manifest-invalid.json, schemas/examples/run-state.valid.json, schemas/examples/run-state.invalid.json
Interfaces: consumes contract:task-state, contract:ownership-conformance, and contract:verification-result; produces task-oriented manifests, PR statistics, and final delivery eligibility evidence.
Graph context: owns task:dag-execution-t03 and file nodes for `skills/pr/SKILL.md`, `schemas/manifest.schema.json`, and the four manifest/run-state fixture nodes; consumes contract:task-state, contract:ownership-conformance, and contract:verification-result; produces contract:task-report and contract:pr-eligibility; edges task:dag-execution-t03 -depends-on-> task:dag-execution-t01 and task:dag-execution-t03 -consumes-> contract:task-state.
Acceptance criteria:
- WHEN a task is retried, integrated, or blocked, THE SYSTEM SHALL persist task-oriented outcome evidence and an append-only lifecycle event without fabricating token usage.
- WHEN all required graph tasks are integrated and the final verification boundary passes, THE SYSTEM SHALL create or update a PR for human review and SHALL NOT auto-merge it.
- WHEN a run reports completion, THE SYSTEM SHALL expose task-oriented outcomes and retain the existing honest token-coverage behavior.
- WHEN task state includes integration branch ownership, verification artifacts, retry evidence, or stop reason, THE SYSTEM SHALL validate those additive fields while preserving back-compatibility for pre-DAG manifests and run states.
Verification: run `python tests/validate_schemas.py`; run `node --test tests/contract.test.js`; inspect a synthetic completed DAG manifest and PR body for task evidence and no auto-merge claim.
Non-goals:
- Does not change GitHub merge policy.
- Does not remove legacy wave/phase reporting fields before their compatibility window closes.
Blocked by: dag-execution-t01
Constraints: Preserve manifest schema back-compatibility and the current lower-bound treatment of unreported tokens. The PR source must be the run-owned integration branch, never the operator's active branch.

### Task 4: Add task-DAG contract, schema, and recovery coverage
Task ID: dag-execution-t04
Owned files: tests/contract.test.js, tests/validate_schemas.py, test-fixtures/tiny.md, test-fixtures/medium.md, test-fixtures/large-plan.md, schemas/examples/task-graph-valid.json, schemas/examples/task-graph-invalid.json, schemas/examples/task-event-valid.json, schemas/examples/task-event-invalid.json
Interfaces: consumes all task graph, state, worker, integration, verification, and reporting contracts from Tasks 1-3; produces automated regression evidence and representative plan fixtures.
Graph context: owns task:dag-execution-t04 and file nodes for `tests/contract.test.js`, `tests/validate_schemas.py`, the three plan fixtures, and the four task-graph/event fixtures; consumes contract:task-graph, contract:task-state, contract:task-worktree, contract:ownership-conformance, contract:verification-result, contract:task-report, and contract:pr-eligibility; produces contract:dag-test-evidence; edges task:dag-execution-t04 -depends-on-> tasks dag-execution-t01, dag-execution-t02, dag-execution-t03.
Acceptance criteria:
- WHEN a representative plan contains an independent slow task and a dependent fast task, THE SYSTEM SHALL demonstrate that the dependent starts after its own integrated dependency without waiting for unrelated ready work.
- WHEN tests exercise DAG mode, THE SYSTEM SHALL cover no-Git wave fallback, dirty-tree preflight, run-owned integration branch ownership, task resume, integration-count checkpointing, and explicit wave rollback mode.
- WHEN tests exercise task ownership, THE SYSTEM SHALL cover add/delete/rename/generated/shared path semantics, undeclared-write rejection, stale-base re-execution, and the one-conflict retry cap.
- WHEN schemas or contracts change, THE SYSTEM SHALL validate valid, invalid, and legacy fixtures for graph, event, state, manifest, token, verifier, and PR eligibility evidence.
- WHILE contract tests run, THE SYSTEM SHALL continue to pin dual-client host-neutral orchestration, independent verification, TDD, six-task concurrency, and honest token reporting.
Verification: run `node --test tests/contract.test.js` and `python tests/validate_schemas.py`.
Non-goals:
- Does not weaken current contract coverage to accommodate the new executor.
- Does not require live GitHub, network, or production services for automated coverage.
Blocked by: dag-execution-t01, dag-execution-t02, dag-execution-t03
Constraints: Keep fixtures deterministic and small enough to run locally on Windows, macOS, and Linux. Test prose contracts and schema behavior without requiring a live agent host.

### Task 5: Document, release, and operate the DAG executor
Task ID: dag-execution-t05
Owned files: README.md, CHANGELOG.md, docs/release-smoke.md, package.json, .claude-plugin/plugin.json, .codex-plugin/plugin.json
Interfaces: consumes the delivered behavior and test evidence from Tasks 1-4; produces user/operator documentation, synchronized dual-plugin release metadata, and release-smoke guidance.
Graph context: owns task:dag-execution-t05 and file nodes for `README.md`, `CHANGELOG.md`, `docs/release-smoke.md`, `package.json`, `.claude-plugin/plugin.json`, and `.codex-plugin/plugin.json`; consumes contract:dag-test-evidence and contract:pr-eligibility; produces contract:release-ready; edges task:dag-execution-t05 -depends-on-> tasks dag-execution-t01, dag-execution-t02, dag-execution-t03, dag-execution-t04.
Acceptance criteria:
- WHEN an operator configures or invokes DAG execution, THE SYSTEM SHALL document the default DAG mode, explicit wave rollback mode, automatic no-Git fallback, integration-count relay/stop behavior, clean-base requirement, dirty-tree decision, and resume evidence.
- WHEN a release is prepared, THE SYSTEM SHALL keep `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json`, the changelog, and contract-test version pins synchronized.
- WHEN release smoke runs, THE SYSTEM SHALL verify dual-client task-DAG behavior, ownership enforcement, task-level recovery, wave fallback, and human-reviewed PR delivery in addition to the repository's required validators.
- WHEN user-visible execution reporting changes, THE SYSTEM SHALL document task-oriented outcomes, retry/block evidence, and token-coverage honesty without claiming automatic merge.
Verification: run `node --test tests/contract.test.js`, `python tests/validate_schemas.py`, both plugin validators, and the Codex skill validator; perform the updated release smoke procedure.
Non-goals:
- Does not publish a release or create a GitHub PR.
- Does not add automatic merge, external infrastructure, or new network calls.
Blocked by: dag-execution-t01, dag-execution-t02, dag-execution-t03, dag-execution-t04
Constraints: Follow AGENTS.md release guidance exactly and preserve compatible skill frontmatter and the default hook location.
