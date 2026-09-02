# ADR-0007: Tier-indirection model resolution

Status: accepted
Date: 2026-08-30

## Context

Plan Runner picks models in four unrelated places: bundled agent `model:` frontmatter, the
analyzer's structure heuristic at Step 1c-bis, the analyzer's per-task `recommended_model`
(schema enum `haiku | sonnet | opus`), and prose such as "prefer model `sonnet` when available"
at the verifier and aggregator dispatch sites. None of them is configurable by the target repo,
and none can name a model outside the three tier words -- neither a pinned version such as
`claude-opus-5` nor a locally served model behind an HTTP endpoint.

A configuration surface has to accept both vocabularies without invalidating the artifacts and
schemas already in use, and without discarding the per-task complexity scoring the analyzer
already performs.

## Options

1. **Tier indirection.** The analyzer keeps emitting tier words. A `models.tiers` map in
   `.plan-runner.yml` resolves each tier to a concrete model identifier at dispatch time.
   Per-role keys override the tier map for a named pipeline role.
2. **Hard-pinned roles.** A configured role always uses its named model; `recommended_model` is
   ignored wherever config covers the role.
3. **Bounded selection.** Config declares a floor and ceiling; the analyzer picks a tier within
   those bounds.

## Decision

Choose option 1. Tier words become an abstract vocabulary rather than model names, and the config
file is the single place that binds them to something concrete.

The `recommended_model` enum in `task-graph.schema.json` and `wave-plan.schema.json` is unchanged,
so every existing artifact keeps validating. Raw identifiers appear only in `.plan-runner.yml` and
are passed to the host untouched; tier words are passed as-is and resolved by whatever the host
understands, which is what keeps one config file working on both the Claude Code and Codex
backends. The existing closest-available-model degradation rule is unchanged for tier words.

## Consequences

- The analyzer's complexity scoring survives intact and gains reach: it now steers a concrete,
  user-chosen model per task instead of a fixed tier.
- A repo can point the whole pipeline at pinned versions, or at a locally served model, by editing
  three lines, without touching agent frontmatter.
- Tier words acquire a second meaning -- vocabulary, not model -- which must be stated explicitly
  in SKILL.md and README or the config file reads as a tautology (`sonnet: sonnet`).
- Per-role keys and the tier map can disagree. Precedence has to be pinned by contract test:
  serving project agent `model:` frontmatter, then per-role key, then tier map, then built-in
  default.
- Config values are not validated against a model registry. A typo resolves to an unavailable
  model and surfaces at the preflight gate rather than at parse time.
