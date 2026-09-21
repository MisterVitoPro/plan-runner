# plan-runner — rules for working on this repo

This is a dual-client Claude Code and Codex plugin. The Markdown prose in `skills/*/SKILL.md` and `agents/*.md` IS the product — edits to wording are behavior changes, not doc changes.

## Verification

```
node --test tests/contract.test.js
python tests/validate_schemas.py        # needs: pip install jsonschema
claude plugin validate .
# Also run the Codex plugin and skill validators used by CI.
```

`tests/contract.test.js` pins exact phrases and regexes in the skill/agent prose. When you edit prose, update the matching contract test in the same change — and when you add a feature, add a contract test that pins it.

## Version bump protocol

A release touches six places, in one commit:
1. `.claude-plugin/plugin.json` `version`
2. `.codex-plugin/plugin.json` `version`
3. The pinned version assertion in `tests/contract.test.js` ("docs + version reflect the ... feature")
4. `package.json` `version`
5. A new `CHANGELOG.md` entry (SemVer: new pipeline behavior = minor, prose/doc fix = patch)
6. `.claude-plugin/plugin.json` `description` — a deliberately short marketplace blurb (~250 chars; the plugin-ecosystem median is ~150 and every browsing surface truncates past a few lines). Update it only when the core pitch changes; per-release feature detail goes in the CHANGELOG and README, never appended here. A contract test caps it at 300 chars. (Pre-1.18.0 it accumulated a clause per release and reached 4,200+ chars.)

Tagging and the marketplace pin are **automated** by `.github/workflows/marketplace-pin.yml`: when a merge to `main` bumps the synchronized manifest version, it tags the merge commit `vX.Y.Z` and updates the plugin's `ref` + `sha` in both `MisterVitoPro/esper` catalogs, plus the Claude catalog description, the plan-runner version badge in Esper's `README.md`, and the plan-runner row of Esper's `CLAUDE.md` plugin table (Esper's lint requires the badge to match the pinned ref). So a normal release is just: land the six-place version-bump commit on `main` via PR — the tag and both marketplace pins follow automatically. Don't hand-tag or hand-edit the marketplace for a routine release; doing both by hand races the workflow.

Esper's per-plugin README section and CLAUDE.md description cell are prose the workflow does not write; when the core pitch changes (as in 2.0.0), update them by hand in a PR against `MisterVitoPro/esper`.

Caveats: the `.claude-plugin/plugin.json` `description` field is especially important — the workflow copies it verbatim into the plan-runner entry of the Claude marketplace catalog, which is the only plugin copy users see when browsing the marketplace. No automated check catches drift (`node --test`, `tests/validate_schemas.py` and `claude plugin validate` all pass with a stale description), so it must be checked by hand at release time. The workflow only syncs when `.claude-plugin/plugin.json`'s version differs from the previous commit, so a description-only merge to `main` is a no-op; correcting the blurb requires a version bump (and under SemVer, a prose fix counts as a patch release).

The workflow authenticates to `esper` with the `MARKETPLACE_DEPLOY_KEY` repo secret — the private half of an SSH deploy key registered with write access on that repo (scoped to it alone, not a personal PAT). Without it the release merge fails at the marketplace step. It fires only on a version change, so non-release merges are a no-op. If you ever need to pin a specific older `sha` (not the merge commit), edit `marketplace.json` by hand instead. A release is not live until the marketplace bump lands (now: until the workflow run succeeds).

## Never commit a private infrastructure identifier

Committed text uses placeholders. A real hostname, IP address, or personal email must
never reach a tracked file, **including inside a comment, a test fixture, or an example**.
Use `localhost`, `example.com`, or an obviously fictional name like `stub-endpoint`.

This is enforced by `scripts/check-no-private-identifiers.js`, which runs first in CI and
is pinned by a contract test. If a host is genuinely public and belongs in the repo, add
it to that script's `ALLOWED_HOSTS` with a reason, rather than working around the check.

The rule exists because it was broken. Implementing local-endpoint dispatch, an agent was
handed a real, working endpoint as ground truth so it would build against the actual wire
format instead of guessing. That was correct for the code and wrong for the comment: it
used the live host as its example, and the value shipped in a public release. Removing it
afterwards was not a one-line fix. The hostname survived in the branch history and in
`refs/pull/<n>/head`, which GitHub serves even after a squash merge and a branch deletion,
so the only complete remedy was deleting and recreating the repository, which cost it 126
commits, 31 pull requests, and every tag before `v2.2.0`.

