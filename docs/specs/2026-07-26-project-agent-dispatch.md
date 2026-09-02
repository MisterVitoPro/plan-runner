# Project-agent + model selection for dev dispatch - design spec

Date: 2026-07-26 | Status: approved | Author: MisterVitoPro

## Problem

The run skill always implements tasks with the plugin's generic `plan-dev` agent, even when the target repo ships its own specialized agents (e.g. a frontend expert) that would do the implementation work better. The pipeline also has no rule for reconciling a project agent's preferred model with the analyzer's per-task `recommended_model`.

## Existing system

plan-runner is a dual-client Claude Code / Codex plugin whose product is Markdown prose in `skills/*/SKILL.md` and `agents/*.md`. Today:

- The analyzer emits a per-task `recommended_model` (`haiku|sonnet|opus`, rubric in `agents/plan-analyzer.md` rule 6) carried by `schemas/wave-plan.schema.json`.
- Step 4a of `skills/run/SKILL.md` selects a bundled role file by the wave-plan `role` field (`plan-dev.md`, `plan-test-author.md`), embeds its full text in a native subagent prompt, and uses `recommended_model` for dev agents. Verifier and aggregator prefer `sonnet`; the analyzer has its own model heuristic (1c-bis).
- Repo invariant: role files are resolved relative to the active SKILL.md and embedded in prompts; the pipeline never depends on the host natively registering `agents/` files (Codex cannot).
- The dev-agent contract (owned files only, no commits, file-backed `return_file` JSON) is enforced via the per-invocation prompt; the wave verifier judges compliance.
- Config precedence pattern: run flag overrides `.plan-runner.yml` key overrides default (e.g. `--sync-verify` / `verification.pipelined`).
- The phase manifest (`schemas/manifest.schema.json`) records per-wave `agents[]` objects.

## Goals

- A dev task whose domain a project-defined agent clearly covers is implemented by that agent instead of the bundled `plan-dev`. (matcher, match-bar)
- The model for each dev dispatch is resolved by a single precedence rule: chosen project agent's `model:` frontmatter, else the wave-plan `recommended_model`. (model-precedence)
- Behavior is identical on both backends: the chosen agent's definition is embedded in the prompt, never dispatched by native agent registration. (codex-parity)
- Every dispatch records which agent definition served it, everywhere the run reports. (reporting)

## Non-goals

- No project agent ever replaces the test-author, verifier, or aggregator roles - verification independence is preserved. (roles-covered; conflict-check: broader substitution was offered and declined)
- No analyzer or wave-plan schema involvement in agent selection - matching happens at dispatch time. (matcher; a wave-plan `recommended_agent` field was offered and declined)
- No widening of a project agent's declared tools, ever. (tool-guard)
- No new cycle artifact (no `agent-inventory.json`); the inventory is in-session state. (approach)

## Users / consumers

plan-runner users running the run skill against repos that define their own agents; the pipeline itself (dispatch, manifest, Run Report, PR step); this spec feeds ideas:plan and then a plan-runner run. (spec-consumer)

## Requirements

