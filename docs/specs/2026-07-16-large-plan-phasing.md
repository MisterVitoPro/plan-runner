# Large-plan phase-chunking and resource hardening for plan-runner - design spec

Date: 2026-07-16 / Status: approved / Author: MisterVitoPro

## Problem

Running a large plan (40+ tasks, ~10-15 waves) through `/plan-runner:run` keeps one orchestrator session alive for the entire run. The Claude Code host process accumulates memory that is never freed regardless of context compaction, and on real runs this crashes the user's machine. Agent return payloads are unbounded, which accelerates the bloat. Large plans need to be broken into smaller executions with durable on-disk state, without weakening any of the pipeline's honesty or verification invariants.

## Existing system

Dual-client Claude Code + Codex plugin whose Markdown prose (`skills/*/SKILL.md`, `agents/*.md`) is the product. Current pipeline per cycle: analyzer emits a DAG-ordered wave plan (max 6 file-disjoint agents per wave); the run skill executes waves sequentially in one session with a per-wave barrier (dispatch -> TDD gates -> verify -> commit); bugs aggregate at the end into `bugs.md` + `fix-plan.md`; a re-run prompt can hand the fix-plan to a fresh-context subagent (Step 6). Artifacts live under `docs/plan-runner/{DATE}/cycle-{N}/` (gitignored via SessionStart hook). Config: `.plan-runner.yml` (`verification.mode`) plus flags. Two backends: native subagent (default, also Codex) and Agent Teams (Claude Code, env-gated; teammates cannot spawn nested teams). git is optional (`git_available` gates every git operation). Schemas under `schemas/` with valid/invalid fixtures; `tests/contract.test.js` pins exact prose phrases; releases follow a five-place version bump.

## Goals

- A plan whose wave plan exceeds a configurable threshold is automatically split into sequential phases, each executed with a fresh context, so no single context carries the whole run (ledger: feature set, split metric, approach).
- A run interrupted at any point - planned stop or machine crash - resumes from the last completed wave via on-disk state (ledger: feature set, checkpoint, crash-resume).
- Every pipeline agent's return payload is bounded to a distilled ~1-2k-token structured summary (ledger: feature set, payload-cap enforcement).
- Plans at or below the threshold run exactly as today - zero behavior change (ledger: phasing trigger assumption).
- All honesty and pipeline invariants hold across phase boundaries (ledger: baseline).

## Non-goals

