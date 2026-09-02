# Project-agent + model selection for dev dispatch - implementation plan

Goal: the run skill implements dev tasks with a clearly-matching project-defined agent (model per agent frontmatter, else recommended_model) and falls back to bundled plan-dev, with the dev return contract embedded in every dispatch and provenance recorded everywhere the run reports.
Source spec: docs/specs/2026-07-26-project-agent-dispatch.md
Flagged constraints (unconfirmed):
- Discovery dirs are `.claude/agents/` and `.codex/agents/` plus locations named by AGENTS.md/CLAUDE.md.
- Malformed/unreadable agent files are skipped with a logged reason, never fatal.
- Substitution never touches test-author/verifier/aggregator dispatches.
- Release is a SemVer minor; version placeholder 1.19.0.
- Flag name `--no-project-agents`; yml key `agents.project` (default true).
- `agent_source` values are `"bundled"` | `"project:<name>"`.
- Manual verification lives in `docs/release-smoke.md`.
- Smoke covers A1/A2/A8 end-to-end plus A9's malformed-file case, with an adversarial matching agent.

Note: the six-place release version bump (both plugin manifests, package.json, contract-test version pin, CHANGELOG entry, marketplace description check) is a single release-time commit per the repo's version-bump protocol and is deliberately NOT a task below; perform it when landing the release PR.

### Task 1: Dispatch overlay in run skill + Dev Return Contract split
Task ID: project-agent-dispatch-t01
Owned files: skills/run/SKILL.md, agents/plan-dev.md
Interfaces: consumes docs/specs/2026-07-26-project-agent-dispatch.md and ADR docs/adr/0005-project-agent-dispatch-overlay.md; produces the Step 4a selection prose, the `--no-project-agents` flag and `agents.project` yml key resolution, the "served by <agent>" dispatch line, the Run Report provenance stat, the `agent_source` value written into each per-agent manifest entry (shape consumed by Task 2 and Task 4), and the labeled "Dev Return Contract" section of agents/plan-dev.md (consumed verbatim by every dev dispatch and pinned by Task 3).
Acceptance criteria:
- WHEN a run cycle starts with project-agent dispatch enabled THE SYSTEM SHALL build an in-session inventory of project agents from `.claude/agents/*.md`, `.codex/agents/*.md` when present, and any agent-file locations named by the target repo's AGENTS.md or CLAUDE.md, capturing name, description, tools (absent = inherits all), and model frontmatter, plus explicit "use agent X for Y work" routing directives from those docs.
- WHEN a dev task's domain is clearly covered by a discovered project agent's description THE SYSTEM SHALL embed that agent's definition in the dev prompt in place of plan-dev.md's domain-guidance half.
- WHEN no discovered agent clearly covers the task, or the match is doubtful, THE SYSTEM SHALL dispatch with the bundled plan-dev.md.
- WHEN AGENTS.md or CLAUDE.md contains an explicit "use agent X for Y" directive covering the task THE SYSTEM SHALL select agent X for it, overriding the conservative description match.
- IF a selected agent's tools frontmatter lacks both Write and Edit THEN THE SYSTEM SHALL log the disqualification and dispatch plan-dev instead, without widening the agent's tools.
- WHEN a selected project agent declares model frontmatter THE SYSTEM SHALL dispatch it with that model, and WHEN it declares none THE SYSTEM SHALL use the task's recommended_model; bundled plan-dev dispatches SHALL always use recommended_model.
- WHILE dispatching a project agent THE SYSTEM SHALL append the per-invocation dev contract after the agent definition and declare it overriding any conflicting instruction in the agent definition.
- WHILE dispatching any dev agent, bundled or project, THE SYSTEM SHALL embed the Dev Return Contract (return JSON skeleton, DONE/DONE_WITH_CONCERNS/BLOCKED/NEEDS_CONTEXT status enum, owned-files and files_unexpectedly_modified rules, no-git-commit rule, token self-report) in the prompt.
- IF a project agent's return fails validation against schemas/dev-return.schema.json THEN THE SYSTEM SHALL re-prompt that agent once with the schema alone, and IF it fails again THE SYSTEM SHALL record a return_contract_violation bug carrying the dispatch's agent_source and pin the task to bundled plan-dev for the next cycle, without fabricating any return field.
- WHEN `--no-project-agents` is passed or `.plan-runner.yml` sets `agents.project: false` THE SYSTEM SHALL use only bundled role definitions, byte-identical to pre-feature dispatch behavior.
- IF an agent file is unreadable or its frontmatter unparseable THEN THE SYSTEM SHALL exclude it from the inventory with a logged reason and continue; an empty inventory SHALL yield today's behavior with no warnings.
- WHEN a wave contains role "test-author" tasks or dispatches the verifier/aggregator THE SYSTEM SHALL use only bundled definitions for those dispatches regardless of inventory.
- WHEN a dev agent is dispatched THE SYSTEM SHALL print a "served by <agent>" provenance line at the 4a dispatch line, leaving the Step 3 wave-plan display unchanged, and SHALL record agent_source ("bundled" or "project:<name>") in the per-agent manifest entry, the Run Report, and the wave-state used by the PR step.
Verification: run `node --test tests/contract.test.js` (existing pins must still pass) and `claude plugin validate .`
Non-goals:
- Does not touch schemas/, tests/, skills/pr/SKILL.md, README, CHANGELOG, or release-smoke (Tasks 2-5).
- Does not add a new cycle artifact or wave-plan schema field; the inventory is in-session state only.
- Does not alter analyzer, verifier, or aggregator role files or their tool frontmatter.
Blocked by: none
Constraints: Prose is the product - selection rules, tool guard, model precedence, and the overriding-contract sentence must be written as testable phrases (Task 3 pins them). Split agents/plan-dev.md into two labeled sections (domain guidance / Dev Return Contract) without changing return-protocol semantics. Preserve repo invariants: role files resolved relative to the active SKILL.md and embedded in prompts (never native registration - Codex parity); all git operations gated on git_available; honesty invariants untouched (no fabricated returns, token_usage null when unreported, verifier-coverage gate upstream of PR). Config precedence: flag > .plan-runner.yml > default, single-key extraction without a YAML parser, matching the verification.mode pattern.