1. **ADDED - agent inventory at cycle setup.** (discovery-sources, docs-role) During Step 1 setup the orchestrator builds an in-session inventory of project agents from: `.claude/agents/*.md`, `.codex/agents/*.md` when present, and any additional agent-file locations named by the target repo's AGENTS.md or CLAUDE.md. Each entry captures `name`, `description`, `tools` (absent = inherits all), and `model` from frontmatter. It also collects explicit routing directives from AGENTS.md/CLAUDE.md of the form "use agent X for Y work".
2. **ADDED - dispatch-time selection in Step 4a.** (matcher, match-bar, docs-role) For each impl/standalone dev task, in order: (a) an explicit routing directive covering the task selects that agent; (b) otherwise a project agent whose description clearly covers the task's domain is selected - any doubt selects none; (c) otherwise the bundled `plan-dev.md` is used. Selection never applies to `role: "test-author"` tasks or to verifier/aggregator dispatches.
3. **ADDED - tool guard.** (tool-guard) A selected agent whose `tools` frontmatter lacks write capability (no Write and no Edit) is disqualified: the orchestrator logs the skip reason and falls back to `plan-dev`. An absent `tools` field is eligible.
4. **ADDED - prompt assembly for project agents.** (codex-parity, protocol-precedence) When a project agent is selected, its markdown body replaces the bundled `plan-dev.md` role text in the dev prompt. The plan-runner per-invocation contract (owned files, no commits, file-backed return, acceptance criteria) is appended AFTER the agent definition and explicitly declared as overriding any conflicting instruction in the agent definition. The verifier continues to judge by the contract.
5. **MODIFIED - model resolution for dev dispatch.** (model-precedence) When the selected project agent declares `model:` frontmatter, that model is used; otherwise the task's `recommended_model` applies. Bundled `plan-dev` dispatches always use `recommended_model`. The existing "closest available model, never block" rule is unchanged.
6. **ADDED - opt-out.** (rollout-default) The feature is on by default. A `--no-project-agents` run flag and a `.plan-runner.yml` key `agents.project: false` disable it (flag overrides yml overrides default, matching existing config precedence). When disabled, Step 4a behaves exactly as today.
7. **ADDED - provenance reporting.** (reporting, rollout-default, provenance-line-placement) Each dev dispatch records its serving definition as `agent_source` (value shape per Assumptions). It appears in the per-agent manifest entry, the Run Report, the PR body stats, and a human-visible "served by <agent>" line printed at the 4a dispatch line; the Step 3 wave-plan display is unchanged.
8. **MODIFIED - manifest schema.** (reporting, verification-method) `schemas/manifest.schema.json` gains an optional per-agent `agent_source` string field with a "pre-1.19.0" back-compat note; old manifests still validate; `schemas/examples/` gains matching valid and invalid fixtures.

9. **MODIFIED - dev return contract extraction.** (critic-mitigation-1) `agents/plan-dev.md` is split into two labeled sections: domain guidance (process, codebase inspection, Context7 usage) and a **Dev Return Contract** (return JSON skeleton, the DONE/DONE_WITH_CONCERNS/BLOCKED/NEEDS_CONTEXT status enum, owned-files and `files_unexpectedly_modified` rules, the no-git-commit rule, the token self-report block). A selected project agent's body replaces only the domain-guidance half; the Dev Return Contract is embedded verbatim in EVERY dev dispatch, bundled or project.
10. **ADDED - return validation for project-agent dispatches.** (critic-mitigation-2) A project agent's return is validated against `schemas/dev-return.schema.json` before acceptance. On failure the orchestrator does NOT classify it BLOCKED: it re-prompts that agent once with the schema alone; if the return still fails, it records the dispatch with its `agent_source` plus a `return_contract_violation` bug entry, and pins that task to bundled `plan-dev` for the next cycle. Return fields are never fabricated; `token_usage` stays null when unreported.

### Non-functional requirements

11. **Robust discovery.** (malformed-agent-files) An unreadable agent file or unparseable frontmatter excludes that agent from the inventory with a logged skip reason; discovery failures never fail the pipeline. A repo with no agent dirs and no directives yields an empty inventory and today's behavior with no warnings.
12. **Least-privilege posture preserved.** (tool-guard, protocol-precedence) The pipeline never grants a project agent tools beyond its own frontmatter, and bundled analyzer/verifier/aggregator tool restrictions are untouched.
13. **Honest reporting.** (reporting, critic-mitigation-2) `agent_source` is recorded from what was actually dispatched, never inferred after the fact; token-accounting and verifier-coverage invariants are unchanged.

## Chosen approach

Approach A - prose-only dispatch overlay: inventory built in-session at cycle setup, selection rules in Step 4a prose, one optional manifest field. Alternatives: B (structured `agent-inventory.json` artifact + per-wave decision records) lost as heavier than a conservative matcher needs; C (haiku matcher subagent) lost on dispatch-latency and untestability of the match bar. See `docs/adr/0005-project-agent-dispatch-overlay.md`.

