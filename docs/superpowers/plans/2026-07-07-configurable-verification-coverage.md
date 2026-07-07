# Configurable Verification Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `verify_mode` dial (`per-agent` | `per-wave` | `last-wave-only`) — set via `.plan-runner.yml` or a `--verify` flag — that limits how many waves get a semantic verifier, with reduced coverage surfaced honestly everywhere.

**Architecture:** This is a Claude Code plugin whose Markdown prose in `skills/*/SKILL.md` and `agents/*.md` IS the product. "Implementation" means editing orchestration prose; "tests" are the contract tests (`node --test tests/contract.test.js`, which pin exact phrases/regexes in that prose) and the JSON-schema fixture validator (`python tests/validate_schemas.py`). Each task follows red-green: add the failing contract assertion(s), watch them fail, edit the prose to satisfy them, watch them pass, commit.

**Tech Stack:** Markdown (skill/agent prose), JSON Schema (draft 2020-12), Node.js `node:test` (contract tests), Python `jsonschema` (fixture validation), `claude plugin validate`.

## Global Constraints

Copy these exactly; every task's requirements implicitly include them.

- **No emojis in code.** The PR-body banner uses GitHub's native alert syntax (`> [!WARNING]`), not an emoji glyph.
- **Author handle is `MisterVitoPro`** in any project file. Never a real name/email.
- **Three verify commands must all pass before any change is "done":** `node --test tests/contract.test.js`, `python tests/validate_schemas.py`, `claude plugin validate .`.
- **When you edit prose, update the matching contract test in the same change.** When you add a feature, add a contract test that pins it.
- **Honesty invariants (never weaken):** the orchestrator never self-verifies; a *requested* but missing verdict becomes `UNVERIFIABLE` and flows through the fix-plan loop; the verifier-coverage gate stays upstream of the PR step so a PR cannot open while a *requested* verdict is outstanding. `SKIPPED` is an intentional, config-driven absence — distinct from `UNVERIFIABLE`.
- **Pipeline invariants:** max 6 agents per wave; waves file-disjoint; per-wave barrier; dispatch pipeline agents by registered subagent type (`plan-runner:plan-*`), never inline agent bodies; every git op gated on `git_available`; verifier/analyzer stay read-only (`Read, Grep, Glob`).
- **Schema back-compat:** new manifest fields are optional (not in `required`), carry a `"pre-1.9.0"` note in their `description`, and old manifests must still validate. Any `schemas/*.schema.json` change needs matching valid + invalid fixtures.
- **`verify_mode` values are exactly** `per-agent`, `per-wave`, `last-wave-only`. Default is `per-wave`. Precedence: `--verify` flag > `.plan-runner.yml` > default.
- **`.plan-runner.yml`** lives at the target repo root and is a committed user setting (NOT gitignored).
- **`agents/plan-verifier.md` is not modified by this plan.**
- **Target version: 1.9.0** (minor — new pipeline behavior).

**Spec:** `docs/superpowers/specs/2026-07-07-configurable-verification-coverage-design.md`.

**Locating edits:** line numbers below are approximate (prose shifts as you edit). Locate each edit by its section heading (e.g. `## Argument parsing`, `### 4b.`). Read the section before editing so your insert matches surrounding style.

---

## File Structure

- `skills/run/SKILL.md` — orchestrator prose. Gets: `--verify` parsing, a new "Resolve verification mode" pre-flight step, manifest `verification` init, Step 3 estimate, Step 4b/4c/4d/4f verifier branching, Step 5.0 gate wording, Step 6/7 depth-honest summary + re-run handoff.
- `skills/pr/SKILL.md` — PR prose. Gets: read `verification`, draft + banner on skipped waves.
- `schemas/manifest.schema.json` — add optional `verification` object.
- `schemas/examples/manifest-valid.json` — add a `verification` block (keeps validating).
- `tests/contract.test.js` — new assertions per task; version bump in the final task.
- `.claude-plugin/plugin.json`, `package.json`, `CHANGELOG.md`, `README.md` — version bump + docs (final task).

Task order is dependency-safe: the version-bump test stays green (asserts `1.8.3` against `plugin.json` `1.8.3`) until Task 7 flips both together.

---

## Task 1: Resolve `verify_mode` (config file + flag + default)

**Files:**
- Modify: `skills/run/SKILL.md` (frontmatter `argument-hint`; `## Argument parsing`; new `### 1d-quater` before `### 1e`)
- Test: `tests/contract.test.js`

**Interfaces:**
- Produces: a resolved `verify_mode` string (`per-agent` | `per-wave` | `last-wave-only`) stored for later steps; a `verify_mode_flag` captured during argument parsing.

- [ ] **Step 1: Write the failing test**

Add to `tests/contract.test.js`:

