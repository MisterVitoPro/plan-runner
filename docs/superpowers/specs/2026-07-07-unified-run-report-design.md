# Unified Run Report -- design

Date: 2026-07-07
Skill affected: `skills/run/SKILL.md` (plan-runner:run)

## Problem

The end of a `/plan-runner:run` cycle prints its stats as **three separate
blocks** with overlapping data and three different visual styles:

1. A final summary block -- either the Step 7 "complete -- no bugs found"
   header or the Step 6 "[Phase 4/4] Bug Report" header (waves, dev agents,
   verifiers, commits, duration, tokens).
2. The **Token Report** -- a per-phase ASCII table, printed at Step 6/7.
3. The **Phase Timing Summary** -- a separate indented list, printed last of
   all (after the PR step, so it is the only block with complete timing).

Redundancy: Duration appears in both #1 and #3; total Tokens in both #1 and #2.
The blocks print at different moments (summary + tokens before the PR; timing
after it), so the run never presents one coherent "here is what happened"
report.

## Goal

Replace the three blocks with a single, reusable, nicely-formatted **Run
Report** that reads as one deliverable, shown consistently on both terminal
paths (clean run and bugs-found run).

## Decisions (from brainstorming)

- **Scope:** both terminal paths, unified into one report design.
- **Style:** ASCII only (no Unicode box-drawing, no emojis) -- maximum
  compatibility with Windows consoles.
- **Detail:** keep the full per-phase Token table AND the full per-phase
  Timing list; do not condense them away.
- **Layout:** a compact two-column at-a-glance stat header on top, followed by
  the detailed tables.
- **Intermediate `Y` cycle:** print only the compact decision block before
  handoff (no full report); token/timing detail is deferred to the final
  cycle's Run Report and the manifest.

## Report format

Fixed 60-char width, ASCII only. Rendered from the same finalized `token_usage`
and phase-timing data the current blocks use -- no new data is collected.

### Clean run

```
============================================================
  plan-runner cycle 1 -- COMPLETE (clean, no bugs found)
============================================================
  Waves        7               Duration     4m 12s
  Dev agents   8               Tokens       381,852
  Verifiers    7/7 per-wave    Coverage     12/13 agents
  Commits      7               Bugs         0

  ! Tokens are a lower bound -- 1 of 13 subagents did not
    report usage.
------------------------------------------------------------
Tokens by phase
------------------------------------------------------------
 Phase     | Agents | Reported | Input    | Output   | Total
-----------|--------|----------|----------|----------|--------
 Analyze   |      1 |      1/1 |   12,345 |    2,345 |   14,690
 Dev       |      8 |      7/8 |  201,558 |   40,120 |  241,678
 Verify    |      3 |      3/3 |   88,410 |   12,077 |  100,487
 Aggregate |      1 |      1/1 |   20,115 |    4,882 |   24,997
-----------|--------|----------|----------|----------|--------
 Total     |     13 |    12/13 |  322,428 |   59,424 |  381,852
 Top consumers: wave-2-agent-1 (64,201), wave-1-verifier (41,388)
------------------------------------------------------------
Timing by phase
------------------------------------------------------------
  Pre-flight        0m 08s
  Analyze plan      0m 42s
  Wave execution    2m 55s   (7 waves)
  Aggregation       0m 18s   (skipped if 0 bugs)
  Sync code atlas   0m 22s
  Open PR           0m 07s
  ------------------------------
  Total             4m 12s
------------------------------------------------------------
Artifacts
------------------------------------------------------------
  Manifest    docs/plan-runner/2026-07-07/cycle-1/manifest.json
============================================================
```

### Bugs-found run

Same skeleton, three deltas:

- Title: `plan-runner cycle 1 -- 7 bugs found (P0:1 P1:2 P2:3 P3:1)`
- `Bugs` stat shows the total bug count.
- A second honesty line appears under the stat header when waves were left
  unverified:
  `! 2 of 7 waves were not semantically verified (mode: last-wave-only).`
- Artifacts gains `Bug report` and `Fix plan` rows.

### Rendering rules

- **Title line** is status-aware: `COMPLETE (clean, no bugs found)` when
  `total_bugs == 0`, else `<N> bugs found (P0:<n> P1:<n> P2:<n> P3:<n>)`.
