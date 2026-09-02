# Unified Run Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plan-runner's three separate end-of-run blocks (final summary, Token Report, Phase Timing) with one ASCII "Run Report" -- a two-column at-a-glance stat header plus full per-phase token and timing tables -- printed once at the terminal end of a cycle on both the clean and bugs-found paths.

**Architecture:** The change is entirely in Markdown prose that IS the product: one skill file (`skills/run/SKILL.md`), its contract tests (`tests/contract.test.js`), and the README. A single reusable "End-of-run Run Report" rendering spec is authored in the Token accounting section; the three former print sites (Step 6, Step 7, Phase Timing Summary) are rewired to defer to it, and it is emitted once as the last output before STOP.

**Tech Stack:** Claude Code plugin (Markdown skill/agent prose). Tests: `node --test`, `python tests/validate_schemas.py`, `claude plugin validate .`.

## Global Constraints

- No emojis anywhere in the prose (project + user rule). The honesty markers use ASCII `!`.
- ASCII only in the report -- no Unicode box-drawing, no color. Fixed 60-column width.
- Author/handle in any file metadata is `MisterVitoPro`; never a real name or email.
- Honesty invariants (never weaken): token totals sum non-null values only and label partial coverage as a lower bound; a reduced-coverage run must never read as fully verified-clean; the verifier-coverage gate stays upstream of the PR step (this change is report-only and must not move it).
- Contract tests pin exact phrases/regexes in the prose. Every prose change ships with its matching contract update in the same commit; the tree stays green at every commit.
- Reference plugin files as `${CLAUDE_PLUGIN_ROOT}/...`; never the old `plugins/plan-runner/...` prefix.
- Verification trio that must pass before any change is "done":
  - `node --test tests/contract.test.js`
  - `python tests/validate_schemas.py` (needs `pip install jsonschema`)
  - `claude plugin validate .`

## Reference: current state (as of this plan)

- `skills/run/SKILL.md` -- `### End-of-run Token Report` spec lives under the "Token accounting" section (the fenced example + the "Rendering rules" bullets). Step 6 "RE-RUN PROMPT" prints a `[Phase 4/4] Bug Report` decision block, then "Then print the full **Token Report** block ...". Step 7 "FINAL SUMMARY (clean run only)" prints a `plan-runner cycle <n> complete -- no bugs found.` block, a `waves_skipped` note, then "Then print the full **Token Report** block ...". A standalone `## Phase Timing Summary` section at the file end prints the per-phase timing list and is described as "always print before STOP unless STOP was an early-exit error". Step 8 (git-absent branch) says "proceed to the Phase Timing Summary and STOP"; the after-PR branch says "print its confirmation line verbatim and STOP".
- `tests/contract.test.js` -- `test("run skill renders an end-of-run Token Report", ...)` at ~line 328 asserts `### End-of-run Token Report`, `Top consumers`, `Coverage:`, `lower bound`, `Omit a phase row`, a `>= 2` count of `rendered per the "End-of-run Token Report" spec`, and the non-null-sum phrase. `test("docs + version reflect the TDD feature", ...)` at ~line 149 asserts `pkg.version === "1.9.0"`. `test("SKILL keeps 'clean' honest about verification depth", ...)` at ~line 401 asserts `waves_skipped ... not semantically verified` appears.
- `README.md` -- a paragraph (~lines 76-84) describes "the end-of-run **Token Report**".
- `.claude-plugin/plugin.json` and `package.json` -- both at `1.9.0`.

---

### Task 1: Author the unified Run Report rendering spec

Replace the `### End-of-run Token Report` spec with a `### End-of-run Run Report` spec that keeps the token-table rules verbatim and adds the stat header, honesty lines, timing table, and artifacts. Update the contract test in the same commit so the tree stays green.

**Files:**
- Modify: `skills/run/SKILL.md` (the `### End-of-run Token Report` block under "Token accounting")
- Modify: `tests/contract.test.js` (replace the `renders an end-of-run Token Report` test)