**When dispatching an agent that needs a real endpoint, give it the real value for
behavior and state explicitly that any committed example must be a placeholder.** The
agent will otherwise, and reasonably, treat the value it was given as the canonical one.

## Honesty invariants (never weaken these)

- **Token accounting is best-effort.** Never fabricate a token count. Unreported agents get `null` plus coverage counters (`agents_reported`/`agents_total`/`complete`). Any new stat surfaced anywhere (dashboards, Token Report, PR body) sums non-null values only and labels partial coverage as a lower bound. The tally is durable: every scheduler session appends to the one cycle manifest, and an agent whose session was lost still counts toward `agents_total`.
- **No self-verify.** The orchestrator never substitutes its own judgment for a verifier's verdict. A missing verdict becomes `UNVERIFIABLE`, blocks that task's integration, and flows through the fix-plan loop -- never a silently-integrated task. An agent's own test run is never evidence either: the orchestrator re-runs the gate of record.
- **Verifier-coverage gate stays upstream of the PR step** on every path. It must remain structurally impossible to open a PR while a task's verdict is outstanding.

## Pipeline invariants

- **The task DAG is the only executor** (since 3.0.0; ADR-0011). There are no waves, no wave barriers, and no fallback. Git with usable worktrees is required: pre-flight STOPs without it, and DAG execution is never approximated on a shared working tree.
- At most six active dev tasks; a task is never dispatched while its declared paths (`owned_files` + `shared_files`) intersect an active reservation. Every task runs in its own disposable worktree; the scheduler commits its work, checks the complete diff against declared ownership, runs its gates there, and requests an independent verdict. Only central integration (Step 4f, serial, following `agents/plan-integrator.md`) mutates the run-owned branch; the operator's branch and checkout are never touched.
- Integration is severity-gated: a P0 or P1 finding, an ownership `FAIL`, a failed deterministic check, or an `UNVERIFIABLE` verdict blocks a task; P2 and P3 findings ride along to the fix-plan. Repair is bounded at one attempt, then the task (and everything behind it) is blocked with durable evidence.
- State is authoritative over Git inspection: `run-state.json` + append-only `events.jsonl`. Every run writes them; resume never infers completion from branches or commits and never redispatches an `integrated` task.
- Resolve pipeline role files relative to the active `SKILL.md` and deliver them to native subagents through the prompt, by absolute path (`ROLE DEFINITION: read <path> ...`), pasting the text only as the inline fallback for a subagent that cannot read the plugin directory. Never depend on Codex automatically registering `agents/` files.
- **Bulk text never travels through a prompt or the orchestrator's context.** Every prompt character is orchestrator output, generated before the subagent can start and re-billed as context afterwards. Role files, the plan (`plan.numbered.txt`), and gate output (`gates/*.log`) all travel as file paths. Exactly two dispatches still paste definition text, each deliberately: a project agent's definition (its position above the overriding contract is part of the guard) and an HTTP endpoint dispatch (the model has no tools to read a file with).
- **Gate discipline** governs every test command the orchestrator runs: file-backed logs, a time budget whose expiry is recorded `TIMEOUT` (never a pass, never a fabricated failure list), foreground waits (a subagent that ends its turn on a gate is never woken), and `BUILD_FAILED` as its own state. The full suite runs only at baseline, phase boundaries, and the final verification; the baseline is captured once per cycle and never re-captured. A relay driver never waits on a runner that has returned.
- Agents keep least-privilege `tools:` frontmatter -- the analyzer is read-only (`Read, Grep, Glob`); the verifier adds `Write` solely for its file-backed `return_file` (reason recorded in its rules); aggregator and integrator add only `Write`. Don't broaden these without a reason recorded in the agent's rules.

## Schemas

Any change to `schemas/*.schema.json` needs: matching valid AND invalid fixtures in `schemas/examples/`, and back-compat (new manifest fields are optional, with a "pre-X.Y.Z" note in the description — old manifests must still validate).

## Paths and artifacts

- Reference plugin files relative to the active skill or plugin root. Never use the old monorepo prefix `plugins/plan-runner/...`.
- Run output lives under `docs/plan-runner/` in the target repo and is gitignored by the SessionStart hook — never commit generated cycle artifacts.
- The SessionStart hook logic is inlined in `hooks/hooks.json` via `node -e`, deliberately avoiding `${CLAUDE_PLUGIN_ROOT}` (unreliable for SessionStart hooks on some builds) and any script file path. Keep it self-contained and silent-on-failure; if it grows beyond a one-liner, reconsider the design rather than reintroducing a path dependency.