- **Stat header** is a two-column grid (label, value, label, value). `Verifiers`
  shows `<waves_verified>/<W> <verify_mode>`. `Duration` is the total elapsed
  from the timing tally. `Tokens` is `token_usage.total_tokens`. `Coverage` is
  `<agents_reported>/<agents_total> agents`.
- **Honesty lines** (prefixed `! `) ride directly under the stat header, above
  the tables:
  - Partial token coverage: printed only when `complete` is false; wraps at the
    60-char width with a two-space hanging indent.
  - Unverified waves: printed only when `verification.waves_skipped > 0`.
- **Tokens by phase** table is the existing End-of-run Token Report table
  verbatim (same grouping, same non-null summing, same `Top consumers` line,
  same `n/a` for empty cells, same phase-row omission when a phase dispatched no
  subagent). The standalone `Coverage:` sentence is dropped from this table --
  coverage now lives once in the stat header.
- **Timing by phase** table is the existing Phase Timing Summary content: same
  rows, `User confirm` still excluded from the total, rows still noted as
  skipped when a phase did not run.
- **Artifacts** always lists `Manifest`; adds `Bug report` and `Fix plan` only
  when `total_bugs > 0`.

## Placement / flow

The Run Report prints **once, as the final output before STOP**, on every
terminal path, so its Timing table is complete (includes atlas sync + PR).

| Path | What prints |
|------|-------------|
| Clean run | atlas sync -> PR -> full Run Report at the very end. |
| Bugs, user picks `n` | compact decision block -> Y/n prompt -> atlas sync -> PR -> full Run Report at the very end. |
| Bugs, user picks `Y` | compact decision block -> Y/n prompt -> hand off to fresh subagent -> STOP. No PR, no atlas, no full Run Report (intermediate cycle); the manifest still records this cycle's full tally. |
| Git absent | No PR step -> full Run Report at the very end (Timing shows PR/atlas as skipped). |

### Compact decision block (Step 6, bugs found)

Shrinks to only what the re-run choice needs -- the heavy token + timing tables
move out of Step 6 into the final Run Report:

```
[Phase 4/4] Bug Report
======================
P0: <N>   P1: <N>   P2: <N>   P3: <N>
Total: <N> bugs across <W> waves

Bug report:    <bugs.md path>
Fix plan:      <fix-plan.md path>
```

Plus the existing convergence hint (`(This was cycle N. Cycle N-1 had ... )`)
and the differing-verify-mode caveat, then the Y/n prompt. The Token Report is
no longer printed here.

## Behavior change to note

Today an intermediate `Y` cycle prints a Token Report before handing off. Under
this design it prints only the compact decision block; token/timing detail is
deferred to the final cycle's Run Report and remains fully recorded in each
cycle's `manifest.json`. This trades per-intermediate-cycle token visibility for
one clean report at the end of the loop.

## Honesty invariants preserved

- **Token accounting is best-effort.** Totals still sum non-null values only;
  partial coverage is labelled a lower bound (now via the `!` line under the
  stat header). No fabricated counts.
- **Verifier-coverage visibility.** The unverified-waves line survives in the
  new report; a reduced-coverage run still cannot read as fully verified-clean.
- No change to the verifier-coverage gate's position relative to the PR step --
  this is purely a reporting/format change.

## Out of scope

- No change to what data is collected (timing, token tally) or to the manifest
  schema.
- No change to the verification pipeline, gates, dispatch, or PR skill.
- No Unicode/box-drawing styling; no color.

## Testing

`tests/contract.test.js` pins exact phrases/regexes in the skill prose. The
changed prose needs matching contract updates in the same change:

- Assertions for the new Run Report title lines, stat-header labels, section
  headers (`Tokens by phase`, `Timing by phase`, `Artifacts`), and the `!`
  honesty lines.
- Update/replace the assertions tied to the old `[Phase 4/4]` + Token Report +
  Phase Timing wording that moved or changed.
- Assert the compact decision block no longer prints the Token Report at Step 6.

Then run the full trio: `node --test tests/contract.test.js`,
`python tests/validate_schemas.py`, `claude plugin validate .`.
