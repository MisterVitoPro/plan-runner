# Local-endpoint HTTP dispatch - design spec

Date: 2026-08-30
Status: draft (revised after audit and critique)
Author: MisterVitoPro

## Problem

An operator configured a locally served model in `.plan-runner.yml`, and it had no effect on which
model served anything. plan-runner 2.1.0 parses the whole `models:` block -- tiers, per-role keys,
`endpoint.base_url`, `endpoint.api_key_env` -- issues one 5-second health check against the
endpoint, warns when it disagrees with `ANTHROPIC_BASE_URL`, and then dispatches through host
subagents exactly as it always did. The endpoint is never called. The model only produced output
when the operator drove the endpoint directly with curl, where it wrote a complete TypeScript
implementation in two calls. The configuration surface promises routing it does not perform. (D1)

## Existing system

Node-based dual-client plugin for Claude Code and Codex, published to the `MisterVitoPro/esper`
marketplace, currently 2.1.0. The product is Markdown prose: `skills/run/SKILL.md` and `agents/*.md`
are the behavior, and `tests/contract.test.js` pins exact phrases and regexes in that prose.
Verification is `node --test tests/contract.test.js`, `python tests/validate_schemas.py`, and
`claude plugin validate .`.

Relevant current behavior:

- **Dispatch** is entirely via the host's native subagent facility, which supplies the tool loop
  (Read/Write/Edit/Bash) that dev and test-author agents depend on. `SKILL.md` states "Model labels
  are recommendations; use the closest available model without blocking."
- **Role tool requirements**, verified against the agent files: `plan-analyzer` holds
  `Read, Grep, Glob` and resolves real repository paths for `owned_files`; `plan-aggregator` holds
  `Read, Grep, Glob, Write`, reads every `<cycle_dir>/bugs/*.json` itself, and writes `bugs.md` and
  `fix-plan.md` to disk; `plan-test-author` declares no `tools:` key at all and so inherits the
  full tool set. None of the three is text-shaped in the sense of taking its inputs inline and
  returning only text.
- **Model resolution** (Step 1d-septies, ADR-0007) resolves a role's model from a serving project
  agent's frontmatter, then the per-role config key, then the `models.tiers` map, then the built-in
  default. Resolved identifiers are passed to the host untouched.
- **Endpoint handling** verifies `api_key_env` is set, issues at most one 5-second health check,
  warns on `ANTHROPIC_BASE_URL` mismatch, and never mutates process environment. Endpoint-resolved
  models are already declared non-degradable in prose. **Credential handling**: no credential value
  is printed to the console or persisted to `.plan-runner.yml`, the manifest, or `run-state.json` --
  only the environment variable's name appears.
- **Model policy** persists as an optional `model_policy` object in `run-state.json` (ADR-0008) and
  rehydrates on resume and phase relay rather than being re-resolved.
- **Token accounting** is best-effort from two sources -- harness completion usage, then agent
  self-report -- and records `null` plus coverage counters when neither is available.
- **Dispatch prompt contents**: a test-author dispatch already includes the resolved
  `test_command` so it can match the framework and style (`skills/run/SKILL.md:1124`, template at
  `:1164`), resolved in Step 1d-bis and stored as `{full, single_file}`.
- **Verification layers**: the semantic verifier grades dev agents in a wave against their
  acceptance criteria; the red/green TDD gates (Step 4a-ter) run on every wave independently of
  verifier coverage.
- **Honesty invariants** (CLAUDE.md): no self-verify, the verifier-coverage gate stays upstream of
  the PR step, token counts are never fabricated. **Pipeline invariants** (CLAUDE.md): max 6 agents
  per wave, waves are file-disjoint, the per-wave dev barrier holds on both backends.

## Goals

- A role the config binds to an endpoint is actually called over that endpoint, by plan-runner
  itself, rather than having its label handed to a host subagent. (D1, D3)
- Code-writing roles are servable locally without inventing a tool loop or spending the
  orchestrator's context window on one. (D2, D19)
- The request shape that is known to work -- thinking disabled, timeout under the gateway limit --
  is the default, and the next endpoint's quirk is a config edit rather than a plugin release. (D8)