```javascript
test("SKILL resolves a configurable verification mode (file + flag + default)", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /per-agent/, "documents per-agent mode");
  assert.match(f, /per-wave/, "documents per-wave mode");
  assert.match(f, /last-wave-only/, "documents last-wave-only mode");
  assert.match(f, /--verify/, "documents the --verify flag");
  assert.match(f, /\.plan-runner\.yml/, "reads the .plan-runner.yml config file");
  // precedence: flag > file > default
  assert.match(f, /--verify[\s\S]{0,120}\.plan-runner\.yml[\s\S]{0,120}(default|per-wave)/i, "precedence flag > file > default");
  assert.match(f, /default.{0,20}per-wave|per-wave.{0,20}default/i, "default is per-wave");
  assert.match(f, /Resolve verification mode/i, "has a dedicated resolve-mode pre-flight step");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/contract.test.js`
Expected: FAIL on the new test (`.plan-runner.yml` / `Resolve verification mode` not found).

- [ ] **Step 3: Update the `argument-hint` frontmatter**

In `skills/run/SKILL.md`, change the frontmatter line (currently):

```
argument-hint: "<path-to-plan.md> [--verbose] [--no-tdd] [--test-cmd \"<cmd>\"]"
```

to:

```
argument-hint: "<path-to-plan.md> [--verbose] [--no-tdd] [--test-cmd \"<cmd>\"] [--verify <mode>]"
```

- [ ] **Step 4: Add the `--verify` flag to `## Argument parsing`**

In the `## Argument parsing` section, add this bullet to the flags list (after the `--test-cmd` bullet):

```
- `--verify <mode>` -- optional verification coverage mode: one of `per-agent`, `per-wave`, `last-wave-only`. Overrides `.plan-runner.yml`. When absent, the config file (or the `per-wave` default) decides. Capture its value as `verify_mode_flag` (unset if the flag is absent).
```

Then, in the paragraph that begins `Set \`verbose = true | false\` based on the flag.`, append a sentence:

```
Capture any `--verify` value as `verify_mode_flag`. Strip all flags (including `--verify <mode>`) before using the plan path.
```

- [ ] **Step 5: Add the `### 1d-quater. Resolve verification mode` step**

Insert this new section immediately BEFORE `### 1e. Initialize manifest`:

```
### 1d-quater. Resolve verification mode

plan-runner's semantic-verifier coverage is configurable via `verify_mode`. Resolve it now, in precedence order:

1. If `verify_mode_flag` is set (the `--verify <mode>` flag), use it.
2. Otherwise, if a `.plan-runner.yml` file exists at the repo root, read it with the Read tool and use its `verification.mode` value. Extract that single key directly -- do NOT depend on a YAML parser being installed. A missing file, a missing `verification.mode` key, or an unreadable file falls through to the next step.
3. Otherwise default to `per-wave`.

Validate the resolved value against the set {`per-agent`, `per-wave`, `last-wave-only`}. If it is anything else, print and STOP:

    Error: invalid verification mode "<value>".
    Valid modes: per-agent, per-wave, last-wave-only.
    Set it in .plan-runner.yml (verification.mode) or pass --verify <mode>.

Print the resolved mode and its source:

    Verification mode: <verify_mode> (from <--verify flag | .plan-runner.yml | default>).

Store `verify_mode` for the manifest (Step 1e) and for Step 3 / Step 4b / Step 5.0 branching.

`verify_mode` controls only the semantic verifier layer:
- `per-wave` (default): one verifier per wave, every wave -- byte-for-byte the current behavior.
- `per-agent`: one verifier per dev agent, every wave (highest scrutiny/cost).
- `last-wave-only`: one verifier on the final wave only; earlier waves are recorded `SKIPPED` (Step 4c) -- an intentional, transparent absence distinct from `UNVERIFIABLE`. The red/green TDD gates (Step 4a-ter) still run on every wave regardless of `verify_mode`; a lower mode drops only the verifier's judgment of that output.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tests/contract.test.js`
Expected: PASS (all tests, including the new one).

- [ ] **Step 7: Commit**

```bash
git add skills/run/SKILL.md tests/contract.test.js
git commit -m "feat(run): resolve verify_mode from .plan-runner.yml + --verify flag

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Manifest `verification` block (schema + fixture + init)

**Files:**
- Modify: `schemas/manifest.schema.json` (add `verification` property)
- Modify: `schemas/examples/manifest-valid.json` (add a `verification` block)
- Modify: `skills/run/SKILL.md` (`### 1e. Initialize manifest` starter JSON)
- Test: `tests/contract.test.js`

**Interfaces:**
- Produces: manifest top-level `verification` = `{mode, waves_total, waves_verified, waves_skipped}`. `waves_total` is `null` at init (wave count unknown pre-analysis) and backfilled once the wave plan is known; `waves_verified`/`waves_skipped` start at `0` and are incremented per wave in Task 3's Step 4f.

- [ ] **Step 1: Write the failing test**

Add to `tests/contract.test.js`:

```javascript
test("manifest schema documents the verification coverage block", () => {
  const schema = JSON.parse(read("schemas/manifest.schema.json"));
  const v = schema.properties.verification;
  assert.ok(v, "manifest schema must define verification");
  assert.ok(v.properties.mode, "verification has a mode");
  assert.deepEqual(
    v.properties.mode.enum,
    ["per-agent", "per-wave", "last-wave-only"],
    "mode enum lists the three modes"
  );
  assert.ok(v.properties.waves_skipped, "verification tracks waves_skipped");
  assert.ok(v.properties.waves_verified, "verification tracks waves_verified");
  assert.match(JSON.stringify(v), /pre-1\.9\.0/, "verification notes pre-1.9.0 back-compat");
  // must be optional (old manifests without it still validate)
  assert.ok(!(schema.required || []).includes("verification"), "verification is optional");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/contract.test.js`
Expected: FAIL (`schema.properties.verification` is undefined).

- [ ] **Step 3: Add the `verification` property to the manifest schema**

In `schemas/manifest.schema.json`, inside `"properties"`, add this property (place it right after the `"backend"` property, keeping valid JSON with a trailing comma as needed):

```json
    "verification": {
      "type": "object",
      "description": "Verification coverage config + per-cycle coverage counters. 'mode' is the resolved verify_mode; 'waves_verified'/'waves_skipped' tally how many waves got a semantic verifier versus an honest SKIPPED (e.g. earlier waves under last-wave-only). Optional for back-compat with manifests written before 1.9.0 (absent => the pre-1.9.0 default of one verifier per wave, full coverage).",
      "required": ["mode"],
      "properties": {
        "mode": {"type": "string", "enum": ["per-agent", "per-wave", "last-wave-only"]},
        "waves_total": {"type": ["integer", "null"]},
        "waves_verified": {"type": "integer"},
        "waves_skipped": {"type": "integer"}
      }
    },
```

Do NOT add `verification` to the top-level `"required"` array — it must stay optional.

- [ ] **Step 4: Add a `verification` block to the valid fixture**

In `schemas/examples/manifest-valid.json`, add this key right after `"backend": "teams",` (line 8):

```json
  "verification": {"mode": "per-wave", "waves_total": 1, "waves_verified": 1, "waves_skipped": 0},
```

Leave `schemas/examples/manifest-invalid.json` unchanged — it must keep failing on its `tdd.enabled` type error, and omitting the optional `verification` is fine.

- [ ] **Step 5: Add the `verification` block to the manifest starter JSON**

In `skills/run/SKILL.md`, in `### 1e. Initialize manifest`, add this line to the starter `manifest.json` object (after the `"backend": "<backend>",` line):

```
  "verification": {"mode": "<verify_mode>", "waves_total": null, "waves_verified": 0, "waves_skipped": 0},
```

Then, in the same step, add a sentence after the starter JSON block:

```
`verification.waves_total` is null at init (the wave count is not known until Step 2 analysis); set it to the total wave count once the wave plan is validated, and increment `waves_verified` / `waves_skipped` per wave in Step 4f.
```

- [ ] **Step 6: Run both validators to verify they pass**

Run: `node --test tests/contract.test.js`
Expected: PASS.

Run: `python tests/validate_schemas.py`
Expected: `PASS: manifest-valid.json validates against manifest.schema.json` and `PASS: manifest-invalid.json correctly rejected`. Exit 0.

- [ ] **Step 7: Commit**

```bash
git add schemas/manifest.schema.json schemas/examples/manifest-valid.json skills/run/SKILL.md tests/contract.test.js
git commit -m "feat(schema): add optional verification coverage block to the manifest

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Verifier dispatch honors `verify_mode` (Steps 3, 4b, 4c, 4d, 4f)

**Files:**
- Modify: `skills/run/SKILL.md` (Step 3 estimate; `### 4b`; `### 4c`; `### 4d`; `### 4f`)
- Test: `tests/contract.test.js`

**Interfaces:**
- Consumes: `verify_mode` (Task 1); manifest `verification` counters (Task 2).
- Produces: for every wave, a `bugs/wave-<W>.json` with a non-null `verifier_status` of `CLEAN` | `BUGS_FOUND` | `UNVERIFIABLE` | `SKIPPED`. `SKIPPED` waves carry only BLOCKED-derived P0 bugs. Token entries labelled `wave-<W>-agent-<n>-verifier` for `per-agent` mode.

- [ ] **Step 1: Write the failing test**

Add to `tests/contract.test.js`:

```javascript
test("SKILL verifier dispatch honors verify_mode (per-agent | per-wave | last-wave-only)", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /verify_mode/, "Step 4b branches on verify_mode");
  assert.match(f, /one verifier per dev agent/i, "per-agent = one verifier per dev agent");
  assert.match(f, /last-wave-only[\s\S]{0,260}(final wave|last wave)/i, "last-wave-only verifies only the final wave");
  assert.match(f, /"verifier_status":\s*"SKIPPED"/, "unverified waves are written SKIPPED");
  // BLOCKED relayed by the orchestrator (not a verifier) on skipped waves, from declared status
  assert.match(f, /BLOCKED[\s\S]{0,240}(declared|dev-reported|dev_status)[\s\S]{0,120}(P0|synthesize)/i, "BLOCKED relayed from dev status on skipped waves");
  // per-agent verifier token label
  assert.match(f, /wave-<W>-agent-<n>-verifier/, "per-agent verifiers get per-agent token labels");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/contract.test.js`
