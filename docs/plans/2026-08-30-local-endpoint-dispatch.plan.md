# Local-endpoint HTTP dispatch - implementation plan

Goal: make a role bound to a configured `models.endpoint` actually reach that endpoint over curl, instead of resolving a label that plan-runner never calls.
Source spec: docs/specs/2026-08-30-local-endpoint-dispatch.md
Flagged constraints (unconfirmed): B1 -- a response with no parsable fenced block, or one truncated mid-file, counts as a failed attempt under the retry policy and no partial file is written. B2 -- owned paths that do not yet exist are named in the request as files to create and written when returned. B3 -- the read-only conventions sample is at most 3 whole files totalling at most 32 KB, nearest-first, an empty sample is reported rather than passing silently, and the byte cap is a request-size guard rather than a context-window guarantee. All three are binding defaults welded to acceptance criteria; the values originated as planning defaults, not as explicit user choices.
Skeleton manifest: docs/plans/2026-08-30-local-endpoint-dispatch.skeleton.json
Dependency graph: docs/plans/2026-08-30-local-endpoint-dispatch.graph.json

### Task 1: HTTP dispatch driver and fenced-block parser

Task ID: local-endpoint-dispatch-t01
Owned files: scripts/http-dispatch.js, scripts/fenced-blocks.js
Interfaces: consumes nothing from other tasks (walking skeleton); produces the request-spec input shape, the response-record output shape, and the parser's `(blocks, ownedFiles) -> {written, refused}` contract that Tasks 2, 3, 4, and 5 all build against.
Graph context: owns `path:scripts/http-dispatch.js`, `path:scripts/fenced-blocks.js`; produces `contract:request-spec`, `contract:response-record`, `contract:parser-result`; consumes `dep:curl`, `dep:node-stdlib`; edges `task:local-endpoint-dispatch-t01 -[owns]-> path:scripts/http-dispatch.js`, `task:local-endpoint-dispatch-t01 -[owns]-> path:scripts/fenced-blocks.js`, `task:local-endpoint-dispatch-t01 -[produces]-> contract:request-spec`, `task:local-endpoint-dispatch-t01 -[produces]-> contract:response-record`, `task:local-endpoint-dispatch-t01 -[produces]-> contract:parser-result`, `task:local-endpoint-dispatch-t01 -[requires]-> dep:curl`.
Acceptance criteria:
- WHEN composing an endpoint request, THE SYSTEM SHALL include `chat_template_kwargs: {enable_thinking: false}` and a timeout below 300 seconds unless the request passthrough overrides them.
- WHEN the request passthrough supplies a parameter, THE SYSTEM SHALL merge it over the corresponding default rather than discarding the remaining defaults.
- IF an endpoint call fails, times out, yields no parsable fenced block, or yields a block truncated mid-file, THEN THE SYSTEM SHALL retry exactly once with a reduced completion budget, and SHALL NOT write a partial file.
- WHEN an endpoint response is received, THE SYSTEM SHALL write each fenced block whose path is in the task's owned set and SHALL construct the return JSON itself.
- IF a fenced block names a path outside the task's owned set, THEN THE SYSTEM SHALL refuse it, record the refusal, and leave that path untouched.
- WHEN a fenced block names an owned path that does not exist, THE SYSTEM SHALL create that file.
- WHEN an endpoint response reports token usage, THE SYSTEM SHALL record it with source `http_usage` and count that role as reported.
- IF an endpoint response reports no usage, THEN THE SYSTEM SHALL record `null` and increment the unreported coverage counter, and SHALL NOT estimate a value.
- THE SYSTEM SHALL depend on no runtime package beyond the Node standard library and `curl`, and SHALL operate under both PowerShell and Git Bash.
Verification: `node --test tests/http-dispatch.test.js tests/fenced-blocks.test.js` (written by Task 2) passes; `node -e "require('./scripts/http-dispatch.js')"` loads with no dependency resolution error.
Non-goals:
- Does not select the conventions sample -- the driver composes from a request spec it is handed (spec Architecture & components).
- Does not read the wave plan, the run-state, or `.plan-runner.yml`.
- Does not decide which roles are endpoint-bound.
- Does not write its own unit tests (Task 2).
Blocked by: none
Constraints: Node standard library only, no npm dependencies, no install step -- a contract test in Task 4 asserts this. curl is the transport (ADR-0010); do not substitute Node's fetch. Must survive both PowerShell and Git Bash quoting: pass the request body via a file rather than an inline shell argument. The parser never consults the plan or run-state; it receives an owned-file list and returns written and refused paths.

### Task 2: Unit tests for the driver and parser