- A failing endpoint never silently moves source code onto a hosted model. (D7)
- Locally produced dev output is graded by an independent, host-dispatched verifier, and locally
  produced test files are gated by the existing red/green TDD gates. (D15, D22)
- An existing 2.1.0 configuration behaves identically until the operator opts in. (D11)
- Token coverage improves rather than degrades on the new path. (D12)

## Non-goals

- **Serving the analyzer or the aggregator over HTTP.** Deferred to a follow-up spec. Neither is
  text-shaped: the aggregator reads its inputs from disk and writes two artifacts, and the analyzer
  resolves real repository paths. Constraint-conflict check: covering them was the broader feature,
  but the operator demonstrated whole-file code generation, not DAG synthesis or artifact writing,
  and the analyzer is the component that *produces* the file-disjointness invariant everything else
  rests on -- so breadth loses to evidence, the same reasoning D2 already used. `test-author` is
  retained despite the same tool-shape finding because, unlike those two, it is dispatched against a
  wave task with a declared owned set and so fits whole-file mode; what it additionally needs -- the
  harness, layout, and naming conventions living in files it does not own -- is supplied by the
  read-only context bundle in requirement 6, and its output is gated by the red/green TDD gates.
  (D19, D22)
- **Serving the verifier locally.** (D15)
- **A tool loop for local models.** Rejected at wave 1: the loop would run in the orchestrator's own
  context window, consuming the context plan-runner exists to protect, and depends on a local model
  emitting reliable `tool_calls`. The conventions sample in requirement 6 is not a partial tool loop:
  it is discovery bounded up front by a fixed rule and a fixed cap, decided before the request is
  sent, rather than discovery driven by the model across an unbounded number of round trips. That
  distinction is what the cap enforces, and it is why the cap is not negotiable at run time. (D2, B3)
- **Per-role endpoints.** One endpoint per run, unchanged from 2.1.0, which rejected them because
  Claude Code's subagent dispatch takes a model name but no per-agent base URL. (D3)
- **Setting `ANTHROPIC_BASE_URL` on the operator's behalf.** Unchanged from 2.1.0; a process-wide
  variable leaks to every agent in the run. (D3)
- **The Anthropic `/v1/messages` wire shape, and a configurable request template.** (D16)
- **Team-gateway concerns** -- shared proxies, per-teammate reachability. (D14)
- **Validating model identifiers against a registry.** Inherited unchanged from ADR-0007; not
  decided here.

## Users / consumers

- A single operator running plan-runner against their own repository with their own local model
  server -- the case this feature exists for. (D14)
- The `plan-runner:run` orchestrator on both the Claude Code and Codex backends. (D5)
- Anyone reading a cycle's `manifest.json`, which records the dispatch mechanism and token source
  per agent. (D12)

## Requirements

Expressed as deltas against 2.1.0.

1. **ADDED** -- `models.endpoint` MAY carry a `roles:` list naming the pipeline roles the endpoint
   serves. Only `dev` and `test-author` are eligible. (D19)
2. **ADDED** -- `models.endpoint` MAY carry a request-parameter passthrough block supplying extra
   body parameters, a timeout, and a completion budget, merged over plan-runner's defaults. (D8)
3. **ADDED** -- For a role listed in `roles:`, plan-runner issues an OpenAI-compatible
   `POST <base_url>/v1/chat/completions` itself and treats the response as that role's return,
   instead of dispatching a host subagent. (D1, D3, D16)
4. **ADDED** -- Every endpoint request carries `chat_template_kwargs: {enable_thinking: false}` and
   a timeout below the observed ~300s gateway limit by default; the passthrough block overrides
   either. (D8)
5. **ADDED** -- Whole-file mode: for an endpoint-bound task, the request carries the task excerpt,
   its EARS acceptance criteria, and the task's owned files in full. An owned path that does not yet
   exist is named in the request as a file to create rather than omitted -- the common case for a
   test-author task authoring new test files. (D2, D9, D10, B2)
