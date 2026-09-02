# Model-selection config for plan-runner - design spec

Date: 2026-08-30
Status: approved
Author: MisterVitoPro

## Problem

Plan Runner decides which model runs each pipeline role entirely on its own, and a target repo has
no say in it. Model choice is scattered across four unrelated places -- bundled agent frontmatter,
an analyzer structure heuristic, the analyzer's per-task `recommended_model`, and prose such as
"prefer model `sonnet` when available" -- and every one of them is limited to the three words
`haiku`, `sonnet`, and `opus`. There is no way to pin a specific version, and no way to point any
role at a model served locally over HTTP. When a named model cannot be served, the pipeline
silently substitutes the closest available one and keeps going, so a run can quietly execute on a
model the operator never chose and never sees. (D10)

## Existing system

plan-runner is a dual-client Claude Code and Codex plugin whose product is the Markdown prose in
`skills/*/SKILL.md` and `agents/*.md`; edits to that wording are behavior changes, pinned by exact
phrase and regex in `tests/contract.test.js`.

Relevant current behavior:

- `.plan-runner.yml` at the target repo root already carries `verification`, `phasing`,
  `agents.project`, and `execution.mode`. Keys are extracted individually by the orchestrator with
  the Read tool -- deliberately not via a YAML parser, which may not be installed. Precedence
  everywhere is CLI flag > `.plan-runner.yml` > built-in default, announced on the console as
  `<setting>: <value> (from <flag | .plan-runner.yml | default>).`
- Model selection today: `agents/plan-aggregator.md` declares `model: haiku`; the other five
  bundled agents declare `model: sonnet`. `skills/run/SKILL.md` Step 1c-bis picks the analyzer's
  model by a cheap plan-structure heuristic (haiku when the plan is well-structured, else sonnet).
  The analyzer emits `recommended_model` per task, constrained by `task-graph.schema.json` and
  `wave-plan.schema.json` to the enum `haiku | sonnet | opus`. Verifier and aggregator dispatch
  prose says "prefer model `sonnet` when available".
- Dev-dispatch model precedence (pinned at `tests/contract.test.js:1148`): a serving project
  agent's `model:` frontmatter wins; when it declares none, the task's `recommended_model` applies;
  a bundled `plan-dev` dispatch always uses `recommended_model`.
- SKILL.md line 17 states the governing rule: "Model labels are recommendations; use the closest
  available model without blocking."
- `run-state.schema.json` (ADR-0004) is the durable checkpoint for phased runs, carrying
  `verify_mode`, `tdd_enabled`, `invocation_flags`, and the phase list. Unphased runs write none.
  On resume, facilities that are not persisted -- `git_available`, `context7_available`, the
  project-agent inventory -- are deliberately re-resolved.
- Every prior feature shipped with a kill-switch flag: `--no-phasing`, `--no-project-agents`,
  `--execution-mode wave`, `--sync-verify`.
- Honesty invariants that constrain this change: token accounting is best-effort and never
  fabricated; the orchestrator never self-verifies; the verifier-coverage gate stays upstream of
  the PR step.

## Goals

- A target repo can name the model for any pipeline role in committed configuration. (D8)
- Configuration accepts both portable tier words and raw model identifiers, including locally
  served models. (D2)
- A locally served model is reachable, with its endpoint declared in the same configuration. (D5, D6)
- When a configured model cannot be served, the operator is asked once whether the pipeline may
  pick by task complexity instead -- never silently substituted without record. (D3, D14)
- Unattended runs never block on that question. (D4)
- Which model actually ran, and every substitution, is visible on the console, in the manifest, and
  in the PR body. (D12)
- Existing artifacts, schemas, and runs with no `models:` block are unaffected. (D7, D11)

## Non-goals

- **Setting `ANTHROPIC_BASE_URL` on the operator's behalf.** plan-runner declares and verifies the
  endpoint; it never mutates process environment. Claude Code's subagent dispatch takes a model
  name but no per-agent base URL, so any env manipulation would leak to every agent in the run,
  including the verifier. (D6)
- **Per-role endpoints.** One endpoint per run. Constraint-conflict check: per-role endpoints were
  the more useful feature but are unimplementable against a process-wide base URL, so the
  configuration deliberately does not offer a knob the harness cannot honor. (D6)