**Interfaces:**
- Produces (referenced by Task 2's print sites): a spec titled exactly `### End-of-run Run Report`. Steps 6/7 and the terminal step refer to it as `the End-of-run Run Report` (spec), and it renders from the finalized `token_usage` tally and the phase-timing tally.

- [ ] **Step 1: Update the contract test to pin the new Run Report (red first)**

In `tests/contract.test.js`, replace the entire `test("run skill renders an end-of-run Token Report", () => { ... });` block with:

```javascript
test("run skill renders a unified end-of-run Run Report", () => {
  const f = read("skills/run/SKILL.md");
  // one reusable rendering spec, referenced by name
  assert.match(f, /### End-of-run Run Report/, "defines the unified Run Report spec");
  // three detail sections under one report
  assert.match(f, /Tokens by phase/, "report keeps a per-phase token table");
  assert.match(f, /Timing by phase/, "report folds in per-phase timing");
  assert.match(f, /^Artifacts$/m, "report lists artifacts");
  // status-aware title, both variants
  assert.match(f, /COMPLETE \(clean, no bugs found\)/, "clean title variant");
  assert.match(f, /bugs found \(P0:/, "bugs title variant carries the P-breakdown");
  // token honesty preserved from the old Token Report
  assert.match(f, /Top consumers/, "top-consuming subagents listed");
  assert.match(f, /lower bound/i, "partial coverage described as a lower bound");
  assert.match(f, /Omit a phase row/i, "empty phases omitted, not zero-filled");
  assert.match(f, /sums of the \*\*non-null\*\* values/i, "sums skip null entries");
  // honesty lines ride under the stat header
  assert.match(f, /!\s*Tokens are a lower bound/, "partial-token honesty line");
  assert.match(f, /waves were not semantically verified/, "unverified-waves honesty line");
  // it prints once at the terminal end -- the old per-step Token Report print is gone
  assert.doesNotMatch(f, /full \*\*Token Report\*\* block/, "old per-step Token Report print removed");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/contract.test.js`
Expected: the new `renders a unified end-of-run Run Report` test FAILS (the SKILL still says `### End-of-run Token Report` and still contains `full **Token Report** block`).

- [ ] **Step 3: Rewrite the spec block in `skills/run/SKILL.md`**

Find the block that starts with `### End-of-run Token Report` and ends just before `## Step 1: PRE-FLIGHT` (it includes the intro sentence "Both end-of-run paths ...", the fenced `Token Report` example, and the "Rendering rules:" bullet list). Replace that entire block with:

````markdown
### End-of-run Run Report

The terminal end of a cycle prints one **Run Report** -- a single ASCII block (fixed 60-column width, no Unicode box-drawing, no color) that presents the whole cycle at a glance and then in detail. It is rendered from the finalized `token_usage` tally (above) and the phase-timing tally. It prints once, as the last output before STOP, on every terminal path: the clean run, the bugs-found run after the user declines the re-run, and the git-absent path. It does NOT print on the bugs-found re-run *handoff* path (user picks `Y`) -- that intermediate cycle prints only the compact decision block (Step 6) and hands off; its full tally still lands in `manifest.json`.

Clean run:

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
  Aggregation       0m 18s
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

Bugs-found run -- same skeleton, three deltas: the title reads `plan-runner cycle <n> -- <N> bugs found (P0:<n> P1:<n> P2:<n> P3:<n>)`; the `Bugs` stat shows `<N>`; and the Artifacts block gains `Bug report` and `Fix plan` rows. When any wave was left unverified a second honesty line prints under the stat header: `! <waves_skipped> of <W> waves were not semantically verified (mode: <verify_mode>).`

Rendering rules:

- **Title.** `COMPLETE (clean, no bugs found)` when `total_bugs == 0`; otherwise `<total_bugs> bugs found (P0:<n> P1:<n> P2:<n> P3:<n>)`.
- **Stat header** is a two-column grid of label/value pairs. `Waves` = `W`; `Dev agents` = total dev agents dispatched; `Verifiers` = `<waves_verified>/<W> <verify_mode>`; `Commits` = count of waves with a non-null `commit_sha`; `Duration` = total elapsed, `Xm Ys`; `Tokens` = `token_usage.total_tokens` with thousands separators; `Coverage` = `<agents_reported>/<agents_total> agents`; `Bugs` = `total_bugs`.
- **Honesty lines** (each prefixed `! `) print directly under the stat header, above the tables, and only when they apply:
  - partial token coverage -- printed only when `token_usage.complete` is false; the totals are a lower bound. Wrap at the 60-column width with a two-space hanging indent.
  - unverified waves -- printed only when `verification.waves_skipped > 0`.
- **Tokens by phase** table: group `by_agent` entries by `phase` (`analyze` -> Analyze, `wave` -> Dev, `verify` -> Verify, `aggregate` -> Aggregate); omit a phase row entirely when no subagent was dispatched in that phase (e.g. Aggregate on a zero-bug run). `Agents` = subagents dispatched in the phase; `Reported` = how many surfaced a usage figure. Input / Output / Total are sums of the **non-null** values only, with thousands separators; print `n/a` for a cell where nothing in that phase reported a figure. Never fabricate a number. The `Total` row's Total cell equals `token_usage.total_tokens`. `Top consumers` lists up to 3 agents with the largest non-null `total`, formatted `<agent> (<total>)`; omit the line when no agent reported. The coverage figure is not repeated here -- it lives once, in the stat header.
- **Timing by phase** table lists each phase's elapsed time as `Xm Ys`: Pre-flight, Analyze plan, Wave execution (annotated `(<W> waves)`), Aggregation (omit the row on a zero-bug run, where no aggregator ran), Sync code atlas (mark skipped when git is absent or code-atlas is not present), Open PR (mark skipped when git is absent), and a `Total`. `User confirm` is excluded from the total.
- **Artifacts** always lists `Manifest`; it adds `Bug report` and `Fix plan` rows only when `total_bugs > 0`.
````

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/contract.test.js`
Expected: `renders a unified end-of-run Run Report` PASSES. Other tests may still fail here -- specifically any that reference the old per-step print (they are fixed in Task 2). Note which tests still fail; they should be only Task-2-owned ones. If `SKILL keeps 'clean' honest about verification depth` fails, confirm the `waves were not semantically verified` phrase is present in the new spec.

- [ ] **Step 5: Commit**

```bash
git add skills/run/SKILL.md tests/contract.test.js
git commit -m "Author unified End-of-run Run Report spec

Replace the End-of-run Token Report spec with a single Run Report
rendering: a two-column stat header, honesty lines, the existing
per-phase token table, a per-phase timing table, and an artifacts
block. Token honesty rules (non-null sums, omit-empty-phase, lower
bound, top consumers) are preserved verbatim.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Rewire the three print sites to the Run Report

Slim Step 6's decision block (drop its Token Report print), slim Step 7 (drop its inline summary + Token Report print), and replace the standalone `## Phase Timing Summary` section with a terminal print of the Run Report. Route Step 8's STOP points through it.

**Files:**
- Modify: `skills/run/SKILL.md` (Step 6 "RE-RUN PROMPT", Step 7 "FINAL SUMMARY", Step 8 "OPEN PR", `## Phase Timing Summary`)
- Modify: `tests/contract.test.js` (add placement assertions)

**Interfaces:**
- Consumes: the `### End-of-run Run Report` spec authored in Task 1.
- Produces: exactly one terminal section, `## End-of-run Run Report (terminal print)`, that renders the spec and STOPs; reached from the clean path, the bugs-found `n` path, and the git-absent path, but never the bugs-found `Y` handoff.

- [ ] **Step 1: Slim Step 6's decision block**

In the Step 6 "RE-RUN PROMPT" section, delete this sentence (it appears right after the fenced `[Phase 4/4] Bug Report` decision block):

```markdown
Then print the full **Token Report** block rendered per the "End-of-run Token Report" spec in the Token accounting section (per-phase table, top consumers, coverage line).
```

Replace it with:

```markdown
Do NOT print the full Run Report here -- this block stays compact so the re-run decision is quick. On the `Y` handoff path the token/timing detail is deferred to the next cycle's Run Report and remains recorded in this cycle's `manifest.json`; on the `n` path the full Run Report prints at the terminal end (after the PR step).
```

Leave the convergence hint, the differing-`verify_mode` caveat, the `Y/n` prompt, and both backend branches exactly as they are.

- [ ] **Step 2: Slim Step 7 (clean run)**

In "## Step 7: FINAL SUMMARY (clean run only)", replace the body from "Print:" through the "Then print the full **Token Report** block ..." sentence (i.e. the fenced `plan-runner cycle <cycle_n> complete` block, the `waves_skipped` note, and the Token Report print instruction) with:

```markdown
Reach this step ONLY when total_bugs == 0 (no aggregator dispatched, no re-run prompt).

Do not print a summary here. The clean-run summary now lives in the single End-of-run Run Report printed at the terminal end (its status-aware title reads `COMPLETE (clean, no bugs found)`, and the unverified-waves honesty line covers `verification.waves_skipped > 0`, so a reduced-coverage run still cannot read as fully verified-clean).

Update manifest `completed_at` and write to disk. Proceed to Step 7-bis.
```

Rename the section heading to `## Step 7: FINALIZE (clean run only)` so it no longer promises a summary block. (The Step 6 / Step 7-bis / Step 8 cross-references to "Step 7" by number are unaffected.)

- [ ] **Step 3: Route Step 8's STOP points through the Run Report**

In "## Step 8: OPEN PR":
- In the git-absent branch, change `Then proceed to the Phase Timing Summary and STOP.` to `Then proceed to the End-of-run Run Report (terminal print) and STOP.`
- In the after-PR branch, change `print its confirmation line verbatim and STOP.` to `print its confirmation line verbatim, then proceed to the End-of-run Run Report (terminal print) and STOP.`

- [ ] **Step 4: Replace the Phase Timing Summary section with the terminal Run Report**

Replace the entire `## Phase Timing Summary (always print before STOP unless STOP was an early-exit error)` section (its heading and the fenced `Phase Timing:` block) with:

````markdown
## End-of-run Run Report (terminal print)

Always reached as the last thing before a normal STOP (clean path, bugs-found `n` path, and git-absent path); never reached on the bugs-found `Y` handoff (that cycle STOPs after the handoff) or on an early-exit error STOP.

Compute the per-phase durations from the timestamps recorded through the run (Pre-flight, Analyze plan, Wave execution, Aggregation, Sync code atlas, Open PR) and the `Total`, excluding the User-confirm wait. Then render and print the **End-of-run Run Report** exactly per its spec in the Token accounting section -- status-aware title, two-column stat header, honesty lines, `Tokens by phase` table, `Timing by phase` table (using the durations just computed), and the `Artifacts` block. Then STOP.
````

- [ ] **Step 5: Add placement assertions to the contract test**

Append a new test after the `renders a unified end-of-run Run Report` test:

```javascript
test("Run Report prints once at the terminal end, not per step", () => {
  const f = read("skills/run/SKILL.md");
  // a single terminal print section exists
  assert.match(f, /## End-of-run Run Report \(terminal print\)/, "terminal print section exists");
  // the old standalone timing section is gone
  assert.doesNotMatch(f, /## Phase Timing Summary/, "standalone Phase Timing Summary removed");
  // Step 6 keeps the compact decision block but not the full report
  assert.match(f, /\[Phase 4\/4\] Bug Report/, "Step 6 keeps the compact bug decision block");
  assert.doesNotMatch(f, /"End-of-run Token Report" spec/, "no lingering reference to the old Token Report spec name");
  // clean run defers its summary to the terminal report
  assert.match(f, /Step 7: FINALIZE \(clean run only\)/, "Step 7 finalizes rather than printing a summary");
});
```

- [ ] **Step 6: Run the run-skill tests to verify they pass**

Run: `node --test tests/contract.test.js`
Expected: `renders a unified end-of-run Run Report`, `Run Report prints once at the terminal end, not per step`, and `SKILL keeps 'clean' honest about verification depth` all PASS. The only test expected to still fail is `docs + version reflect the TDD feature` if you have not yet bumped the version -- that is Task 4. If any other test fails, read its message and reconcile the prose before continuing.

- [ ] **Step 7: Commit**

```bash
git add skills/run/SKILL.md tests/contract.test.js
git commit -m "Print the Run Report once at the terminal end

Slim Step 6's re-run decision block and Step 7's clean finalize so
neither prints an inline Token Report, and replace the standalone
Phase Timing Summary with a single terminal Run Report print reached
from the clean, bugs-found-n, and git-absent paths.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Update the README to describe the Run Report

**Files:**
- Modify: `README.md` (the end-of-run reporting paragraph, ~lines 76-84)

**Interfaces:**
- Consumes: nothing from earlier tasks (doc-only). Must stay consistent with the spec authored in Task 1.

- [ ] **Step 1: Rewrite the reporting paragraph**

Change the phrase `the end-of-run Token Report` (in the sentence "... surfaced in the wave dashboards, the end-of-run Token Report, and the PR stats.") to `the end-of-run Run Report`.

Then replace the paragraph that begins "At the end of every run (both the clean path and the bugs-found path) plan-runner prints a **Token Report**: ..." through "... under its `Tokens:` stat." with:

```markdown
At the end of every run (both the clean path and the bugs-found path) plan-runner
prints one **Run Report**: a status-aware title, a two-column at-a-glance stat
header (waves, dev agents, verifiers, commits, duration, tokens, coverage, bugs),
then detail tables -- a per-phase token table (Analyze / Dev / Verify / Aggregate)
with input, output, and total sums, a per-phase reported-coverage column, and a
top-consumers line naming the most expensive subagents; a per-phase timing table;
and an artifacts block. Partial token coverage is flagged as a lower bound and any
unverified waves are called out, both directly under the stat header. The PR body
carries a compact per-phase token breakdown under its `Tokens:` stat.
```

- [ ] **Step 2: Verify README tests still pass**

Run: `node --test tests/contract.test.js`
Expected: `README documents token accounting`, `docs + version reflect the TDD feature` (still on 1.9.0 until Task 4), and `README documents configurable verification coverage` behave as before -- the README edits touch none of their pinned phrases (`## Token accounting`, `token_usage`, `best-effort`, `--no-tdd`, `red-green`, `--verify`, `.plan-runner.yml`, `last-wave-only` all remain). No new failures from this task.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "README: describe the unified Run Report

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Version bump to 1.10.0 and full verification

New pipeline reporting behavior is a minor bump under SemVer. Touch the four release places in one commit, then run the full trio.

**Files:**
- Modify: `.claude-plugin/plugin.json` (`version`)
- Modify: `package.json` (`version`)
- Modify: `tests/contract.test.js` (pinned version assertion)
- Modify: `CHANGELOG.md` (new entry)

**Interfaces:**
- Consumes: the completed prose changes from Tasks 1-3.

- [ ] **Step 1: Bump the pinned version assertion (red first)**

In `tests/contract.test.js`, in `test("docs + version reflect the TDD feature", ...)`, change:

```javascript
  assert.equal(pkg.version, "1.9.0", "plugin version is current");
```

to:

```javascript
  assert.equal(pkg.version, "1.10.0", "plugin version is current");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/contract.test.js`
Expected: `docs + version reflect the TDD feature` FAILS -- `plugin.json` still says `1.9.0`.

- [ ] **Step 3: Bump `plugin.json` and `package.json`**

In `.claude-plugin/plugin.json` set `"version": "1.10.0"`.
In `package.json` set `"version": "1.10.0"`.

- [ ] **Step 4: Add a CHANGELOG entry**

Add a new top entry to `CHANGELOG.md` above the most recent one, matching the file's existing heading style (check the current top entry's format before writing -- mirror it exactly):

