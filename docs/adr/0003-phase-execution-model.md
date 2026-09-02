# ADR-0003: Orchestrator-sliced phase execution for large plans

Status: accepted (2026-07-16)

## Context

plan-runner runs an entire plan -- every wave -- in one long-lived orchestrator session. Claude Code's host process accumulates message heap that compaction never frees (documented V8 OOM near the ~4.2GB default ceiling after multi-hour sessions), so 40+ task plans (~10-15 waves) crash the user's machine. Research across Anthropic's multi-agent system write-ups and community orchestration plugins converged on: bound the work one context carries, execute chunks in fresh contexts, keep durable state on disk.

Wave order is topological (the analyzer emits a DAG-sorted wave plan), so any split into consecutive wave ranges is dependency-safe by construction.

## Options

- **A. Orchestrator-sliced phases.** Analyzer unchanged. The run skill slices the stored wave plan into phases of at most `max_waves_per_phase` consecutive waves. The invoking session becomes a thin phase driver; each phase executes in a fresh-context phase-runner subagent that returns only a compact phase summary. A `stop` mode instead ends the session at each boundary and prints a resume command (fresh OS process, full heap reset).
- **B. Analyzer-emitted phases.** The analyzer groups waves into `phases[]` at natural DAG seams. Schema change, analyzer prose change, contract-test churn; the seam benefit is cosmetic because consecutive slices are already safe.
- **C. Literal plan splitting.** Split the Markdown plan into per-phase files chained as normal runs. Fragile free-form prose splitting, cross-phase DAG lost, analysis cost duplicated, artifacts fragmented.

## Decision

Option A, with a hybrid execution mode: `relay` drives each phase through a fresh-context phase-runner subagent from a lean driver session; `stop` ends the session at each phase boundary for a full process reset. The default mode is ADAPTIVE (critic mitigation adopted at the review gate): relay when the sliced phase count is small (at most `auto_stop_phases`), stop above it - so the large plans that motivate the feature default to the full process reset. Relay additionally carries a wall-time guardrail (`relay_max_minutes`) that forces an early stop boundary before the observed OOM envelope. The Agent Teams backend always uses `stop` (teammates cannot spawn nested teams, so a phase-runner cannot lead a team).

The driver-plus-phase-runner shape (rather than phase-N-hands-off-to-phase-N+1 chaining) keeps subagent nesting at a constant depth of 2 (driver -> phase runner -> dev agents = 3), independent of phase count; a relay chain would nest one level per phase and hit the platform's depth-5 cap on large runs.

## Consequences

- Plans at or below the threshold run byte-for-byte as today; phasing is invisible until it is needed.
- The driver session's context stays flat: it holds the wave plan, run-state pointers, and one distilled summary per phase.
- `relay` reduces context growth but not host-process heap growth; `stop` is the complete fix and is what constrained machines and the teams backend use. This trade-off is explicit and user-chosen.
- Per-wave invariants (max 6 agents, file-disjoint, barrier, no-self-verify, verifier-coverage gate before PR) are enforced inside each phase runner and re-checked across all phases at aggregation.