6. **ADDED** -- An endpoint-bound request carries a read-only **conventions sample** alongside the
   writable owned files: at most 3 whole files totalling at most 32 KB, selected as the existing test
   files nearest the task's owned paths -- same directory first, then the nearest ancestor directory
   containing test files, lexicographic within each. Whole files only: a file that would exceed the
   cap is dropped, never truncated, which preserves D10's predictable-request-size rationale. The
   32 KB figure is a request-size guard, not a context-window guarantee: 32 KB of generated fixture
   and 32 KB of hand-written unit tests are very different amounts of usable context, and nothing
   here promises the latter. Context
   files are not in the task's owned set, so requirement 8 already refuses any returned block naming
   one. This is what makes a test-author task workable when its owned paths do not yet exist. The
   resolved test command also reaches the role, but by the existing dispatch-prompt path (see
   Existing system), not as a new behavior. When the cap drops every candidate and the sample ends
   up empty, the request says so and the dispatch-map line reports it, so convention-mismatched
   output has a visible cause instead of looking like a model failure. (B3, D19, D21)
7. **ADDED** -- plan-runner parses the returned blocks and writes the files itself, then constructs
   the schema-valid return JSON. The model never produces the return JSON. Return fields split by
   provenance: fields describing what was written (a test-author's `test_files`) are derived from
   the parsed block paths, while fields the TDD gates consume from the wave plan (an impl task's
   `tests_to_satisfy`) are carried over from the task and are never taken from model output. (D9)
8. **ADDED** -- A parsed block whose path falls outside the dispatched task's owned set is refused
   and recorded; it is never written. (D18)
9. **ADDED** -- An endpoint call that fails or times out is retried exactly once against the same
   endpoint with a reduced completion budget. A failing retry makes the task a durable failure that
   routes through the normal bug/fix-plan flow. (D7)
10. **ADDED** -- An endpoint-bound role is never rerouted to a host-dispatched or hosted model on
    any failure path. (D7)
11. **ADDED** -- `analyzer`, `aggregator`, or `verifier` in `roles:` is a configuration error
    reported at preflight, not an honored setting. (D15, D19)
12. **ADDED** -- Preflight probes that `curl` is executable and reports the result; endpoint-bound
    roles with no usable `curl` fail loudly rather than falling back. (D20)
13. **MODIFIED** -- Endpoint health is re-probed on resume and at each phase relay, while the
    resolved map and the consent answer continue to rehydrate from `run-state.json`. (D13)
14. **MODIFIED** -- `run-state.json` `model_policy` and the manifest's per-agent entry record which
    dispatch mechanism served each role. (D12, D13)
15. **UNCHANGED** -- With no `roles:` key, resolution and dispatch are byte-identical to 2.1.0, and
    `--no-model-config` / `models.enabled: false` continue to disable the entire block including
    this path. (D11)

### Non-functional requirements

16. **ADDED (observability)** -- The token usage reported in an endpoint response is recorded as an
    authoritative figure with source `http_usage`, and roles served that way count as reported.
    The best-effort rule, its `null` value, and the coverage counters are unchanged everywhere
    else. (D12, D6)
17. **ADDED (observability)** -- Preflight prints which roles are endpoint-bound and where they are
    dispatched, so a run never silently differs from its configuration. (D21)
18. **ADDED (portability)** -- The dispatch driver depends only on the Node standard library and
    `curl`, and works under both PowerShell and Git Bash on Windows. (D5)
19. **ADDED (portability)** -- The HTTP dispatch path behaves identically on the Claude Code and
    Codex backends, driven by one `models:` block with no client-specific keys. (D5)
20. **ADDED (security)** -- No credential value is printed, logged, persisted, or written into a
    request log; only the name of the environment variable appears. Extends the existing 2.1.0
    credential rule (see Existing system) to the request path. (inherited existing-system rule from
    `skills/run/SKILL.md`; not decided here)
21. **ADDED (integrity)** -- The wave and DAG invariants hold identically on both dispatch
    mechanisms: file-disjointness, the max-6-agents-per-wave limit, the per-wave dev barrier
    (CLAUDE.md Pipeline invariants), and the verifier-coverage gate upstream of the PR step
    (CLAUDE.md Honesty invariants, D6). (D6, D18)

## Chosen approach

A bundled, dependency-free Node driver with curl as the transport. The driver owns the mechanical
work -- body composition, request defaults, the single retry, response parsing, usage extraction --
and the skill prose keeps authority over what happens and when. Prose-only curl and an MCP server
were the alternatives; both lost for reasons recorded in the ADRs. (D17)

- `docs/adr/0009-plan-runner-issues-inference-requests.md` -- supersedes the part of ADR-0007 that
  says a configured identifier is only ever passed to the host.
- `docs/adr/0010-node-driver-curl-transport.md` -- where the request logic lives.

## Architecture & components

- **`scripts/http-dispatch.js`** -- composes the request body from a request-spec file, applies
  defaults and the passthrough, shells to `curl`, performs the single retry, and writes a response
  file carrying content, usage, served model, and any error. The only component that talks to the
  network.
- **Fenced-block parser** -- turns a path-headed block sequence into file writes, restricted to the
  dispatched task's owned set, and reports refusals. Boundary: it receives an owned-file list and
  returns written and refused paths; it never consults the plan or the run-state.
- **Step 1d-septies (extended)** -- resolves `models.endpoint.roles` and the passthrough, rejects
  ineligible roles, probes `curl`, and prints the dispatch map.
- **Conventions-sample selection (dispatch-site prose)** -- the orchestrator, which alone holds the
  wave plan and repository access, selects the capped sample and places it in the request spec.
  Neither `http-dispatch.js` (which composes from a spec it is handed) nor the parser (which never
  consults the plan) owns this; naming the owner here is what keeps requirement 6 implementable.
- **Dev and test-author dispatch sites (extended)** -- each states which mechanism serves it and
  constructs the request spec for the HTTP path.
- **Run-state and manifest (extended)** -- record dispatch mechanism, endpoint health per phase, and
  the token-usage source.

Artifact flow: `SKILL.md dispatch site -> request-spec JSON -> http-dispatch.js -> curl -> endpoint
-> response JSON -> fenced-block parser -> owned files + return JSON -> verifier (host subagent)`.

## Data & interfaces

Configuration (`.plan-runner.yml`, extending the 2.1.0 `models:` block):

```yaml
models:
  endpoint:
    base_url: http://localhost:8000
    api_key_env: LOCAL_MODEL_KEY
    roles: [dev, test-author]      # only these two are eligible
    request:                       # optional passthrough, merged over defaults
      timeout_seconds: 240
      max_tokens: 8000
      body:
        chat_template_kwargs:
          enable_thinking: false
```

- **Request spec** (orchestrator -> driver): a JSON file naming the role, endpoint, resolved model,
  messages, merged request parameters, and the output path.
- **Response record** (driver -> orchestrator): a JSON file carrying the assistant content, the
  usage object, the served model name, the attempt count, and an error field that is null on
  success.
- **Whole-file response format** (model -> parser): one fenced code block per file, each preceded by
  that file's repository-relative path on its own line.
- **Manifest per-agent entry**: gains a dispatch-mechanism field and a token-source value of
  `http_usage`.
- **`run-state.json` `model_policy`**: gains the endpoint role list, per-phase health, and dispatch
  mechanism per role. Optional, with a back-compat note naming the release it ships in; existing
  run-states still validate.
- **Console**: preflight prints the endpoint role map and the curl probe result. A refused block
  prints at the point it happens. 2.1.0's existing substitution notice is unchanged and applies only
  to non-endpoint roles -- an endpoint-bound role is never substituted (requirement 10).

## Edge cases & error handling

| Case | Handling |
|---|---|
| Endpoint unreachable at preflight | Existing 2.1.0 availability gate, unchanged. Endpoint-bound roles halt rather than degrade when consent is refused or unavailable. (D7) |
| Call times out or returns 5xx mid-run | One retry with a reduced completion budget, then a durable task failure into the bug/fix-plan flow. (D7) |
| Response contains no parsable fenced block | Counts as a failed attempt: retried once, then a durable failure. Nothing is written. (B1) |
| Response is truncated mid-block | The incomplete trailing block is refused and the attempt counts as failed, rather than writing a half file. (B1) |
| A block names a file outside the owned set | Refused, recorded, not written; the remaining in-scope blocks still apply. (D18) |
| A block names an owned path that does not exist | Written as a new file; ownership, not prior existence, is the test. The normal case for a test-author task. (B2) |
| A test-author task owns no existing files | The request names the paths to create and carries the task's acceptance criteria; the response is parsed identically. (D19, B2) |
| `analyzer`, `aggregator`, or `verifier` in `roles:` | Configuration error at preflight, naming the role. (D15, D19) |
| `curl` missing or not executable | Preflight reports it; endpoint-bound roles fail loudly, never fall back. (D20) |
| `api_key_env` unset or empty | Existing 2.1.0 behavior: endpoint unavailable, availability gate. |
| Endpoint healthy at run start, dead after a relay | Caught by the per-phase re-probe at the boundary rather than mid-task. (D13) |
| Response carries no usage object | `null` with the coverage counters, exactly as an unreported subagent. Never fabricated. (D6, D12) |
| `--no-model-config` passed | The whole block is ignored, including this path. (D11) |

## Acceptance criteria (EARS)

1. WHEN a role is listed in `models.endpoint.roles`, THE SYSTEM SHALL dispatch it by issuing an
   OpenAI-compatible chat-completions request to `base_url` rather than dispatching a host subagent.
2. WHEN `models.endpoint.roles` is absent, THE SYSTEM SHALL resolve and dispatch every role exactly
   as it did before this feature.
3. WHEN composing an endpoint request, THE SYSTEM SHALL include
   `chat_template_kwargs: {enable_thinking: false}` and a timeout below 300 seconds unless the
   request passthrough overrides them.
4. WHEN the request passthrough supplies a parameter, THE SYSTEM SHALL merge it over the
   corresponding default rather than discarding the remaining defaults.
5. WHEN an endpoint-bound task is dispatched, THE SYSTEM SHALL include the task excerpt, its
   acceptance criteria, and the full contents of the task's owned files, naming any owned path that
   does not yet exist as a file to create. (binding default B2)
6. WHEN an endpoint response is received, THE SYSTEM SHALL write each fenced block whose path is in
   the task's owned set and SHALL construct the return JSON itself.
7. IF a fenced block names a path outside the task's owned set, THEN THE SYSTEM SHALL refuse it,
   record the refusal, and leave that path untouched.
8. IF an endpoint call fails, times out, yields no parsable fenced block, or yields a block
   truncated mid-file, THEN THE SYSTEM SHALL retry exactly once with a reduced completion budget,
   and SHALL NOT write a partial file. (binding default B1)
9. IF the retry also fails, THEN THE SYSTEM SHALL record a durable task failure that routes through
   the bug and fix-plan flow.
10. WHEN a fenced block names an owned path that does not exist, THE SYSTEM SHALL create that file.
    (binding default B2)
11. THE SYSTEM SHALL NOT dispatch an endpoint-bound role to a host subagent or a hosted model on any
    failure path.
12. IF `analyzer`, `aggregator`, or `verifier` appears in `models.endpoint.roles`, THEN THE SYSTEM
    SHALL report a configuration error at preflight naming that role, and SHALL NOT serve it over
    the endpoint.
13. WHILE any role is endpoint-bound, THE SYSTEM SHALL dispatch every verifier through the host
    subagent facility, and SHALL run the red/green TDD gates unchanged.
14. WHEN preflight runs with an endpoint configured, THE SYSTEM SHALL probe that `curl` is
    executable and SHALL print the endpoint role map with each role's dispatch mechanism.
15. IF `curl` is unavailable, THEN THE SYSTEM SHALL fail endpoint-bound roles with a named reason
    and SHALL NOT substitute a host-dispatched model.
16. WHEN a run resumes or relays into a new phase, THE SYSTEM SHALL re-probe endpoint health and
    SHALL rehydrate the resolved map and the consent answer from `run-state.json`.
17. WHEN an endpoint response reports token usage, THE SYSTEM SHALL record it with source
    `http_usage` and count that role as reported.
18. IF an endpoint response reports no usage, THEN THE SYSTEM SHALL record `null` and increment the
    unreported coverage counter, and SHALL NOT estimate a value.
19. THE SYSTEM SHALL NOT print, log, or persist the value of the variable named by `api_key_env`.
20. THE SYSTEM SHALL enforce file-disjointness, the six-agent wave limit, the per-wave dev barrier,
    and the verifier-coverage gate identically for endpoint-bound and host-dispatched roles.
21. THE SYSTEM SHALL behave identically on the Claude Code and Codex backends for every criterion
    above, driven by one `models:` block with no client-specific keys.
22. THE SYSTEM SHALL depend on no runtime package beyond the Node standard library and `curl`, and
    SHALL operate under both PowerShell and Git Bash.
23. WHEN an endpoint-bound request is composed, THE SYSTEM SHALL include at most 3 whole
    conventions-sample files totalling at most 32 KB, selected nearest-first from the task's owned
    paths, and SHALL drop rather than truncate any file that would exceed the cap. (binding
    default B3)
24. WHEN constructing the return JSON for an endpoint-bound task, THE SYSTEM SHALL derive the
    written-file fields from the parsed block paths and SHALL carry every gate-consumed field
    supplied by the wave plan over from the task, taking none of them from the model's output.
25. IF the cap leaves the conventions sample empty, THEN THE SYSTEM SHALL record that in the request
    and report it on the dispatch-map line. (binding default B3)

## Verification strategy

- **unit** (`node --test`, against `scripts/http-dispatch.js` and the block parser): criteria 3, 4,
  6, 7, 8, 10, 17, 18, 22. Fixtures: a response with usage, one without, a truncated response, a
  response with no fenced block, a response naming an unowned path, a response naming a
  non-existent owned path, a timeout, and a 5xx.
- **unit / contract** (`tests/contract.test.js`, pinning SKILL.md prose): criteria 1, 2, 5, 9, 11,
  12, 13, 14, 15, 16, 19, 20, 21, 23, 24, 25 -- each phrase pinned in the same change that
  introduces it, per
  CLAUDE.md.
- **schema** (`python tests/validate_schemas.py`): the extended `run-state.json` `model_policy` and
  manifest entry, with matching valid and invalid fixtures and a back-compat note; a 2.1.0
  run-state must still validate.
- **manual** (one run against the operator's endpoint): criteria 1, 5, 14, 16 end to end, on a plan
  whose first task the local model can plausibly complete. This is the only criterion group that
  cannot be verified without a live local server.

## Assumptions (unconfirmed)

Three binding defaults, each welded to an acceptance criterion above so it is checked like any
other requirement. All three are low-cost and reversible. B1 and B2 arose from audit findings; B3
arose from the response to a later finding, not from the audit itself.

- **B1.** A response with no parsable fenced block, or one truncated mid-file, counts as a failed
  attempt under the retry policy rather than a distinct failure class, and no partial file is
  written. (EARS 8)
- **B2.** Owned paths that do not yet exist are handled in both directions -- named in the request
  as files to create, and written when returned. (EARS 5, EARS 10)
- **B3.** An endpoint-bound request carries a read-only conventions sample -- at most 3 whole files,
  at most 32 KB, nearest-first -- alongside the writable owned files, and an empty sample is reported
  rather than passing silently. The cap is a request-size guard, not a context-window guarantee.
  Passing the resolved test command is inherited 2.1.0 behavior (see Existing system), not part of
  this default. (EARS 23, EARS 25)

A1 (OpenAI-compatible wire shape) was confirmed and recorded as D16.

## Open questions

None. O3 -- whether analyzer and aggregator stay endpoint-eligible -- was resolved at the review
gate by D19: they are removed from this spec and deferred to a follow-up.

## Definition of done

- Tests written and passing: `node --test tests/contract.test.js`, `python tests/validate_schemas.py`,
  `claude plugin validate .`, plus the Codex skill and plugin validators used by CI.
- Existing behavior preserved outside the described change: a repo with no `roles:` key runs
  byte-identically to 2.1.0, and existing run-states and manifests still validate.
- Platform floors honored: Node standard library only, `curl` present, both PowerShell and Git Bash,
  both backends.
- No new network calls beyond the chat-completions request and the existing health check.
- Docs updated: README gains the `roles:` and request-passthrough surface and the dispatch-map
  console line; CHANGELOG entry; the six-place version bump per CLAUDE.md.
- Every acceptance criterion above passes.