Expected: FAIL (no `verify_mode` branching in Step 4b yet).

- [ ] **Step 3: Update the Step 3 agent estimate**

In `## Step 3: DISPLAY WAVE PLAN`, replace the line:

```
Estimated total agents: <total_dev + <W> verifiers + 2 (analyzer + aggregator)>
```

with:

```
Estimated total agents: <total_dev + <verifier_count> verifiers + 2 (analyzer + aggregator)>
```

and add this sentence immediately after the code block that contains it:

```
`<verifier_count>` depends on `verify_mode`: `per-agent` -> the total dev-agent count (one verifier each); `per-wave` -> `<W>` (one per wave); `last-wave-only` -> `1` (final wave only). Also set `verification.waves_total = <W>` in the manifest now that the wave count is known.
```

- [ ] **Step 4: Rewrite Step 4b to branch on `verify_mode`**

Replace the entire `### 4b. Dispatch wave verifier (single agent, background)` section (heading and body, up to but not including `### 4c.`) with:

```
### 4b. Verify the wave (coverage per `verify_mode`)

Print:

    [Wave <W>] All dev agents complete. Verifying (mode: <verify_mode>)...

Whether this wave gets a semantic verifier depends on `verify_mode` (resolved in Step 1d-quater):
- `per-wave` (default): yes -- one verifier for the whole wave.
- `per-agent`: yes -- one verifier per dev agent.
- `last-wave-only`: only if this is the final wave (`W == total_W`). For any earlier wave, do NOT dispatch a verifier -- jump to "Unverified wave (SKIPPED)" below.

**Dispatch a semantic verifier** via the registered subagent type `plan-runner:plan-verifier` (do NOT inline the agent file). Use `model: sonnet`. Build the per-invocation prompt with the `AGENTS IN THIS WAVE` block, varying only by mode:
- `per-wave`, and the final wave under `last-wave-only`: include ALL dev agents in ONE verifier's `AGENTS IN THIS WAVE` block (the original single-verifier behavior).
- `per-agent`: dispatch N verifiers, one per dev agent, each with a single-agent `AGENTS IN THIS WAVE` block containing only that agent. Label each `wave-<W>-agent-<n>-verifier`.

The per-invocation prompt (unchanged from the single-verifier form, repeated per agent for `per-agent`):

    You are being deployed as the wave verifier for plan-runner cycle <cycle_n>, wave <W>.

    wave_id: <W>

    AGENTS IN THIS WAVE:
    <for each dev agent in scope for this verifier, repeat the block:>
    ---
    agent_id: <agent_id>
    task_title: <task_title>
    acceptance_criteria:
    <acceptance_criteria as bulleted list>

    OWNED FILES (the dev agent was allowed to write these):
    <owned_files joined with newlines>

    DEV AGENT REPORTED:
    - status: <dev_status>
    - files_written: <dev's files_written joined with newlines>
    - files_unexpectedly_modified: <dev's files_unexpectedly_modified joined with newlines>
    - concerns: <dev's concerns joined with newlines>
    - role: <agent role or "standalone">
    - tests_to_satisfy: <impl only: tests_to_satisfy joined with newlines, else "n/a">
    - captured_test_output: |
      <verbatim gate output captured in 4a-ter, or "n/a" for standalone/classic>
    ---
    <end repeat>

    Return only the JSON bug report, nothing else.

**Wait for the verifier(s) to complete (backend-aware).** For `per-agent`, wait for ALL N verifiers. The verdict must come from each verifier's own report -- never from the orchestrator's own reading of the code:

**Backend `subagent` (default):** dispatch each verifier as a background task and wait for its completion notification. Collect each return JSON.

**Backend `teams`:** each verifier runs as a teammate (or a plain subagent referencing the type). Because the team task status lags, do NOT treat "no status update yet" as "no verdict." Deterministically poll each verifier's task result / mailbox with a generous bounded wait, re-reading until the bug-report JSON (its final message) is retrieved. Read the verdict from the task result, not by inferring it.

**No-self-verify rule (both backends, hard requirement):** The orchestrator MUST NOT perform the verification itself, MUST NOT substitute its own judgment for a verifier's report, and MUST NOT advance to 4c / 4e / Step 5 / Step 8 until every dispatched verifier's report is in hand. If the bounded wait genuinely expires without a report, do NOT self-verify to "rescue" the wave: the missing verdict flows into 4c as `UNVERIFIABLE` so the gap routes through the normal verify -> aggregate -> fix-plan -> re-run loop. A late or missing verdict becomes a tracked bug, never a silently-closed wave.

**Unverified wave (SKIPPED).** When `verify_mode` leaves this wave without a semantic verifier (an earlier wave under `last-wave-only`), dispatch no verifier. The orchestrator writes the wave's bug JSON directly in 4c with `verifier_status: "SKIPPED"`, synthesizing only the BLOCKED bugs from dev-reported status:
- For each dev agent whose `dev_status` is `BLOCKED`, synthesize the same P0 `missing_requirement` bug the verifier would (per plan-verifier.md step 1): `title` = `Dev agent BLOCKED: <first concern or 'no reason given'>`, `file` = `<owned_files[0] or 'n/a'>`, `line` = null, `evidence` = "Dev agent could not complete the task", `expected` = "Dev agent should complete all acceptance criteria", `suggested_fix` = `<concerns joined or 'investigate why agent was blocked'>`. This is relayed from the dev's own declared `dev_status`, not a correctness judgment of code -- so it does not violate the No-self-verify rule.
- Every other agent on a SKIPPED wave gets no bug: its code is deliberately not semantically verified in this mode.
```

