# ADR-0009: plan-runner issues inference requests for endpoint-bound roles

Status: accepted
Date: 2026-08-30
Supersedes: part of ADR-0007

## Context

ADR-0007 established tier indirection: `.plan-runner.yml` binds tier words to concrete model
identifiers, and those identifiers are "passed to the host untouched... resolved by whatever the
host understands". The v2.1.0 design added `models.endpoint` with `base_url` and `api_key_env`,
and its non-goals recorded why nothing more was attempted: "Claude Code's subagent dispatch takes
a model name but no per-agent base URL", so per-role endpoints "are unimplementable against a
process-wide base URL" and the configuration "deliberately does not offer a knob the harness
cannot honor". The same interview considered "routing local models as delegate tools rather than
agent backends" and did not choose it.

The result shipped anyway: 2.1.0 parses `endpoint.base_url`, issues one 5-second health check
against it, warns when it disagrees with `ANTHROPIC_BASE_URL`, and then dispatches through host
subagents exactly as before. The endpoint is never called. An operator configured a local model,
saw the config accepted, and found that it had no effect on which model served anything; the
model only produced output when the endpoint was driven directly with curl. The knob the non-goal
promised not to offer was offered.

Two facts are now settled that were not when ADR-0007 was written. The harness cannot honor a
per-role base URL -- still true. And plan-runner does not have to ask the harness to: it can issue
the request itself.

## Options

1. **plan-runner issues the request.** For roles the config binds to an endpoint, the orchestrator
   makes the HTTP call directly and treats the response as that role's return, instead of handing
   a label to the host subagent facility.
2. **Remove `models.endpoint`.** Delete the inert knob and document that plan-runner cannot serve
   locally hosted models, so no one else is misled the way this operator was.
3. **Keep it declarative.** Leave the endpoint as documentation-plus-health-check and rely on the
   operator to export `ANTHROPIC_BASE_URL` themselves.

## Decision

Choose option 1, scoped to the roles the config names in `models.endpoint.roles`.

The part of ADR-0007 that says a configured identifier is only ever passed to the host is
superseded for endpoint-bound roles. Tier indirection itself is untouched: tier words remain an
abstract vocabulary, the `recommended_model` enum is unchanged, and every role the config does not
bind to the endpoint still resolves exactly as ADR-0007 decided.

Option 3 was rejected because it is the status quo that produced the failure, and because a
process-wide environment variable would leak to every agent in the run including the verifier.
Option 2 was offered to the operator at triage and declined in favor of building the path.

## Consequences

- `models.endpoint` stops being decorative: a configured endpoint with a `roles:` list changes
  which process makes the call, not merely which label is printed.
- plan-runner acquires an outbound network call it makes itself, which the honesty rules must
  cover: what was requested, what served it, and what it cost all become recordable facts rather
  than inferences. Token accounting improves, because an HTTP response reports exact usage where a
  subagent frequently reports none.
- The verifier is excluded by contract, not by convention. Local output is always graded by an
  independent host-dispatched model, so "no self-verify" keeps its force when the author is local.
- A second dispatch mechanism now exists beside host subagents. Every dispatch site must state
  which one it uses, and the wave/DAG invariants (file-disjointness, the per-wave barrier, the
  verifier-coverage gate) have to hold identically on both.
- Roles not listed in `roles:` are unaffected, so an existing 2.1.0 configuration keeps its exact
  behavior until the operator adds the key.