Task ID: local-endpoint-dispatch-t02
Owned files: tests/http-dispatch.test.js, tests/fenced-blocks.test.js
Interfaces: consumes `contract:request-spec`, `contract:response-record`, and `contract:parser-result` (Task 1); produces the fixture set the spec's Verification strategy names for the unit layer.
Graph context: owns `path:tests/http-dispatch.test.js`, `path:tests/fenced-blocks.test.js`; consumes `contract:request-spec`, `contract:response-record`, `contract:parser-result`; edges `task:local-endpoint-dispatch-t02 -[owns]-> path:tests/http-dispatch.test.js`, `task:local-endpoint-dispatch-t02 -[owns]-> path:tests/fenced-blocks.test.js`, `task:local-endpoint-dispatch-t02 -[blocked-by]-> task:local-endpoint-dispatch-t01`, `task:local-endpoint-dispatch-t02 -[consumes]-> contract:parser-result`.
Acceptance criteria:
- WHEN the unit suite runs, THE SYSTEM SHALL cover a response with a usage object, a response without one, a truncated response, a response with no fenced block, a response naming an unowned path, a response naming a non-existent owned path, a timeout, and a 5xx.
- IF a fixture asserts the conventions-sample cap, THEN THE SYSTEM SHALL assert the concrete bound of at most 3 whole files and at most 32 KB rather than asserting that a bound merely exists.
- WHEN the retry path is exercised, THE SYSTEM SHALL assert exactly one retry occurred and that the retry used a reduced completion budget.
- THE SYSTEM SHALL NOT reach the network in any test; the curl invocation is stubbed or injected.
Verification: `node --test tests/http-dispatch.test.js tests/fenced-blocks.test.js`
Non-goals:
- Does not test SKILL.md prose (Task 4 owns contract pins).
- Does not test schema fixtures (Task 5).
- Does not modify the driver or parser to make testing easier without a recorded reason.
Blocked by: local-endpoint-dispatch-t01
Constraints: `node --test` only, no test framework dependency. Tests must run with no local model server present and must never make a real HTTP request.

### Task 3: SKILL.md dispatch prose

Task ID: local-endpoint-dispatch-t03
Owned files: skills/run/SKILL.md
Interfaces: consumes `contract:request-spec` and `contract:response-record` (Task 1); produces the pinned prose phrases Task 4 asserts and the console surfaces Task 6 documents.
Graph context: owns `path:skills/run/SKILL.md`; consumes `contract:request-spec`, `contract:response-record`; produces `contract:dispatch-map-line`, `contract:roles-config`, `contract:conventions-sample-rule`; edges `task:local-endpoint-dispatch-t03 -[owns]-> path:skills/run/SKILL.md`, `task:local-endpoint-dispatch-t03 -[blocked-by]-> task:local-endpoint-dispatch-t01`, `task:local-endpoint-dispatch-t03 -[produces]-> contract:dispatch-map-line`, `task:local-endpoint-dispatch-t03 -[produces]-> contract:roles-config`.
Acceptance criteria:
- WHEN a role is listed in `models.endpoint.roles`, THE SYSTEM SHALL dispatch it by issuing an OpenAI-compatible chat-completions request to `base_url` rather than dispatching a host subagent.
- WHEN `models.endpoint.roles` is absent, THE SYSTEM SHALL resolve and dispatch every role exactly as it did before this feature.
- WHEN an endpoint-bound task is dispatched, THE SYSTEM SHALL include the task excerpt, its acceptance criteria, and the full contents of the task's owned files, naming any owned path that does not yet exist as a file to create.
- WHEN an endpoint-bound request is composed, THE SYSTEM SHALL include at most 3 whole conventions-sample files totalling at most 32 KB, selected nearest-first from the task's owned paths, and SHALL drop rather than truncate any file that would exceed the cap.
- IF the cap leaves the conventions sample empty, THEN THE SYSTEM SHALL record that in the request and report it on the dispatch-map line.
- WHEN constructing the return JSON for an endpoint-bound task, THE SYSTEM SHALL derive the written-file fields from the parsed block paths and SHALL carry every gate-consumed field supplied by the wave plan over from the task, taking none of them from the model's output.
- IF the retry also fails, THEN THE SYSTEM SHALL record a durable task failure that routes through the bug and fix-plan flow.
- THE SYSTEM SHALL NOT dispatch an endpoint-bound role to a host subagent or a hosted model on any failure path.
- IF `analyzer`, `aggregator`, or `verifier` appears in `models.endpoint.roles`, THEN THE SYSTEM SHALL report a configuration error at preflight naming that role, and SHALL NOT serve it over the endpoint.
- WHILE any role is endpoint-bound, THE SYSTEM SHALL dispatch every verifier through the host subagent facility, and SHALL run the red/green TDD gates unchanged.
- WHEN preflight runs with an endpoint configured, THE SYSTEM SHALL probe that `curl` is executable and SHALL print the endpoint role map with each role's dispatch mechanism.
- IF `curl` is unavailable, THEN THE SYSTEM SHALL fail endpoint-bound roles with a named reason and SHALL NOT substitute a host-dispatched model.
- WHEN a run resumes or relays into a new phase, THE SYSTEM SHALL re-probe endpoint health and SHALL rehydrate the resolved map and the consent answer from `run-state.json`.
- THE SYSTEM SHALL NOT print, log, or persist the value of the variable named by `api_key_env`.
- THE SYSTEM SHALL enforce file-disjointness, the six-agent wave limit, the per-wave dev barrier, and the verifier-coverage gate identically for endpoint-bound and host-dispatched roles.
- THE SYSTEM SHALL behave identically on the Claude Code and Codex backends for every criterion above, driven by one `models:` block with no client-specific keys.
Verification: `node --test tests/contract.test.js` passes once Task 4 lands; `claude plugin validate .` passes; the Codex skill-frontmatter validator used by CI passes.
Non-goals:
- Does not add or edit contract tests (Task 4 owns `tests/contract.test.js`).
- Does not change schemas (Task 5).
- Does not touch README or CHANGELOG (Task 6).
- Does not add analyzer or aggregator dispatch -- explicitly out of scope per the spec's non-goals.
Blocked by: local-endpoint-dispatch-t01
Constraints: The Markdown prose IS the behavior -- edits here are behavior changes. Extend Step 1d-septies rather than adding a parallel resolution step. Resolve the driver path relative to the active `SKILL.md`, exactly as `../../agents/` is resolved; never depend on `${CLAUDE_PLUGIN_ROOT}`. Honesty invariants must not be weakened: no self-verify, verifier-coverage gate stays upstream of the PR step, token counts never fabricated. Every git operation stays gated on `git_available`.