### Task 2: Manifest schema agent_source field + fixtures
Task ID: project-agent-dispatch-t02
Owned files: schemas/manifest.schema.json, schemas/examples/manifest-agent-source-valid.json, schemas/examples/manifest-agent-source-invalid.json
Interfaces: consumes the agent_source value shape produced by Task 1 (`"bundled"` | `"project:<name>"`); produces the optional per-agent manifest field consumed by Task 4 (PR body) and tests/validate_schemas.py.
Acceptance criteria:
- WHEN a manifest wave agent entry carries agent_source with value "bundled" or "project:<name>" THE SYSTEM SHALL validate it successfully against schemas/manifest.schema.json.
- WHEN validating a pre-1.19.0 manifest without agent_source THE SYSTEM SHALL validate it successfully, and the field's description SHALL carry a "pre-1.19.0" back-compat note.
- IF a manifest carries agent_source with a non-string value THEN THE SYSTEM SHALL fail validation, demonstrated by the invalid fixture.
Verification: run `python tests/validate_schemas.py`
Non-goals:
- Does not modify wave-plan, dev-return, bug-report, or run-state schemas.
- Does not make agent_source required or alter any existing manifest field.
Blocked by: project-agent-dispatch-t01
Constraints: New manifest fields are optional with back-compat preserved (old manifests must still validate). Follow the repo schema rule: matching valid AND invalid fixtures in schemas/examples/. If the validator discovers fixtures by naming convention, match it.