- The "prose hardening extras" bundle - per-phase invariant re-assertion for compaction survival, batched-dispatch audit, NODE_OPTIONS heap-headroom README note - explicitly cut by the user (ledger: feature set). No conflict with the critical constraints: cutting these leaves the core crash fix intact.
- No analyzer changes and no analyzer-level phase awareness (ledger: approach - option B rejected).
- No literal splitting of the plan Markdown into multiple files (ledger: approach - option C rejected).
- No first-party context-editing / memory-tool API integration (research pattern 10; adds API-surface coupling contrary to the plugin's backend-agnostic stance).
- No change to the max-6-agents-per-wave cap, file-disjointness, verification modes, TDD gates, or the PR step's contract.

## Users / consumers

The plan-runner pipeline itself: this spec feeds `/plan-runner:run` as an implementation plan (ledger: spec consumer). End beneficiaries are plan-runner users executing large plans on consumer hardware, on both Claude Code and Codex.

## Requirements

Change deltas against the current run skill (`skills/run/SKILL.md`), agent roles, and schemas.

1. **ADDED - phase slicing.** After wave-plan validation (Step 2), when phasing is enabled and the wave count exceeds `max_waves_per_phase`, the run skill SHALL slice the wave plan into sequential phases of at most `max_waves_per_phase` consecutive waves, preserving wave order. Slicing is mechanical arithmetic on the stored wave plan - the analyzer is not re-dispatched and its prose is unchanged (ledger: split metric, approach).
2. **ADDED - run-state checkpoint.** At slicing time the run skill SHALL write `run-state.json` to the cycle directory recording: plan path and content hash, verbatim invocation flags, backend, verify mode, TDD state, the phase list (each phase's wave range, status, directory, last completed wave), and overall status. It SHALL be updated after every wave completion and at every phase boundary (ledger: checkpoint; ADR-0004).
3. **ADDED - phase directories.** Each phase SHALL own `cycle-{N}/phase-{P}/` containing its wave-plan slice, `bugs/`, and `manifest.json`. The canonical full `wave-plan.json` stays at the cycle root. Unphased runs keep today's flat cycle layout unchanged (ledger: dir layout).
4. **ADDED - relay execution mode.** In `relay` mode the invoking session SHALL act as a phase driver: each phase executes in a fresh-context phase-runner subagent (dispatched with the same self-contained mechanism as the Step 6 fix-plan handoff: absolute path to the run SKILL.md plus the run-state path), and the driver SHALL receive only a distilled phase summary (bounded per requirement 9), never wave-level transcripts. Driver-side nesting depth stays constant regardless of phase count (ledger: phase execution; ADR-0003).
5. **ADDED - stop execution mode.** In `stop` mode the session SHALL end cleanly at each phase boundary after updating run-state.json, printing a copy-pasteable resume invocation. The Agent Teams backend SHALL always use `stop` regardless of configured mode, with a one-line explanation (ledger: phase execution, teams backend).
6. **ADDED - resume.** `--resume [run-state path]` SHALL re-enter a run at its first incomplete phase and wave. When invoked without a path, and at pre-flight of any normal run, the skill SHALL auto-detect incomplete run-states under `docs/plan-runner/` and offer resume before starting fresh (ledger: config + resume surface).
7. **ADDED - crash-resume semantics.** When resume finds an interrupted wave (in-progress, not completed), the skill SHALL re-dispatch that whole wave from its start. If git is available and the tree is dirty, it SHALL show the dirty state and ask once - stash, or keep and let agents overwrite - before re-running; it SHALL never silently discard work. With git absent, the prompt is skipped and the wave re-runs over the working tree as-is (ledger: crash-resume; no-git assumption).
8. **ADDED - phasing config surface with adaptive default mode.** `.plan-runner.yml` SHALL gain a `phasing` block (`enabled`, `max_waves_per_phase`, `mode: relay|stop|auto`, `auto_stop_phases`, `relay_max_minutes`); flags `--phase-size N`, `--phase-mode <relay|stop>`, and `--no-phasing` SHALL override it, with the same precedence pattern as `--verify` (flag > yml > default). When no explicit mode is set, mode resolution is ADAPTIVE: `relay` when the sliced phase count is at most `auto_stop_phases`, otherwise `stop` - so the plans that motivate this feature default to the mode that fully resets process memory, with a printed one-line explanation. `--no-phasing` is the rollback kill-switch restoring today's single-session behavior (ledger: config + resume surface; critic mitigation 1, adopted at gate).
9. **ADDED - return budgets in agent prose.** Every pipeline agent role (`plan-analyzer`, `plan-dev`, `plan-test-author`, `plan-verifier`, `plan-aggregator`) SHALL gain a "Return budget" section: returns are distilled structured summaries within ~1-2k tokens; point at file paths and line ranges instead of quoting file bodies, logs, or diffs (ledger: payload-cap enforcement).
10. **ADDED - schema caps on free-text fields.** Free-text fields in agent-return schemas (e.g. `evidence`, `summary`, `concerns`, `suggested_fix`, `title`) SHALL gain `maxLength` limits sized to the return budget, with matching valid and invalid fixtures. Existing committed fixtures and pre-change artifacts must still validate - cap values are chosen generously enough to clear all existing fixtures, and the back-compat check is part of the schema change (ledger: payload-cap enforcement; schema protocol).
11. **MODIFIED - wave execution loop.** Step 4 SHALL iterate only the current phase's waves. All per-wave behavior - barrier, gates, verification per `verify_mode`, bug JSON, dashboard, commit, teardown, manifest - is unchanged within a phase (ledger: baseline).
12. **MODIFIED - aggregation and coverage gate.** Step 5 SHALL run once, on the terminal phase, reading bug JSONs across all phase subdirectories. The verifier-coverage gate SHALL assert a verdict for every wave of every phase before the PR step - it remains structurally impossible to open a PR with any wave's verdict outstanding, across phases (ledger: baseline, dir layout).
13. **MODIFIED - reporting.** Intermediate phase boundaries SHALL print a compact phase summary (waves run, bugs so far, tokens with coverage, next action). The terminal phase SHALL print the full Run Report summing all phase manifests, aggregating `agents_reported`/`agents_total` coverage counters and preserving lower-bound honesty labels across the sum. Token counts are never fabricated; unreported agents stay `null` in their phase manifest and are excluded from sums (ledger: cross-phase reporting, baseline).
14. **MODIFIED - terminal-only steps.** Code-atlas sync (Step 7-bis), the PR step (Step 8), and the Run Report SHALL run only on the terminal phase of the terminal cycle, exactly as they run today on the terminal cycle (ledger: dir layout, baseline).
15. **MODIFIED - fix-plan re-runs.** A fix-plan cycle is a normal run through the same pipeline and SHALL inherit phasing by the same rules automatically - no special-casing (ledger: fix-plan assumption).
16. **ADDED - run-state schema.** `run-state.json` SHALL get a JSON schema under `schemas/` with valid and invalid fixtures, following the existing schema conventions (ledger: checkpoint; schema protocol).
17. **ADDED - relay guardrail.** While relaying, at every phase boundary the driver SHALL compare elapsed wall-time since run start against `relay_max_minutes`; when exceeded, it SHALL force a stop-and-resume at that boundary (an early `stop` boundary reusing the existing resume machinery), printing the reason and the resume invocation. Relay is thereby bounded by construction, not by hope that payload caps suffice (critic mitigation 2, adopted at gate).
18. **MODIFIED - contract tests and docs.** Every prose change above SHALL land with matching contract-test updates in the same change; README SHALL document phasing, resume, the config block, and the relay-vs-stop trade-off (including that only `stop` fully resets process memory); release follows the five-place version bump (ledger: baseline).

## Chosen approach

Orchestrator-sliced phases (checkpoint decision A): the analyzer stays untouched; the run skill slices the validated wave plan into consecutive-wave phases (dependency-safe because wave order is topological), executes them via a lean phase-driver session in `relay` mode or via clean session stops in `stop` mode, and checkpoints everything in `run-state.json`. Alternatives - analyzer-emitted phases (schema and prose churn for cosmetic seam quality) and literal plan-file splitting (fragile, DAG-losing) - were rejected at the checkpoint. Details and consequences: [ADR-0003](../adr/0003-phase-execution-model.md), [ADR-0004](../adr/0004-run-state-checkpoint.md).

## Data & interfaces

- **Flags (run skill):** `--phase-size <N>`, `--phase-mode <relay|stop>`, `--no-phasing`, `--resume [path]`. Existing flags unchanged.
- **Config:** `.plan-runner.yml`:

  ```yaml
  phasing:
    enabled: true            # default true
    max_waves_per_phase: 4   # default 4
    mode: auto               # auto (default) | relay | stop
    auto_stop_phases: 3      # auto mode: relay up to this many phases, stop above
    relay_max_minutes: 90    # relay guardrail: force stop at next boundary past this
  ```

- **Checkpoint:** `docs/plan-runner/{DATE}/cycle-{N}/run-state.json` - fields per requirement 2; schema `schemas/run-state.schema.json` + fixtures in `schemas/examples/`.
- **Layout (phased runs only):** `cycle-{N}/wave-plan.json` (canonical), `cycle-{N}/run-state.json`, `cycle-{N}/phase-{P}/{wave-plan.json (slice), bugs/, manifest.json}`; `bugs.md`, `fix-plan.md` at the cycle root (terminal-phase aggregation output).
- **Phase-runner handoff prompt (relay):** absolute path to the active run `SKILL.md` + absolute run-state path + phase id; the phase runner reads everything else from disk. Return: one distilled phase-summary JSON (status per wave, bug count, token tally with coverage, manifest path) within the return budget.
- **Manifest:** each phase manifest keeps today's cycle-manifest shape plus a `phase` field ({`phase_id`, `of`, `wave_range`}) - additive and optional, satisfying schema back-compat.
- **Agent roles:** each `agents/*.md` gains a "Return budget" section; return schemas gain `maxLength` caps.
- No new network calls anywhere.

## Edge cases & error handling

- **Plan at or below threshold:** phasing never activates; byte-for-byte today's behavior (decided: trigger assumption).
- **Teams backend:** phase boundaries always `stop`, with printed explanation; resumed session re-establishes the team (decided: teams backend).
- **Codex backend:** native subagents support relay identically to Claude Code's subagent backend; stop mode prints the `$plan-runner:run --resume` form of the command.
- **Plan file changed since checkpoint:** resume compares the stored plan content hash; on mismatch it warns and requires explicit confirmation before continuing against the stored wave plan (binding default, see Assumptions).
- **Corrupt or missing run-state on `--resume`:** print the parse/read failure and offer a fresh run; never guess at state.
- **Phase-runner subagent dies mid-phase (relay):** the driver treats the phase as interrupted; run-state still reflects the last completed wave (written per-wave), so the normal resume path applies. The driver offers resume in-session or stops with the resume command.
- **Mid-wave crash:** re-run the whole interrupted wave; dirty-tree prompt once, git-gated (decided: crash-resume).
- **No-git mode:** run-state.json is still written and resume works; dirty-tree prompt skipped; per-wave commits absent as today (decided: no-git assumption).
- **Rogue self-commits during an interrupted wave:** the existing rogue-commit guard runs on the re-dispatched wave; committed rogue work is detected via `git log` against the wave's recorded start SHA from run-state.
- **Agent return exceeding schema caps:** the orchestrator treats it like any schema-invalid return today (dev-agent parse-failure fallback / verifier UNVERIFIABLE synthesis); no silent truncation.
- **User declines resume at auto-detect:** the stale run-state is marked `abandoned` so it is not re-offered every run.

## Acceptance criteria (EARS)

1. WHEN a validated wave plan contains more than `max_waves_per_phase` waves and phasing is enabled, THE SYSTEM SHALL slice it into sequential phases of at most `max_waves_per_phase` consecutive waves and write `run-state.json` before dispatching any dev agent.
2. WHEN a validated wave plan contains at most `max_waves_per_phase` waves, THE SYSTEM SHALL run the existing unphased pipeline with no phase directories and no run-state file.
3. WHILE in `relay` mode, THE SYSTEM SHALL execute each phase in a fresh-context phase-runner subagent and the driver session SHALL receive only the phase-summary return, never per-wave agent returns.
4. WHILE in `stop` mode, THE SYSTEM SHALL end the session at each phase boundary after updating run-state.json and printing a copy-pasteable resume invocation.
5. WHILE running on the Agent Teams backend with phasing active, THE SYSTEM SHALL use `stop` behavior at every phase boundary regardless of configured mode.
6. WHEN `--no-phasing` is passed, THE SYSTEM SHALL run the entire plan in the current single-session pipeline regardless of plan size or yml config.
7. WHEN `--resume` targets a run-state whose next phase is incomplete, THE SYSTEM SHALL re-enter at the first incomplete wave of that phase without re-running the analyzer or any completed wave.
8. WHEN resume finds an interrupted (in-progress) wave, THE SYSTEM SHALL re-dispatch that wave from its start; IF git is available and the working tree is dirty, THEN THE SYSTEM SHALL ask once (stash / keep) before dispatching and SHALL NOT silently discard uncommitted work.
9. WHEN pre-flight detects an incomplete run-state under `docs/plan-runner/`, THE SYSTEM SHALL offer resume before starting a fresh run; IF the user declines, THEN THE SYSTEM SHALL mark that run-state `abandoned`.
10. IF the plan file's content hash differs from the hash stored in run-state at resume, THEN THE SYSTEM SHALL warn and require explicit confirmation before continuing.
11. IF `run-state.json` is missing or unparseable when `--resume` is invoked, THEN THE SYSTEM SHALL report the failure and offer a fresh run, never inferring state.
12. WHEN the terminal phase completes, THE SYSTEM SHALL run aggregation over bug JSONs from all phase subdirectories, and the verifier-coverage gate SHALL backfill `UNVERIFIABLE` for any wave of any phase lacking a verdict before the PR step can run.
13. WHEN the terminal phase prints the Run Report, THE SYSTEM SHALL sum token and timing figures across all phase manifests, sum only non-null token values, aggregate the coverage counters, and print the lower-bound honesty line whenever any phase's coverage is partial.
14. WHEN any intermediate phase completes, THE SYSTEM SHALL print a compact phase summary (waves, bugs so far, tokens with coverage, next action) and SHALL NOT print the full Run Report.
15. WHEN any pipeline agent returns free-text fields exceeding the schema `maxLength` caps, THE SYSTEM SHALL handle it via the existing invalid-return paths (parse-failure fallback / UNVERIFIABLE), not silent truncation.
16. WHEN the schema caps land, all pre-existing valid fixtures SHALL still validate, and new invalid fixtures SHALL exercise each capped field.
17. WHEN a fix-plan re-run's wave plan exceeds the threshold, THE SYSTEM SHALL phase it by the same rules as a first-cycle run.
18. WHEN phasing is active in no-git mode, THE SYSTEM SHALL still write and update run-state.json and support stop/resume, with all git-gated steps skipped as today.
19. WHEN a run completes (terminal phase, terminal cycle), THE SYSTEM SHALL set run-state status `complete`, and code-atlas sync plus the PR step SHALL have run only on that terminal phase.
20. WHEN no explicit phase mode is configured and the sliced phase count exceeds `auto_stop_phases`, THE SYSTEM SHALL select `stop` mode and print a one-line explanation; WHEN the phase count is at most `auto_stop_phases`, THE SYSTEM SHALL select `relay`.
21. WHILE relaying, IF elapsed wall-time since run start exceeds `relay_max_minutes` at a phase boundary, THEN THE SYSTEM SHALL force a stop-and-resume at that boundary, printing the reason and the resume invocation.
22. WHEN a representative 40+-task plan is run in the default configuration as the release smoke check, THE SYSTEM SHALL complete (across resumed sessions where stop boundaries occur) without the host process exceeding its memory envelope.

## Assumptions (unconfirmed)

Binding defaults (low-cost, reversible; each welded to a criterion above):

- **`max_waves_per_phase` defaults to 4** (calibrated from "40+ task plans crash": ~10-15 waves -> 3-4 phases). Criteria 1-2.
- **Phasing enabled by default** (`phasing.enabled: true`); the kill-switch is `--no-phasing` / `enabled: false`. Criteria 1, 6.
- **Phasing triggers only above the threshold**; smaller plans see zero change. Criterion 2.
- **Fix-plan re-runs inherit phasing automatically.** Criterion 17.
- **No-git mode keeps full stop/resume support** via run-state.json alone; the dirty-tree prompt is git-gated. Criteria 8, 18.
- **Return budget ~1-2k tokens**, expressed as prose budgets plus generous character `maxLength` caps sized to clear all existing fixtures. Criteria 15-16.
- **Plan content hash stored in run-state** guards resume against plan drift. Criterion 10.
- **Adaptive-mode defaults: `auto_stop_phases` = 3 and `relay_max_minutes` = 90** (conservative against the observed ~2.5h OOM envelope; the mitigations themselves are decided, these numbers are labeled defaults). Criteria 20, 21.
- **Run-state placement: per-cycle, deviating from the decided "run root" wording** (audit finding 1, surfaced for user ratification at the review gate). Rationale: a fix-plan re-run is a new cycle that phases independently (requirement 15), so per-cycle run-states compose with the cycle model; the decided "single resume entry point" is preserved behaviorally by the pre-flight auto-detect scan (criterion 9) and `--resume [path]`. If the user prefers the literal decision, run-state moves to `docs/plan-runner/{DATE}/run-state.json` with cross-cycle cycle-dir pointers, and requirements 2 and 6 plus the Data & interfaces and layout blocks move together.
- **Run-state carries operational context beyond the ledger's field list** - backend, verify mode, TDD state, overall status - because a resumed session must re-enter with identical settings (extends the decided checkpoint row; audit finding 3). Criteria 7, 18.
- **Resume failure modes are derived error handling** from the decided "never silently discard work" principle: a declined auto-detect marks the run-state `abandoned` so it is not re-offered; a corrupt/missing run-state on `--resume` reports and offers a fresh run (audit finding 4). Criteria 9, 11.
- **Excluding first-party context-editing / memory-tool API integration** follows the plugin's backend-agnostic stance (dual-client baseline row), not a ledger decision of its own (audit finding 2).
- **ADR numbering starts at 0003** to avoid collision with ADR-0001/0002 on the parked codex-compat branch.

## Open questions

- **Prose-hardening extras** (per-phase invariant re-assertion for compaction survival, batched one-message dispatch audit, NODE_OPTIONS heap-headroom README note): cut from this spec by the user; candidate follow-up spec if long relay runs still degrade.

## Definition of done

- Contract tests updated in the same change as every prose edit, including new tests pinning the phasing, resume, and return-budget prose.
- `node --test tests/contract.test.js`, `python tests/validate_schemas.py`, `claude plugin validate .`, and the Codex validators pass.
- Existing behavior preserved outside the described change - specifically, sub-threshold plans and `--no-phasing` runs are byte-for-byte today's pipeline.
- Both backends and both clients (Claude Code, Codex) honored; Windows and POSIX path handling verified.
- No new network calls.
- README documents phasing, resume, config, and the relay-vs-stop memory trade-off, without overstating payload caps as the memory fix.
- Release smoke check: a representative 40+-task plan completes in the default configuration without host-process memory exhaustion (criterion 22).
- Five-place version bump (minor: new pipeline behavior) on release.
- Every acceptance criterion above passes.
