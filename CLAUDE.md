# plan-runner — rules for working on this repo

This is a Claude Code plugin. The Markdown prose in `skills/*/SKILL.md` and `agents/*.md` IS the product — edits to wording are behavior changes, not doc changes.

## Verification (run all three before claiming any change done)

```
node --test tests/contract.test.js
python tests/validate_schemas.py        # needs: pip install jsonschema
claude plugin validate .
```

`tests/contract.test.js` pins exact phrases and regexes in the skill/agent prose. When you edit prose, update the matching contract test in the same change — and when you add a feature, add a contract test that pins it.

## Version bump protocol

A release touches four places, in one commit:
1. `.claude-plugin/plugin.json` `version`
2. The pinned version assertion in `tests/contract.test.js` ("docs + version reflect the ... feature")
3. `package.json` `version`
4. A new `CHANGELOG.md` entry (SemVer: new pipeline behavior = minor, prose/doc fix = patch)

Tagging and the marketplace pin are **automated** by `.github/workflows/marketplace-pin.yml`: when a merge to `main` bumps `plugin.json`'s `version`, it tags the merge commit `vX.Y.Z` and updates the plugin's entry (`ref` + `sha` + `description`) in `MisterVitoPro/qa-claude-market` `.claude-plugin/marketplace.json`. So a normal release is just: land the four-place version-bump commit on `main` via PR — the tag and the marketplace bump follow on their own. Don't hand-tag or hand-edit the marketplace for a routine release; doing both by hand races the workflow.

Caveats: the workflow authenticates to `qa-claude-market` with the `MARKETPLACE_DEPLOY_KEY` repo secret — the private half of an SSH deploy key registered with write access on that repo (scoped to it alone, not a personal PAT). Without it the release merge fails at the marketplace step. It fires only on a version change, so non-release merges are a no-op. If you ever need to pin a specific older `sha` (not the merge commit), edit `marketplace.json` by hand instead. A release is not live until the marketplace bump lands (now: until the workflow run succeeds).

## Honesty invariants (never weaken these)

- **Token accounting is best-effort.** Never fabricate a token count. Unreported agents get `null` plus coverage counters (`agents_reported`/`agents_total`/`complete`). Any new stat surfaced anywhere (dashboards, Token Report, PR body) sums non-null values only and labels partial coverage as a lower bound.
- **No self-verify.** The orchestrator never substitutes its own judgment for a verifier's verdict. A missing verdict becomes `UNVERIFIABLE` and flows through the fix-plan loop — never a silently-closed wave.
- **Verifier-coverage gate stays upstream of the PR step** on every path. It must remain structurally impossible to open a PR while a wave's verdict is outstanding.

## Pipeline invariants

- Max 6 agents per wave; waves are file-disjoint; per-wave barrier (dispatch -> gates -> verify -> commit) holds on both backends.
- Dispatch pipeline agents by registered subagent type (`plan-runner:plan-*`). Never inline agent `.md` bodies into prompts.
- git is optional: every git operation must be gated on `git_available`.
- Agents keep least-privilege `tools:` frontmatter — verifier and analyzer are read-only (`Read, Grep, Glob`); aggregator adds only `Write`. Don't broaden these without a reason recorded in the agent's rules.

## Schemas

Any change to `schemas/*.schema.json` needs: matching valid AND invalid fixtures in `schemas/examples/`, and back-compat (new manifest fields are optional, with a "pre-X.Y.Z" note in the description — old manifests must still validate).

## Paths and artifacts

- Reference plugin files relative to the plugin root (`${CLAUDE_PLUGIN_ROOT}/...`). Never use the old monorepo prefix `plugins/plan-runner/...`.
- Run output lives under `docs/plan-runner/` in the target repo and is gitignored by the SessionStart hook — never commit generated cycle artifacts.
- The SessionStart hook logic is inlined in `hooks/hooks.json` via `node -e`, deliberately avoiding `${CLAUDE_PLUGIN_ROOT}` (unreliable for SessionStart hooks on some builds) and any script file path. Keep it self-contained and silent-on-failure; if it grows beyond a one-liner, reconsider the design rather than reintroducing a path dependency.
