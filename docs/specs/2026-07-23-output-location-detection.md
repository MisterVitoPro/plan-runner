# Output location detection - design spec

Date: 2026-07-23 / Status: awaiting-review / Author: MisterVitoPro

## Problem

plan-runner always writes its run artifacts under `docs/plan-runner/$DATE/cycle-N`, with `docs/`
hardcoded. Projects that keep their documentation somewhere other than `docs/` (for example
`documentation/`, `doc/`, or a repo that declares its docs home in `CLAUDE.md`) get a stray `docs/`
tree created just for plan-runner, splitting their documentation across two roots. The output base
should follow where the project already keeps its docs, and only invent `docs/` as a last resort.

## Existing system

Markdown-driven Claude Code + Codex plugin (the prose in `skills/*/SKILL.md` and `agents/*.md` is
the product). The run orchestrator (`skills/run/SKILL.md`) computes the output tree in **Step 1b**:
`DATE=$(date +%Y-%m-%d)`, `cycle_root = "docs/plan-runner/$DATE/"`, then the next `cycle-N`. The
literal `docs/plan-runner/` base also appears in:
- **Resume discovery** (Resume/crash-recovery step R.1), reached from the fresh-run auto-detect
  **Step 1a-0** and from bare `--resume`: globs `docs/plan-runner/**/run-state.json`. Note the
  ordering - Step 1a-0 runs *before* Step 1b, so base resolution must precede it (see requirement 1).
- **SessionStart gitignore hook** (`hooks/hooks.json`): an inlined `node -e` one-liner that appends
  `docs/plan-runner/` to `.gitignore` (deliberately self-contained, no plugin-root/script path).
- Illustrative-only references in `skills/pr/SKILL.md`, `agents/plan-aggregator.md`, README,
  CHANGELOG, and schema examples.

Already path-agnostic (no change needed): the pr step and aggregator receive the cycle directory as
an argument; `run-state.json` persists each phase's absolute `directory`, so resume writes to the
persisted location without re-detecting. Config resolution convention: single-key extraction from
`.plan-runner.yml` with no YAML-parser dependency, precedence flag > yml > default.

## Goals

- Resolve the output base from the project's real documentation directory instead of a hardcoded
  `docs/`. (ledger: Goal, Detection precedence)
- Honor a documentation location stated in `CLAUDE.md` / `AGENTS.md` / context above any scan.
  (ledger: Detection precedence 1)
- When nothing is stated, pick the base by a deterministic top-level directory scan. (ledger:
  Top-level scan matching)
- Preserve today's behavior as the fallback: `docs/plan-runner/...` when no docs convention exists.
  (ledger: Detection precedence 3)
- Never orphan an in-flight run created under the old default. (ledger: Resume back-compat)

## Non-goals

- No new config knob: no `.plan-runner.yml output.dir` key and no `--output-dir` flag. (ledger: No
  explicit config knob) Constraint-conflict check: a config knob would match the existing
  `--verify`/`--phase-size` pattern, but the user explicitly chose context-only control to keep the
  surface small; the stated-in-context path covers the "force a location" need.
- No change to the subtree layout under the base: it stays `plan-runner/$DATE/cycle-N[/phase-M]`.
- No migration or relocation of already-written run artifacts.

## Users / consumers

The plan-runner run orchestrator (primary), the resume/crash-recovery path, the SessionStart hook,
and the maintainer (MisterVitoPro) reading generated artifacts. No end-user-facing API surface.

## Requirements

Change deltas against the current system:

1. (MODIFIED, ledger: Detection precedence, Top-level scan) THE SYSTEM SHALL resolve a `docs_base`
   directory in a **pre-flight step that runs before the resumable-run auto-detect (Step 1a-0)**,
   not in Step 1b, because the resume discovery in requirement 3 consumes `docs_base` and Step 1a-0
   runs ahead of 1b. Step 1b then consumes the pre-resolved value: `cycle_root` becomes
   `"<docs_base>/plan-runner/$DATE/"`, replacing the hardcoded `docs/`. Resolution order:
   1. If `CLAUDE.md` or `AGENTS.md` at the repo root (or in-context repository instructions)
      explicitly names a documentation directory, use that directory.
   2. Otherwise scan top-level directory entries and select the first that matches, in fixed order,
      one of `docs`, `doc`, `documentation`, `.docs`.
   3. Otherwise use `docs` (creating it as today).