- [ ] **Step 5: Extend Step 4c for per-agent merge and SKIPPED**

In `### 4c. Write bug JSON`, replace the opening (the "Parse the verifier's return..." paragraph and its synthetic fallback) with:

```
Produce the wave's `bugs/wave-<W>.json` according to how 4b verified it:

**Single-verifier waves (`per-wave`, or the final wave under `last-wave-only`):** parse the verifier's return. If parse fails, synthesize:

    {"wave_id": <W>, "verifier_status": "UNVERIFIABLE", "agent_statuses": {}, "bugs": [{"bug_id": "wave-<W>-bug-1", "severity": "P2", "category": "incorrect_implementation", "title": "Wave verifier returned non-JSON output", "file": "n/a", "line": null, "evidence": "<truncated raw output>", "expected": "Valid JSON bug report", "suggested_fix": "Re-run verification manually"}]}

**Per-agent waves (`per-agent`):** parse each of the N verifier returns (apply the same synthetic UNVERIFIABLE fallback per verifier that fails to parse). Merge into one wave JSON: `bugs` = the union of every verifier's bugs; `agent_statuses` = each agent's own verdict from its verifier; `verifier_status` = `CLEAN` if all agents are clean, `BUGS_FOUND` if any agent has bugs, `UNVERIFIABLE` if any per-agent verifier's report was missing or unparseable.

**Unverified (SKIPPED) waves:** write

    {"wave_id": <W>, "verifier_status": "SKIPPED", "agent_statuses": {<each agent_id>: "BUGS_FOUND" if that agent's dev_status is BLOCKED else "SKIPPED"}, "bugs": [<the BLOCKED bugs synthesized in 4b, may be empty>]}

Write the JSON to `$cycle_dir/bugs/wave-<W>.json`.
```

Then, in the token-capture and teardown paragraphs of 4c, adjust for multiple/zero verifiers. Replace the sentence that begins `Capture the verifier's token usage` with:

```
Capture each dispatched verifier's token usage (see **Token accounting**). Append one `{"agent": "<label>", "phase": "verify", ...}` entry per verifier: `wave-<W>-verifier` for a single-verifier wave, or one `wave-<W>-agent-<n>-verifier` per verifier for a `per-agent` wave. A SKIPPED wave dispatched no verifier, so it appends no `verify` entries. Store the wave's summed verifier tokens as `verifier_tokens` (null when nothing was reported).
```

And replace the teardown sentence (`**Tear down the wave verifier.** ...`) with:

```
**Tear down the wave verifier(s).** Each dispatched verifier's report is now captured -- release it the same way as the dev agents in 4a-bis: `TaskStop` on its background `task_id` (subagent backend) or its teammate agent ID / name (teams backend). For a `per-agent` wave, tear down every verifier. A SKIPPED wave has no verifier to tear down. Do this regardless of `verifier_status` (`CLEAN`, `BUGS_FOUND`, `UNVERIFIABLE`, or `SKIPPED`).
```

- [ ] **Step 6: Note SKIPPED in the Step 4d dashboard**

In `### 4d. Render wave dashboard`, add this sentence after the dashboard table code block:

```
For a SKIPPED wave (unverified under `verify_mode`), the "Wave verifier" line prints `SKIPPED` and "Total bugs" counts only any BLOCKED-derived bugs. For a `per-agent` wave, "Wave verifier" prints the merged wave `verifier_status` and each agent's own verdict appears in the "Status per agent" column.
```

- [ ] **Step 7: Update the Step 4f manifest counters**

In `### 4f. Update manifest`, add this sentence after the wave-entry JSON block:

```
The wave entry's `wave_verifier_status` may now be `SKIPPED`. Also update the top-level `verification` counters: increment `waves_verified` when this wave got a semantic verifier, or `waves_skipped` when it was SKIPPED. Ensure `verification.waves_total` is set to the total wave count.
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test tests/contract.test.js`
Expected: PASS (including the pre-existing self-verify, coverage-gate, and teardown tests — verify they still pass, since Step 4b text changed).

- [ ] **Step 9: Commit**

```bash
git add skills/run/SKILL.md tests/contract.test.js
git commit -m "feat(run): branch wave verification on verify_mode (per-agent/per-wave/last-wave-only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Coverage gate distinguishes `SKIPPED` from `UNVERIFIABLE`

**Files:**
- Modify: `skills/run/SKILL.md` (`### 5.0. Verifier-coverage gate`)
- Test: `tests/contract.test.js`

**Interfaces:**
- Consumes: per-wave `bugs/wave-<W>.json` with a non-null `verifier_status` (Task 3); `verify_mode`.