```markdown
## 1.10.0

- Unified end-of-run reporting: the former separate final-summary, Token Report, and Phase Timing blocks are now a single **Run Report** -- a two-column at-a-glance stat header (waves, agents, verifiers, commits, duration, tokens, coverage, bugs) followed by per-phase token and timing tables and an artifacts block, printed once at the terminal end of a cycle on both the clean and bugs-found paths. Partial token coverage and unverified waves are surfaced as honesty lines under the stat header. The bugs-found re-run decision block stays compact (no inline Token Report); intermediate `Y` handoff cycles defer token/timing detail to the manifest and the final cycle's report.
```

- [ ] **Step 5: Run the full verification trio**

Run each and confirm the exact expected result:

```bash
node --test tests/contract.test.js
```
Expected: all tests PASS (0 failures), including `renders a unified end-of-run Run Report`, `Run Report prints once at the terminal end, not per step`, `docs + version reflect the TDD feature`, `SKILL keeps 'clean' honest about verification depth`.

```bash
python tests/validate_schemas.py
```
Expected: PASS. (No schema files changed in this plan, so this is a regression guard.)

```bash
claude plugin validate .
```
Expected: validation succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/plugin.json package.json CHANGELOG.md tests/contract.test.js
git commit -m "Release 1.10.0: unified end-of-run Run Report

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Unified report format (stat header + token table + timing table + artifacts, ASCII, both paths) -> Task 1.
- Placement (print once at terminal end; compact decision block on bugs path; no report on `Y` handoff; git-absent path) -> Task 2.
- Behavior change note (intermediate `Y` defers detail) -> captured in Task 1 spec text and Task 2 Step 1.
- Honesty invariants preserved (non-null sums, lower-bound line, unverified-waves line, gate not moved) -> Task 1 spec + contract assertions; no gate edits anywhere.
- Docs updated -> Task 3 (README) + Task 4 (CHANGELOG).
- Out-of-scope items (no schema change, no manifest change, no pipeline/gate change) -> honored; `python tests/validate_schemas.py` runs only as a regression guard.

**Placeholder scan:** No TBD/TODO; every prose block and test block is written out in full.

**Type/name consistency:** The spec is named `### End-of-run Run Report` in Task 1 and referenced by that exact name in Task 2 (Step 6 text, Step 8 routing, terminal section). The terminal section heading `## End-of-run Run Report (terminal print)` is asserted in Task 2 Step 5 and matches Task 2 Step 4. The old names `### End-of-run Token Report`, `full **Token Report** block`, and `## Phase Timing Summary` are removed in Tasks 1-2 and asserted absent. Version `1.10.0` is used consistently across plugin.json, package.json, the pinned test, and the CHANGELOG in Task 4.
