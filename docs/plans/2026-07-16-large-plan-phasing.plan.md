# Large-plan phase-chunking and resource hardening - implementation plan

Goal: split oversized plans into phased executions with fresh contexts, durable on-disk checkpoints, resumability, and bounded agent return payloads, so large plan-runner runs no longer exhaust the host machine.

Source spec: docs/specs/2026-07-16-large-plan-phasing.md (ADR-0003, ADR-0004 under docs/adr/)

Flagged constraints (unconfirmed): `max_waves_per_phase` defaults to 4; phasing enabled by default and triggers only above the threshold; `auto_stop_phases` defaults to 3 and `relay_max_minutes` to 90; fix-plan re-runs inherit phasing automatically; no-git mode keeps full stop/resume via run-state.json alone (dirty-tree prompt git-gated); return budget ~1-2k tokens with generous character maxLength caps sized to clear all existing fixtures; plan content hash stored in run-state guards resume against plan drift; run-state is per-cycle (`cycle-N/run-state.json`, user-ratified deviation from "run root" wording) with pre-flight auto-detect as the single entry point; run-state also records backend, verify mode, TDD state, and overall status; declined auto-detect marks run-state `abandoned`, corrupt run-state on --resume reports and offers a fresh run; no first-party context-editing/memory-tool API integration (backend-agnostic stance); prose-hardening extras bundle (per-phase invariant re-assertion, batched-dispatch audit, NODE_OPTIONS note) is explicitly out of scope.

Repo-wide constraints for every task: the Markdown prose IS the product - wording changes are behavior changes; honesty invariants (no fabricated token counts, no self-verify, verifier-coverage gate upstream of the PR step) and pipeline invariants (max 6 agents/wave, file-disjoint waves, per-wave barrier, git optional via `git_available`) must hold; resolve pipeline files relative to the active SKILL.md; both clients (Claude Code, Codex) and both backends stay supported; no emojis; author handle MisterVitoPro.

### Task 1: run-state.json schema and fixtures
Owned files: schemas/run-state.schema.json, schemas/examples/run-state.valid.json, schemas/examples/run-state.invalid.json
Interfaces: consumes the run-state shape defined in the spec (plan path, plan content hash, verbatim invocation flags, backend, verify mode, TDD state, phase list with per-phase wave range / status / directory / last completed wave, overall status incl. `abandoned` and `complete`, updated-at); produces the schema that Task 4's run-state writes must conform to and that tests/validate_schemas.py picks up.
Acceptance criteria:
- WHEN a validated wave plan contains more than `max_waves_per_phase` waves and phasing is enabled, THE SYSTEM SHALL slice it into sequential phases of at most `max_waves_per_phase` consecutive waves and write `run-state.json` before dispatching any dev agent. (This task delivers the schema that write must validate against.)
Constraints: follow existing schema conventions under schemas/ (draft, required/optional split, descriptive descriptions); valid AND invalid fixtures both required; tests/validate_schemas.py must pass with the new pair.

### Task 2: maxLength caps on agent-return schemas with fixtures
Owned files: schemas/bug-report.schema.json, schemas/wave-plan.schema.json, schemas/examples/ (existing fixture files for these schemas plus new invalid-cap fixtures)
Interfaces: consumes the current return schemas; produces capped free-text fields (evidence, summary, concerns, suggested_fix, title, and equivalents) sized to the ~1-2k-token return budget.
Acceptance criteria:
- WHEN any pipeline agent returns free-text fields exceeding the schema `maxLength` caps, THE SYSTEM SHALL handle it via the existing invalid-return paths (parse-failure fallback / UNVERIFIABLE), not silent truncation.
- WHEN the schema caps land, all pre-existing valid fixtures SHALL still validate, and new invalid fixtures SHALL exercise each capped field.
Constraints: cap values generous enough that every existing committed fixture still validates (schema back-compat protocol: old artifacts must not be invalidated); add a "pre-1.13.0 artifacts uncapped" style note in field descriptions where applicable.