## Architecture & components

- **Inventory step (run SKILL.md, Step 1 family)** - scans agent dirs and AGENTS.md/CLAUDE.md, parses frontmatter, holds `agent_inventory` + `routing_directives` in session state.
- **Selection block (run SKILL.md, Step 4a)** - directive match -> conservative description match -> tool guard -> chosen definition; falls back to bundled `plan-dev.md`.
- **Prompt assembly (Step 4a)** - domain body (project or bundled) + Dev Return Contract (always) + overriding per-invocation contract.
- **Dev Return Contract section (agents/plan-dev.md)** - the extracted return-protocol half, embedded verbatim in every dev dispatch.
- **Return validation (Step 4a return capture)** - schema check, one re-prompt, `return_contract_violation` bug + next-cycle pin on repeat failure.
- **Config resolution (Step 1 flags/config)** - `--no-project-agents` / `agents.project`.
- **Provenance surfaces** - manifest `agent_source`, dispatch display line, Run Report, PR body (pr skill reads the manifest).

## Data & interfaces

- Inventory entry shape: `{name, description, tools[]?, model?, path}` (in-session only).
- Routing directive shape: `{agent_name, applies_to}` parsed from AGENTS.md/CLAUDE.md prose (in-session only).
- `.plan-runner.yml`: `agents.project: true|false` (default true), read with the same single-key extraction pattern as `verification.mode`.
- Run flag: `--no-project-agents`.
- Manifest: optional `waves[].agents[].agent_source` string, `"bundled"` or `"project:<name>"`.
- New/changed files: `skills/run/SKILL.md`, `skills/pr/SKILL.md` (PR body stats), `schemas/manifest.schema.json`, `schemas/examples/*`, `tests/contract.test.js`, README, CHANGELOG.

## Edge cases & error handling

- Malformed/unreadable agent file -> excluded, skip reason logged. (assumed, binding default)
- Agent lacking Write/Edit in `tools` -> disqualified, logged, plan-dev fallback. (decided)
- Agent prose conflicts with dev contract -> contract wins; declared overriding in the prompt. (decided)
- Ambiguous match (two agents plausibly fit, or fit is doubtful) -> conservative bar fails, plan-dev. (decided)
- Project agent named like a bundled role (e.g. "plan-verifier") -> irrelevant; substitution only ever targets impl/standalone dev slots. (assumed, binding default)
- Empty inventory / feature disabled -> exactly today's dispatch path.
- Codex backend -> identical selection and embedding; no native registration attempted. (decided)

## Acceptance criteria (EARS)

- A1. WHEN a dev task's domain is clearly covered by a discovered project agent's description, THE SYSTEM SHALL embed that agent's definition in the dev prompt in place of `plan-dev.md`.
- A2. WHEN no discovered agent clearly covers the task, or the match is doubtful, THE SYSTEM SHALL dispatch with the bundled `plan-dev.md`.
- A3. WHEN AGENTS.md or CLAUDE.md contains an explicit "use agent X for Y" directive covering the task, THE SYSTEM SHALL select agent X for it, overriding the conservative description match.
- A4. IF a selected agent's `tools` frontmatter lacks both Write and Edit, THEN THE SYSTEM SHALL log the disqualification and dispatch `plan-dev` instead, without widening the agent's tools.
- A5. WHEN a selected project agent declares `model:` frontmatter, THE SYSTEM SHALL dispatch it with that model; otherwise WHEN it declares none, THE SYSTEM SHALL use the task's `recommended_model`.
- A6. WHILE dispatching a project agent, THE SYSTEM SHALL append the per-invocation dev contract after the agent definition and declare it overriding.
- A7. WHEN `--no-project-agents` is passed or `.plan-runner.yml` sets `agents.project: false`, THE SYSTEM SHALL use only bundled role definitions.
- A8. WHEN any dev agent completes, THE SYSTEM SHALL record `agent_source` ("bundled" or "project:<name>") in the phase manifest, and surface it in the dispatch display line, Run Report, and PR body.
- A9. IF an agent file is unreadable or its frontmatter unparseable, THEN THE SYSTEM SHALL exclude it from the inventory with a logged reason and continue.
- A10. WHEN a wave contains `role: "test-author"` tasks or dispatches the verifier/aggregator, THE SYSTEM SHALL use only bundled definitions for those dispatches regardless of inventory.
- A11. WHEN validating a pre-1.19.0 manifest without `agent_source`, THE SYSTEM SHALL validate it successfully.
- A12. WHILE dispatching any dev agent, bundled or project, THE SYSTEM SHALL embed the Dev Return Contract (return JSON skeleton, four-value status enum, owned-files and files_unexpectedly_modified rules, no-git-commit rule, token self-report) in the prompt.
- A13. IF a project agent's return fails validation against `dev-return.schema.json`, THEN THE SYSTEM SHALL re-prompt that agent once with the schema alone, and IF it fails again, THE SYSTEM SHALL record a `return_contract_violation` bug carrying the dispatch's `agent_source` and pin the task to bundled `plan-dev` for the next cycle, without fabricating any return field.
- A14. WHEN a dev agent is dispatched, THE SYSTEM SHALL print the "served by <agent>" provenance line at the 4a dispatch line, leaving the Step 3 wave-plan display unchanged.

