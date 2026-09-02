# Repository guidance

- Maintain Plan Runner as a dual-client plugin for Claude Code and Codex.
- Keep `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json`, the changelog, and contract-test version pins synchronized.
- Keep skill frontmatter compatible with Codex: only supported fields, and each skill name must match its folder name.
- Keep shared orchestration prose host-neutral. Claude Agent Teams may remain an optional Claude-only backend; Codex uses native subagents through the shared `subagent` backend.
- Resolve bundled agent definitions relative to the active `SKILL.md`; Codex does not register files under `agents/` as named agents automatically.
- Keep the DAG executor the default in Git repositories and the wave executor an explicit rollback (`execution.mode: wave`) plus the automatic no-Git path; never let a task agent mutate the integration branch or the operator's checkout.
- Preserve the default `hooks/hooks.json` location and keep the SessionStart hook self-contained.
- Run `node --test tests/contract.test.js`, `python tests/validate_schemas.py`, both plugin validators, and the Codex skill validator before releasing.
- Release by landing the synchronized version bump on `main` via PR. The `marketplace-pin` workflow then tags the merge commit `v<version>` and updates both catalogs in `MisterVitoPro/esper` (ref, sha, Claude description, README badge, and CLAUDE.md table row); do not hand-tag or hand-edit the marketplace for a routine release.
- Never commit a private infrastructure identifier. A real hostname, IP address, or personal email must not reach a tracked file, including in a comment, fixture, or example; use `localhost`, `example.com`, or an obviously fictional name. Enforced by `scripts/check-no-private-identifiers.js` in CI. When an agent is given a real endpoint so it builds against the true wire format, say explicitly that any committed example must still be a placeholder.