### Task 3: Return budget sections in agent role prose
Owned files: agents/plan-analyzer.md, agents/plan-dev.md, agents/plan-test-author.md, agents/plan-verifier.md, agents/plan-aggregator.md
Interfaces: consumes the return-JSON contracts each role already documents; produces a "Return budget" section in each role: returns are distilled structured summaries within ~1-2k tokens; point at file paths and line ranges instead of quoting file bodies, logs, or diffs.
Acceptance criteria:
- WHEN any pipeline agent returns free-text fields exceeding the schema `maxLength` caps, THE SYSTEM SHALL handle it via the existing invalid-return paths (parse-failure fallback / UNVERIFIABLE), not silent truncation. (This task delivers the prose side: agents are instructed to stay inside the budget so the caps are rarely hit.)
Constraints: do not alter any role's tools: frontmatter (least-privilege invariant); do not change any return field names; keep each section short and consistent across the five roles; wording must be pinnable by contract tests.

### Task 4: run skill - phasing config, slicing, run-state lifecycle, phase directories
Owned files: skills/run/SKILL.md
Interfaces: consumes the validated wave plan from Step 2 and the run-state schema from Task 1; produces new argument parsing (`--phase-size N`, `--phase-mode <relay|stop>`, `--no-phasing`), a `.plan-runner.yml` `phasing:` block (enabled, max_waves_per_phase, mode: auto|relay|stop, auto_stop_phases, relay_max_minutes) with precedence flag > yml > default, the mechanical phase-slicing step after wave-plan validation, per-cycle run-state.json writes (at slicing time, after every wave, at every phase boundary), and the `cycle-N/phase-P/` directory layout (wave-plan slice, bugs/, manifest.json per phase; canonical wave-plan.json at the cycle root).
Acceptance criteria:
- WHEN a validated wave plan contains more than `max_waves_per_phase` waves and phasing is enabled, THE SYSTEM SHALL slice it into sequential phases of at most `max_waves_per_phase` consecutive waves and write `run-state.json` before dispatching any dev agent.
- WHEN a validated wave plan contains at most `max_waves_per_phase` waves, THE SYSTEM SHALL run the existing unphased pipeline with no phase directories and no run-state file.
- WHEN `--no-phasing` is passed, THE SYSTEM SHALL run the entire plan in the current single-session pipeline regardless of plan size or yml config.
Constraints: slicing is arithmetic on the stored wave plan - the analyzer is NOT re-dispatched and agents/plan-analyzer.md is untouched; sub-threshold and --no-phasing runs must remain byte-for-byte today's pipeline; yml parsing follows the existing single-key extraction pattern (no YAML parser dependency); git operations stay gated on `git_available`.

### Task 5: run skill - phase execution modes (relay driver, stop, adaptive default, guardrail, teams override)
Owned files: skills/run/SKILL.md
Interfaces: consumes the sliced phase list and run-state from Task 4; produces the relay phase-driver loop (each phase runs in a fresh-context phase-runner subagent dispatched with the Step 6 handoff mechanism - absolute SKILL.md path + run-state path + phase id - returning one distilled phase-summary JSON), stop-mode boundaries (clean session end + copy-pasteable resume invocation, `$plan-runner:run` form on Codex), adaptive mode resolution, the relay wall-time guardrail, and the teams-backend override.
Acceptance criteria:
- WHILE in `relay` mode, THE SYSTEM SHALL execute each phase in a fresh-context phase-runner subagent and the driver session SHALL receive only the phase-summary return, never per-wave agent returns.
- WHILE in `stop` mode, THE SYSTEM SHALL end the session at each phase boundary after updating run-state.json and printing a copy-pasteable resume invocation.
- WHILE running on the Agent Teams backend with phasing active, THE SYSTEM SHALL use `stop` behavior at every phase boundary regardless of configured mode.
- WHEN no explicit phase mode is configured and the sliced phase count exceeds `auto_stop_phases`, THE SYSTEM SHALL select `stop` mode and print a one-line explanation; WHEN the phase count is at most `auto_stop_phases`, THE SYSTEM SHALL select `relay`.
- WHILE relaying, IF elapsed wall-time since run start exceeds `relay_max_minutes` at a phase boundary, THEN THE SYSTEM SHALL force a stop-and-resume at that boundary, printing the reason and the resume invocation.
Constraints: driver-plus-phase-runner shape (constant nesting depth), never phase-to-phase chained handoffs (depth-5 platform cap, per ADR-0003); the phase runner executes the existing Step 4 wave loop unchanged within its phase; all per-wave invariants (barrier, gates, verify modes, teardown, no-self-verify) hold inside the phase runner; a forced guardrail stop is an early stop boundary reusing the same resume machinery.