- **Validating config values against a model registry.** A typo surfaces at preflight as an
  unavailable model, not at parse time. (ADR-0007)
- **Changing the `recommended_model` enum, the analyzer's complexity scoring, or the dev-dispatch
  precedence rule.** (D7)
- **Client-specific config keys.** One `models:` block serves both backends. (D13)
- **Routing local models as delegate tools rather than agent backends.** Considered at wave 1 and
  not chosen.

## Users / consumers

- Repo owners committing `.plan-runner.yml` to a target repo.
- The `plan-runner:run` skill orchestrator on both the `subagent` (Claude Code, Codex) and `teams`
  backends.
- The `plan-runner:pr` skill, which reads the completed cycle directory for the PR body.
- Reviewers of a plan-runner PR, who need to see whether a wave ran on a substituted model.

## Requirements

Expressed as deltas against the current system.

1. **ADDED** -- `.plan-runner.yml` MAY carry a top-level `models:` block with a `tiers:` map
   (`haiku` / `sonnet` / `opus` -> model identifier), optional per-role keys for the six pipeline
   roles (`analyzer`, `dev`, `test-author`, `verifier`, `aggregator`, `integrator`), and an
   optional `endpoint:` object with `base_url` and `api_key_env`. (D8, A1)
2. **ADDED** -- Keys are extracted individually with the Read tool, never via a YAML parser, exactly
   as `verification.mode` is extracted today. A missing file, a missing key, or an unreadable file
   falls through to the next precedence level. (A1)
3. **ADDED** -- Config values MAY be tier words or raw model identifier strings. Raw identifiers are
   passed to the host untouched. (D2, D13)
4. **MODIFIED** -- Model resolution at every dispatch site becomes one precedence chain: a serving
   project agent's `model:` frontmatter, then the `models:` per-role key for that role, then the
   `models.tiers` entry for the tier the role or task called for, then the built-in default
   (frontmatter, the Step 1c-bis heuristic, or `recommended_model`). The existing dev-dispatch rule
   is preserved as the head of this chain. (D7, D8, ADR-0007)
5. **UNCHANGED** -- The analyzer continues to emit `recommended_model` from the enum
   `haiku | sonnet | opus`. Tier words become an abstract vocabulary that config binds to concrete
   models; `task-graph.schema.json` and `wave-plan.schema.json` are not modified. (D7, ADR-0007)
6. **ADDED** -- Before the first dispatch, the orchestrator resolves the complete model map and
   preflights what is *locally checkable*: endpoint reachability, presence of `endpoint.api_key_env`,
   and config well-formedness. It does not attempt to enumerate host models. When `endpoint.base_url`
   is set it health-checks that URL and compares it against the exported `ANTHROPIC_BASE_URL`.
   (D6, D14, O8-resolution)
6-bis. **ADDED** -- An unservable *model name* is detected at first dispatch, not at preflight: the
   analyzer dispatch doubles as the availability probe. The orchestrator compares the model the
   analyzer was actually served against the configured one, and a mismatch opens the gate of
   requirement 8 before any dev agent is dispatched. The gate answer caches into `model_policy`
   exactly as a preflight answer does. (O8-resolution)
7. **ADDED** -- When `endpoint.api_key_env` is set and the named environment variable is absent or
   empty, the endpoint is treated as unavailable and takes the gate path of requirement 8. The
   config never holds a literal credential. (D9)
8. **MODIFIED** -- When preflight finds one or more configured models that cannot be served, the
   orchestrator asks the operator once, in a single structured question covering every unavailable
   entry, whether it may substitute a model chosen by task complexity. This is a deliberate,
   scoped reversal of "use the closest available model without blocking" -- the never-block rule
   continues to govern every case except a config-named model at preflight. (D3, D14)
8-bis. **ADDED** -- IF the operator declines at the gate, THE SYSTEM SHALL NOT substitute by task
   complexity: the affected roles fall back to the pre-feature built-in defaults (agent frontmatter,
   the Step 1c-bis heuristic, `recommended_model`), the answer is recorded as
   `consent: "declined"`, and the run continues. Declining never aborts the run. (D18)
9. **UNCHANGED** -- A repo with no `models:` block, or a role absent from the block, resolves to
   today's built-in defaults with no gate and no prompt. (D3)
