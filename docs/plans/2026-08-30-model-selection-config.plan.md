# Model-selection config for plan-runner - implementation plan

Goal: Let a target repo name the model for every plan-runner pipeline role in committed configuration -- including a locally served model behind an HTTP endpoint -- and ask the operator once, rather than silently substituting, when a configured model cannot be served.
Source spec: docs/specs/2026-08-30-model-selection-config.md
Flagged constraints (unconfirmed): None
Skeleton manifest: docs/plans/2026-08-30-model-selection-config.skeleton.json
Dependency graph: docs/plans/2026-08-30-model-selection-config.graph.json

### Task 1: Model policy prose and contract pins
Task ID: model-selection-config-t01
Owned files: skills/run/SKILL.md, skills/pr/SKILL.md, tests/contract.test.js
Interfaces: consumes docs/specs/2026-08-30-model-selection-config.md, docs/adr/0007-tier-indirection-model-resolution.md, docs/adr/0008-model-policy-in-run-state.md; produces the `models:` config contract, the resolution precedence chain, the `model_policy` object shape consumed by model-selection-config-t02, the analyzer served-model self-report contract consumed by model-selection-config-t03, the user-facing flag and key surface documented by model-selection-config-t04, and the release pin string `2.1.0` consumed by model-selection-config-t05.
Graph context: owns path:skills/run/SKILL.md, path:skills/pr/SKILL.md, path:tests/contract.test.js; consumes contract:spec-ears, contract:adr-0007-tier-indirection, contract:adr-0008-run-state-persistence; produces contract:models-config-block, contract:resolution-precedence-chain, contract:model-policy-shape, contract:analyzer-served-model, contract:cli-surface, contract:release-pin-2.1.0; edges (task:t01 owns path:skills/run/SKILL.md) (task:t01 owns path:skills/pr/SKILL.md) (task:t01 owns path:tests/contract.test.js) (task:t01 produces contract:model-policy-shape) (task:t02 consumes contract:model-policy-shape) (task:t03 consumes contract:analyzer-served-model) (task:t04 consumes contract:cli-surface) (task:t05 consumes contract:release-pin-2.1.0)
Acceptance criteria:
- WHEN `.plan-runner.yml` contains a `models.tiers` entry for a tier, THE SYSTEM SHALL dispatch every role and task that calls for that tier using the configured identifier.
- WHEN `.plan-runner.yml` contains a per-role key for one of `analyzer`, `dev`, `test-author`, `verifier`, `aggregator`, or `integrator`, THE SYSTEM SHALL prefer that key over the tier map for that role.
- WHEN a project agent serving a dev dispatch declares `model:` frontmatter, THE SYSTEM SHALL use the frontmatter model in preference to any `models:` configuration.
- WHEN no `models:` block is present, THE SYSTEM SHALL resolve every role exactly as it did before this feature and SHALL NOT prompt the operator.
- WHEN a configured model value is not a tier word, THE SYSTEM SHALL pass the value to the host unmodified.
- WHEN a run begins with a `models:` block present, THE SYSTEM SHALL check only endpoint reachability, `api_key_env` presence, and config well-formedness at preflight, and SHALL NOT attempt to enumerate the host's available models.
- WHEN the analyzer returns, THE SYSTEM SHALL compare the model it was served against the configured model, and IF they differ THEN THE SYSTEM SHALL open the availability gate before dispatching any dev agent.
- IF preflight or the analyzer probe finds one or more configured models that cannot be served, THEN THE SYSTEM SHALL ask the operator once, in a single structured question covering every unavailable entry, before any dev agent is dispatched.
- IF the availability gate has already been answered earlier in the same run, THEN THE SYSTEM SHALL NOT ask the operator about model availability again for the remainder of that run.
- IF the operator declines at the gate, THEN THE SYSTEM SHALL resolve the affected roles using the pre-feature built-in defaults, record the answer as declined, and continue the run without aborting and without substituting by task complexity.
- IF the gate is reached with no structured-input facility available, THEN THE SYSTEM SHALL dispatch the closest available model, print the substitution, and record it, and SHALL NOT abort the run.
- IF a model resolved through `endpoint.base_url` is unavailable, THEN THE SYSTEM SHALL NOT substitute a model not served by that endpoint; it SHALL ask when an input facility exists, and otherwise SHALL halt that dispatch and record it.
- IF `endpoint.api_key_env` names an environment variable that is absent or empty, THEN THE SYSTEM SHALL treat the endpoint as unavailable and SHALL NOT print or persist any credential value.
- IF `endpoint.base_url` does not match the exported `ANTHROPIC_BASE_URL`, THEN THE SYSTEM SHALL print a warning naming both values and SHALL NOT modify the process environment.
- WHEN `endpoint.base_url` is configured, THE SYSTEM SHALL issue at most one health-check request for it per run with a 5-second timeout, and IF the check fails or times out THEN THE SYSTEM SHALL record the endpoint health as unreachable and continue without raising.
- WHEN a configured model becomes unavailable after the gate has been answered, THE SYSTEM SHALL degrade to the closest available model and record the substitution without opening a second gate.
- WHEN a run resumes or relays into a new phase, THE SYSTEM SHALL rehydrate the model policy from run-state rather than re-resolving the configuration.
- WHEN model policy resolution completes, THE SYSTEM SHALL print the resolved map once in the form `<setting>: <value> (from <flag | .plan-runner.yml | default>).`
- WHEN an agent is dispatched, THE SYSTEM SHALL record its resolved model in the manifest entry for that agent.
- IF any substitution occurred during a run, THEN THE SYSTEM SHALL surface it in the PR body alongside the bug and verification counts.
- WHEN `--no-model-config` is passed, THE SYSTEM SHALL ignore the `models:` block, resolve models exactly as it did before this feature, and SHALL NOT open the gate.
- WHEN `models.enabled` is false and no flag overrides it, THE SYSTEM SHALL behave exactly as `--no-model-config` does.
- WHEN the same `models:` block is read on the Codex backend, THE SYSTEM SHALL apply the same resolution chain and SHALL NOT require any client-specific key.
- WHEN `.plan-runner.yml` is absent, unreadable, or missing a requested key, THE SYSTEM SHALL fall through to the next precedence level without raising.
- WHEN this feature is present, THE SYSTEM SHALL leave the verifier-coverage gate upstream of the PR step and SHALL NOT allow a model substitution to close a wave whose verdict is outstanding.
- WHEN the contract suite runs, THE SYSTEM SHALL pin each behavior above as an exact-phrase or regex assertion over the emitted prose, and SHALL assert the release pin string `2.1.0`.
Verification: `node --test tests/contract.test.js` and `claude plugin validate .`, plus the Codex plugin and skill validators used by CI
Non-goals:
- Does not modify `schemas/run-state.schema.json` or `schemas/manifest.schema.json` (model-selection-config-t02 owns those)
- Does not modify any file under `agents/` (model-selection-config-t03 owns the analyzer)
- Does not update `README.md` or `CHANGELOG.md`
- Does not change `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, or `package.json`
- Does not change the `recommended_model` enum, the analyzer complexity heuristic, or the Step 1c-bis structure heuristic
- Does not set or mutate `ANTHROPIC_BASE_URL`
Blocked by: none
Constraints: Prose in `skills/*/SKILL.md` is the product -- wording changes are behavior changes and every new rule needs its contract pin in the same change. Resolve pipeline role files relative to the active SKILL.md and embed instructions in prompts; never rely on Codex registering `agents/` files. Extract each `models:` key directly with the Read tool -- no YAML parser dependency. Precedence is flag > `.plan-runner.yml` > built-in default throughout. Gate the endpoint health check and every git operation on the relevant availability flag. Honesty invariants are inviolable: never fabricate a token count, never self-verify, keep the verifier-coverage gate upstream of the PR step. No emojis in code.

### Task 2: run-state and manifest schema extensions
Task ID: model-selection-config-t02
Owned files: schemas/run-state.schema.json, schemas/manifest.schema.json, schemas/examples/run-state-model-policy-valid.json, schemas/examples/run-state-model-policy-invalid.json, schemas/examples/manifest-model-policy-valid.json, schemas/examples/manifest-model-policy-invalid.json, tests/validate_schemas.py
Interfaces: consumes contract:model-policy-shape from model-selection-config-t01 (the `resolved`, `source`, `endpoint`, `consent`, and `substitutions` fields and the `resolved_model` / `model_substituted` manifest fields); produces the validated durable shape that the resume path and the PR step read.
Graph context: owns path:schemas/run-state.schema.json, path:schemas/manifest.schema.json, path:schemas/examples/run-state-model-policy-valid.json, path:schemas/examples/run-state-model-policy-invalid.json, path:schemas/examples/manifest-model-policy-valid.json, path:schemas/examples/manifest-model-policy-invalid.json, path:tests/validate_schemas.py; consumes contract:model-policy-shape; produces contract:model-policy-schema; edges (task:t02 depends_on task:t01) (task:t02 consumes contract:model-policy-shape) (task:t02 owns path:schemas/run-state.schema.json) (task:t02 produces contract:model-policy-schema) (task:t05 depends_on task:t02)
Acceptance criteria:
- WHEN a phased run writes a checkpoint, THE SYSTEM SHALL accept a run-state document carrying the resolved model map, its per-entry provenance, the endpoint record, the consent answer, and the substitution list.
- WHEN a run-state file written before this feature is validated, THE SYSTEM SHALL validate it successfully with the model policy object absent.
- IF a run-state document declares a consent value outside the allowed set, or a substitution entry missing its configured or dispatched model, THEN THE SYSTEM SHALL fail validation.
- WHEN a manifest agent entry is validated, THE SYSTEM SHALL accept an optional resolved model string and an optional substitution object carrying the configured model, the dispatched model, and the reason.
- WHEN a manifest written before this feature is validated, THE SYSTEM SHALL validate it successfully with both new fields absent.
- IF a manifest substitution object omits the dispatched model, THEN THE SYSTEM SHALL fail validation.
- WHEN a new schema field is added, THE SYSTEM SHALL mark it optional and describe it with a "pre-2.1.0" note so older documents still validate.
- WHEN `tests/validate_schemas.py` runs, THE SYSTEM SHALL exercise every new fixture pair and SHALL exit non-zero if a valid fixture fails or an invalid fixture passes.
Verification: `python tests/validate_schemas.py`
Non-goals:
- Does not touch any SKILL.md, agent file, or contract test
- Does not modify existing fixtures for wave-plan, dev-return, bug-report, task-graph, or task-event
- Does not change the `recommended_model` enum in `task-graph.schema.json` or `wave-plan.schema.json`
- Does not make any new field required
Blocked by: model-selection-config-t01
Constraints: Any schema change needs matching valid AND invalid fixtures in `schemas/examples/` plus back-compat -- new manifest and run-state fields are optional with a "pre-2.1.0" note in the description, and old documents must still validate. Register each new fixture pair in the `CASES` list so it actually runs. No credential value appears in any fixture. Needs `pip install jsonschema`.

### Task 3: Analyzer served-model self-report
Task ID: model-selection-config-t03
Owned files: agents/plan-analyzer.md
Interfaces: consumes contract:analyzer-served-model from model-selection-config-t01 (the orchestrator compares the analyzer's served model against the configured one to detect an unservable model name); produces the analyzer-side return field that makes the comparison possible.
Graph context: owns path:agents/plan-analyzer.md; consumes contract:analyzer-served-model; produces contract:analyzer-return-model-field; edges (task:t03 depends_on task:t01) (task:t03 consumes contract:analyzer-served-model) (task:t03 owns path:agents/plan-analyzer.md) (task:t05 depends_on task:t03)
Acceptance criteria:
- WHEN the analyzer returns its execution plan, THE SYSTEM SHALL include the identifier of the model that actually served the analyzer dispatch.
- IF the analyzer cannot determine which model served it, THEN THE SYSTEM SHALL report that field as null rather than guessing or fabricating an identifier.
- WHEN the analyzer emits its recommended model per task, THE SYSTEM SHALL continue to use only the values `haiku`, `sonnet`, and `opus`.
- WHEN the analyzer runs, THE SYSTEM SHALL keep its read-only tool set of Read, Grep, and Glob unchanged.
Verification: `node --test tests/contract.test.js` and `claude plugin validate .`
Non-goals:
- Does not modify any other agent file
- Does not change the analyzer's complexity-scoring rules or the tier vocabulary
- Does not broaden the analyzer's `tools:` frontmatter
- Does not perform the comparison itself -- the orchestrator does that
Blocked by: model-selection-config-t01
Constraints: Agents keep least-privilege `tools:` frontmatter; the analyzer stays read-only (`Read, Grep, Glob`). A null self-report is the honest value -- never fabricate a model identifier, consistent with the best-effort token-accounting rule. Prose in `agents/*.md` is the product; changes need matching contract pins, which model-selection-config-t01 owns. No emojis in code.

### Task 4: User-facing documentation
Task ID: model-selection-config-t04
Owned files: README.md
Interfaces: consumes contract:cli-surface and contract:models-config-block from model-selection-config-t01 (the `models:` keys, the `--no-model-config` flag, `models.enabled`, and the precedence rule); produces the operator-facing reference for the feature.
Graph context: owns path:README.md; consumes contract:cli-surface, contract:models-config-block; produces contract:user-docs; edges (task:t04 depends_on task:t01) (task:t04 consumes contract:cli-surface) (task:t04 owns path:README.md) (task:t05 depends_on task:t04)
Acceptance criteria:
- WHEN the README documents configuration, THE SYSTEM SHALL show a complete `models:` block example including `enabled`, the `tiers` map, at least one per-role override, and the `endpoint` object with `base_url` and `api_key_env`.
- WHEN the README documents the flag list, THE SYSTEM SHALL describe `--no-model-config` and state its precedence as flag over `.plan-runner.yml` over default, matching the existing flag entries.
- WHEN the README documents local models, THE SYSTEM SHALL state that plan-runner never sets `ANTHROPIC_BASE_URL` itself and that the operator exports it, and SHALL state that a model served through a configured endpoint never degrades to a hosted model.
- WHEN the README documents credentials, THE SYSTEM SHALL show only an environment variable name and SHALL NOT show a literal key value.
- IF the README documents the availability gate, THEN THE SYSTEM SHALL state that it fires at most once per run and that an unattended run degrades and records rather than blocking.
Verification: manual: read the new README sections against the spec's Data & interfaces and Edge cases tables, and confirm every documented key and flag appears in `skills/run/SKILL.md`
Non-goals:
- Does not update `CHANGELOG.md` or any version manifest
- Does not edit any SKILL.md, agent, schema, or test file
- Does not update the Esper marketplace README or its plugin table
Blocked by: model-selection-config-t01
Constraints: Reference plugin files relative to the active skill or plugin root -- never the old monorepo prefix `plugins/plan-runner/...`. Match the existing README voice and the established `<setting>: <value> (from <flag | .plan-runner.yml | default>).` convention. Do not write a real name or email into the file; the author handle is `MisterVitoPro`. No emojis in code.

### Task 5: Release -- version bump and changelog
Task ID: model-selection-config-t05
Owned files: .claude-plugin/plugin.json, .codex-plugin/plugin.json, package.json, CHANGELOG.md
Interfaces: consumes contract:release-pin-2.1.0 from model-selection-config-t01 (the contract test asserts release metadata is synchronized at `2.1.0`), contract:model-policy-schema from model-selection-config-t02, contract:analyzer-return-model-field from model-selection-config-t03, and contract:user-docs from model-selection-config-t04; produces the synchronized release metadata the marketplace-pin workflow reads on merge to `main`.
Graph context: owns path:.claude-plugin/plugin.json, path:.codex-plugin/plugin.json, path:package.json, path:CHANGELOG.md; consumes contract:release-pin-2.1.0, contract:model-policy-schema, contract:analyzer-return-model-field, contract:user-docs; produces contract:release-2.1.0; edges (task:t05 depends_on task:t01) (task:t05 depends_on task:t02) (task:t05 depends_on task:t03) (task:t05 depends_on task:t04) (task:t05 owns path:CHANGELOG.md) (task:t05 produces contract:release-2.1.0)
Acceptance criteria:
- WHEN the release lands, THE SYSTEM SHALL carry the version `2.1.0` in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, and `package.json`, matching the pin already asserted by the contract suite.
- WHEN new pipeline behavior ships, THE SYSTEM SHALL record it as a minor version bump under SemVer with a new `CHANGELOG.md` entry describing the `models:` block, the availability gate, the endpoint declaration, and the `--no-model-config` kill-switch.
- IF the core marketplace pitch changed, THEN THE SYSTEM SHALL update the `.claude-plugin/plugin.json` `description` and SHALL keep it at or under 300 characters, and IF the pitch did not change THEN THE SYSTEM SHALL leave the description untouched.
- WHEN the version bump is made, THE SYSTEM SHALL land all synchronized places in a single commit.
- WHEN the release is prepared, THE SYSTEM SHALL NOT hand-tag the repository and SHALL NOT hand-edit either Esper marketplace catalog, because the marketplace-pin workflow performs both on merge to `main`.
Verification: `node --test tests/contract.test.js` and `claude plugin validate .`, then confirm all three manifests report `2.1.0`
Non-goals:
- Does not edit `tests/contract.test.js` -- model-selection-config-t01 owns the version pin
- Does not edit `README.md`
- Does not tag the repository or push a tag
- Does not edit the Esper catalogs, Esper's README badge, or Esper's CLAUDE.md plugin table
- Does not append per-release feature detail to the plugin description
Blocked by: model-selection-config-t01, model-selection-config-t02, model-selection-config-t03, model-selection-config-t04
Constraints: A release touches six places in one commit -- the two plugin manifests, the contract-test version pin (owned by model-selection-config-t01), `package.json`, a new `CHANGELOG.md` entry, and the plugin description only when the core pitch changes. The description is copied verbatim into the Claude marketplace catalog and no automated check catches drift, so verify it by hand. Tagging and both marketplace pins are automated by `.github/workflows/marketplace-pin.yml`; doing either by hand races the workflow. No emojis in code.