### Task 6: run skill - resume (--resume, auto-detect, crash recovery)
Owned files: skills/run/SKILL.md
Interfaces: consumes run-state.json (Task 1 schema, Task 4 lifecycle); produces the `--resume [path]` flag, pre-flight auto-detect of incomplete run-states under docs/plan-runner/, the abandoned marking, the plan-hash drift guard, interrupted-wave re-dispatch with the git-gated dirty-tree prompt, and corrupt-state handling.
Acceptance criteria:
- WHEN `--resume` targets a run-state whose next phase is incomplete, THE SYSTEM SHALL re-enter at the first incomplete wave of that phase without re-running the analyzer or any completed wave.
- WHEN resume finds an interrupted (in-progress) wave, THE SYSTEM SHALL re-dispatch that wave from its start; IF git is available and the working tree is dirty, THEN THE SYSTEM SHALL ask once (stash / keep) before dispatching and SHALL NOT silently discard uncommitted work.
- WHEN pre-flight detects an incomplete run-state under `docs/plan-runner/`, THE SYSTEM SHALL offer resume before starting a fresh run; IF the user declines, THEN THE SYSTEM SHALL mark that run-state `abandoned`.
- IF the plan file's content hash differs from the hash stored in run-state at resume, THEN THE SYSTEM SHALL warn and require explicit confirmation before continuing.
- IF `run-state.json` is missing or unparseable when `--resume` is invoked, THEN THE SYSTEM SHALL report the failure and offer a fresh run, never inferring state.
- WHEN phasing is active in no-git mode, THE SYSTEM SHALL still write and update run-state.json and support stop/resume, with all git-gated steps skipped as today.
Constraints: resume reads state ONLY from run-state.json plus on-disk artifacts (never inferred from git history alone); the existing rogue-commit guard runs on the re-dispatched wave against the wave's recorded start SHA; abandoned run-states are never re-offered.

### Task 7: run skill - cross-phase aggregation, reporting, terminal steps
Owned files: skills/run/SKILL.md
Interfaces: consumes phase manifests and per-phase bugs/ directories; produces terminal-phase aggregation across all phase subdirs, the cross-phase verifier-coverage gate, compact intermediate phase summaries, the combined final Run Report, terminal-only gating of code-atlas sync and the PR step, fix-plan phasing inheritance, and run-state completion.
Acceptance criteria:
- WHEN the terminal phase completes, THE SYSTEM SHALL run aggregation over bug JSONs from all phase subdirectories, and the verifier-coverage gate SHALL backfill `UNVERIFIABLE` for any wave of any phase lacking a verdict before the PR step can run.
- WHEN the terminal phase prints the Run Report, THE SYSTEM SHALL sum token and timing figures across all phase manifests, sum only non-null token values, aggregate the coverage counters, and print the lower-bound honesty line whenever any phase's coverage is partial.
- WHEN any intermediate phase completes, THE SYSTEM SHALL print a compact phase summary (waves, bugs so far, tokens with coverage, next action) and SHALL NOT print the full Run Report.
- WHEN a fix-plan re-run's wave plan exceeds the threshold, THE SYSTEM SHALL phase it by the same rules as a first-cycle run.
- WHEN a run completes (terminal phase, terminal cycle), THE SYSTEM SHALL set run-state status `complete`, and code-atlas sync plus the PR step SHALL have run only on that terminal phase.
Constraints: token accounting stays best-effort and honest - unreported agents stay null in their phase manifest, sums cover non-null values only, coverage counters aggregate, counts are never fabricated; the coverage gate remains structurally upstream of the PR step on every path across phases; SKIPPED (verify_mode) waves keep their existing distinct semantics.

