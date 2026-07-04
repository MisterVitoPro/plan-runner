---
name: plan-runner:run
description: >
  Run a free-form Markdown implementation plan through a parallel agent swarm with
  per-wave verification. Each cycle: analyze the plan into file-disjoint waves of <=6
  agents, dispatch dev + verifier agents per wave, commit per wave, aggregate bugs at
  the end, and prompt to re-run with the generated fix-plan. Use when the user has a
  Markdown plan they want executed with built-in verification and bug-driven re-planning.
argument-hint: "<path-to-plan.md> [--verbose] [--no-tdd] [--test-cmd \"<cmd>\"]"
---

You are orchestrating a plan-runner pipeline cycle. The user's arguments are:

**"{$ARGUMENTS}"**

Follow this pipeline exactly. Do not skip steps.

## Argument parsing

Tokenize `{$ARGUMENTS}` on whitespace. The first non-flag token is the plan path. Flags:
- `--verbose` -- if present, the analyzer emits per-wave `rationale` and per-agent `complexity_signals`. If absent, those fields are omitted (default; smaller analyzer output).
- `--no-tdd` -- if present, disable TDD and run the classic (non-TDD) pipeline. Set `tdd_enabled = false`. TDD is ON by default; this flag is the only way to turn it off.
- `--test-cmd "<cmd>"` -- optional explicit test command. May include a `{file}` placeholder for single-file runs (e.g. `pytest {file}`). When provided, it is used verbatim and detection is skipped.

Set `verbose = true | false` based on the flag. Capture any `--test-cmd` value as `test_cmd_flag`. Set `tdd_enabled = false` if `--no-tdd` is present, otherwise `tdd_enabled = true` (TDD is auto-enabled by default -- never prompt for it). Strip all flags before using the plan path.

## Timing

Track elapsed time for each phase. At the start of each step run `date +%s` and store the timestamp. Compute durations at the end and write to `manifest.json`.

## Token accounting

plan-runner tallies the tokens consumed by every subagent it dispatches (analyzer, dev agents, wave verifiers, aggregator) so `manifest.json` carries a per-agent breakdown and a grand total for the whole cycle. This is the foundation for tallying the full run's token cost.

There is no tool that returns a subagent's token count directly. The only source is the usage figure the harness surfaces when a subagent finishes, so capture is **best-effort**:

- When a subagent completes, read the token usage reported in its completion result (the Task/Agent result's usage summary, e.g. input/output token counts). Record it as `{"input": <n>, "output": <n>, "total": <input + output>}`.
- If only a single combined total is surfaced, record `{"input": null, "output": null, "total": <n>}`.
- If the harness surfaces no usage figure for that subagent, record `tokens: null` and count the agent as unreported.

On the `teams` backend a teammate's usage may not be visible to the lead; record `null` for those. **Never fabricate a token count** -- a `null` with an honest coverage number is the correct outcome when the figure is unavailable.

Maintain a running `token_usage` tally in memory across the whole cycle and write it to the manifest at finalization (Step 5 / Step 7):

```json
{
  "by_agent": [
    {"agent": "analyzer", "phase": "analyze", "input": <n|null>, "output": <n|null>, "total": <n|null>}
  ],
  "total_tokens": <sum of every non-null per-agent total>,
  "agents_reported": <count of subagents that surfaced a usage figure>,
  "agents_total": <count of subagents dispatched this cycle>,
  "complete": <agents_reported == agents_total>
}
```

Append one `by_agent` entry per dispatched subagent: the analyzer (Step 2), every dev agent (Step 4a), every wave verifier (Step 4b), and the aggregator (Step 5). `agent` is the subagent label (`analyzer`, `wave-<W>-agent-<n>`, `wave-<W>-verifier`, `aggregator`); `phase` is one of `analyze | wave | verify | aggregate`.

### End-of-run Token Report

Both end-of-run paths -- the Step 6 bug report and the Step 7 final summary -- print a full **Token Report** rendered from the finalized `token_usage`:

```
Token Report
============================================================
 Phase     | Agents | Reported | Input    | Output   | Total
-----------|--------|----------|----------|----------|----------
 Analyze   |      1 |      1/1 |   12,345 |    2,345 |   14,690
 Dev       |      8 |      7/8 |  201,558 |   40,120 |  241,678
 Verify    |      3 |      3/3 |   88,410 |   12,077 |  100,487
 Aggregate |      1 |      1/1 |   20,115 |    4,882 |   24,997
-----------|--------|----------|----------|----------|----------
 Total     |     13 |    12/13 |  322,428 |   59,424 |  381,852

Top consumers: wave-2-agent-1 (64,201), wave-1-verifier (41,388), analyzer (14,690)
Coverage: 12/13 subagents reported usage -- totals are a lower bound (partial)
```

Rendering rules:
- Group `by_agent` entries by `phase`: `analyze` -> Analyze, `wave` -> Dev, `verify` -> Verify, `aggregate` -> Aggregate. Omit a phase row entirely when no subagent was dispatched in that phase (e.g. Aggregate on a zero-bug run).
- `Agents` = subagents dispatched in the phase; `Reported` = how many surfaced a usage figure.
- Input / Output / Total columns are sums of the **non-null** values only, with thousands separators. Print `n/a` for a cell where nothing in that phase reported a figure. Never fabricate a number.
- `Top consumers` lists up to 3 agents with the largest non-null `total`, formatted `<agent> (<total>)`. Omit the line when no agent reported.
- The Coverage line prints `Coverage: <N>/<N> subagents reported usage -- complete` when every subagent reported; otherwise the lower-bound wording shown above.
- The `Total` row's Total cell equals `token_usage.total_tokens`.

## Step 1: PRE-FLIGHT

Record the pipeline start time: `t_start = $(date +%s)`.

### 1a. Validate plan file

Parse the argument as a file path. If the path is empty or the file does not exist:

```
Error: plan file not found: <path>

Usage: /plan-runner:run <path-to-plan.md>
Example: /plan-runner:run docs/foo/feature.md
```

Then STOP.

Read the plan file. Store its contents in memory. If the file is empty, print:

```
Error: plan file is empty: <path>
```

Then STOP.

### 1a-bis. TDD enablement

TDD is auto-enabled. Do NOT prompt the user.

- If `--no-tdd` was passed: `tdd_enabled` is already `false`; print `TDD disabled (--no-tdd). Running classic pipeline.`
- Otherwise: `tdd_enabled` is already `true`; print `TDD red-green enabled (default). Testable tasks get a failing test first (red), then implementation makes it pass (green). Use --no-tdd to run the classic pipeline.`

### 1b. Compute cycle directory

1. Compute `DATE=$(date +%Y-%m-%d)`.
2. Set `cycle_root = "docs/plan-runner/$DATE/"`.
3. If `cycle_root` does not exist, set `cycle_n = 1`.
4. Otherwise, list existing `cycle-*` directories under `cycle_root` and set `cycle_n = max(N) + 1`. Use Glob to find them.
5. Set `cycle_dir = "$cycle_root/cycle-$cycle_n/"`.
6. Create `cycle_dir/bugs/`:

```bash
mkdir -p "$cycle_dir/bugs"
```

### 1b-bis. Detect git availability

Run `git rev-parse --is-inside-work-tree 2>/dev/null`. If the command succeeds and prints `true`, set `git_available = true`. Otherwise -- git is not installed, or the working directory is not a git repository -- set `git_available = false`.

If `git_available` is false, print:

```
Git not detected (no git binary or not a git repository). plan-runner will run
without any git operations: no clean-tree check, no per-wave commits, and no PR
step. Generated artifacts remain in the cycle directory.
```

Store `git_available` for the manifest and for the conditional git steps below (1c, 4e, 7-bis, and 8). When `git_available` is false, every step that runs `git` is skipped as noted in that step.

### 1c. Pre-flight clean tree check

If `git_available` is false, skip this step entirely (no working tree to check).

Run `git status --porcelain`. If output is non-empty:

```
Warning: working tree has uncommitted changes:
<git status output>

plan-runner commits per wave. If a wave fails mid-pipeline, recovery is easier
from a clean tree. Recommend: commit or stash first.

Continue anyway? (Y/n)
```

Wait for user input. If `n` (or empty default), STOP. If `Y`, continue.

### 1c-bis. Pick analyzer model (structure heuristic)

Before dispatching the analyzer, compute a cheap structure score on the plan contents:

- `task_boundary_count` = number of lines matching `^## ` OR `^### Task` OR `^Task \d+:` (case-sensitive).
- `path_token_count` = number of tokens matching `(?:[\w.-]+/)+[\w.-]+\.[A-Za-z0-9]{1,5}` (path segments with a file extension).

Use the Bash tool with `awk` / `grep -c` to count -- do NOT read the plan into your own context twice.

Decision:
- If `task_boundary_count >= 2` AND `path_token_count >= 2` AND `path_token_count >= task_boundary_count`: set `analyzer_model = "haiku"`. The plan is well-structured; DAG inference is mostly mechanical.
- Otherwise: set `analyzer_model = "sonnet"`.

Print one of:
```
Plan structure detected (N task markers, M explicit paths) -- using haiku for analyzer.
Plan is free-form -- using sonnet for analyzer.
```

### 1d. Detect Context7 MCP

Check whether the tools `mcp__context7__resolve-library-id` and `mcp__context7__query-docs` are available in this session. Set `context7_available = true | false`.

If true: print `Context7 MCP detected -- dev agents will use it for current framework docs.`
If false: print `Context7 MCP not detected -- dev agents will rely on training data only.`

### 1d-ter. Select execution backend

plan-runner can run wave execution two ways. Pick the backend now:

1. Read the env var with Bash: `printenv CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`.
2. If the value is exactly `1` AND this Claude Code session exposes Agent Teams tooling (team task list + teammate spawning, Claude Code v2.1.178+), set `backend = "teams"`. Otherwise set `backend = "subagent"`.
3. Print one of:

```
Agent Teams enabled -- using team backend (lean orchestration, lower token usage).
```
```
Agent Teams not enabled -- using subagent backend. Set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 (Claude Code v2.1.178+) for lower token usage.
```

If the env var is set to `1` but team tooling is not available (older build), do NOT error -- fall back to `backend = "subagent"` and print the second message with a note that the build is too old.

Store `backend` for the manifest and for Step 4 / Step 6 branching.

### 1d-bis. Resolve test command + green baseline (only if tdd_enabled)

If `tdd_enabled` is false, skip this step entirely.

**Resolve the command** in priority order:
1. If `test_cmd_flag` is set, use it. If it contains `{file}`, that is the single-file form; derive the full form by removing the `{file}` token AND any now-dangling argument separator or trailing whitespace (e.g. `npm test -- {file}` -> `npm test`, `pytest {file}` -> `pytest`). Otherwise treat it as the full form and derive a single-file form if the runner supports it.
2. Otherwise detect from repo markers (use Glob/Read, do not guess blindly):
   - `package.json` with `scripts.test` -> full: `npm test`, single-file: `npm test -- {file}`
   - `pytest.ini` / `pyproject.toml` / `setup.cfg` with pytest -> full: `pytest`, single-file: `pytest {file}`
   - `go.mod` -> full: `go test ./...`, single-file: `go test ./{dir}`
   - `Cargo.toml` -> full: `cargo test`, single-file: `cargo test {mod}`
   - `*.csproj` / `*.sln` -> full: `dotnet test`, single-file: `dotnet test --filter {file}`
3. If detection is ambiguous or finds nothing, prompt the user once:

```
No test command detected. Enter the test command (use {file} for single-file runs),
or press Enter to STOP (re-run with --no-tdd for the classic pipeline):
```

   If the user supplies a command, use it. **If the user enters nothing, STOP** with:

```
No test command available -- cannot run TDD gates.
Re-run with --no-tdd to use the classic pipeline.
```

   Do NOT silently downgrade to classic.

**Capture the green baseline.** Run the full test command via Bash. Record the set of currently-failing test identifiers as `baseline_failing` (empty if the suite is green). If the suite is already red, print a warning that the baseline is not clean and that the listed failures will be subtracted when attributing new failures.

Store the resolved command (both forms) and `baseline_failing` for the manifest `tdd` block.

### 1e. Initialize manifest

Write a starter `manifest.json` to `$cycle_dir/manifest.json`:

```json
{
  "cycle": <cycle_n>,
  "input_plan": "<plan path>",
  "started_at": "<ISO 8601 from `date -Iseconds`>",
  "completed_at": null,
  "context7_available": <bool>,
  "git_available": <bool>,
  "backend": "<backend>",
  "waves": [],
  "total_bugs": 0,
  "token_usage": null,
  "next_cycle_plan": null,
  "code_atlas_sync": null,
  "tdd": {
    "enabled": <tdd_enabled>,
    "test_command": {"full": "<resolved full or null>", "single_file": "<resolved single-file or null>"},
    "baseline_failing": [<baseline ids>],
    "tasks": []
  }
}
```

(When `tdd_enabled` is false, write `"tdd": {"enabled": false}` and omit the other keys.)

Record `t_preflight_done = $(date +%s)`.

## Step 2: ANALYZE PLAN

Print:
```
[Phase 1/4] Analyzing plan and computing wave plan...
```

Prepare the plan contents with 1-indexed line-number prefixes. Using Bash:

```bash
awk '{printf "%4d\t%s\n", NR, $0}' "<plan path>"
```

Capture the result as `PLAN_WITH_LINES`.

Dispatch ONE analyzer via the **registered subagent type `plan-runner:plan-analyzer`**. Do NOT inline the agent file -- the definition body loads automatically as the agent's system prompt. Pass ONLY the per-invocation parameters:

```
You are being deployed as the plan-analyzer for plan-runner cycle <cycle_n>.

Source plan path: <plan path>
Context7 available: <bool>
Verbose: <verbose>
TDD enabled: <tdd_enabled>
Test command: <resolved single-file form, or "n/a"> (full: <resolved full form, or "n/a">)

PLAN CONTENTS (1-indexed line-number prefixes):
<<<
<PLAN_WITH_LINES inlined here>
>>>

Return only the JSON wave plan, nothing else.
```

Run the agent in foreground (you need its output to proceed). Use `model: <analyzer_model>` from step 1c-bis (that field applies to the analyzer itself; per-task `recommended_model` applies to dev agents downstream).

When the agent returns, parse the JSON. If parsing fails:
- Retry ONCE by **continuing the SAME analyzer session** -- send the follow-up via `SendMessage` to the analyzer's returned agent id; do NOT dispatch a fresh analyzer. The phrase "your previous response" only resolves against the session that produced it, and a fresh spawn would have to resend the entire plan text again (wasteful for large plans). Follow-up message: "Your previous response could not be parsed as JSON. Return ONLY a single JSON object matching wave-plan.schema.json, with no prose before or after."
- If second attempt also fails, print the agent's raw output and STOP.

Validate the wave plan:
1. Conforms to the plugin's `schemas/wave-plan.schema.json` (under the plugin root, i.e. `${CLAUDE_PLUGIN_ROOT}/schemas/wave-plan.schema.json`; use Python+jsonschema if available; otherwise structural check: required fields present, agent counts <=6, file paths unique within each wave). Note that `rationale` and `complexity_signals` are optional -- do NOT fail validation if they are absent.
2. Within each wave, the union of `owned_files` across all agents has no duplicates.
3. Every agent has a `task_excerpt_lines` matching `^[0-9]+-[0-9]+$` where START <= END and END <= total lines in the plan file.

If validation fails, print the failure reason and STOP. Do NOT auto-retry beyond what is specified above (avoid infinite loops).

If `waves` is empty:
```
Plan analysis returned 0 waves. Reason: <uncovered_plan_sections joined>
No tasks to execute. STOP.
```
Then STOP.

Write the wave plan to `$cycle_dir/wave-plan.json`.

Capture the analyzer's token usage (see **Token accounting**) and append it to `token_usage.by_agent` as `{"agent": "analyzer", "phase": "analyze", ...}`.

Record `t_analyze_done = $(date +%s)`.

## Step 3: DISPLAY WAVE PLAN

Print the wave plan in human-readable form:

```
Wave Plan (<W> waves, <total_agents> dev agents total)
========================================================
Wave 1 (<N> agents, parallel):
  agent-1 [test]        : <task_title>   -> <owned_files joined with comma>
  agent-2 [impl]        : <task_title>   -> <owned_files joined with comma>
  agent-3 [standalone]  : <task_title>   -> <owned_files joined with comma>
  ...

Non-testable tasks (will run without a test gate):
  - <task_title>: <non_testable_reason>     (one line per standalone task with a reason)

Uncovered plan sections: <sections or "none">
Estimated total agents: <total_dev + <W> verifiers + 2 (analyzer + aggregator)>
```

If `uncovered_plan_sections` is non-empty, print a warning that those sections will not be executed and the user can re-run with a revised plan after this cycle completes.

The bracketed tag is the agent `role` (`test`, `impl`, or `standalone`). In classic (non-TDD) runs, agents have no role and the tag is omitted. The "Non-testable tasks" block lists standalone agents that carry a `non_testable_reason`, so the user can challenge a mis-classification before execution.

Proceed automatically without waiting for user input.

Record `t_confirmed = $(date +%s)`.

(Continued in Step 4: WAVE EXECUTION)

## Step 4: WAVE EXECUTION

Wave execution honors the `backend` chosen in Step 1d-ter. Both backends keep the same per-wave barrier (dispatch -> wait for all -> TDD gates -> verify -> commit -> next wave); they differ only in how dev agents are dispatched and how their results are collected (4a). Teardown (4a-bis), gates (4a-ter), verification (4b), bug JSON (4c), dashboard (4d), commit (4e), and manifest (4f) are identical for both.

For each wave in `wave_plan.waves` (sequentially):

Print:
```
[Phase 2/4] Wave <W>/<total_W>: dispatching <N> dev agents in parallel...
```

Record `t_wave_<W>_start = $(date +%s)`. If `git_available` is true, also record `wave_start_sha=$(git rev-parse HEAD)` -- the rogue-commit guard (below) and the wave commit (4e) compare against it. If `git_available` is false, leave `wave_start_sha` unset and skip every check that references it.

### 4a. Dispatch dev agents (parallel)

**Select the registered subagent type by the wave-plan `role` field** (in classic / non-TDD runs there is no `role` -- treat every agent as an impl/standalone dev agent and use `plan-runner:plan-dev`). Do NOT inline agent `.md` bodies -- referencing the type loads the definition as the agent's system prompt automatically and keeps each prompt small:

- `role: "test-author"` -> subagent type `plan-runner:plan-test-author`; include the resolved `test_command` so it can match the test framework/style.
- `role: "impl"` -> subagent type `plan-runner:plan-dev`; include a `TESTS TO SATISFY` block listing the agent's `tests_to_satisfy`.
- `role: "standalone"` or no role (classic) -> subagent type `plan-runner:plan-dev` with no `TESTS TO SATISFY` block.

Common per-invocation prompt template (parameters only -- the agent body comes from its registered definition):

```
You are being deployed as a dev agent for plan-runner cycle <cycle_n>, wave <W>.

agent_id: <agent_id>
task_title: <task_title>
plan_path: <absolute path to the source plan>
task_excerpt_lines: <task_excerpt_lines>
context7_available: <bool>
<if role == "test-author": "test_command: <single-file form> (full: <full form>)">

OWNED FILES (you may write only these):
<owned_files joined with newlines>

ACCEPTANCE CRITERIA:
<acceptance_criteria joined with newlines, prefixed with "- ">
<if role == "impl": a "TESTS TO SATISFY (make these pass; do not edit them):" block listing tests_to_satisfy, one per line>

Return only the JSON status, nothing else.
```

The agent reads the task prose from `plan_path` using the line range -- the orchestrator does not inline the task text. This keeps prompts small and lets multiple agents in a wave share one cached plan read. Use the `recommended_model` from the wave-plan for each agent.

Dispatch depends on `backend`:

**Backend `subagent` (default):** Create one Claude Task per dev agent for live UI progress (TaskCreate). In a SINGLE message, dispatch all dev agents in this wave with `run_in_background: true`, each using its role-selected `subagent_type` and the per-invocation prompt above. As each background agent completes, the orchestrator receives a notification; collect all dev agent return JSONs.

**Backend `teams`:** The session is the team lead.
1. Create one task on the shared team task list per wave-plan agent, embedding the per-invocation prompt parameters (agent_id, task_title, plan_path, task_excerpt_lines, owned files, acceptance criteria, role-specific blocks) in the task detail. Give the wave's tasks no unmet dependencies so they are all immediately claimable (cross-wave ordering is enforced by the lead opening one wave at a time, not by global DAG edges).
2. Spawn one teammate per task (honor the <=6-per-wave cap), each referencing the role-selected `subagent_type` and the role's `recommended_model`. Teammates self-claim the wave's tasks.
3. Read teammate progress from the task list / mailbox -- do NOT pull full JSON returns into the lead context. Each teammate records its final JSON status as its task result / final message.

For each dev agent return (both backends):
1. Parse the JSON. If parse fails, treat as `{"agent_id": "<id>", "status": "BLOCKED", "files_written": [], "files_unexpectedly_modified": [], "context7_queries": [], "summary": "agent returned non-JSON output", "concerns": ["unparseable response"]}` and continue.
2. Update the corresponding Task to `completed`.
3. Record the dev_status in a wave-state map.
4. Capture the agent's token usage (see **Token accounting**) and store it in the wave-state map keyed by `agent_id`. Append it to `token_usage.by_agent` as `{"agent": "<agent_id>", "phase": "wave", ...}` (use `tokens: null` if the harness surfaced no figure -- common for teammates on the `teams` backend).

**Wave barrier (both backends):** Wait for ALL dev agents/teammates in this wave to complete before proceeding. On the `teams` backend, if a task is stuck past a bounded wait (the known task-status-lag issue), read the owned-file state directly, treat any unreported teammate as `BLOCKED`, print a warning, and proceed to gates -- the gap then flows through the normal verify -> aggregate -> fix-plan loop rather than hanging the pipeline.

**Rogue-commit guard (both backends, only if `git_available` is true):** Dev agents are forbidden from committing, but one that disobeys leaves a clean working tree that makes its work look undone. Before treating any dev agent as silent-failed (missing return, empty owned-file diff, no working-tree changes) -- and before dispatching any retry or replacement agent for it -- run `git log --oneline <wave_start_sha>..HEAD -- <owned_files>` scoped to that agent's owned files. If commits appear, the agent rogue self-committed: the work counts as delivered, so do NOT dispatch a retry agent. Print a warning naming the agent and the rogue commit SHA(s), record the SHAs in the wave-state map, and let the wave verifier (4b) judge the content exactly as it would judge uncommitted work. Judging by working-tree diff alone is not sufficient evidence that an agent did nothing.

### 4a-bis. Tear down wave dev agents

A finished dev agent does not exit on its own -- it stays resident (an idle background task or an idle teammate) until explicitly stopped. As soon as the wave barrier above is satisfied and every dev agent's return has been captured, tear each one down immediately, before dispatching the wave verifier (4b):

- **Backend `subagent`:** call `TaskStop` with the background `task_id` created for that agent in 4a.
- **Backend `teams`:** call `TaskStop` with the teammate's agent ID (`name@team`) or bare teammate name.

Tear down every dev agent in the wave, regardless of `dev_status` (`DONE` or `BLOCKED`) -- a blocked agent still holds its process open. If `TaskStop` reports the task already gone, treat that as success; there is nothing left to release. Do this for every wave, not only the last one -- letting agents from wave 1 idle until the whole cycle ends wastes resources for the run's entire duration.

### 4a-ter. Run gates (only if tdd_enabled)

If `tdd_enabled` is false, skip this step (classic pipeline).

Gates are applied **per agent**, by `role`, because a single wave may mix test-author, impl, and standalone agents. For each agent in the wave, run the matching gate via Bash and capture verbatim output. There are **No inline retries** -- every gate failure is recorded as captured output for the verifier and surfaces as a bug routed through the normal aggregate -> fix-plan -> re-run loop.

**Test-author agent (role: test-author) -> RED gate:**
1. For each file in the agent's reported `test_files`, run the single-file test command (substitute `{file}`). Capture exit code + output.
2. Run the full suite; diff the failing-test set against `tdd.baseline_failing`.
3. Record `red_run` = `{cmd, exit, result: exit != 0 ? "FAILED" : "PASSED", valid_red: null}`. Leave `valid_red` null here -- the orchestrator cannot tell a genuine failure (import / not-implemented / assertion) from an invalid one (syntax / collection error) without analysis. The red-gate verifier (Step 4b) makes that call; backfill `valid_red` in the manifest from the verifier's verdict after 4b.
4. This agent's `captured_test_output` (for the verifier) = the per-file run output (all `test_files`) + any new pre-existing failures from the suite diff.

**Impl agent (role: impl) -> GREEN gate:**
1. For each file in the agent's `tests_to_satisfy`, run the single-file test command (substitute `{file}`). Capture exit + output per file.
2. Run the full suite; diff against `tdd.baseline_failing` to detect newly-broken pre-existing tests.
3. Record `green_run` = `{cmd, exit, result: all target files passed ? "PASSED" : "FAILED"}`.
4. `captured_test_output` = the per-file `tests_to_satisfy` run output + any new suite failures.

**Standalone agent (role: standalone or classic):** no gate; `captured_test_output` is empty.

**Append evidence to the manifest `tdd.tasks` array** (one entry per testable task, keyed by `task_title`): `{task, test_files, red_run, green_run}`. The red_run is filled when the test-author wave runs; green_run when the paired impl wave runs (match by task_title / tests_to_satisfy).

**Invalid red (paired impl skipped):** if the red gate shows the new tests PASSED (exit 0 -- the orchestrator detects this directly) OR the red-gate verifier judged the red invalid (syntax / collection error), do NOT dispatch the paired impl agent -- mark it BLOCKED with reason "paired test red gate invalid" and set `valid_red: false` for that task in the manifest. The verifier still emits the P1 bug from the captured output, which flows to the next cycle.

### 4b. Dispatch wave verifier (single agent, background)

Print:
```
[Wave <W>] All dev agents complete. Dispatching wave verifier...
```

Dispatch ONE verifier for the entire wave via the **registered subagent type `plan-runner:plan-verifier`** (do NOT inline the agent file). On the `teams` backend this may be a teammate or a plain subagent; either way reference the type rather than inlining. Include all dev agents' data in the per-invocation prompt:

```
You are being deployed as the wave verifier for plan-runner cycle <cycle_n>, wave <W>.

wave_id: <W>

AGENTS IN THIS WAVE:
<for each dev agent, repeat this block:>
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
```

Use `model: sonnet`.

**Wait for the verifier to complete (backend-aware).** The verdict must come from the verifier's own report -- never from the orchestrator's own reading of the code:

**Backend `subagent` (default):** dispatch the verifier as a background task and wait for its completion notification. Collect its return JSON.

**Backend `teams`:** the verifier runs as a teammate (or a plain subagent referencing the type). Because the team task status lags, do NOT treat "no status update yet" as "no verdict." Instead **deterministically poll the verifier's task result / mailbox** with a generous bounded wait, re-reading the task result until the verifier's bug-report JSON (its final message) is actually retrieved. Read the verdict *from the task result*, not by inferring it.

**No-self-verify rule (both backends, hard requirement):** The orchestrator MUST NOT perform the verification itself, MUST NOT substitute its own judgment for the verifier's report, and MUST NOT advance to 4c / 4e / Step 5 / Step 8 until the verifier's report is in hand. If the bounded wait genuinely expires without a report, do NOT self-verify to "rescue" the wave: mark the wave `verifier_status = UNVERIFIABLE` (use the 4c synthetic-bug fallback) so the gap flows through the normal verify -> aggregate -> fix-plan -> re-run loop. A late or missing verdict becomes a tracked bug, never a silently-closed wave.

### 4c. Write bug JSON

Parse the verifier's return. If parse fails, synthesize:
```json
{"wave_id": <W>, "verifier_status": "UNVERIFIABLE", "agent_statuses": {}, "bugs": [{"bug_id": "wave-<W>-bug-1", "severity": "P2", "category": "incorrect_implementation", "title": "Wave verifier returned non-JSON output", "file": "n/a", "line": null, "evidence": "<truncated raw output>", "expected": "Valid JSON bug report", "suggested_fix": "Re-run verification manually"}]}
```

Write the JSON to `$cycle_dir/bugs/wave-<W>.json`.

Capture the verifier's token usage (see **Token accounting**), store it as the wave's `verifier_tokens`, and append it to `token_usage.by_agent` as `{"agent": "wave-<W>-verifier", "phase": "verify", ...}`.

**Tear down the wave verifier.** Its report is now captured -- release it the same way as the dev agents in 4a-bis: `TaskStop` on its background `task_id` (subagent backend) or its teammate agent ID / name (teams backend). Do this regardless of `verifier_status` (`CLEAN`, `BUGS_FOUND`, or `UNVERIFIABLE`) -- an unverifiable run still leaves a process to release.

### 4d. Render wave dashboard

Print a wave summary table. The "Verify" and "Bugs" columns reflect the single wave verifier result (the verifier_status and total bugs across all agents):

```
Wave <W>/<total_W> complete (<duration>s)
============================================================
 Agent | Task                       | Dev          | Status per agent
-------|----------------------------|--------------|------------------
   1   | <task_title>               | DONE         | <agent_statuses[agent_id]>
   2   | <task_title>               | DONE         | <agent_statuses[agent_id]>
   3   | <task_title>               | BLOCKED      | <agent_statuses[agent_id] or N/A>
-------|----------------------------|--------------|-----------------
Wave verifier: <verifier_status>   Total bugs: <bugs array length>
Wave tokens: <wave_token_total or "n/a"> (<reported>/<dispatched> agents reported)
============================================================
```

`wave_token_total` is the sum of every non-null per-agent and verifier `total` in this wave; print `n/a` when nothing was reported. `<reported>/<dispatched>` is how many of this wave's subagents (dev agents + verifier) surfaced a usage figure.

### 4e. Commit the wave

If `git_available` is false, skip this step: set `commit_sha = null` and `skipped_reason = "git not available"` in the manifest entry, print `Wave <W>: git not available -- skipping commit.`, and continue to the next wave. Do NOT run any `git` command.

Otherwise (git is available):

Compute verifier-status summary for the commit message:
- If all verifiers returned CLEAN: `"verified clean"`
- If any verifier returned BUGS_FOUND: `"<total_bugs> bugs flagged"`
- If any verifier returned UNVERIFIABLE: append `"<N> unverifiable"`

Run:
```bash
git add -A
git status --porcelain | head -1   # check if there's anything to commit
```

If the working tree is clean, do NOT immediately conclude the wave is empty -- first check for rogue self-commits: run `git log --oneline <wave_start_sha>..HEAD`. If commits exist, the wave's work was self-committed by dev agents. Set `commit_sha = $(git rev-parse HEAD)`, `skipped_reason = "self-committed by dev agents (rogue)"`, print a warning listing the rogue commit SHAs, and continue to the next wave (do not create an empty commit).

If nothing to commit AND no commits since `wave_start_sha` (all dev agents BLOCKED, no files changed):
- Set `commit_sha = null`, `skipped_reason = "no changes"` in manifest entry.
- Print `Wave <W>: nothing to commit.`
- Continue to next wave.

Otherwise:
```bash
git commit -m "plan-runner cycle <cycle_n> wave <W>/<total_W>: <task_titles_summary> (<verifier_summary>)"
```

The `<task_titles_summary>` is a comma-joined list of agent task titles, truncated if >80 chars. Example: `"add User model, add Session model, define auth types"`.

Capture the commit SHA: `commit_sha=$(git rev-parse HEAD)`.

If the commit fails (pre-commit hook):
```
Pre-commit hook failed for wave <W>:
<hook output>

Continue without committing this wave? (Y/n)
```
If Y: leave wave uncommitted, continue (subsequent wave commits via `git add -A` will include it).
If n: STOP.

### 4f. Update manifest

Append a wave entry to `$cycle_dir/manifest.json`:

```json
{
  "wave_id": <W>,
  "duration_seconds": <wave duration>,
  "agents": [
    {"agent_id": "<id>", "dev_status": "<status>", "tokens": {"input": <n|null>, "output": <n|null>, "total": <n|null>}}
  ],
  "wave_verifier_status": "<verifier_status>",
  "wave_bug_count": <total bugs in wave>,
  "verifier_tokens": {"input": <n|null>, "output": <n|null>, "total": <n|null>},
  "wave_token_total": <sum of non-null totals in this wave, or null>,
  "commit_sha": "<sha or null>",
  "skipped_reason": "<reason or null>"
}
```

Use Read+Write or jq to update the manifest in place. If jq is unavailable, read the JSON, mutate it in memory, write it back.

Record `t_wave_<W>_end = $(date +%s)`.

Move to the next wave. After the last wave completes, proceed to Step 5.

## Step 5: AGGREGATE

### 5.0. Verifier-coverage gate (runs before counting, on every path)

Before counting bugs, assert that **every** wave `1..W` produced a verdict. For each wave, check that `$cycle_dir/bugs/wave-<W>.json` exists and parses with a non-null `verifier_status`.

If any wave's bug JSON is missing or has a null `verifier_status`, the verifier for that wave never landed -- the wave must not be treated as clean. For each such wave, synthesize and write:

```json
{"wave_id": <W>, "verifier_status": "UNVERIFIABLE", "agent_statuses": {}, "bugs": [{"bug_id": "wave-<W>-bug-1", "severity": "P2", "category": "incorrect_implementation", "title": "Wave <W> verifier verdict missing -- wave closed without verification", "file": "n/a", "line": null, "evidence": "No bugs/wave-<W>.json with a verifier_status was found at aggregation time.", "expected": "Every wave is gated by its verifier before the cycle closes", "suggested_fix": "Re-run this cycle's wave <W> so the verifier produces a verdict"}]}
```

Print a warning naming each backfilled wave. This gate makes it structurally impossible to reach the PR step (Step 8, downstream of Step 5 on both the clean and buggy paths) while a verifier verdict is still outstanding.

### 5.1. Count and aggregate

Count total bugs across all bug JSONs. If total bugs == 0:

```
[Phase 3/4] All waves complete. Zero bugs flagged -- skipping aggregation.
```

Finalize the token tally: compute `total_tokens`, `agents_reported`, `agents_total`, and `complete` from `token_usage.by_agent` (see **Token accounting**). No aggregator runs on this path, so it contributes no entry.

Update manifest: `total_bugs: 0`, `token_usage: <finalized tally>`, `completed_at: <ISO timestamp>`. Skip to Step 7 (final summary).

If total bugs > 0:

```
[Phase 3/4] Aggregating <N> bugs across <W> waves...
```

Dispatch ONE aggregator via the **registered subagent type `plan-runner:plan-aggregator`** (foreground, model: sonnet; do NOT inline the agent file). Pass only the per-invocation parameters:

```
You are being deployed as the plan-aggregator for plan-runner cycle <cycle_n>.

cycle_dir: <absolute path to $cycle_dir>
input_plan: <absolute path to the original plan>

Read all bug JSONs under <cycle_dir>/bugs/*.json.
Read the wave plan at <cycle_dir>/wave-plan.json for task context.

Write bugs.md and fix-plan.md to <cycle_dir> as instructed. Return the status JSON.
```

The aggregator writes the two files itself. When it returns, parse its status JSON. Capture the aggregator's token usage (see **Token accounting**) and append it to `token_usage.by_agent` as `{"agent": "aggregator", "phase": "aggregate", ...}`.

If the aggregator crashes or returns non-JSON:
```
Aggregator failed -- bug JSONs are intact at <cycle_dir>/bugs/.
You can run aggregation manually by re-invoking the agent.
```
Skip to Step 7 with `total_bugs = <count>`, `next_cycle_plan = null`.

Finalize the token tally: compute `total_tokens`, `agents_reported`, `agents_total`, and `complete` from `token_usage.by_agent` (see **Token accounting**).

Update manifest:
- `total_bugs: <from aggregator status>`
- `token_usage: <finalized tally>`
- `next_cycle_plan: <fix-plan path from aggregator>`
- `completed_at: <ISO timestamp>`

## Step 6: RE-RUN PROMPT (only if total_bugs > 0)

Print the bug summary:

```
[Phase 4/4] Bug Report
======================
P0: <N>   P1: <N>   P2: <N>   P3: <N>
Total: <N> bugs across <W> waves

Bug report:    <bugs.md path>
Fix plan:      <fix-plan.md path>
```

Then print the full **Token Report** block rendered per the "End-of-run Token Report" spec in the Token accounting section (per-phase table, top consumers, coverage line).

If cycle_n > 1, add a convergence hint:
```
(This was cycle <cycle_n>. Cycle <cycle_n - 1> had <prior_total> bugs, this cycle has <current_total>.)
```

Read `prior_total` from the previous cycle's manifest.json if it exists.

Then prompt:

```
Run plan-runner again with the generated fix-plan to address these bugs?
[Y] = auto-handoff to fresh-context subagent running /plan-runner:run <fix-plan.md>
[n] = stop here (you can resume later with the same command)

(Y/n)
```

If `n`: print `Stopping fix-plan re-run. Proceeding to code-atlas sync + PR step.` Proceed to Step 7-bis.

If `Y` (or empty default), the re-run mechanism depends on `backend`:

**Backend `subagent`:** dispatch a `general-purpose` Agent with this self-contained prompt:

```
You are executing the plan-runner:run skill in a fresh session.

Invoke the Skill tool with:
  skill: "plan-runner:run"
  args: "<absolute path to fix-plan.md>"

The fix-plan file already exists on disk. Read it fresh. Follow the skill exactly.

When the skill completes, return a concise summary: cycle number, waves run, total bugs found, whether the user accepted another re-run, and the path to the cycle's bugs.md. Do not re-describe work the user already saw -- just the outcome.
```

Use absolute paths so the subagent's path resolution does not depend on shared working-directory state. When the subagent returns, print its summary verbatim and STOP.

**Backend `teams`:** do NOT hand off to a fresh subagent -- a teammate cannot spawn its own team (no nested teams), and the lead is fixed for the session. Instead re-run **in place in the lead session**: re-enter this pipeline from Step 1 with the plan path set to the absolute `fix-plan.md` path (this starts a new cycle under the same date root). Carry the existing `backend = "teams"` forward. When that cycle completes, STOP.

## Step 7: FINAL SUMMARY (clean run only)

Reach this step ONLY when total_bugs == 0 (no aggregator dispatched, no re-run prompt).

Print:

```
plan-runner cycle <cycle_n> complete -- no bugs found.
==========================================================
Waves: <W>
Dev agents: <total dev agents>
Wave verifiers: <W> (1 per wave)
Commits: <count of waves with non-null commit_sha>
Duration: <total elapsed in Xm Ys>
Tokens: <total_tokens> across <agents_reported>/<agents_total> subagents<if not complete: " (partial -- some subagents did not report usage)">

Manifest: <path to manifest.json>
```

Then print the full **Token Report** block rendered per the "End-of-run Token Report" spec in the Token accounting section (per-phase table, top consumers, coverage line).

Update manifest `completed_at` and write to disk. Proceed to Step 7-bis.

## Step 7-bis: SYNC CODE ATLAS

This step keeps a code-atlas architecture index in sync with what this cycle just
implemented. All wave changes are already committed to disk (Step 4e), so the atlas
update picks them up automatically. It runs on the terminal cycle only -- the Step 6
"Y" re-run handoff never reaches this step, so intermediate fix cycles do not re-index.

`code-atlas:update` writes only to `.code-atlas/` (gitignored by the map skill), so
this step produces nothing committable and never changes the PR diff. It is purely a
freshness step run before the PR is opened.

### 7-bis.a. Git guard

If `git_available` is false, skip this step entirely. Set `code_atlas_sync = {"ran": false, "reason": "git not available"}` in the manifest and print:

```
code-atlas sync skipped (git not available).
```

Do NOT run any command. Proceed to Step 8.

### 7-bis.b. Detect code-atlas

Check whether `.code-atlas/state.json` exists (use Glob, or `test -f .code-atlas/state.json` via Bash). This file exists only when code-atlas is installed AND has already been initialized with `/code-atlas:map`.

If it does NOT exist, skip: set `code_atlas_sync = {"ran": false, "reason": "code-atlas not detected"}` in the manifest and print:

```
code-atlas not detected (.code-atlas/state.json absent) -- skipping architecture index sync.
```

Then proceed to Step 8. Do NOT auto-run `/code-atlas:map` (a full map is expensive and the user never opted in).

### 7-bis.c. Run the incremental update

If `.code-atlas/state.json` exists, print:

```
code-atlas detected -- syncing architecture index with this cycle's changes...
```

Invoke the Skill tool with:

```
  skill: "code-atlas:update"
  args: ""
```

Pass NO arguments. The update auto-selects its depth (micro / targeted / full) from the
size of the committed change set -- a small plan stays cheap; a large one re-scans as
needed. When the skill returns, print its final confirmation line verbatim, then set
`code_atlas_sync = {"ran": true, "reason": "synced"}` in the manifest and write it to disk.

Proceed to Step 8.

## Step 8: OPEN PR

If `git_available` is false, skip this step entirely. Print:

```
Git not available -- skipping the PR step. Review the generated artifacts in the
cycle directory: <cycle_dir>.
```

Then proceed to the Phase Timing Summary and STOP. Do NOT invoke the `plan-runner:pr` skill.

Otherwise (git is available):

Delegate push + PR creation to the dedicated PR skill. Compute the absolute path to
the cycle directory (the `$cycle_dir` from Step 1b resolved to an absolute path):

```bash
realpath "$cycle_dir"
```

Capture as `cycle_dir_abs`. Then invoke the Skill tool:

```
Invoke the Skill tool with:
  skill: "plan-runner:pr"
  args: "<cycle_dir_abs>"
```

The `plan-runner:pr` skill reads `manifest.json`, `wave-plan.json`, and the bug JSONs
from that directory, pushes the current branch, and creates or updates the pull
request (conventional title, rich body, draft when bugs remain). When it returns,
print its confirmation line verbatim and STOP.

## Phase Timing Summary (always print before STOP unless STOP was an early-exit error)

```
Phase Timing:
  Pre-flight       <Xm Ys>
  Analyze plan     <Xm Ys>
  User confirm     (excluded from total)
  Wave execution   <Xm Ys>   (<W> waves)
  Aggregation      <Xm Ys>   (skipped if 0 bugs)
  Sync code atlas  <Xm Ys>   (skipped if git absent or code-atlas not present)
  Open PR          <Xm Ys>
  --------------------------------
  Total            <Xm Ys>
```