10. **ADDED** -- When no structured-input facility is available, or the operator does not answer,
    the orchestrator degrades to the closest available model, prints the substitution, and records
    it. It never aborts the run and never proceeds without recording. (D4)
10-bis. **ADDED** -- A model resolved through `endpoint.base_url` is **non-degradable**. It SHALL
    NOT fall back to a hosted model under any circumstance, including the headless path of
    requirement 10. When such a model is unavailable: ask if an input facility exists; when none
    exists, halt that dispatch and record it rather than rerouting. Degrading a deliberately local
    model to a hosted one moves source code off the operator's machine, which is not recoverable
    after the fact. (O6-resolution)
11. **ADDED** -- The resolved model map and the operator's gate answer persist as an optional
    `model_policy` object in `run-state.schema.json`. A resumed or relayed phase rehydrates from it
    rather than re-resolving and re-asking. (D14, D16, ADR-0008)
12. **ADDED** -- A model that becomes unavailable after preflight degrades per requirement 10 and is
    recorded as a substitution. It does not open a second gate. (D14, ADR-0008)
13. **ADDED** -- `--no-model-config` ignores the `models:` block entirely for one run, restoring
    frontmatter defaults, the Step 1c-bis heuristic, `recommended_model`, and silent degradation.
    A persistent counterpart `models.enabled: false` does the same for every run, matching
    `phasing.enabled` and `agents.project`. Precedence: flag > `models.enabled` > default `true`.
    (D11, O7-resolution)
14. **ADDED** -- Codex and Claude Code read the same `models:` block. Tier words are passed to
    whatever the host understands and degrade under the existing closest-available rule. (D13)

### Non-functional requirements

15. **ADDED (observability)** -- At setup the orchestrator prints the resolved map once in the
    established form, e.g. `Model policy: sonnet -> claude-opus-5, verifier -> claude-opus-5 (from
    .plan-runner.yml).` (D12)
16. **ADDED (observability)** -- The manifest records the resolved model actually dispatched for
    each agent, and any substitution with its reason, alongside the existing `agent_source` field.
    (D12)
17. **ADDED (observability)** -- The PR body surfaces substitutions next to the existing bug and
    verification counts, so a reviewer can see a wave ran on a model other than the configured one.
    (D12)
18. **ADDED (security)** -- No credential value is ever written to `.plan-runner.yml`, the manifest,
    the run-state file, the console, or the PR body. Only the environment variable's name appears.
    (D9)
19. **ADDED (compatibility)** -- `model_policy` is optional in `run-state.schema.json`, carries a
    "pre-X.Y.Z" description note, and pre-existing run-state files continue to validate. (ADR-0008)
20. **ADDED (reliability)** -- Preflight performs at most one health-check request per configured
    endpoint per run, with a bounded timeout, and a failed check degrades rather than raising.
    (D6, D14; request count and timeout are binding default A3)
21. **UNCHANGED (honesty)** -- The verifier-coverage gate stays upstream of the PR step, the
    orchestrator never substitutes its own judgment for a verifier verdict, and token accounting
    remains best-effort with null-plus-coverage counters. Nothing in this feature may weaken these.

## Chosen approach

Approach B: resolution logic in `skills/run/SKILL.md` prose, with the resolved map and consent
answer persisted in the existing run-state checkpoint. (D16)

Alternatives considered:

- **A -- prose-only, session-local.** Smallest diff and no schema change, but phase relays,
  stop-mode boundaries, and resume run in fresh contexts, so they would re-resolve and re-ask about
  the same unavailable model. It cannot deliver the once-per-run gate (D14) on exactly the long
  unattended runs where the gate matters most.
- **C -- a dedicated `model-policy.json` cycle artifact.** Most auditable, but the heaviest surface
  (new schema, fixtures, gitignore rules, resume rules) and it cuts against the precedent ADR-0005
  set for project-agent dispatch: prose plus one durable field, not a new artifact.

Decision records: [ADR-0007 - tier-indirection model resolution](../adr/0007-tier-indirection-model-resolution.md)
and [ADR-0008 - model policy persisted in the run-state checkpoint](../adr/0008-model-policy-in-run-state.md).

## Architecture & components