## Verification strategy

- `unit` (contract tests, `tests/contract.test.js`): A1-A7, A10, A12-A14 - pin the new Step 4a selection prose, tool-guard wording, model-precedence sentence, opt-out flag/key, contract-overrides sentence, bundled-only roles sentence, the provenance-line sentence, and the Dev Return Contract block (assert it contains the JSON skeleton keys and all four status values, so the split halves of plan-dev.md cannot drift apart).
- `unit` (schema fixtures, `tests/validate_schemas.py`): A8 field shape, A11 back-compat - valid fixture with `agent_source`, valid legacy fixture without it, invalid fixture with a wrong type.
- `manual` (release smoke, `docs/release-smoke.md`): A1/A2/A8/A13 end-to-end - run a small plan in a repo with a deliberately irrelevant agent and an ADVERSARIAL matching agent (its body uses its own conflicting output format and instructs itself to commit its work); assert the return parses against `dev-return.schema.json`, `files_written` is non-empty, `git log` over the wave range shows zero dev-agent commits, and coverage counters match the bundled-only baseline. A9 with one malformed agent file.

## Assumptions (unconfirmed)

- Binding default: discovery dirs are `.claude/agents/` and `.codex/agents/` plus docs-specified locations (codex-discovery-dir) - checked by A1/A9 fixtures in smoke.
- Binding default: malformed agent files are skipped, never fatal (malformed-agent-files) - welded to A9.
- Binding default: substitution never touches non-dev roles (bundled-role-protection) - welded to A10.
- Binding default: release is a SemVer minor with the repo's six-place version-bump protocol; version placeholder "1.19.0" in R8 follows it (verification-method).
- Binding default: flag name `--no-project-agents` and yml key `agents.project` (default true) (config-key-name) - welded to A7.
- Binding default: `agent_source` values are `"bundled"` | `"project:<name>"` (agent-source-values) - welded to A8 and A11 fixtures.
- Binding default: the manual verification pass lives in `docs/release-smoke.md` and covers A1/A2/A8 end-to-end plus A9's malformed-file case (smoke-coverage).

## Open questions

None. (Provenance-line placement was resolved at the review gate: 4a dispatch line only.)

## Definition of done

- Contract tests and schema fixtures written and passing (`node --test tests/contract.test.js`, `python tests/validate_schemas.py`, `claude plugin validate .`).
- Existing dispatch behavior byte-identical when the feature is disabled or the inventory is empty.
- Both backends honored via prompt embedding; no native agent registration dependency introduced.
- No new network calls.
- README and CHANGELOG updated; six-place version-bump protocol followed at release.
- Every acceptance criterion above passes.