### Task 8: contract tests for phasing, resume, and return budgets
Owned files: tests/contract.test.js
Interfaces: consumes the prose landed by Tasks 3-7; produces contract tests pinning the new load-bearing phrases (phasing block keys and defaults, adaptive-mode selection lines, stop-boundary resume invocation, relay guardrail, teams override, auto-detect/abandoned wording, dirty-tree prompt, cross-phase coverage-gate wording, Return budget sections in all five roles, run-state schema presence).
Acceptance criteria:
- WHEN a validated wave plan contains at most `max_waves_per_phase` waves, THE SYSTEM SHALL run the existing unphased pipeline with no phase directories and no run-state file. (Pinned: the trigger/threshold prose.)
- WHEN `--no-phasing` is passed, THE SYSTEM SHALL run the entire plan in the current single-session pipeline regardless of plan size or yml config. (Pinned: the kill-switch prose.)
- WHEN no explicit phase mode is configured and the sliced phase count exceeds `auto_stop_phases`, THE SYSTEM SHALL select `stop` mode and print a one-line explanation; WHEN the phase count is at most `auto_stop_phases`, THE SYSTEM SHALL select `relay`. (Pinned: the adaptive-default prose.)
Constraints: follow the existing contract-test style (exact phrases and regexes against skill/agent prose); every feature added by Tasks 3-7 gets at least one pinning test; `node --test tests/contract.test.js` passes.

### Task 9: README documentation
Owned files: README.md
Interfaces: consumes the shipped behavior from Tasks 4-7; produces a "Phasing large plans" section (threshold and defaults, relay vs stop with the honest memory trade-off - only stop fully resets process memory, relay resets context only), a "Resuming a run" section (--resume, auto-detect, crash recovery), the updated flags list and `.plan-runner.yml` example, and a note on bounded agent return budgets that does not overstate payload caps as the memory fix.
Acceptance criteria:
- Docs updated where user- or operator-visible behavior changed: README documents phasing, resume, config, and the relay-vs-stop memory trade-off, without overstating payload caps as the memory fix.
Constraints: keep both client invocations (`/plan-runner:run`, `$plan-runner:run`) in examples; version badge untouched (Task 11 owns version); no emojis.

### Task 10: release smoke fixture and checklist
Owned files: test-fixtures/large-plan.md, docs/release-smoke.md
Interfaces: consumes nothing at runtime; produces a representative 40+-task fixture plan (structured Markdown with explicit file paths so the analyzer slices it into 10+ waves / 3+ phases) and a short release-smoke document describing how to run the symptom check and what passing means.
Acceptance criteria:
- WHEN a representative 40+-task plan is run in the default configuration as the release smoke check, THE SYSTEM SHALL complete (across resumed sessions where stop boundaries occur) without the host process exceeding its memory envelope.
Constraints: the fixture is inert documentation-shaped input (tasks that touch only scratch paths), consistent in style with existing test-fixtures/*.md; the smoke doc is a manual/scripted release-checklist item, not CI.

### Task 11: version bump and changelog
Owned files: .claude-plugin/plugin.json, .codex-plugin/plugin.json, package.json, CHANGELOG.md, tests/contract.test.js
Interfaces: consumes the completed feature set; produces the synchronized next minor version in both plugin manifests and package.json, the updated pinned-version assertion in the contract tests, and a CHANGELOG entry (minor: new pipeline behavior) summarizing phasing, resume, adaptive mode, guardrail, and return budgets.
Acceptance criteria:
- WHEN the release merge lands on main with the synchronized manifest version bumped, THE SYSTEM (marketplace-pin workflow) SHALL tag the merge commit and update both marketplace catalogs automatically - so this task SHALL bump all five places in one coherent change and SHALL NOT hand-tag or hand-edit the marketplace.
Constraints: five-place protocol exactly (two plugin manifests, package.json, CHANGELOG entry, contract-test version assertion); SemVer minor (new pipeline behavior); runs last, after all prose and tests have landed.