| Component | Responsibility |
|---|---|
| `models:` block in `.plan-runner.yml` | Declares the tier map, per-role overrides, and the endpoint. Target-repo-owned, committed. |
| Model policy resolver (new SKILL.md step, alongside Steps 1d-quater/quinquies/sexies) | Extracts the `models:` keys, applies flag > yml > default, and builds the resolved model map. |
| Endpoint preflight | Health-checks `endpoint.base_url`, resolves `api_key_env`, compares against exported `ANTHROPIC_BASE_URL`, and warns on mismatch. |
| Availability gate | Asks once about everything unresolvable; degrades and records when no input facility exists. |
| Dispatch-site resolution rule | Applies the precedence chain of requirement 4 at analyzer, dev, test-author, verifier, aggregator, and integrator dispatch. |
| `model_policy` in `run-state.schema.json` | Persists the resolved map, its provenance, and the consent answer across phases and resume. |
| Reporting surfaces | Console line at setup; manifest per-dispatch model and substitutions; PR body substitution summary. |
| `--no-model-config` | Run-level kill-switch restoring pre-feature behavior. |

Data flow:

`.plan-runner.yml` -> model policy resolver -> endpoint preflight -> availability gate ->
resolved model map -> (run-state `model_policy`) -> dispatch sites -> manifest -> PR body

## Data & interfaces

Config shape at the target repo root:

```yaml
models:
  enabled: true                  # default true; false == --no-model-config for every run
  tiers:
    haiku: claude-haiku-4-5
    sonnet: claude-opus-5
    opus: claude-opus-5
  verifier: claude-opus-5        # optional per-role override
  dev: qwen3-coder               # raw identifier, passed through untouched
  endpoint:
    base_url: http://localhost:4000
    api_key_env: PLAN_RUNNER_LOCAL_KEY
```

Role keys: `analyzer`, `dev`, `test-author`, `verifier`, `aggregator`, `integrator`.

CLI: `--no-model-config` (boolean, no value).

`run-state.schema.json` gains one optional top-level object:

```
model_policy: {
  resolved:      { <role|tier>: <model identifier> },
  source:        { <role|tier>: "flag" | ".plan-runner.yml" | "default" },
  endpoint:      { base_url, api_key_env, health: "ok" | "unreachable" | "unchecked" } | null,
  consent:       "granted" | "declined" | "degraded-no-input" | null,
  substitutions: [ { role, configured, dispatched, reason } ]
}
```

Manifest wave/agent entries gain `resolved_model` (string) and `model_substituted`
(object or null: `{ configured, dispatched, reason }`), sitting beside the existing `agent_source`.

No credential value appears in any of these shapes.

## Edge cases & error handling

| Edge case | Handling |
|---|---|
| No `.plan-runner.yml`, or no `models:` block | Built-in defaults, no gate, no prompt. (D3) |
| Role absent from `models:` | Falls through to tier map, then built-in default. (D8) |
| Configured model unavailable at preflight | One structured ask covering all unavailable entries. (D3, D14) |
| Gate fires with no input facility, or unanswered | Degrade to closest available, print, record. Never abort. (D4) |
| `api_key_env` names an absent or empty variable | Endpoint treated as unavailable; takes the gate path. Value never logged. (D9) |
| `endpoint.base_url` unreachable at preflight | Recorded `health: "unreachable"`; dependent models are unavailable and take the gate path. (D6) |
| Exported `ANTHROPIC_BASE_URL` differs from `endpoint.base_url` | Warn on the console naming both values; do not mutate the environment; continue. (D6) |
| Model becomes unavailable mid-run | Degrade and record. No second gate. (D14) |
| Phase relay / stop boundary / resume | Rehydrate `model_policy` from run-state; do not re-ask. (D16) |
| Unphased run (no run-state file) | Policy is session-local; a single session cannot lose it, so once-per-run still holds. (ADR-0008) |
| `.plan-runner.yml` edited mid-run | Resumed run keeps the policy captured at run start, consistent with the `plan_content_hash` drift guard. Config edits take effect next run. (ADR-0008) |
| `--no-model-config` passed | Block ignored entirely; pre-feature behavior. (D11) |
| Tier word unknown to the host (Codex) | Existing closest-available degradation applies. (D13) |
| Project agent declares `model:` frontmatter | Frontmatter still wins; head of the precedence chain is unchanged. (D7) |