2. (ADDED, ledger: Assumed - interface) When the base is resolved, the orchestrator SHALL print one
   line naming the resolved base and its source, in the same block as the existing verify-mode /
   phasing lines.
3. (MODIFIED, ledger: Resume back-compat) The resumable-run discovery scan (R.1) SHALL glob run-
   states under BOTH `<docs_base>/plan-runner/**/run-state.json` and the legacy
   `docs/plan-runner/**/run-state.json`, de-duplicating when the two are the same path. Every other
   resume rule (status filter, most-recent selection, the "No resumable run found" message) is
   unchanged.
4. (MODIFIED, ledger: Gitignore hook) The SessionStart gitignore hook SHALL ensure the base-agnostic
   entry `**/plan-runner/` is present in `.gitignore` instead of the literal `docs/plan-runner/`,
   remaining a self-contained inlined one-liner with no config or plugin-root dependency.
5. (MODIFIED, ledger: Assumed - manifest) The run manifest SHALL record the resolved `docs_base` (or
   the full resolved `cycle_root`) so downstream path reporting stays accurate.

### Non-functional requirements

6. (binding default, see Assumptions) Base resolution uses only directory listing / Glob and reading
   `CLAUDE.md`/`AGENTS.md` - no YAML parser and no shell-specific tooling - and is deterministic for
   a given repository state.
7. (Honesty invariants, unchanged) The verifier-coverage gate, token-accounting rules, and no-self-
   verify invariant are untouched; this change only moves where artifacts are written.

## Chosen approach

A single resolution helper at Step 1b produces `docs_base` by the three-tier precedence above; every
other site consumes that value or (for resume discovery and the hook) is made base-agnostic.
Alternatives considered and rejected at the checkpoint: (a) a `.plan-runner.yml output.dir` + CLI
flag - rejected as unnecessary surface (user chose context-only control); (b) a heaviest-markdown-
directory heuristic - rejected as nondeterministic and heavier than a known-name scan.

## Architecture & components

None new. The change touches existing sites only:
- `skills/run/SKILL.md` Step 1b (base resolution) and Resume step R.1 (dual-base discovery glob).
- `hooks/hooks.json` (base-agnostic gitignore entry).
- Illustrative path references in `skills/pr/SKILL.md`, `agents/plan-aggregator.md`, README,
  CHANGELOG, schema example descriptions - updated for accuracy, not behavior.
- `tests/contract.test.js` - new pins for the resolution precedence, dual-base resume glob, and the
  `**/plan-runner/` hook entry; plus the five-place version bump (minor: new pipeline behavior).

## Data & interfaces

- Resolved value: `docs_base` (string, a repo-relative directory), feeding
  `cycle_root = "<docs_base>/plan-runner/$DATE/"`.
- Detection inputs: repo-root `CLAUDE.md`, `AGENTS.md`, in-context repository instructions; top-level
  directory listing filtered to `["docs","doc","documentation",".docs"]`.
- Resume discovery globs: `<docs_base>/plan-runner/**/run-state.json` and
  `docs/plan-runner/**/run-state.json`.
- Gitignore entry: literal line `**/plan-runner/`.
- Manifest field: resolved base / cycle_root recorded for path reporting.
- Console line format (binding default): `Output location: <docs_base>/plan-runner/ (from <CLAUDE.md |
  AGENTS.md | top-level scan | default>).`

## Edge cases & error handling

- CLAUDE.md/AGENTS.md present but naming no docs directory, or only vaguely: fall through to the
  top-level scan (only an explicit, unambiguous declaration is honored).
