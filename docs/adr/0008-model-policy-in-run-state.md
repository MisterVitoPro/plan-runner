# ADR-0008: Model policy persisted in the run-state checkpoint

Status: accepted
Date: 2026-08-30

## Context

When a configured model cannot be served, the pipeline asks the operator once for permission to
substitute a model chosen by task complexity, and that answer must hold for the whole run. A run
is not one context: phasing relays dispatch each phase as a fresh subagent, stop mode ends the
session at a phase boundary, and a crashed run resumes from a checkpoint. Facilities that are not
persisted are deliberately re-resolved on resume today -- `git_available`, `context7_available`,
the project-agent inventory.

Re-resolving a model policy the same way would re-ask the consent question at every phase
boundary and on every resume, precisely on the long unattended runs where nobody is watching. The
resolved map and the operator's answer therefore need a durable home.

## Options

1. **Persist in the existing run-state checkpoint.** Add an optional `model_policy` object to
   `run-state.schema.json` holding the resolved map, its provenance, and the consent answer.
2. **Session-local, re-resolved on resume.** Treat model policy like the project-agent inventory
   and accept re-asking at phase boundaries.
3. **A dedicated `model-policy.json` cycle artifact** with its own schema, read by every dispatch
   site.

## Decision

Choose option 1. The checkpoint that ADR-0004 introduced already carries exactly this class of
data -- `verify_mode`, `tdd_enabled`, `invocation_flags` -- and a resume already rehydrates from
it. `model_policy` is optional, so pre-existing run-state files keep validating.

Option 3 was rejected on the precedent ADR-0005 set for project-agent dispatch: prose plus one
durable field, rather than a new artifact, a new schema, new fixtures, and new gitignore and
resume rules. Option 2 was rejected because it cannot deliver the once-per-run gate.

## Consequences

- The consent answer and the resolved map survive relay boundaries, stop-mode restarts, and crash
  recovery; the gate fires at most once per run.
- Unphased runs write no run-state file, so their policy stays session-local. That is sufficient:
  a single session cannot lose it, and "once per run" still holds.
- A resumed run keeps the model policy captured at run start even if `.plan-runner.yml` changed in
  between. This is deliberate -- consistent with the existing `plan_content_hash` drift guard --
  and means a config edit takes effect on the next run, not the current one.
- `run-state.schema.json` needs a matching valid and invalid fixture pair and a "pre-X.Y.Z" note
  on the new field, per the repo's schema back-compat rule.
- A model that becomes unavailable mid-run is not a new gate: it degrades to the closest available
  model and is recorded as a substitution.