## Acceptance criteria (EARS)

1. WHEN `.plan-runner.yml` contains a `models.tiers` entry for a tier, THE SYSTEM SHALL dispatch
   every role and task that calls for that tier using the configured identifier.
2. WHEN `.plan-runner.yml` contains a per-role key for a pipeline role, THE SYSTEM SHALL prefer
   that key over the tier map for that role.
3. WHEN a project agent serving a dev dispatch declares `model:` frontmatter, THE SYSTEM SHALL use
   the frontmatter model in preference to any `models:` configuration.
4. WHEN no `models:` block is present, THE SYSTEM SHALL resolve every role exactly as it did before
   this feature and SHALL NOT prompt the operator.
5. WHEN a configured model value is not a tier word, THE SYSTEM SHALL pass the value to the host
   unmodified.
6. WHEN a run begins with a `models:` block present, THE SYSTEM SHALL resolve and preflight the
   complete model map before dispatching the analyzer.
7. IF preflight finds one or more configured models that cannot be served, THEN THE SYSTEM SHALL
   ask the operator once, in a single structured question covering every unavailable entry, before
   the first dispatch.
8. WHILE a run is executing after the preflight gate has been answered, THE SYSTEM SHALL NOT ask
   the operator about model availability again.
9. IF the gate is reached with no structured-input facility available, THEN THE SYSTEM SHALL
   dispatch the closest available model, print the substitution, and record it.
10. IF `endpoint.api_key_env` names an environment variable that is absent or empty, THEN THE
    SYSTEM SHALL treat the endpoint as unavailable and SHALL NOT print or persist any credential
    value.
11. IF `endpoint.base_url` does not match the exported `ANTHROPIC_BASE_URL`, THEN THE SYSTEM SHALL
    print a warning naming both values and SHALL NOT modify the process environment.
12. WHEN a configured model becomes unavailable after preflight, THE SYSTEM SHALL degrade to the
    closest available model and record the substitution without opening a second gate.
13. WHEN a phased run writes a checkpoint, THE SYSTEM SHALL persist the resolved model map, its
    provenance, and the consent answer in the run-state `model_policy` object.
14. WHEN a run resumes or relays into a new phase, THE SYSTEM SHALL rehydrate `model_policy` from
    run-state rather than re-resolving the configuration.
15. WHEN a run-state file written before this feature is read, THE SYSTEM SHALL validate it
    successfully with `model_policy` absent.
16. WHEN model policy resolution completes, THE SYSTEM SHALL print the resolved map once in the
    form `<setting>: <value> (from <flag | .plan-runner.yml | default>).`
17. WHEN an agent is dispatched, THE SYSTEM SHALL record its resolved model in the manifest entry
    for that agent.
18. IF any substitution occurred during a run, THEN THE SYSTEM SHALL surface it in the PR body
    alongside the bug and verification counts.
19. WHEN `--no-model-config` is passed, THE SYSTEM SHALL ignore the `models:` block, resolve models
    exactly as it did before this feature, and SHALL NOT open the gate.
20. WHEN the same `models:` block is read on the Codex backend, THE SYSTEM SHALL apply the same
    resolution chain and SHALL NOT require any client-specific key.
21. WHEN this feature is present, THE SYSTEM SHALL leave the verifier-coverage gate upstream of the
    PR step and SHALL NOT allow a model substitution to close a wave whose verdict is outstanding.
22. WHEN `.plan-runner.yml` is absent, unreadable, or missing a requested key, THE SYSTEM SHALL
    fall through to the next precedence level without raising.
23. WHEN `endpoint.base_url` is configured, THE SYSTEM SHALL issue at most one health-check request
    for it per run with a 5-second timeout, and IF the check fails or times out THEN THE SYSTEM
    SHALL record `health: "unreachable"` and continue without raising. (A3)
24. IF the operator declines at the gate, THEN THE SYSTEM SHALL resolve the affected roles using the
    pre-feature built-in defaults, record `consent: "declined"`, and continue the run without
    aborting and without substituting by task complexity. (D18)
25. WHEN preflight runs, THE SYSTEM SHALL check only endpoint reachability, `api_key_env` presence,
    and config well-formedness, and SHALL NOT attempt to enumerate the host's available models.
    (O8-resolution)
