# Repository guidance

- Maintain Plan Runner as a dual-client plugin for Claude Code and Codex.
- Keep `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json`, the changelog, and contract-test version pins synchronized.
- Keep skill frontmatter compatible with Codex: only supported fields, and each skill name must match its folder name.
- Keep shared orchestration prose host-neutral. Claude Agent Teams may remain an optional Claude-only backend; Codex uses native subagents through the shared `subagent` backend.
- Resolve bundled agent definitions relative to the active `SKILL.md`; Codex does not register files under `agents/` as named agents automatically.
- Preserve the default `hooks/hooks.json` location and keep the SessionStart hook self-contained.
- Run `node --test tests/contract.test.js`, `python tests/validate_schemas.py`, both plugin validators, and the Codex skill validator before releasing.
- Release with an immutable plain `v<version>` tag, then update both catalogs in `qa-claude-market` to that tag and commit SHA.
