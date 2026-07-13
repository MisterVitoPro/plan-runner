# Changelog

All notable changes to plan-runner are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## 1.11.0 - 2026-07-13

- **Agents bubble up their token usage.** Every pipeline agent (analyzer, dev, test-author, verifier, aggregator) now includes an optional `token_usage` self-report in its return JSON: the most recent usage figure the harness surfaced to it in-band (e.g. a token-budget system warning), or `null` when none appeared -- never an estimate. The orchestrator captures tokens from two sources in strict precedence: the completion result's usage summary (authoritative, `source: "harness"`) first, falling back to the agent's non-null self-report (`source: "self_report"`, an honest lower bound) -- the common rescue for teammates on the Agent Teams backend, whose usage is not always visible to the lead. `tokens: null` remains the outcome only when both sources are dry, so per-agent coverage improves without weakening the never-fabricate invariant.
- Schemas: `dev-return` and `wave-plan` gain an optional `token_usage` self-report field; manifest `token_usage.by_agent` entries and the reusable `tokenCount` shape gain an optional `source` enum (`harness` | `self_report`). All new fields are optional -- pre-1.11.0 artifacts still validate.

## 1.10.1 - 2026-07-12

### Changed
- README: cross-reference the ideas plugin as the pipeline front door (interview -> audited spec -> plan-runner-ready plan). No pipeline behavior change.

## 1.10.0 - 2026-07-07

- Unified end-of-run reporting: the former separate final-summary, Token Report, and Phase Timing blocks are now a single **Run Report** -- a two-column at-a-glance stat header (waves, agents, verifiers, commits, duration, tokens, coverage, bugs) followed by per-phase token and timing tables and an artifacts block, printed once at the terminal end of a cycle on both the clean and bugs-found paths. Partial token coverage and unverified waves are surfaced as honesty lines under the stat header. The bugs-found re-run decision block stays compact (no inline Token Report); intermediate `Y` handoff cycles defer token/timing detail to the manifest and the final cycle's report.

## 1.9.0 - 2026-07-07

- **Configurable verification coverage.** A new `verify_mode` dial controls how many waves get a semantic verifier: `per-agent` (one verifier per dev agent, every wave), `per-wave` (one per wave, every wave -- the default and previous behavior), or `last-wave-only` (verify only the final wave). Set it in a committed `.plan-runner.yml` (`verification.mode`) or per-run with `--verify <mode>`; precedence is flag > file > default.
- **Honest reduced coverage.** Waves left unverified by a lower mode are recorded `SKIPPED` -- a deliberate, transparent absence distinct from `UNVERIFIABLE` (a *requested* verdict that never landed, still a tracked bug). BLOCKED dev agents on a SKIPPED wave still surface a P0, relayed by the orchestrator from the dev's own declared status (no self-verify). The coverage gate leaves SKIPPED alone but still backfills UNVERIFIABLE for an in-scope missing verdict, so a PR still cannot open while a requested verdict is outstanding.
- **Depth-honest surfacing.** The zero-bug summary and cross-cycle convergence hint no longer read as fully verified-clean when waves were skipped; the auto-re-run carries the effective mode forward; and the PR opens as a **draft** with a `[!WARNING]` verification banner whenever any wave was left unverified. The manifest gains an optional `verification` block (`mode` + coverage counters).

## 1.8.3 - 2026-07-04

- **Fix release automation: tag step had no git identity.** The `marketplace-pin` workflow created an annotated tag (`git tag -a`) without configuring a committer identity on the runner, so the tag step failed with `empty ident name` and the marketplace pin never ran (caught by the first live release, v1.8.2). It now sets the `github-actions[bot]` identity before tagging.

## 1.8.2 - 2026-07-04

- **Release automation.** Added a `marketplace-pin` GitHub Actions workflow: when a merge to `main` bumps `plugin.json`'s version, it tags the merge commit `vX.Y.Z` and updates this plugin's `ref` + `sha` + `description` in the `MisterVitoPro/qa-claude-market` marketplace, authenticated by a repo-scoped SSH deploy key. Routine releases no longer need a manual tag or marketplace edit; non-release merges are a no-op.

## 1.8.1 - 2026-07-04