- Stated docs directory does not exist yet: create it (same as today's `docs/` fallback).
- Multiple known-name dirs exist (e.g. both `docs/` and `documentation/`): first in the fixed order
  `docs > doc > documentation > .docs` wins; deterministic, no ambiguity.
- Resolved base equals `docs/`: the two resume globs collapse to one path; de-duplicate results.
- Legacy in-flight run under `docs/plan-runner/` while the resolved base differs: found by the
  legacy glob; the run-state's persisted absolute `directory` keeps writes on the original path.
- Repo with no docs dir and no statement: behaves exactly as today (creates `docs/plan-runner/`).
- Non-git repo: hook and resume are already git-gated; base resolution is git-independent.

## Acceptance criteria (EARS)

- WHEN `CLAUDE.md` (or `AGENTS.md` / context) explicitly names a documentation directory, THE SYSTEM
  SHALL set `docs_base` to that directory and write the cycle tree under it.
- WHEN no docs location is stated AND a top-level `docs`/`doc`/`documentation`/`.docs` directory
  exists, THE SYSTEM SHALL set `docs_base` to the first match in that fixed order.
- WHEN no docs location is stated AND no known-name top-level directory exists, THE SYSTEM SHALL fall
  back to `docs`, preserving current behavior.
- WHEN the base is resolved, THE SYSTEM SHALL print one line naming the resolved base and its source.
- WHEN scanning for resumable runs AND the resolved base differs from `docs/`, THE SYSTEM SHALL find
  run-states under both the resolved base and legacy `docs/plan-runner/`, de-duplicated.
- WHILE the SessionStart hook runs, THE SYSTEM SHALL ensure `.gitignore` contains `**/plan-runner/`.
- IF two known-name docs directories both exist, THEN THE SYSTEM SHALL choose deterministically by
  the fixed order and not create a second base.

## Verification strategy

- `unit` (contract test, `tests/contract.test.js`): pins for the Step 1b precedence prose, the dual-
  base resume glob, the `**/plan-runner/` hook entry, and the resolved-base print line. Plus the
  synchronized five-place version bump assertion.
- `manual`: (a) run the plan on a repo whose docs live in `documentation/` and confirm artifacts
  land in `documentation/plan-runner/...`; (b) interrupt a run under the *resolved* base
  (`documentation/plan-runner/`) and confirm it is offered by BOTH bare `--resume` AND the fresh-run
  Step 1a-0 auto-detect - not just the legacy `docs/` path; (c) run on a repo with a legacy
  `docs/plan-runner/` in-flight run and confirm resume still offers it.
- Existing suites unchanged: `python tests/validate_schemas.py`, `claude plugin validate .`, and the
  Codex plugin/skill validators.

## Assumptions (unconfirmed)

- Binding default: the resolved base is printed once at run start in the format under Data &
  interfaces, welded to the "print one line" acceptance criterion. (Low-cost, reversible.)
- Binding default: "stated in CLAUDE.md/context" requires an explicit statement naming a docs
  directory; vague prose is not honored and falls through to the scan. (Low-cost, reversible.)
- Binding default: the manifest records the resolved base/cycle_root; the schema field is optional
  and back-compatible with a "pre-1.15.0" note, so old manifests still validate. (Low-cost.)
- Binding default (NFR 6): base resolution uses only directory listing / Glob and reads
  `CLAUDE.md`/`AGENTS.md` - no YAML parser, no shell-specific tooling - and is deterministic for a
  given repository state, matching the existing dependency-free config-resolution convention.
  Welded to the deterministic-choice acceptance criterion. (Low-cost, reversible.)

## Open questions

None.

## Definition of done

- Contract tests written and passing (`node --test tests/contract.test.js`).
- Existing behavior preserved outside the described change (repos with no docs convention still get
  `docs/plan-runner/...`; honesty and pipeline invariants untouched).
- Stated platform/runtime floors honored (no new dependencies; detection is Glob/read only).
- No new network calls.
- Docs updated where behavior changed: README and CHANGELOG note the new detection; the version bump
  touches all five synchronized places in one commit per the repo release protocol.
- Every acceptance criterion above passes.