26. WHEN the analyzer returns, THE SYSTEM SHALL compare the model it was served against the
    configured model, and IF they differ THEN THE SYSTEM SHALL open the gate before dispatching any
    dev agent and cache the answer in `model_policy`. (O8-resolution)
27. IF a model resolved through `endpoint.base_url` is unavailable, THEN THE SYSTEM SHALL NOT
    substitute a model not served by that endpoint; it SHALL ask when an input facility exists, and
    otherwise SHALL halt that dispatch and record it. (O6-resolution)
28. WHEN `models.enabled` is `false` and no flag overrides it, THE SYSTEM SHALL behave exactly as
    `--no-model-config` does. (O7-resolution)

## Verification strategy

**unit** -- criteria 1-5, 22. Config-parsing and precedence cases over the single-key extraction
rule, including absent file, absent key, unreadable file, tier word, and raw identifier.

**unit** -- criteria 13, 15, 19. Schema fixtures: a valid `run-state.json` with `model_policy`
populated, a valid one with it absent (back-compat), and an invalid one violating the object's
shape, under `schemas/examples/` and exercised by `tests/validate_schemas.py`. Manifest fixtures
for `resolved_model` and `model_substituted`, valid and invalid.

**unit (prose contract)** -- criteria 6-12, 14, 16-21, 23. Exact-phrase and regex pins in
`tests/contract.test.js` over the new `skills/run/SKILL.md` prose: the precedence chain sentence,
the gate wording, the once-per-run rule, the headless-degrade rule, the preflight and
`ANTHROPIC_BASE_URL` mismatch wording, the console line format, the `--no-model-config` flag
description, and the honesty-invariant restatement. This is the primary harness for this repo,
where prose is the product.

**integration** -- criteria 17, 18. A recorded fixture cycle directory with a substitution present,
asserted through the manifest and the `plan-runner:pr` body assembly.

**manual (opt-in, not in CI)** -- criterion 11 and the endpoint health check against a real local
server. No automated test issues an HTTP request; CI stays hermetic. (D15)

## Assumptions (unconfirmed)

None. A1 (config lives in `.plan-runner.yml` under `models:`, single-key extraction), A2
(precedence flag > yml > default), and A3 (one health check per endpoint per run, 5-second timeout,
failure recorded as `health: "unreachable"`) were each confirmed at the planning gate and are
recorded as decided rows D19-D21 in the ledger. They remain welded into criteria 1, 2, 4, 16, 19,
22, and 23.

## Open questions

None. All three were resolved at the planning gate and recorded as decided rows D22-D24 in the
ledger:

- **O6 -> D22 (privacy).** A model resolved through `endpoint.base_url` is non-degradable: it never
  falls back to a hosted model, on any path including the headless one. Ask when an input facility
  exists; otherwise halt that dispatch and record it. Requirement 10-bis, criterion 27.
- **O7 -> D23.** `--no-model-config` gains a persistent counterpart `models.enabled: false`,
  matching `phasing.enabled` and `agents.project`. Requirement 13, criterion 28.
- **O8 -> D24 (feasibility).** Preflight is narrowed to locally checkable facts only and never tries
  to enumerate host models; an unservable model *name* is caught at first dispatch, with the
  analyzer dispatch doubling as the availability probe and its gate answer caching into
  `model_policy`. Requirements 6 and 6-bis, criteria 25 and 26.

## Definition of done

- Tests written and passing: `node --test tests/contract.test.js`, `python tests/validate_schemas.py`,
  `claude plugin validate .`, and the Codex plugin and skill validators used by CI.
- Existing behavior preserved outside the described change: a repo with no `models:` block, and a
  run with `--no-model-config`, behave exactly as before.
- Stated platform floors honored: no YAML parser dependency; both the Claude Code and Codex
  backends read the same configuration.
- No new network calls unless specified in Data & interfaces -- exactly one bounded endpoint
  health-check per run, and only when `endpoint.base_url` is configured.
- Docs updated: `README.md` configuration and flag sections, `CHANGELOG.md` (new pipeline
  behavior = minor), and the six-place version bump per `CLAUDE.md`.
- Every acceptance criterion above passes.