- [ ] **Step 1: Write the failing test**

Add to `tests/contract.test.js`:

```javascript
test("coverage gate treats SKIPPED as intentional, distinct from UNVERIFIABLE", () => {
  const f = read("skills/run/SKILL.md");
  // SKIPPED is a present, non-null status -> not backfilled, not a bug
  assert.match(f, /SKIPPED[\s\S]{0,240}(does NOT backfill|not.{0,20}backfill|not.{0,25}treat it as a bug)/i, "SKIPPED waves are not backfilled as bugs");
  // in-scope-but-missing verdict still becomes UNVERIFIABLE
  assert.match(f, /in scope for a semantic verifier[\s\S]{0,160}UNVERIFIABLE|UNVERIFIABLE[\s\S]{0,200}(missing|null)/i, "in-scope missing verdict still becomes UNVERIFIABLE");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/contract.test.js`
Expected: FAIL (gate does not yet mention SKIPPED).

- [ ] **Step 3: Add the SKIPPED wording to the coverage gate**

In `### 5.0. Verifier-coverage gate (runs before counting, on every path)`, add this paragraph immediately after the paragraph that describes synthesizing the backfill JSON (after the `Print a warning naming each backfilled wave.` sentence, or right before it — keep it in the gate section):

```
A wave whose bug JSON carries `verifier_status: "SKIPPED"` was intentionally left unverified by `verify_mode` (e.g. an earlier wave under `last-wave-only`). `SKIPPED` is a present, non-null status, so this gate does NOT backfill it and does NOT treat it as a bug. The gate still backfills `UNVERIFIABLE` for any wave that was in scope for a semantic verifier but whose `bugs/wave-<W>.json` is missing or has a null `verifier_status` -- a dispatched verifier that never landed is still a tracked gap, exactly as before. So the "structurally impossible to open a PR while a requested verdict is outstanding" guarantee holds, while an intentional skip stays honest rather than masquerading as clean.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/contract.test.js`
Expected: PASS. Confirm the pre-existing test `"SKILL has a verifier-coverage gate before aggregation"` still passes (the gate heading and ordering are unchanged).

- [ ] **Step 5: Commit**

```bash
git add skills/run/SKILL.md tests/contract.test.js
git commit -m "feat(run): coverage gate distinguishes SKIPPED from UNVERIFIABLE

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Keep "clean" honest about depth (summary, convergence, re-run)

**Files:**
- Modify: `skills/run/SKILL.md` (`## Step 6: RE-RUN PROMPT` re-run handoff + convergence hint; `## Step 7: FINAL SUMMARY`)
- Test: `tests/contract.test.js`

**Interfaces:**
- Consumes: `verify_mode`, manifest `verification.waves_skipped` / `waves_verified` / `waves_total`.

- [ ] **Step 1: Write the failing test**

Add to `tests/contract.test.js`:

```javascript
test("SKILL keeps 'clean' honest about verification depth", () => {
  const f = read("skills/run/SKILL.md");
  // the zero-bug summary must qualify itself when waves were skipped
  assert.match(f, /waves_skipped[\s\S]{0,240}(not.{0,20}semantically verified|not.{0,20}verified)/i, "clean summary qualifies when waves were skipped");
  // the re-run handoff carries the effective mode forward
  assert.match(f, /--verify <verify_mode>|carry.{0,40}verify_mode[\s\S]{0,40}re-run/i, "re-run handoff carries the effective verify_mode");
  // convergence hint acknowledges differing modes
  assert.match(f, /different[\s\S]{0,40}verify_mode|verify_mode[\s\S]{0,60}(shallower|convergence)/i, "convergence hint notes differing verify_mode");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/contract.test.js`
Expected: FAIL.

- [ ] **Step 3: Make the Step 7 clean summary depth-honest**

In `## Step 7: FINAL SUMMARY (clean run only)`, in the summary code block, replace the line:

```
Wave verifiers: <W> (1 per wave)
```

with:

```
Wave verifiers: <waves_verified> of <W> waves (mode: <verify_mode>)
```

Then add this sentence immediately after the summary code block:

```
When `verification.waves_skipped > 0`, append a line to the summary:

    Note: <waves_skipped> of <W> waves were not semantically verified (mode: <verify_mode>) -- "no bugs found" means no issues in the verified waves, not a clean bill for the whole plan.

This keeps a reduced-coverage run from reading as fully verified-clean.
```

- [ ] **Step 4: Carry `verify_mode` into the re-run handoff**

In `## Step 6: RE-RUN PROMPT`, in the `Backend \`subagent\`` re-run handoff prompt, change the `Invoke the Skill tool with:` block so the args carry the mode. Replace:

```
  args: "<absolute path to fix-plan.md>"
```

with:

```
  args: "<absolute path to fix-plan.md> --verify <verify_mode>"
```

and add this sentence after that prompt block:

```
Carry the effective `verify_mode` forward explicitly (via `--verify`) so a `--verify` one-off does not silently revert to the committed `.plan-runner.yml` mode mid-loop, and the re-run's depth is a conscious, recorded choice. On the `teams` backend (in-place re-run), start the next cycle with the same `verify_mode` carried forward.
```