### Task 4: Contract tests and release pin

Task ID: local-endpoint-dispatch-t04
Owned files: tests/contract.test.js
Interfaces: consumes `contract:dispatch-map-line`, `contract:roles-config`, `contract:conventions-sample-rule` (Task 3); produces the pinned release version assertion that Task 6's manifest bump must match.
Graph context: owns `path:tests/contract.test.js`; consumes `contract:dispatch-map-line`, `contract:roles-config`, `contract:conventions-sample-rule`; produces `contract:release-pin`; edges `task:local-endpoint-dispatch-t04 -[owns]-> path:tests/contract.test.js`, `task:local-endpoint-dispatch-t04 -[blocked-by]-> task:local-endpoint-dispatch-t03`, `task:local-endpoint-dispatch-t04 -[produces]-> contract:release-pin`, `task:local-endpoint-dispatch-t06 -[consumes]-> contract:release-pin`.
Acceptance criteria:
- WHEN the contract suite runs, THE SYSTEM SHALL pin the endpoint-roles config surface, the eligible-role set, the ineligible-role error, the curl probe, the dispatch-map line, the conventions-sample cap, the return-field provenance rule, the resume re-probe, the credential non-leak rule, and the backend-parity statement.
- IF a pinned phrase is absent from `skills/run/SKILL.md`, THEN THE SYSTEM SHALL fail the suite naming the missing phrase.
- WHEN the release pin is asserted, THE SYSTEM SHALL pin the synchronized version that Task 6 writes to both plugin manifests and `package.json`.
- THE SYSTEM SHALL assert that `scripts/` declares no runtime dependency outside the Node standard library.
Verification: `node --test tests/contract.test.js`
Non-goals:
- Does not edit SKILL.md to make a pin pass -- a failing pin means the prose task is incomplete.
- Does not bump any manifest version itself (Task 6).
- Does not test the driver's behavior (Task 2 owns the unit layer).
Blocked by: local-endpoint-dispatch-t03
Constraints: The release-pin assertion is expected to fail until Task 6 lands the matching manifest bump in the same release; that coupling is intentional and matches the repo's version-bump protocol. Pin exact phrases and regexes, following the existing file's style.

### Task 5: Schema extensions and fixtures