### Task 3: Contract tests for dispatch overlay prose
Task ID: project-agent-dispatch-t03
Owned files: tests/contract.test.js
Interfaces: consumes the Step 4a prose and Dev Return Contract section produced by Task 1; produces the pinned-phrase regression suite for the feature.
Acceptance criteria:
- WHEN `node --test tests/contract.test.js` runs THE SYSTEM SHALL include passing tests that pin, in skills/run/SKILL.md: the conservative selection rule and its plan-dev fallback, the explicit-directive override, the tool-guard disqualification sentence, the model-precedence sentence (agent frontmatter wins, else recommended_model), the `--no-project-agents` flag and `agents.project` key, the contract-overrides-agent-prose sentence, the bundled-only rule for test-author/verifier/aggregator dispatches, the "served by <agent>" dispatch-line sentence, and the return-validation flow (one re-prompt with the schema, then return_contract_violation bug + next-cycle pin to plan-dev).
- WHEN `node --test tests/contract.test.js` runs THE SYSTEM SHALL include a passing test asserting agents/plan-dev.md contains a labeled Dev Return Contract section holding the return JSON skeleton keys (status, files_written, files_unexpectedly_modified, context7_queries, token_usage) and all four status values (DONE, DONE_WITH_CONCERNS, BLOCKED, NEEDS_CONTEXT), so the split halves cannot drift apart.
- IF any pinned phrase is edited away from Task 1's wording THEN THE SYSTEM SHALL fail the corresponding contract test.
Verification: run `node --test tests/contract.test.js`
Non-goals:
- Does not edit SKILL.md or agent files to make tests pass (Task 1 owns the prose; report a mismatch as a bug instead).
- Does not update the pinned version assertion (release-time commit).
Blocked by: project-agent-dispatch-t01, project-agent-dispatch-t02
Constraints: Follow the existing contract.test.js style (exact phrases and regexes over skill/agent prose). Tests read the real files; no snapshots of copies.

### Task 4: PR-body provenance stats in pr skill
Task ID: project-agent-dispatch-t04
Owned files: skills/pr/SKILL.md
Interfaces: consumes the per-agent agent_source manifest field (Tasks 1-2); produces the PR-body provenance stat rendered by the pr skill.
Acceptance criteria:
- WHEN the pr skill builds the PR body from a completed cycle whose manifests carry agent_source THE SYSTEM SHALL include a provenance stat naming how many dev dispatches were served by each project agent versus bundled plan-dev.
- IF a manifest predates agent_source (field absent) THEN THE SYSTEM SHALL omit the provenance stat rather than fabricating or inferring values.
Verification: run `claude plugin validate .` and review the rendered PR-body template section against a manifest fixture with and without agent_source
Non-goals:
- Does not change PR title conventions, draft/ready logic, bug counts, or token stats.
- Does not read agent files or re-run selection; the manifest is the only source.
Blocked by: project-agent-dispatch-t01, project-agent-dispatch-t02
Constraints: Honest reporting - sums render only what manifests actually record; absent data is omitted, never estimated.

### Task 5: README docs + adversarial release-smoke case
Task ID: project-agent-dispatch-t05
Owned files: README.md, docs/release-smoke.md
Interfaces: consumes the feature surface produced by Task 1 (flag, yml key, selection rules, provenance line); produces user-facing docs and the manual smoke procedure.
Acceptance criteria:
- WHEN a user reads README.md THE SYSTEM SHALL document project-agent dispatch: discovery locations (including AGENTS.md/CLAUDE.md locations and directives), the conservative match bar and plan-dev fallback, model precedence, the tool guard, `--no-project-agents` / `agents.project: false`, and where provenance appears.
- WHEN the release-smoke procedure runs THE SYSTEM SHALL include a case with a deliberately irrelevant agent and an ADVERSARIAL matching agent (its body uses its own conflicting output format and instructs itself to commit its work), asserting: the return parses against schemas/dev-return.schema.json, files_written is non-empty, git log over the wave range shows zero dev-agent commits, and coverage counters match the bundled-only baseline.
- WHEN the release-smoke procedure runs THE SYSTEM SHALL include a case with one malformed agent file asserting the run logs the skip and completes normally.
Verification: manual: read both files against spec requirements R1-R10; run `claude plugin validate .`
Non-goals:
- Does not add CHANGELOG entries or touch plugin manifests (release-time commit).
- Does not modify pipeline prose or tests.
Blocked by: project-agent-dispatch-t01
Constraints: README stays consistent with existing feature-doc style; smoke steps must be executable by a human with only the repo and a scratch target project.
