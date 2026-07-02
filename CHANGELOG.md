# Changelog

All notable changes to plan-runner are documented here. Versions follow [Semantic Versioning](https://semver.org/).

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