Task ID: local-endpoint-dispatch-t05
Owned files: schemas/run-state.schema.json, schemas/manifest.schema.json, schemas/examples/run-state-endpoint-dispatch-valid.json, schemas/examples/run-state-endpoint-dispatch-invalid.json, schemas/examples/manifest-http-usage-valid.json, schemas/examples/manifest-http-usage-invalid.json, tests/validate_schemas.py
Interfaces: consumes `contract:response-record` (Task 1) for the token-source value; produces the persisted `model_policy` dispatch fields and the manifest per-agent dispatch fields.
Graph context: owns `path:schemas/run-state.schema.json`, `path:schemas/manifest.schema.json`, `path:tests/validate_schemas.py`, and the four fixture paths; consumes `contract:response-record`; produces `contract:model-policy-dispatch`; edges `task:local-endpoint-dispatch-t05 -[owns]-> path:schemas/run-state.schema.json`, `task:local-endpoint-dispatch-t05 -[owns]-> path:schemas/manifest.schema.json`, `task:local-endpoint-dispatch-t05 -[blocked-by]-> task:local-endpoint-dispatch-t01`, `task:local-endpoint-dispatch-t05 -[produces]-> contract:model-policy-dispatch`.
Acceptance criteria:
- WHEN a run records its model policy, THE SYSTEM SHALL persist the endpoint role list, per-phase endpoint health, and the dispatch mechanism per role in `run-state.json`.
- WHEN an agent entry is written to the manifest, THE SYSTEM SHALL record the dispatch mechanism that served it and, for an HTTP dispatch, a token source of `http_usage`.
- IF a run-state written before this feature is validated, THEN THE SYSTEM SHALL accept it unchanged.
- WHEN a new schema field is added, THE SYSTEM SHALL make it optional and carry a back-compat note in its description naming the release it was added in.
- WHEN a fixture pair is added, THE SYSTEM SHALL register both the valid and the invalid fixture in the `CASES` list so both actually run.
Verification: `python tests/validate_schemas.py` -- every case passes, including a pre-feature run-state fixture that must still validate.
Non-goals:
- Does not change `wave-plan.schema.json`, `task-graph.schema.json`, or the `recommended_model` enum.
- Does not write the prose that populates these fields (Task 3).
Blocked by: local-endpoint-dispatch-t01
Constraints: New fields are optional and back-compatible. Both halves of every fixture pair must be registered -- an unregistered fixture that never runs has shipped in this repo before. No credential value appears in any fixture.

### Task 6: Documentation and release

Task ID: local-endpoint-dispatch-t06
Owned files: README.md, CHANGELOG.md, .claude-plugin/plugin.json, .codex-plugin/plugin.json, package.json
Interfaces: consumes `contract:dispatch-map-line` and `contract:roles-config` (Task 3) for the documented surface, and `contract:release-pin` (Task 4) for the version the manifests must match.
Graph context: owns `path:README.md`, `path:CHANGELOG.md`, `path:.claude-plugin/plugin.json`, `path:.codex-plugin/plugin.json`, `path:package.json`; consumes `contract:dispatch-map-line`, `contract:roles-config`, `contract:release-pin`; edges `task:local-endpoint-dispatch-t06 -[owns]-> path:README.md`, `task:local-endpoint-dispatch-t06 -[owns]-> path:CHANGELOG.md`, `task:local-endpoint-dispatch-t06 -[blocked-by]-> task:local-endpoint-dispatch-t03`, `task:local-endpoint-dispatch-t06 -[consumes]-> contract:release-pin`.
Acceptance criteria:
- WHEN the README documents model configuration, THE SYSTEM SHALL describe the `roles:` list, the eligible-role set, the request passthrough, and the dispatch-map console line.
- WHEN the release is prepared, THE SYSTEM SHALL bump the version in both plugin manifests and `package.json` to the same value that Task 4 pinned.
- WHEN the CHANGELOG entry is written, THE SYSTEM SHALL classify the release as a minor version because it adds new pipeline behavior.
- IF the marketplace description's core pitch is unchanged, THEN THE SYSTEM SHALL leave `.claude-plugin/plugin.json` `description` untouched and SHALL keep it under 300 characters.
- WHEN the README describes the 32 KB cap, THE SYSTEM SHALL describe it as a request-size guard and SHALL NOT describe it as a context-window guarantee.
Verification: `node --test tests/contract.test.js` (release pin and description-length assertions pass); `claude plugin validate .`; manual read of the README section.
Non-goals:
- Does not hand-tag the release or hand-edit the Esper marketplace -- the pin workflow does both automatically on merge to main.
- Does not edit `tests/contract.test.js` (Task 4 owns the pin).
- Does not document analyzer or aggregator endpoint support, which this release does not add.
Blocked by: local-endpoint-dispatch-t03
Constraints: The six-place version-bump protocol in CLAUDE.md applies; five of the six places are owned here and the sixth (the contract-test pin) is Task 4's. Do not append per-release feature detail to the marketplace description -- that belongs in the CHANGELOG and README.