- **Analyzer parse-retry reuses the session.** When the analyzer's first response fails to parse as JSON, the run skill now retries by continuing the SAME analyzer session via `SendMessage` (to the analyzer's returned agent id) rather than dispatching a fresh analyzer. The retry prompt says "your previous response," which only resolves against the session that produced it, and a fresh spawn would have to resend the entire plan text a second time -- wasteful for large plans. Prose clarification only; the two-attempt limit and STOP-on-second-failure behavior are unchanged.

## 1.8.0 - 2026-07-02

- **Rogue-commit guard.** A dev agent that disobeys the no-commit rule and commits its own work leaves a clean working tree, which the orchestrator previously misread as "agent produced nothing" -- triggering a wasted retry agent, and mislabeling the wave commit as "no changes". The run skill now records `wave_start_sha` at the start of every wave (when git is available) and, before treating any dev agent as silent-failed or dispatching a retry, checks `git log <wave_start_sha>..HEAD -- <owned_files>`; self-committed work counts as delivered and flows to the wave verifier as usual. The wave-commit step (4e) likewise distinguishes a genuinely empty wave from one self-committed by agents (`skipped_reason = "self-committed by dev agents (rogue)"`, with the real HEAD recorded as `commit_sha`). All checks are gated on `git_available`.
- **Sharper plan-dev git prohibition.** The dev-agent rule now names the forbidden commands (`git add` / `git commit` / `git push`) and explains why a self-commit is harmful, instead of the softer "Do NOT commit".

## 1.7.0 - 2026-07-02

- **Agent teardown (no more idle agents).** A finished dev agent or wave verifier does not exit on its own -- it stayed resident as an idle background task (subagent backend) or idle teammate (teams backend) until the whole cycle ended. Every wave now explicitly calls `TaskStop` on each dev agent immediately after its result is captured (before the wave verifier is dispatched) and on the wave verifier immediately after its report is captured, regardless of status/verdict. This runs wave by wave, so agents from wave 1 no longer idle for the rest of a multi-wave run.

## 1.6.0 - 2026-07-01

- **End-of-run Token Report.** Both end-of-run paths (clean and bugs-found) now print a full token report rendered from `manifest.json` `token_usage`: a per-phase table (Analyze / Dev / Verify / Aggregate) with input, output, and total sums, a per-phase reported-coverage column, a top-consumers line naming the most expensive subagents, and a grand total with an honest coverage line. Sums cover non-null figures only; partial coverage is labeled a lower bound.
- **PR stats token breakdown.** The PR body's `Tokens:` stat gains a compact `By phase:` sub-bullet computed from `token_usage.by_agent`.
- Fixed stale monorepo schema paths (`plugins/plan-runner/schemas/...`) in the run skill and analyzer agent; schemas are referenced relative to the plugin root.
- Fixed the README install instructions (marketplace repo is `MisterVitoPro/qa-claude-market`) and the version badge URL.
- **Least-privilege agents.** The verifier and analyzer (which must never modify files) now declare read-only `tools: Read, Grep, Glob`; the aggregator adds only `Write` (it writes `bugs.md` / `fix-plan.md`). Dev and test-author agents keep full tools (they implement code and may query Context7).
- Added `displayName` and `homepage` to the plugin manifest.
- Added `CHANGELOG.md`, a root `package.json` with test scripts, and a GitHub Actions CI workflow (contract tests, schema fixture validation, `claude plugin validate`).
- **Robust SessionStart hook.** The gitignore-ensure logic is now inlined in `hooks/hooks.json` via `node -e`, removing the dependency on `${CLAUDE_PLUGIN_ROOT}` substitution (reported unreliable for SessionStart hooks on some builds). `scripts/ensure-gitignore.js` is removed.

## 1.5.0

- Initial standalone-repo release. Carries the full pipeline: wave-based parallel execution with per-wave verification, TDD red-green mode on by default, best-effort per-subagent token accounting in `manifest.json`, Agent Teams backend auto-detection with subagent fallback, verifier-gated waves with a coverage gate before aggregation, optional git (no-git mode), pre-PR code-atlas sync, and PR creation via the `plan-runner:pr` skill.
