# ADR-0004: run-state.json as the cross-phase checkpoint

Status: accepted (2026-07-16)

## Context

Phased execution (ADR-0003) needs durable state that survives session boundaries and machine crashes: which phases exist, which completed, where each phase's artifacts live, and enough invocation context (plan path, flags, backend, verify mode) for a fresh session to resume exactly where the last one stopped -- including in no-git mode, where per-wave commits are unavailable as checkpoints.

## Options

- **A. New `run-state.json`** at the cycle directory root. One file, one resume entry point; per-cycle/per-phase manifests keep their existing shape.
- **B. Extend `manifest.json`** with phase/resume fields; resume scans manifests and reconstructs state by inference.
- **C. Git-only** -- rely on per-wave commit messages/tags. Useless in no-git mode, fragile to parse, and cannot carry invocation flags.

## Decision

Option A: `docs/plan-runner/{DATE}/cycle-{N}/run-state.json`, written at phase-slicing time and updated at every wave completion and phase boundary. Pre-flight auto-detects an incomplete run-state and offers resume; `--resume [path]` targets one explicitly. Per-wave commits remain the git-level recovery aid, but run-state.json is the source of truth so resume works identically with git absent.

## Consequences

- Resume is a read of one small JSON file, not an inference over manifests or git history.
- The file is a generated cycle artifact under `docs/plan-runner/` -- already gitignored by the SessionStart hook, never committed.
- Crash recovery granularity is the wave: an interrupted wave re-runs from its start (uncommitted partial work surfaced to the user, never silently discarded).
- One more artifact shape to validate: run-state gets a schema plus valid/invalid fixtures like the other artifacts.