- [ ] **Step 5: Annotate the convergence hint**

In `## Step 6: RE-RUN PROMPT`, after the convergence-hint block (the `(This was cycle <cycle_n>. Cycle <cycle_n - 1> had ...)` text), add:

```
If the previous cycle ran a different `verify_mode`, add: `(verification depth differed between cycles -- a lower bug count may reflect shallower verification, not real convergence.)` A drop in bugs across cycles is only meaningful when both cycles verified at the same depth.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tests/contract.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add skills/run/SKILL.md tests/contract.test.js
git commit -m "feat(run): keep clean summary + re-run honest about verification depth

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: PR drafts + banners when waves were left unverified

**Files:**
- Modify: `skills/pr/SKILL.md` (Step 1 load; Step 5 body; Step 6 draft state)
- Test: `tests/contract.test.js`

**Interfaces:**
- Consumes: manifest `verification` (may be absent on pre-1.9.0 manifests → treat as full coverage, `waves_skipped = 0`).
- Produces: draft PR + a body banner when `verification.waves_skipped > 0`.

- [ ] **Step 1: Write the failing test**

Add to `tests/contract.test.js`:

```javascript
test("pr skill drafts + banners when waves were left unverified", () => {
  const f = read("skills/pr/SKILL.md");
  assert.match(f, /verification/, "pr skill reads the verification block");
  assert.match(f, /waves_skipped/, "pr skill checks waves_skipped");
  assert.match(f, /draft[\s\S]{0,160}waves_skipped|waves_skipped[\s\S]{0,160}draft/i, "skipped waves force a draft PR");
  assert.match(f, /not semantically verified|not verified/i, "PR body banners the unverified waves");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/contract.test.js`
Expected: FAIL.

- [ ] **Step 3: Capture `verification` in Step 1**

In `skills/pr/SKILL.md`, `## Step 1: Load cycle state`, add to the capture paragraph (after `token_usage`):

```
Also capture `verification` (may be absent on pre-1.9.0 manifests, or null). When absent, treat it as `{"mode": "per-wave", "waves_total": <wave count>, "waves_verified": <wave count>, "waves_skipped": 0}` -- i.e. full coverage.
```

- [ ] **Step 4: Add the banner to the PR body (Step 5)**

In `## Step 5: Build the PR body`, in the `Assemble the body as Markdown` template, add a conditional banner as the FIRST lines of the body (before `## Summary`):

```
<if verification.waves_skipped > 0, prepend these lines to the body:>
> [!WARNING]
> Verification: <verification.mode> — <verification.waves_skipped> of <verification.waves_total> waves not semantically verified.
```

Add this sentence after the body template:

```
Omit the verification banner entirely when `verification.waves_skipped` is 0 (full coverage -- nothing to warn about).
```

- [ ] **Step 5: Force draft on skipped waves (Step 6)**

In `## Step 6: Decide draft state`, replace:

```
If `total_bugs > 0`, the PR should be a **draft** (unresolved bugs remain).
Otherwise it is **ready for review**. Set `want_draft = (total_bugs > 0)`.
```

with:

```
Set `want_draft = (total_bugs > 0) OR (verification.waves_skipped > 0)`. Unresolved bugs OR any wave left unverified (a reduced `verify_mode`) makes the PR a **draft**; only a run with zero bugs AND full semantic coverage opens **ready for review**. A reduced-coverage run opens as a draft even with zero bugs -- the work is not fully verified.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tests/contract.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add skills/pr/SKILL.md tests/contract.test.js
git commit -m "feat(pr): draft + banner when a run left waves unverified

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Version bump to 1.9.0 + docs (release protocol)

**Files:**
- Modify: `.claude-plugin/plugin.json` (`version`, `description`)
- Modify: `package.json` (`version`)
- Modify: `CHANGELOG.md` (new 1.9.0 entry)
- Modify: `README.md` (document config + modes + `--verify`)
- Modify: `tests/contract.test.js` (version assertion + README assertion)

**Interfaces:** none (release + docs).

- [ ] **Step 1: Write/adjust the failing tests**

In `tests/contract.test.js`, update the version assertion inside the existing `test("docs + version reflect the TDD feature", ...)`:

```javascript
  assert.equal(pkg.version, "1.9.0", "plugin version is current");
```

Add a new README test:

```javascript
test("README documents configurable verification coverage", () => {
  const readme = read("README.md");
  assert.match(readme, /--verify/, "README documents the --verify flag");
  assert.match(readme, /\.plan-runner\.yml/, "README documents the config file");
  assert.match(readme, /last-wave-only/, "README lists the verification modes");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/contract.test.js`
Expected: FAIL (version is still `1.8.3`; README lacks `--verify`).

- [ ] **Step 3: Bump `.claude-plugin/plugin.json`**

Change `"version": "1.8.3"` to `"version": "1.9.0"`. Then extend the `description` — append this sentence before the final `Final step opens...` sentence:

```
Verification coverage is configurable via a .plan-runner.yml verify_mode (per-agent | per-wave | last-wave-only) or a --verify flag; lower modes verify fewer waves, record the rest as SKIPPED (distinct from UNVERIFIABLE), and force a draft PR with a banner.
```

- [ ] **Step 4: Bump `package.json`**

Change `"version": "1.8.3"` to `"version": "1.9.0"`.

- [ ] **Step 5: Add the `CHANGELOG.md` entry**

Insert at the top of the entries (above `## 1.8.3 - 2026-07-04`):

```markdown
## 1.9.0 - 2026-07-07

- **Configurable verification coverage.** A new `verify_mode` dial controls how many waves get a semantic verifier: `per-agent` (one verifier per dev agent, every wave), `per-wave` (one per wave, every wave -- the default and previous behavior), or `last-wave-only` (verify only the final wave). Set it in a committed `.plan-runner.yml` (`verification.mode`) or per-run with `--verify <mode>`; precedence is flag > file > default.
- **Honest reduced coverage.** Waves left unverified by a lower mode are recorded `SKIPPED` -- a deliberate, transparent absence distinct from `UNVERIFIABLE` (a *requested* verdict that never landed, still a tracked bug). BLOCKED dev agents on a SKIPPED wave still surface a P0, relayed by the orchestrator from the dev's own declared status (no self-verify). The coverage gate leaves SKIPPED alone but still backfills UNVERIFIABLE for an in-scope missing verdict, so a PR still cannot open while a requested verdict is outstanding.
- **Depth-honest surfacing.** The zero-bug summary and cross-cycle convergence hint no longer read as fully verified-clean when waves were skipped; the auto-re-run carries the effective mode forward; and the PR opens as a **draft** with a `[!WARNING]` verification banner whenever any wave was left unverified. The manifest gains an optional `verification` block (`mode` + coverage counters).
```

- [ ] **Step 6: Document it in `README.md`**

In the `**Flags:**` list (under the TDD section), add:

```
- `--verify <mode>` -- verification coverage: `per-agent`, `per-wave` (default), or
  `last-wave-only`. Overrides `.plan-runner.yml`.
```

Then add a new section immediately after the `**Flags:**` list (before `## Code Atlas sync`):

```
## Verification coverage

plan-runner verifies each wave with a read-only verifier agent. How much
verification runs is configurable via `verify_mode`:

- `per-agent` -- one verifier per dev agent, every wave (highest scrutiny, most tokens).
- `per-wave` -- one verifier per wave, every wave. **Default**; the historical behavior.
- `last-wave-only` -- one verifier on the final wave only; earlier waves are recorded
  `SKIPPED`. The cheapest mode.

Set it persistently in a committed `.plan-runner.yml` at the repo root:

```yaml
verification:
  mode: per-wave   # per-agent | per-wave | last-wave-only
```

or per-run with `--verify <mode>` (which overrides the file). Precedence:
`--verify` flag > `.plan-runner.yml` > default (`per-wave`).

`SKIPPED` is an intentional, transparent absence -- distinct from `UNVERIFIABLE`
(a *requested* verdict that never landed, still routed through the fix-plan loop).
A BLOCKED dev agent on a skipped wave still surfaces a P0. Any run that leaves
waves unverified opens its PR as a **draft** with a warning banner, and the
"no bugs found" summary says so -- reduced coverage never masquerades as a clean bill.
```

(Note: the ```yaml fence inside the README block above is literal README content — keep it.)

- [ ] **Step 7: Run all three verification commands**

Run: `node --test tests/contract.test.js`
Expected: PASS (all tests, version now `1.9.0`).

Run: `python tests/validate_schemas.py`
Expected: exit 0, manifest valid/invalid both correct.

Run: `claude plugin validate .`
Expected: validation passes.

- [ ] **Step 8: Commit**

```bash
git add .claude-plugin/plugin.json package.json CHANGELOG.md README.md tests/contract.test.js
git commit -m "chore(release): v1.9.0 -- configurable verification coverage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

After all seven tasks, from a clean tree on the feature branch, run the full suite once more and confirm all three are green:

```bash
node --test tests/contract.test.js
python tests/validate_schemas.py
claude plugin validate .
```

All three must pass before the branch is ready for a PR. Per the repo's release protocol, landing this four-place version-bump commit on `main` via PR triggers the `marketplace-pin` workflow (tag + marketplace bump) automatically — do not hand-tag or hand-edit the marketplace.

## Notes for the implementer

- **The prose IS the product.** A wording change is a behavior change. Match the surrounding style (imperative steps, backticked identifiers, fenced examples). Do not reformat sections you are not changing.
- **Contract tests pin literal phrases.** If you rephrase an insert, the paired assertion must still match — adjust them together, in the same task.
- **Do not touch `agents/plan-verifier.md`.** Per-agent mode reuses its existing "for each dev agent" loop by handing it a one-agent list; no agent-body change is needed.
- **Pre-existing drift (out of scope):** the manifest schema's per-agent `verifier_status`/`bug_count` vs what Step 4f writes. Do not "fix" it here.
```
