# 0005 - Project-agent dispatch as a prose-only overlay at Step 4a

Status: accepted
Date: 2026-07-26

## Context

The run skill should implement dev tasks with a target repo's own agents when one clearly fits, falling back to the bundled `plan-dev`. The selection mechanism could live in the analyzer (wave-plan field), in a new cycle artifact, in a matcher subagent, or purely in orchestrator prose at dispatch time. The plugin is dual-client: Codex cannot natively register agent files, so any mechanism must work by embedding definitions in prompts.

## Options

1. **Prose-only dispatch overlay** - inventory built in-session at cycle setup; selection rules (directive match, conservative description match, tool guard) in Step 4a prose; one optional manifest field (`agent_source`) for provenance.
2. **Structured inventory artifact** - orchestrator writes `agent-inventory.json` (new schema + fixtures) to the cycle dir and logs per-wave dispatch-decision records.
3. **Matcher subagent** - a small haiku agent scores task-vs-inventory fit per wave.

## Decision

Option 1. The user chose orchestrator-at-dispatch-time matching with a conservative bar; that needs no durable artifact and no schema surface beyond one optional manifest field. It matches the skill's existing architecture (role files resolved relative to SKILL.md, embedded in prompts) and keeps both backends identical.

## Consequences

- Selection behavior is pinned by contract tests over SKILL.md prose, like every other pipeline rule.
- The inventory is not resume-durable; after a crash the resumed session rebuilds it, which may pick up agent-file edits made mid-run. Accepted: waves already re-resolve host facilities on resume.
- No dispatch-time subagent latency; no new cycle artifacts to gitignore.
- Auditability rests on `agent_source` in the manifest plus dispatch display lines, not on a decision log.
