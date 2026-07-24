---
name: run
description: >
  Run a free-form Markdown implementation plan through a parallel agent swarm with
  per-wave verification. Each cycle: analyze the plan into file-disjoint waves of at most 6
  agents, dispatch dev + verifier agents per wave, commit per wave, aggregate bugs at
  the end, and prompt to re-run with the generated fix-plan. Use when the user has a
  Markdown plan they want executed with built-in verification and bug-driven re-planning.
---

Orchestrate a plan-runner pipeline cycle. Treat the text supplied with the skill invocation as the invocation input.

## Portable role loading and host facilities

Resolve bundled files relative to this `SKILL.md`, not the current working directory. The role directory is `../../agents/`; the schema directory is `../../schemas/`; and the sibling PR skill is `../pr/SKILL.md`. Before dispatching an analyzer, developer, test author, verifier, or aggregator, read the corresponding role file and include its body in that subagent's prompt. Claude Code may expose those files as namespaced agent types, but never depend on that registration: Codex discovers the skills and does not automatically register `agents/` files.

Use the host's native subagent and progress facilities. Parallelize file-disjoint roles in one batch when supported. Model labels are recommendations; use the closest available model without blocking. Use an available structured-input facility at user gates, or ask in plain chat when none exists.

Follow this pipeline exactly. Do not skip steps.

## Argument parsing

**Internal phase-runner form (relay only).** If the invocation input begins with `--phase-runner <run-state path> --phase <P>`, this is not a normal run: a relay driver dispatched you (Step 3-bis.2) to execute one phase in a fresh context. Capture `run_state_path = <run-state path>` and `phase_runner_id = <P>`, set `is_phase_runner = true`, and do NOT tokenize for a plan path or parse any other flag -- skip pre-flight, analysis, and slicing (all state is already on disk) and jump straight to Step 3-bis.0, which loads everything else from the run-state. For every other invocation set `is_phase_runner = false` and continue below.

Tokenize the skill invocation input on whitespace. The first non-flag token is the plan path (except for a `--resume` invocation, which carries no plan path -- state comes from the run-state; see the `--resume` flag below). Flags:
- `--verbose` -- if present, the analyzer emits per-wave `rationale` and per-agent `complexity_signals`. If absent, those fields are omitted (default; smaller analyzer output).
- `--no-tdd` -- if present, disable TDD and run the classic (non-TDD) pipeline. Set `tdd_enabled = false`. TDD is ON by default; this flag is the only way to turn it off.
- `--test-cmd "<cmd>"` -- optional explicit test command. May include a `{file}` placeholder for single-file runs (e.g. `pytest {file}`). When provided, it is used verbatim and detection is skipped.
- `--verify <mode>` -- optional verification coverage mode: one of `per-agent`, `per-wave`, `last-wave-only`. Overrides `.plan-runner.yml`. When absent, the config file (or the `per-wave` default) decides. Capture its value as `verify_mode_flag` (unset if the flag is absent).
- `--sync-verify` -- if present, disable pipelined verification: each wave's verifier is dispatched and awaited before the next wave begins (the pre-1.14 synchronous behavior). Overrides `.plan-runner.yml` `verification.pipelined`. This is the pipelining kill-switch. Set `sync_verify_flag = true`.
- `--phase-size <N>` -- optional integer overriding `phasing.max_waves_per_phase` (the max consecutive waves per phase). Overrides `.plan-runner.yml`. Capture its value as `phase_size_flag` (unset if the flag is absent).
- `--phase-mode <relay|stop>` -- optional phase execution mode overriding `phasing.mode`. Overrides `.plan-runner.yml`. Capture its value as `phase_mode_flag` (unset if the flag is absent).
- `--no-phasing` -- if present, disable phasing entirely and run the whole plan in one single-session pipeline regardless of plan size or yml config. This is the rollback kill-switch that restores today's behavior. Set `no_phasing_flag = true`.
- `--resume [run-state path]` -- resume an interrupted phased run from its last completed wave. With a path argument, resume that specific `run-state.json`. Bare (no path), auto-detect the most recent incomplete run-state under the resolved `docs_base`'s `plan-runner/` tree (plus the legacy `docs/plan-runner/` when `docs_base` differs from `docs`; see R.1). A `--resume` invocation carries NO plan path -- everything is read from the run-state. Set `resume_flag = true`; if the token immediately following `--resume` exists and is not itself a flag, capture it as `resume_path` and consume it (it is the run-state path, never the plan path); otherwise leave `resume_path` unset.

Set `verbose = true | false` based on the flag. Capture any `--test-cmd` value as `test_cmd_flag`. Set `tdd_enabled = false` if `--no-tdd` is present, otherwise `tdd_enabled = true` (TDD is auto-enabled by default -- never prompt for it). Capture any `--verify` value as `verify_mode_flag`. Set `sync_verify_flag = true` if `--sync-verify` is present, otherwise `sync_verify_flag = false`. Capture any `--phase-size` value as `phase_size_flag` and any `--phase-mode` value as `phase_mode_flag`. Set `no_phasing_flag = true` if `--no-phasing` is present, otherwise `no_phasing_flag = false`. Set `resume_flag = true` if `--resume` is present, otherwise `resume_flag = false`, and capture its optional path token as `resume_path` (see the flag above). Strip all flags (including `--verify <mode>`, `--sync-verify`, `--phase-size <N>`, `--phase-mode <mode>`, `--no-phasing`, and `--resume [path]` together with any consumed `resume_path` token) before using the plan path. On a `--resume` invocation there is no remaining plan-path token, and that is expected -- do not treat its absence as the "plan file not found" error.

## Timing

Track elapsed time for each phase. At the start of each step run `date +%s` and store the timestamp. Compute durations at the end and write to `manifest.json`.

## Token accounting

plan-runner tallies the tokens consumed by every subagent it dispatches (analyzer, dev agents, wave verifiers, aggregator) so `manifest.json` carries a per-agent breakdown and a grand total for the whole cycle. This is the foundation for tallying the full run's token cost.

There is no tool that returns a subagent's token count directly, so capture is **best-effort** from two sources, applied per subagent in strict precedence order:

1. **Harness completion usage (authoritative).** When a subagent completes, read the token usage reported in its completion result (the Task/Agent result's usage summary, e.g. input/output token counts). Record it as `{"input": <n>, "output": <n>, "total": <input + output>, "source": "harness"}`. If only a single combined total is surfaced, record `{"input": null, "output": null, "total": <n>, "source": "harness"}`.
2. **Agent self-report (fallback).** Every pipeline agent bubbles up a `token_usage` field in its return JSON: the most recent usage figure the harness surfaced to it in-band (e.g. a token-budget system warning), or `null` when none appeared. When the completion result carries no usage figure -- common for teammates on the `teams` backend, whose usage may not be visible to the lead -- use the agent's non-null self-report instead: record its fields with `"source": "self_report"` and count the agent as reported. A self-report is a lower bound (the figure predates the agent's final response), but it is a real harness figure, not an estimate.

If neither source yields a figure, record `tokens: null` (no `source`) and count the agent as unreported. **Never fabricate a token count** -- a `null` with an honest coverage number is the correct outcome when the figure is unavailable, and an agent's `token_usage: null` must never be "rescued" with a guess.

Maintain a running `token_usage` tally in memory across the whole cycle and write it to the manifest at finalization (Step 5 / Step 7):

```json
{
  "by_agent": [
    {"agent": "analyzer", "phase": "analyze", "input": <n|null>, "output": <n|null>, "total": <n|null>, "source": "harness | self_report -- omit when tokens are null"}
  ],
  "total_tokens": <sum of every non-null per-agent total>,
  "agents_reported": <count of subagents that surfaced a usage figure>,
  "agents_total": <count of subagents dispatched this cycle>,
  "complete": <agents_reported == agents_total>
}
```

Append one `by_agent` entry per dispatched subagent: the analyzer (Step 2), every dev agent (Step 4a), every wave verifier (Step 4c), and the aggregator (Step 5). `agent` is the subagent label (`analyzer`, `wave-<W>-agent-<n>`, `wave-<W>-verifier`, `aggregator`); `phase` is one of `analyze | wave | verify | aggregate`.

### End-of-run Run Report

The terminal end of a cycle prints one **Run Report** -- a single ASCII block (fixed 60-column width, no Unicode box-drawing, no color) that presents the whole cycle at a glance and then in detail. It is rendered from the finalized `token_usage` tally (above) and the phase-timing tally. On a phased run the tally and timing come from the **cross-phase roll-up** (Step 5.2 -- the sum across every phase's `manifest.json`, non-null token values only, coverage counters aggregated), so the single Run Report still reflects the entire multi-phase cycle rather than just the terminal phase. It prints once, as the last output before STOP, on every terminal path: the clean run, the bugs-found run after the user declines the re-run, and the git-absent path. It does NOT print on the bugs-found re-run *handoff* path (user picks `Y`) -- that intermediate cycle prints only the compact decision block (Step 6) and hands off; its full tally still lands in `manifest.json`.

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

### Intermediate phase summary (phased runs)

At every **non-terminal** phase boundary a phased run prints a compact phase summary -- **never the full Run Report**, which is a terminal-only, once-per-run artifact. The relay driver prints it after each phase-runner returns (Step 3-bis.2); a stop-mode session prints it before ending at the boundary (Step 3-bis.3); the wall-time guardrail reuses the stop form (Step 3-bis.4). It is a small fixed block covering the phase just finished -- waves run, bugs so far, tokens with coverage, and the next action -- and nothing more:

```
Phase <P>/<phase_count> complete -- waves <lo>-<hi> (<n> waves)
  Bugs so far    <cumulative bug count, phases 1..P>
  Tokens so far  <sum of non-null totals, phases 1..P> (<agents_reported>/<agents_total> agents)
  Next           <phase <P+1>: relay dispatch | stop + resume | resume command>
```

- **Bugs so far** and **Tokens so far** are cumulative across phases `1..P`, read from the phase manifests already on disk (`phase-1..P/manifest.json`), so the operator sees the run's running total while the driver holds no wave-level context. Tokens sum **non-null values only**; when coverage across those phases is partial (`agents_reported < agents_total`), append ` -- lower bound` to the Tokens line, mirroring the Run Report's honesty rule. Never fabricate a token count for an agent that stayed `null` in its phase manifest.
- **Next** names what follows this boundary: relaying into phase `<P+1>`, or stopping with the copy-pasteable resume invocation (stop mode, guardrail, or teams backend). This block is compact by contract -- it MUST NOT expand into the token/timing tables, the status header, or the artifacts list of the full Run Report. The full Run Report prints exactly once, only on the terminal phase.

## Step 1: PRE-FLIGHT

If `is_phase_runner` is true, this invocation is a relay phase-runner: skip Steps 1, 2, 2-bis, and 3 entirely (all state is already on disk from the driver's slicing) and execute Step 3-bis.0 directly. A phase runner never resolves `docs_base` itself -- `cycle_dir` is derived from `run_state_path`'s parent directory (Step 3-bis.0), which already lives under whatever base the original run resolved.

### 1a-minus. Resolve output base

Every other invocation -- a fresh run and an explicit `--resume` alike -- resolves `docs_base` here, before any resume discovery or plan validation runs, because both the Step 1a-0 auto-detect scan and the bare-`--resume` scan (R.1) glob under `docs_base`. Resolve using only directory listing / Glob and reading `CLAUDE.md` / `AGENTS.md` -- no YAML parser, no shell-specific tooling -- so the result is deterministic for a given repository state:

1. **Explicit statement.** Check, in order, the repo-root `CLAUDE.md`, the repo-root `AGENTS.md`, and any repository instructions already loaded into context this session (e.g. a project `CLAUDE.md` the host injected at session start). Look for a sentence that **explicitly** names a documentation directory (e.g. "docs live in `documentation/`", "project docs are under `doc/`"). A generic or vague mention of "docs" without a named directory does not count -- fall through to the next rule. If an explicit statement is found, set `docs_base` to the named directory (strip any trailing slash) and `docs_base_source` to whichever file supplied it (`CLAUDE.md` takes precedence over `AGENTS.md` when both name a directory; in-context repository instructions count as their source file, typically `CLAUDE.md`).
2. **Top-level scan.** Otherwise, list the repo-root top-level entries (Glob or a directory listing) and check, in this fixed order, for a directory literally named `docs`, `doc`, `documentation`, `.docs`. Set `docs_base` to the first one that exists and `docs_base_source = "top-level scan"`. If two or more of these directories exist simultaneously, still pick only the first match in this order -- never create or use a second base.
3. **Default.** Otherwise (no explicit statement, no known-name top-level directory), set `docs_base = "docs"` and `docs_base_source = "default"` -- byte-for-byte today's behavior, including creating `docs/` as Step 1b already does.

Store `docs_base` and `docs_base_source` for Step 1b (`cycle_root`), the resume-discovery globs (1a-0 and R.1), and Step 1e (manifest).

Print the resolved output base and its source now, unconditionally, as soon as `docs_base` resolves -- before the `resume_flag` check below, so both a fresh run and an explicit `--resume` invocation see it:

    Output location: <docs_base>/plan-runner/ (from <CLAUDE.md | AGENTS.md | top-level scan | default>).

If `resume_flag` is true, this is an explicit resume invocation: skip the rest of this fresh pre-flight and Steps 2 / 2-bis / 3 (the wave plan is already sliced and checkpointed on disk) and execute the **Resume and crash recovery** section directly (entry: explicit `--resume`), which consumes `docs_base` resolved above for its bare-scan glob (R.1).

Record the pipeline start time: `t_start = $(date +%s)`.

### 1a-0. Auto-detect resumable runs

On a normal fresh run only (`is_phase_runner` false AND `resume_flag` false), run the auto-detect scan in **Resume and crash recovery** step R.1 before validating the plan: using the `docs_base` resolved in 1a-minus, it looks for an incomplete run-state under `<docs_base>/plan-runner/` (plus the legacy `docs/plan-runner/` whenever `docs_base` differs from `docs`, per R.1) and, if it finds one, offers to resume it. If the user accepts, control transfers to the resume machinery and this fresh pre-flight does not continue. If the user declines (the incomplete run-state is marked `abandoned`) or none is found, continue with 1a below as a fresh run.

### 1a. Validate plan file

Parse the argument as a file path. If the path is empty or the file does not exist:

```
Error: plan file not found: <path>

Claude Code: /plan-runner:run <path-to-plan.md>
Codex: $plan-runner:run <path-to-plan.md>
Example: $plan-runner:run docs/foo/feature.md
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
2. Set `cycle_root = "<docs_base>/plan-runner/$DATE/"`, using `docs_base` resolved in 1a-minus.
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

Store `git_available` for the manifest and for the conditional git steps below (1c, 4b, 7-bis, and 8). When `git_available` is false, every step that runs `git` is skipped as noted in that step.

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

Use available shell tools such as `awk` / `grep -c` to count -- do NOT read the plan into your own context twice.

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

1. If running in Claude Code, read `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` with an available shell command.
2. If the value is exactly `1` AND this Claude Code session exposes Agent Teams tooling (team task list + teammate spawning, Claude Code v2.1.178+), set `backend = "teams"`.
3. In Codex, or in Claude Code without both prerequisites, set `backend = "subagent"` and use the host's native subagent facility.
3. Print one of:

```
Agent Teams enabled -- using team backend (lean orchestration, lower token usage).
```
```
Using native subagent backend.
```

If the env var is set to `1` but team tooling is not available (older Claude Code build), do NOT error -- fall back to `backend = "subagent"` and print the second message with a note that the build is too old.

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

Store `verify_mode` for the manifest (Step 1e) and for Step 3 / Step 4c / Step 5.0 branching.

`verify_mode` controls only the semantic verifier layer:
- `per-wave` (default): one verifier per wave, every wave -- byte-for-byte the current behavior.
- `per-agent`: one verifier per dev agent, every wave (highest scrutiny/cost).
- `last-wave-only`: one verifier on the final wave only; earlier waves are recorded `SKIPPED` (Step 4d) -- an intentional, transparent absence distinct from `UNVERIFIABLE`. The red/green TDD gates (Step 4a-ter) still run on every wave regardless of `verify_mode`; a lower mode drops only the verifier's judgment of that output.

**Resolve pipelining the same way.** `verify_pipelined` decides WHEN each wave's verifier runs, never whether: pipelined (default) dispatches it right after the wave commit and captures the verdict while the next wave's dev agents work; synchronous waits for the verdict before the next wave starts. Precedence: `false` if `sync_verify_flag` is set (the `--sync-verify` flag); otherwise the `.plan-runner.yml` `verification.pipelined` value (extract the single key directly, exactly as above); otherwise default `true`. Print:

    Pipelined verification: <on|off> (from <--sync-verify flag | .plan-runner.yml | default>).

When git is unavailable there is no commit to pin a snapshot to, so a no-git run always verifies synchronously regardless of this setting (Step 4c). Store `verify_pipelined` for Step 4c.

### 1d-quinquies. Resolve phasing config

Large plans (40+ tasks, ~10-15 waves) run today in one long-lived orchestrator session whose host-process memory is never freed, which crashes constrained machines. Phasing splits an oversized wave plan into sequential phases, each executed with a fresh context. Resolve the phasing configuration now; the actual slicing happens in Step 2-bis once the wave count is known.

`.plan-runner.yml` MAY carry a `phasing` block:

```yaml
phasing:
  enabled: true            # default true
  max_waves_per_phase: 4   # default 4
  mode: auto               # auto (default) | relay | stop
  auto_stop_phases: 3      # auto mode: relay up to this many phases, stop above
  relay_max_minutes: 90    # relay guardrail: force stop at the next boundary past this
```

Resolve each setting in precedence order **flag > yml > default** (the same precedence pattern as `--verify`). Extract each key directly with the Read tool -- do NOT depend on a YAML parser being installed, exactly as Step 1d-quater extracts `verification.mode`. A missing file, a missing key, or an unreadable file falls through to the default.

- `phasing_enabled`: `false` if `no_phasing_flag` is true (the kill-switch wins over everything); otherwise the yml `phasing.enabled` value; otherwise `true`.
- `max_waves_per_phase`: `phase_size_flag` if set; otherwise the yml `phasing.max_waves_per_phase` value; otherwise `4`. Must be an integer >= 1; if the resolved value is not a positive integer, print an error and STOP.
- `phase_mode`: `phase_mode_flag` if set; otherwise the yml `phasing.mode` value; otherwise `auto`. Validate against {`relay`, `stop`, `auto`}; if it is anything else, print an error and STOP. (`auto` resolves to `relay` or `stop` per phase count during execution -- Step 3-bis's adaptive resolution; slicing itself is mode-independent.)
- `auto_stop_phases`: the yml `phasing.auto_stop_phases` value; otherwise `3`.
- `relay_max_minutes`: the yml `phasing.relay_max_minutes` value; otherwise `90`.

Print the resolved config and its trigger threshold:

    Phasing: <enabled|disabled>. Threshold: >4 waves (max_waves_per_phase=<max_waves_per_phase>), mode=<phase_mode>.

When `phasing_enabled` is false, print instead:

    Phasing disabled (--no-phasing or phasing.enabled: false) -- running the whole plan in one session.

Store `phasing_enabled`, `max_waves_per_phase`, `phase_mode`, `auto_stop_phases`, and `relay_max_minutes` for Step 2-bis (slicing) and for the run-state checkpoint.

(The output base and its source were already printed in Step 1a-minus, immediately after `docs_base` resolved and unconditionally of everything that follows it -- including the clean-tree prompt, missing test command, and verify-mode validation checks that can each STOP the pipeline before this step is reached. Nothing further to print here.)

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
  "docs_base": "<docs_base>",
  "verification": {"mode": "<verify_mode>", "waves_total": null, "waves_verified": 0, "waves_skipped": 0},
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

`verification.waves_total` is null at init (the wave count is not known until Step 2 analysis); set it to the total wave count once the wave plan is validated, and increment `waves_verified` / `waves_skipped` per wave in Step 4f.

(When `tdd_enabled` is false, write `"tdd": {"enabled": false}` and omit the other keys.)

Record `t_preflight_done = $(date +%s)`.

## Step 2: ANALYZE PLAN

Print:
```
[Phase 1/4] Analyzing plan and computing wave plan...
```

Prepare the plan contents with 1-indexed line-number prefixes using an available shell:

```bash
awk '{printf "%4d\t%s\n", NR, $0}' "<plan path>"
```

Capture the result as `PLAN_WITH_LINES`.

Read `../../agents/plan-analyzer.md` relative to this skill and dispatch one analyzer with the complete role definition plus these per-invocation parameters:

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
1. Conforms to `../../schemas/wave-plan.schema.json`, resolved relative to this skill (use Python+jsonschema if available; otherwise structural check: required fields present, agent counts <=6, file paths unique within each wave). Note that `rationale` and `complexity_signals` are optional -- do NOT fail validation if they are absent.
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

Capture the analyzer's token usage (see **Token accounting**) and append it to `token_usage.by_agent` as `{"agent": "analyzer", "phase": "analyze", ...}`. The analyzer's return carries a top-level `token_usage` self-report -- the fallback source when its completion result surfaces no usage figure.

Record `t_analyze_done = $(date +%s)`.

## Step 2-bis: SLICE INTO PHASES

Slicing is mechanical arithmetic on the already-validated wave plan. The analyzer is NOT re-dispatched and `agents/plan-analyzer.md` is untouched -- wave order is topological, so any split into consecutive-wave ranges is dependency-safe by construction.

Let `W` = the number of waves in `wave_plan.waves`.

**Unphased path (byte-for-byte today's pipeline).** If `phasing_enabled` is false (including whenever `--no-phasing` was passed), OR `W <= max_waves_per_phase`, then phasing does not activate:

- Set `phasing_active = false` and `phase_dir = $cycle_dir`.
- Do NOT create any `phase-*/` directory. Do NOT write `run-state.json`.
- The run proceeds exactly as it does today: one session, the flat `cycle-<N>/` layout, Step 4 iterating all `W` waves, Step 5 aggregating `$cycle_dir/bugs/`. Nothing below in this step runs.
- Print: `Plan fits in one phase (<W> waves <= <max_waves_per_phase>) -- running unphased.` (omit this line entirely when `phasing_enabled` is false, since Step 1d-quinquies already announced that phasing is off).

Then proceed to Step 3.

**Phased path.** Otherwise (`phasing_enabled` is true AND `W > max_waves_per_phase`), set `phasing_active = true` and slice:

1. `phase_count = ceil(W / max_waves_per_phase)`.
2. Phase `P` (1-indexed, `1..phase_count`) owns the consecutive global waves `((P-1) * max_waves_per_phase) + 1` through `min(P * max_waves_per_phase, W)`. **Global wave numbering is preserved across phases** -- wave `<W>` keeps its number, so its bug JSON stays `wave-<W>.json` and manifests/run-state reference the global number. The last phase may be short.
3. For each phase `P`, create its directory and per-phase `bugs/`:

```bash
mkdir -p "$cycle_dir/phase-$P/bugs"
```

   write that phase's wave-plan slice -- the sub-array of `wave_plan.waves` for its wave range, in the same shape as the canonical wave plan -- to `$cycle_dir/phase-$P/wave-plan.json`, and write a starter `$cycle_dir/phase-$P/manifest.json` using the **same template as Step 1e** (identical fields and starter values) plus one additive object `"phase": {"phase_id": <P>, "of": <phase_count>, "wave_range": "<this phase's global range>"}`. The `phase` object is additive and optional, so a phase manifest still satisfies the manifest schema's back-compat rule. During a phase's execution, Step 4 appends its wave entries to this per-phase manifest (that is what `phase_dir` resolves to); the cycle-root `manifest.json` written in Step 1e stays as the pre-slice starter, and terminal-phase reporting (Step 5.2) sums across the per-phase manifests.

### Phase directory layout (phased runs only)

```
cycle-<N>/
  wave-plan.json        # canonical full wave plan (Step 2, unchanged)
  run-state.json        # the checkpoint (this step)
  phase-1/
    wave-plan.json      # this phase's wave slice
    bugs/               # this phase's per-wave bug JSONs
    manifest.json       # this phase's cycle-manifest (initialized at phase start)
  phase-2/ ...
  bugs.md               # terminal-phase aggregation output (cycle root)
  fix-plan.md           # terminal-phase aggregation output (cycle root)
```

The canonical `wave-plan.json` stays at the cycle root. Each phase owns its slice, `bugs/`, and `manifest.json`. `phase_dir` names the active phase's directory (`$cycle_dir/phase-<P>/`) during that phase's execution; every per-wave write in Step 4 that targets `$cycle_dir/bugs/` or `$cycle_dir/manifest.json` resolves against `phase_dir` instead. For an unphased run `phase_dir` is `$cycle_dir`, so those same Step 4 paths are byte-for-byte unchanged.

### Write the run-state checkpoint

Before dispatching any dev agent, write `run-state.json` to the **cycle** directory (`$cycle_dir/run-state.json`) -- per-cycle, so a fix-plan re-run (a new cycle) phases and checkpoints independently. It conforms to `../../schemas/run-state.schema.json` and records:

```json
{
  "plan_path": "<absolute path to the source plan>",
  "plan_content_hash": "<SHA256 of the plan file contents>",
  "invocation_flags": {
    "phase_size": <phase_size_flag or null>,
    "phase_mode": "<phase_mode>",
    "phasing_enabled": <phasing_enabled>,
    "no_phasing": <no_phasing_flag>
  },
  "backend": "<backend>",
  "verify_mode": "<verify_mode>",
  "tdd_enabled": <tdd_enabled>,
  "phases": [
    {"phase_id": 1, "wave_range": "1-<max_waves_per_phase>", "status": "pending", "directory": "<absolute path to cycle-<N>/phase-1>", "last_completed_wave": null}
  ],
  "overall_status": "active",
  "updated_at": "<ISO 8601 from `date -Iseconds`>"
}
```

Compute `plan_content_hash` with an available hashing tool (`sha256sum "<plan path>"`, `shasum -a 256 "<plan path>"`, or `certutil -hashfile "<plan path>" SHA256` on Windows), then normalize to the bare 64-character digest, lowercased with all whitespace stripped, so it matches the schema's `^[a-f0-9]{64}$` pattern (`certutil` emits uppercase with spaces). It guards resume against plan drift (Step 6 / resume compares it). List one `phases` entry per sliced phase, all `status: "pending"`, `last_completed_wave: null`; use each phase's absolute directory path and its global `wave_range` (e.g. `"1-4"`, `"5-8"`).

### Run-state lifecycle

`run-state.json` is the durable source of truth for stop/resume and crash recovery -- it is written and updated even in no-git mode (git-gated steps are skipped, but the checkpoint is not). Update it at exactly three points, always rewriting `updated_at`:

1. **At slicing time (here):** the initial write above -- all phases `pending`, `overall_status: "active"`.
2. **After every wave completion (Step 4f):** set the active phase's `last_completed_wave` to the just-finished global wave number and its `status` to `in_progress`.
3. **At every phase boundary:** when a phase's last wave completes, set that phase's `status` to `complete`; set the next phase's `status` to `in_progress` (or, when the terminal phase finishes, set `overall_status` to `complete` during terminal roll-up, Step 5.2).

Print the phase plan:

```
Phasing active: <W> waves sliced into <phase_count> phases of <=<max_waves_per_phase> waves.
  Phase 1: waves 1-<n>
  Phase 2: waves <n+1>-<m>
  ...
Checkpoint: <cycle_dir>/run-state.json
```

Then proceed to Step 3.

> Mode execution (relay driver vs. stop boundaries vs. adaptive resolution and the wall-time guardrail) is Step 3-bis. This step only slices, lays out the directories, and writes the checkpoint.

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
Estimated total agents: <total_dev + <verifier_count> verifiers + 2 (analyzer + aggregator)>
```

`<verifier_count>` depends on `verify_mode`: `per-agent` -> the total dev-agent count (one verifier each); `per-wave` -> `<W>` (one per wave); `last-wave-only` -> `1` (final wave only). Also set `verification.waves_total = <W>` in the manifest now that the wave count is known.

If `uncovered_plan_sections` is non-empty, print a warning that those sections will not be executed and the user can re-run with a revised plan after this cycle completes.

The bracketed tag is the agent `role` (`test`, `impl`, or `standalone`). In classic (non-TDD) runs, agents have no role and the tag is omitted. The "Non-testable tasks" block lists standalone agents that carry a `non_testable_reason`, so the user can challenge a mis-classification before execution.

Proceed automatically without waiting for user input.

Record `t_confirmed = $(date +%s)`.

(Continued in Step 3-bis: PHASE EXECUTION, then Step 4: WAVE EXECUTION)

## Step 3-bis: PHASE EXECUTION (driver, modes, and boundaries)

This step is the phase driver. It runs after the wave plan is displayed (Step 3) and decides how the sliced phases execute: it resolves `phase_mode` to an effective mode and hosts the relay loop, the stop boundaries, and the wall-time guardrail. Per-wave behavior never changes here -- every phase runs the existing Step 4 wave loop unchanged (barrier, gates, commit, pipelined verification per `verify_mode`, teardown, manifest, end-of-range drain); this step only orchestrates *which session* runs *which phase* and *what happens at each phase boundary*.

**Unphased passthrough.** If `phasing_active` is false (Step 2-bis left the run unphased -- every `--no-phasing` run and every sub-threshold run), this step is a no-op: proceed directly to Step 4 and run all `W` waves in this one session exactly as today. Nothing below applies, so the sub-threshold and `--no-phasing` paths stay byte-for-byte today's pipeline.

Otherwise `phasing_active` is true -- continue.

### 3-bis.0. Phase-runner entry (relay subagents only)

Reached when THIS invocation is a relay phase-runner -- `is_phase_runner` is true because a driver dispatched you with the internal input `--phase-runner <run-state path> --phase <P>` (Step 3-bis.2). You are NOT the driver: do not slice, do not resolve modes, do not aggregate, do not run any terminal step.

1. Read `run_state_path`. Derive `cycle_dir` = the **parent directory of `run_state_path`** (the run-state lives at the cycle root), so Step 4f's `$cycle_dir/run-state.json` rewrite has `cycle_dir` defined even though this relay phase-runner skipped Steps 1/2 where a fresh run computes it. The run-state already holds the sliced phase list, `backend`, `verify_mode`, `tdd_enabled`, and each phase's directory (Step 2-bis wrote it). Load `phase_dir`, `verify_mode`, `tdd_enabled`, `backend`, and phase `phase_runner_id`'s global wave range from it. Resolve the test command / green baseline from the run-state's TDD state exactly as a driver would (do not re-prompt).
2. Read that phase's wave-plan slice from `<phase_dir>/wave-plan.json`.
3. Execute Step 4 over this phase's wave range only, **beginning at the phase's first incomplete wave** -- `max(phase first wave, this phase's run-state `last_completed_wave` + 1)`. On a freshly-dispatched (pending) phase `last_completed_wave` is null, so it starts at the phase's first wave; on a resumed phase whose runner was re-dispatched mid-phase it starts just past the last completed wave, re-running no completed wave. The full per-wave barrier, gates, commit, pipelined verification, bug JSON, dashboard, teardown, and per-wave manifest + run-state updates run unchanged; every per-wave artifact resolves against `phase_dir` (Step 4 already targets `phase_dir`). All per-wave invariants (max 6 agents, file-disjoint, no-self-verify, verifier-coverage) hold inside the phase runner exactly as in an unphased session.
4. When the phase's last wave finishes and the Step 4g drain has captured every outstanding verdict, **finalize and persist this phase's own scoped token tally before returning.** Compute `total_tokens`, `agents_reported`, `agents_total`, and `complete` over this phase-runner session's in-memory `token_usage.by_agent` (the dev agents and verifiers this phase dispatched) using the **same computation as Step 5.1's tally finalization**, and write that finalized `token_usage` object -- its `by_agent` array plus the four rolled-up fields -- to the top level of this phase's `$phase_dir/manifest.json`. This is what lets Step 5.2's cross-phase union read a real top-level `token_usage` from **every** phase manifest, not just the terminal phase's. Then do NOT continue to Step 5, Step 6, or any terminal step. Return exactly one distilled **phase-summary JSON** and end. The driver owns everything after the phase.

Phase-summary return -- the ONLY thing the driver receives (never per-wave agent returns or transcripts); keep it within the ~1-2k-token return budget and point at the manifest for detail:

```json
{
  "phase_id": <P>,
  "wave_range": "<global range, e.g. 5-8>",
  "waves": [{"wave_id": <W>, "verifier_status": "<status>", "bug_count": <n>, "commit_sha": "<sha or null>"}],
  "phase_bug_count": <sum of this phase's wave bug counts>,
  "token_usage": {"total_tokens": <sum of non-null totals>, "agents_reported": <n>, "agents_total": <n>, "complete": <bool>},
  "manifest_path": "<absolute path to this phase's manifest.json>",
  "status": "complete | interrupted"
}
```

`status` is `interrupted` only if a wave could not complete; run-state (written per wave in Step 4f) still records the last completed wave, so the driver applies the normal resume path. Never inline wave-level data -- point at `manifest_path`.

### 3-bis.1. Resolve the effective execution mode

`phase_mode` (from Step 1d-quinquies) is `relay`, `stop`, or `auto`. Resolve the mode that governs this run, in this precedence:

1. **Teams-backend override (wins over everything, including an explicit `relay`).** If `backend == "teams"`, set `effective_mode = "stop"` regardless of `phase_mode`. A teammate cannot spawn a nested team, so a phase-runner subagent cannot lead one and relay is impossible on this backend (ADR-0003). Print the one-line explanation:

   `Agent Teams backend: forcing stop mode at every phase boundary (a phase-runner cannot lead a nested team).`

2. **Explicit mode.** Else if `phase_mode` is `relay` or `stop`, set `effective_mode = phase_mode` (a flag or the yml chose it explicitly).

3. **Adaptive default.** Else (`phase_mode == "auto"` -- no explicit mode configured), resolve by the sliced `phase_count`:
   - If `phase_count > auto_stop_phases`: `effective_mode = "stop"` -- the large plans that motivate phasing default to the full process reset.
   - Else (`phase_count <= auto_stop_phases`): `effective_mode = "relay"`.

   Print the one-line explanation, exactly one of:

   `Adaptive mode: <phase_count> phases <= auto_stop_phases (<auto_stop_phases>) -- relaying (context reset per phase).`
   `Adaptive mode: <phase_count> phases > auto_stop_phases (<auto_stop_phases>) -- stopping at each boundary (full process reset).`

Store `effective_mode`. Branch: `relay` -> 3-bis.2; `stop` -> 3-bis.3.

### 3-bis.2. Relay mode -- phase-driver loop

The invoking session is a thin driver. In relay mode it NEVER runs wave execution itself; each phase runs in its own fresh-context phase-runner subagent, and the driver holds only run-state pointers plus one phase summary at a time. Driver-side nesting stays at a constant depth regardless of `phase_count` (driver -> phase runner -> dev agents), never a phase-to-phase chain -- a chain would nest one level per phase and hit the platform's depth cap on large runs (ADR-0003).

Resolve this active `SKILL.md` to an absolute path once. Then, for each phase `P` in `1..phase_count` in order (skip any phase already `complete` in run-state):

1. **Guardrail check at the boundary.** Before dispatching phase `P` when `P > 1` (i.e. at each phase boundary), apply the relay wall-time guardrail (3-bis.4). If it trips, force a stop boundary here and end the session -- do NOT dispatch the next phase.
2. Dispatch a fresh-context general subagent -- the same self-contained handoff mechanism as the Step 6 fix-plan re-run -- with this prompt:

```
You are executing the Plan Runner run skill as a phase runner in a fresh session.

Read the complete skill instructions at <absolute path to this run SKILL.md>.
Treat them as the active instructions and execute them with this invocation input:
  --phase-runner <absolute run-state path> --phase <P>

Everything else -- the wave-plan slice, verify mode, backend, TDD state, phase
directory -- is already on disk in the run-state and the phase directory. Read it fresh.
Run only phase <P>'s waves (Step 3-bis.0), then return the single phase-summary JSON.
Do not aggregate, do not open a PR, do not run any terminal step.
```

3. Wait for the phase-runner to return. Parse its phase-summary JSON. If it does not parse, or `status` is `interrupted`, treat the phase as interrupted: run-state already records the last completed wave, so offer resume in-session or stop with the resume invocation (the resume path). Do NOT drive later phases over an interrupted one.
4. Record the phase summary (waves, bug count, token tally with coverage, `manifest_path`) for the terminal Run Report, which sums across the per-phase manifests (Step 5.2). The driver keeps ONLY this summary -- never the phase's per-wave agent returns or transcripts.
5. Tear down the phase-runner subagent with the host-native stop facility once its summary is captured; it must not idle after returning.
6. Print the compact intermediate phase summary (the **Intermediate phase summary** block in the Token accounting section -- waves run, bugs so far, tokens with coverage, next action; never the full Run Report) and continue to phase `P+1`.

After the terminal phase's runner returns (and the guardrail has not tripped), proceed to Step 5 for cross-phase aggregation over every phase's `bugs/` directory. The driver never dispatched a dev agent or verifier itself, so it carries no wave-level context into aggregation.

### 3-bis.3. Stop mode -- clean session boundaries

Stop mode fully resets the host process at each boundary: each session runs exactly ONE phase directly in its own context, then ends the session, and a fresh OS process resumes the next phase. This is the complete memory fix -- relay resets context but not host-process heap; stop resets both -- and is what the teams backend and large runs use.

In this session, execute the first phase whose run-state `status` is not `complete` (on the initial run that is phase 1; on a resumed session the resume path selects it):

1. Run Step 4 over that phase's wave range only, directly in this session -- the full per-wave barrier, gates, commit, pipelined verification, teardown, per-wave manifest + run-state updates, and the end-of-range drain (4g), unchanged -- writing every artifact to that phase's `phase_dir`.
2. When the phase's last wave completes and the Step 4g drain has captured every outstanding verdict, this is a **phase boundary**. Step 4f already updated run-state at that boundary (finished phase -> `complete`, next phase -> `in_progress`, `overall_status` still `active` until the terminal phase finalizes in Step 5.2); confirm it reflects the boundary before ending. **Finalize and persist this phase's own scoped token tally now**, at every stop boundary (terminal and non-terminal alike): compute `total_tokens`, `agents_reported`, `agents_total`, and `complete` over this session's in-memory `token_usage.by_agent` using the **same computation as Step 5.1's tally finalization**, and write that finalized `token_usage` object to the top level of this phase's `$phase_dir/manifest.json`. On phase 1 that in-memory `by_agent` also carries the analyzer entry (Step 2 ran in this same session), so it rides along into phase 1's manifest; a resumed intermediate phase carries only its own dev agents and verifiers. Persisting at every boundary is what lets Step 5.2's cross-phase union read a real top-level `token_usage` from every phase manifest before the fresh process (or terminal aggregation) takes over.
3. Then:
   - **More phases remain:** print the compact phase summary (the **Intermediate phase summary** block, not the full Run Report) followed by a copy-pasteable resume invocation, and end the session cleanly (STOP). Do NOT run Step 5 or any terminal step -- the fresh resumed process runs the next phase.

```
Phase <P>/<phase_count> complete. Stopping here for a full process reset before phase <P+1>.
Resume with:
  Claude Code:  /plan-runner:run --resume <absolute run-state path>
  Codex:        $plan-runner:run --resume <absolute run-state path>
```

   - **Terminal phase just completed:** do NOT stop. Proceed to Step 5 for cross-phase aggregation, then the terminal steps (Step 7-bis, Step 8, Run Report) run in this session exactly as on an unphased run. Step 5 reads every phase's bug JSONs from disk, so it needs no earlier-phase context.

The `--resume` flag, pre-flight auto-detect, and crash recovery that re-enter at the selected phase are the resume machinery; a stop boundary here only ensures run-state is current and prints the invocation. The guardrail-forced stop (3-bis.4) reuses this exact boundary and invocation.

### 3-bis.4. Relay wall-time guardrail

Relay keeps the driver's context lean but does NOT reset the host process, so a long relay run can still creep toward the process-memory envelope. Bound it by wall-time, not by hoping payload caps suffice. While relaying (3-bis.2), at every phase boundary -- after phase `P` completes and before dispatching phase `P+1` -- compare elapsed wall-time since this session's run start (`t_start`, Step 1) against `relay_max_minutes`:

- If `(now - t_start)` in minutes is `<= relay_max_minutes`: continue to the next phase's relay dispatch.
- If it exceeds `relay_max_minutes`: force a **stop-and-resume** at this boundary. This is an early stop boundary that reuses the stop machinery (3-bis.3): run-state is already current (written per wave and at the boundary), so print the reason and the copy-pasteable resume invocation and end the session (STOP). The fresh resumed process continues from phase `P+1`; its mode re-resolves, and if it relays again its own `t_start` restarts the guardrail clock.

```
Relay guardrail: <elapsed>m elapsed since run start exceeds relay_max_minutes (<relay_max_minutes>m).
Forcing a stop at the phase <P>/<phase_count> boundary for a full process reset.
Resume with:
  Claude Code:  /plan-runner:run --resume <absolute run-state path>
  Codex:        $plan-runner:run --resume <absolute run-state path>
```

## Resume and crash recovery

plan-runner checkpoints every phased run to `run-state.json` (written at slicing time in Step 2-bis, updated after every wave in Step 4f). Resume re-enters an interrupted run -- a planned `stop`-mode boundary, a guardrail-forced stop, or a machine crash -- from the last completed wave. Resume reads state ONLY from `run-state.json` plus the on-disk artifacts it points at (manifests, wave-plan slices, per-wave bug JSONs); it never infers progress from git history alone. Two entry points reach this machinery:

- **Explicit `--resume [path]`** (`resume_flag` is true): a resume invocation carrying no plan path; Step 1 routes here instead of the fresh pre-flight.
- **Pre-flight auto-detect** (Step 1a-0 on a normal fresh run): an incomplete run-state is found and the user accepts the resume offer (R.1).

Unphased runs write no run-state and are therefore never resumable -- there is nothing to resume, and re-invoking the plan just starts a fresh run.

### R.1. Locate the run-state (explicit path, bare scan, or auto-detect)

Resolve `run_state_path`:

- **Explicit path** (`resume_path` is set): use it directly as `run_state_path`.
- **Bare `--resume`** (`resume_flag` true, `resume_path` unset) **or the Step 1a-0 auto-detect scan**: scan for resumable run-states:
  1. Find every `run-state.json` under `<docs_base>/plan-runner/` (Glob `<docs_base>/plan-runner/**/run-state.json`), using `docs_base` resolved in 1a-minus. If `docs_base` differs from `docs`, ALSO glob the legacy `docs/plan-runner/**/run-state.json` and union the two result sets, de-duplicating any path that appears in both (the two glob roots always differ inside this branch, since it only runs when `docs_base` differs from `docs`; a collision is not expected but the de-dup guards against aliasing -- e.g. a symlink or a case-insensitive filesystem -- without weakening the union). This keeps runs started before a repo adopted a different `docs_base` -- or runs from a repo whose base legitimately is `docs` -- discoverable either way.
  2. Read each. Keep those that parse AND whose `overall_status` is `active` AND that have at least one phase whose `status` is not `complete`. Skip every `complete` or `abandoned` run-state -- **abandoned run-states are never re-offered or resumed.** (`active` is the only resumable status: every write site sets `active`, `complete`, or `abandoned`, so an interrupted-but-resumable run is `active` with an incomplete phase.)
  3. If none qualify: for a **bare `--resume`**, print `No resumable run found under <docs_base>/plan-runner/.` (or, when the legacy path was also scanned, `No resumable run found under <docs_base>/plan-runner/ or docs/plan-runner/.`) and STOP (the user asked to resume; do not silently start fresh). For the **Step 1a-0 auto-detect**, return to Step 1a and continue the fresh run silently.
  4. Otherwise pick the most recent by `updated_at` as the candidate (note in the offer if others also exist). For a **bare `--resume`**, set `run_state_path` to the candidate and continue to R.2. For the **Step 1a-0 auto-detect**, print the offer:

```
Found an incomplete plan-runner run you can resume:
  <run_state_path>
  plan:    <plan_path>
  phases:  <complete_count>/<phase_count> complete; next: phase <next phase_id>, wave <next wave>
  updated: <updated_at>

[Y] resume this run
[n] start a fresh run on <given plan path> (marks the incomplete run abandoned)

(Y/n)
```

  On `Y` (or empty default): set `run_state_path` to the candidate and continue to R.2. The plan path given on the fresh invocation is ignored -- all state comes from the run-state. On `n`: **mark the candidate `abandoned`** -- set its `overall_status` to `abandoned`, rewrite `updated_at`, write it back -- so it is not re-offered on later runs, then return to Step 1a and continue the fresh run on the given plan.

### R.2. Load and validate the run-state (corrupt or missing)

Read `run_state_path`. If the file does not exist, does not parse as JSON, or is missing any required field (`plan_path`, `plan_content_hash`, `phases`, `overall_status`), print the failure and offer a fresh run -- **never infer state**:

```
Cannot resume: run-state is missing or unreadable.
  <run_state_path>
  reason: <file not found | JSON parse error: ...  | missing field: ...>

Start a fresh run instead with:
  Claude Code:  /plan-runner:run <path-to-plan.md>
  Codex:        $plan-runner:run <path-to-plan.md>
```

Then STOP. If `overall_status` is `complete`, print that the run already finished and STOP. If `overall_status` is `abandoned`, print that this run-state was abandoned and STOP -- abandoned run-states are never resumed.

### R.3. Restore run variables (no dependency on Step 1)

Derive every resumed variable from the run-state and its location, so nothing depends on Step 1's fresh-run computation:

- `cycle_dir` = the parent directory of `run_state_path` (the run-state lives at the cycle root). Each phase's `directory` is recorded absolutely in the run-state; do NOT recompute cycle numbering or re-derive any path from Step 1 variables.
- `backend`, `verify_mode`, `tdd_enabled`, and `phase_mode` = the values recorded in the run-state. Set `phasing_active = true` (a run-state exists only for a phased run) and `phase_count` = the number of entries in `phases`.
- Re-detect host facilities that are not persisted: `git_available` per Step 1b-bis and `context7_available` per Step 1d. Re-resolve `max_waves_per_phase`, `auto_stop_phases`, and `relay_max_minutes` from `.plan-runner.yml` per Step 1d-quinquies (the phase list is already sliced, so these only feed the relay guardrail and the adaptive re-resolution in Step 3-bis.1).
- If `tdd_enabled`, re-resolve the **test command** by Step 1d-bis's detection path; do NOT re-prompt on resume. If detection cannot resolve a command non-interactively, proceed exactly as the relay phase-runner does (Step 3-bis.0) and let the missing gate surface through the normal loop. **Defer the green-baseline capture to R.6** -- do NOT capture it here. R.6's dirty-tree stash/keep decision can still change the working tree the resumed wave re-runs over, so a baseline captured now would bake in a pre-stash tree or one still tainted by the interrupted wave's partial breakage.
- Record `t_start = $(date +%s)` for this resumed session (the relay guardrail clock restarts per session, Step 3-bis.4).

### R.4. Plan-drift guard

Re-hash the plan file at `plan_path` (same tool and normalization as Step 2-bis) and compare it to the stored `plan_content_hash`. On a mismatch -- or if the plan file is now missing -- warn and **require explicit confirmation** before continuing against the already-sliced wave plan:

```
Plan file has changed since this run was checkpointed:
  <plan_path>
  checkpoint hash: <stored plan_content_hash>
  current hash:    <current hash, or "file missing">

Resuming runs the wave plan as sliced at checkpoint time; it does NOT re-analyze the
edited plan. Continue against the checkpointed wave plan anyway? (y/N)
```

The default is No. On anything but an explicit `y`, STOP and suggest a fresh run to re-analyze the edited plan. Only when the hash matches (or the user explicitly confirms) proceed to R.5.

### R.5. Compute the resume point

- `resume_phase` = the first entry in `phases` whose `status` is not `complete`. If every phase is already `complete`, the run finished: set `overall_status` to `complete`, rewrite `updated_at`, and proceed to the terminal steps (Step 5 aggregation onward) on the terminal phase -- there is nothing left to execute.
- Parse `resume_phase.wave_range` as `lo-hi`. Let `last = resume_phase.last_completed_wave`.
- `resume_from_wave` = `lo` when `last` is null (the phase never started), otherwise `last + 1`. If `resume_from_wave > hi` (the interruption landed exactly on a phase boundary), the phase is effectively done: set `resume_phase.status` to `complete`, rewrite run-state, and repeat R.5 for the next incomplete phase.
- `phase_dir` = `resume_phase.directory`.

### R.6. Interrupted-wave re-dispatch (dirty tree, ask once)

`resume_from_wave` is re-dispatched **from its start** -- any partial, uncommitted work left by the interruption is re-run, never assumed done. The interactive resuming session (the relay driver, or the single stop-mode session) makes the tree decision here, once, before phase execution begins.

**Dirty-tree prompt (git only, ask once).** If `git_available` is true, run `git status --porcelain`. If its output is non-empty, ask before dispatching -- **never silently discard uncommitted work**:

```
Resuming into wave <resume_from_wave> (interrupted). The working tree has uncommitted changes:
<git status --porcelain output>

This wave re-runs from its start. Choose how to handle the current tree:
  [s] stash first (git stash -u), then re-run the wave against a clean tree
  [k] keep the changes and let this wave's agents overwrite files as needed

(s/k)
```

On `s`, run `git stash -u`, then continue. On `k`, continue as-is. If the tree is clean, skip the prompt. **In no-git mode (`git_available` false), skip this prompt entirely** and re-run the wave over the working tree as-is: run-state.json alone drives resume, and every git-gated step (commit, PR, clean-tree check) stays skipped exactly as it is on a first run.

**Green baseline (deferred from R.3, only if `tdd_enabled`).** Now that the tree decision above is final -- stash applied, changes kept, or tree already clean -- capture the TDD green baseline, over the actual tree the resumed wave will re-run against: run the resolved full test command and record `baseline_failing` exactly as Step 1d-bis does. Capturing it here, after the stash/keep decision resolves, is what keeps the baseline reflecting the tree state the resumed wave actually runs over -- never a pre-stash tree nor one still tainted by the interrupted wave's own partial breakage.

**Rogue-commit baseline (git only).** The Step 4a rogue-commit guard runs on the re-dispatched wave against the wave's recorded start SHA: when Step 4 sets `wave_start_sha` for `resume_from_wave`, it uses the recorded `commit_sha` of the last completed wave (read from the phase manifests / run-state's `last_completed_wave`) rather than current `HEAD`, so any commit the interrupted wave made before crashing is detected as delivered work instead of being re-run blindly. When no prior wave committed, the baseline falls back to current `HEAD`.

### R.7. Hand to phase execution

Set `resume_phase.status` to `in_progress` and `overall_status` to `active` in the run-state, rewrite `updated_at`, and write it back. Then enter Step 3-bis at `resume_phase` with `resume_from_wave` in force (skip Step 3's wave-plan display -- it is already on disk). Step 3-bis re-resolves the effective mode (Step 3-bis.1) and runs the remaining phases from `resume_phase` forward: relay skips the already-`complete` phases and dispatches the first incomplete one (Step 3-bis.2); stop runs the first incomplete phase directly in this session (Step 3-bis.3). Step 4 begins the active phase at `resume_from_wave`, not the phase's first wave, so no completed wave re-runs. Cross-phase aggregation, the verifier-coverage gate, and every terminal step (Step 5, Step 7-bis, Step 8, the Run Report) still run only once, on the terminal phase, exactly as on a non-resumed phased run.

## Step 4: WAVE EXECUTION

Wave execution honors the `backend` chosen in Step 1d-ter. Both backends keep the same per-wave dev barrier (dispatch -> wait for all -> TDD gates -> commit) and the same pipelined verification; they differ only in how dev agents are dispatched and how their results are collected (4a). Teardown (4a-bis), gates (4a-ter), commit (4b), verification dispatch (4c), bug JSON (4d), dashboard (4e), manifest (4f), and the drain (4g) are identical for both.

**Wave timeline (pipelined verification, the default).** A wave's verifier runs while the NEXT wave's dev agents work, so verification stays off the critical path between waves:

1. 4a -- dispatch this wave's dev agents; wave barrier; rogue-commit guard.
2. 4a-bis -- tear down this wave's dev agents. 4a-ter -- run gates (one shared full-suite run per wave).
3. 4b -- commit the wave, then its commit-time 4f half (run-state + timing).
4. 4c -- pick up the PREVIOUS wave's verdict if still in flight (running its 4d, 4e, and capture-half 4f), then dispatch THIS wave's verifier(s) against a snapshot of the wave commit -- and do NOT wait.
5. Next wave. After the range's last wave: 4g drains every outstanding verdict.

4d (bug JSON), 4e (dashboard), and the capture half of 4f (manifest wave entry) are **verdict-capture procedures**: they run at whichever point receives the wave's verdict -- the next wave's 4c pickup, the 4g drain, or inline on a synchronous or SKIPPED wave -- exactly once per wave. A wave verifies **synchronously** (dispatch, wait, capture inline -- the pre-1.14 order of events, minus the commit having moved ahead of it) whenever pipelining is off (`--sync-verify` / `verification.pipelined: false`), `git_available` is false, the wave has no commit to snapshot, or the snapshot failed (4c).

For each wave in the active phase's wave range (sequentially) -- for an unphased run that is all of `wave_plan.waves`; inside a phase (a relay phase-runner or a stop-mode session) it is only that phase's wave-plan slice, so Step 4 iterates the current phase's waves and no others. **On a resumed run, iteration begins at the phase's first incomplete wave** -- `max(phase first wave, (run-state `last_completed_wave` for this phase) + 1)`, which is `resume_from_wave` (Resume step R.5). A pending phase has `last_completed_wave` null, so it starts at the phase's first wave; a partially-completed phase starts just past its last completed wave. Waves before that point already completed (recorded in run-state / the phase manifest) and are NOT re-run:

Print:
```
[Phase 2/4] Wave <W>/<total_W>: dispatching <N> dev agents in parallel...
```

Record `t_wave_<W>_start = $(date +%s)`. If `git_available` is true, also record `wave_start_sha=$(git rev-parse HEAD)` -- the rogue-commit guard (below) and the wave commit (4b) compare against it. **Resume exception:** when this wave is the resume point (`resume_from_wave`, re-dispatched after a crash or stop -- Resume step R.6), set `wave_start_sha` to the recorded `commit_sha` of the last completed wave (from run-state's `last_completed_wave` / the phase manifest) instead of current `HEAD`, so the rogue-commit guard catches any commit the interrupted wave made before it was interrupted; fall back to current `HEAD` when no prior wave committed. If `git_available` is false, leave `wave_start_sha` unset and skip every check that references it.

### 4a. Dispatch dev agents (parallel)

**Select and load the bundled role by the wave-plan `role` field** (in classic / non-TDD runs there is no `role` -- treat every agent as an impl/standalone dev agent and load `plan-dev.md`):

- `role: "test-author"` -> read `../../agents/plan-test-author.md`; include the resolved `test_command` so it can match the test framework/style.
- `role: "impl"` -> read `../../agents/plan-dev.md`; include a `TESTS TO SATISFY` block listing the agent's `tests_to_satisfy`.
- `role: "standalone"` or no role (classic) -> read `../../agents/plan-dev.md` with no `TESTS TO SATISFY` block.

Common per-invocation prompt template (prepend the complete bundled role definition):

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

**Backend `subagent` (default, including Codex):** Create one progress item per dev agent when the host offers task tracking; otherwise maintain a concise checklist. In one parallel batch, dispatch all dev agents in this wave with the role definition and per-invocation prompt above. Collect every dev agent return JSON.

**Backend `teams`:** The session is the team lead.
1. Create one task on the shared team task list per wave-plan agent, embedding the per-invocation prompt parameters (agent_id, task_title, plan_path, task_excerpt_lines, owned files, acceptance criteria, role-specific blocks) in the task detail. Give the wave's tasks no unmet dependencies so they are all immediately claimable (cross-wave ordering is enforced by the lead opening one wave at a time, not by global DAG edges).
2. Spawn one teammate per task (honor the <=6-per-wave cap), each receiving the role-selected bundled definition and using the role's `recommended_model` when available. Teammates self-claim the wave's tasks.
3. Read teammate progress from the task list / mailbox -- do NOT pull full JSON returns into the lead context. Each teammate records its final JSON status as its task result / final message.

For each dev agent return (both backends):
1. Parse the JSON. If parse fails, treat as `{"agent_id": "<id>", "status": "BLOCKED", "files_written": [], "files_unexpectedly_modified": [], "context7_queries": [], "summary": "agent returned non-JSON output", "concerns": ["unparseable response"]}` and continue.
2. Update the corresponding progress item or fallback checklist entry to `completed`.
3. Record the dev_status in a wave-state map.
4. Capture the agent's token usage (see **Token accounting**) and store it in the wave-state map keyed by `agent_id`. Append it to `token_usage.by_agent` as `{"agent": "<agent_id>", "phase": "wave", ...}`: harness completion usage first; when it is absent -- common for teammates on the `teams` backend -- fall back to the `token_usage` self-report in the agent's return JSON; record `tokens: null` only when both are missing.

**Wave barrier (both backends):** Wait for ALL dev agents/teammates in this wave to complete before proceeding. On the `teams` backend, if a task is stuck past a bounded wait (the known task-status-lag issue), read the owned-file state directly, treat any unreported teammate as `BLOCKED`, print a warning, and proceed to gates -- the gap then flows through the normal verify -> aggregate -> fix-plan loop rather than hanging the pipeline.

**Rogue-commit guard (both backends, only if `git_available` is true):** Dev agents are forbidden from committing, but one that disobeys leaves a clean working tree that makes its work look undone. Before treating any dev agent as silent-failed (missing return, empty owned-file diff, no working-tree changes) -- and before dispatching any retry or replacement agent for it -- run `git log --oneline <wave_start_sha>..HEAD -- <owned_files>` scoped to that agent's owned files. If commits appear, the agent rogue self-committed: the work counts as delivered, so do NOT dispatch a retry agent. Print a warning naming the agent and the rogue commit SHA(s), record the SHAs in the wave-state map, and let the wave verifier (4c) judge the content exactly as it would judge uncommitted work. Judging by working-tree diff alone is not sufficient evidence that an agent did nothing.

### 4a-bis. Tear down wave dev agents

A finished dev agent does not exit on its own -- it stays resident (an idle background task or an idle teammate) until explicitly stopped. As soon as the wave barrier above is satisfied and every dev agent's return has been captured, tear each one down immediately, before the gates (4a-ter) and the wave commit (4b):

- **Backend `subagent`:** release or stop the subagent with the host-native facility when it remains resident; if it exits automatically, no action is required.
- **Backend `teams`:** stop the teammate with its agent ID (`name@team`) or bare teammate name.

Tear down every dev agent in the wave, regardless of `dev_status` (`DONE` or `BLOCKED`) -- a blocked agent still holds its process open. If `TaskStop` reports the task already gone, treat that as success; there is nothing left to release. Do this for every wave, not only the last one -- letting agents from wave 1 idle until the whole cycle ends wastes resources for the run's entire duration.

### 4a-ter. Run gates (only if tdd_enabled)

If `tdd_enabled` is false, skip this step (classic pipeline).

Gates are applied **per agent**, by `role`, because a single wave may mix test-author, impl, and standalone agents -- but the FULL suite runs **once per wave**, not once per agent. For each agent in the wave, run the matching targeted gate with an available shell and capture verbatim output; then run the shared full-suite step once. There are **No inline retries** -- every gate failure is recorded as captured output for the verifier and surfaces as a bug routed through the normal aggregate -> fix-plan -> re-run loop.

**Test-author agent (role: test-author) -> RED gate (targeted, per agent):**
1. For each file in the agent's reported `test_files`, run the single-file test command (substitute `{file}`). Capture exit code + output.
2. Record `red_run` = `{cmd, exit, result: exit != 0 ? "FAILED" : "PASSED", valid_red: null}`. Leave `valid_red` null here -- the orchestrator cannot tell a genuine failure (import / not-implemented / assertion) from an invalid one (syntax / collection error) without analysis. The red-gate verifier (Step 4c) makes that call; backfill `valid_red` in the manifest when that verdict is captured (4f).
3. This agent's `captured_test_output` (for the verifier) = the per-file run output (all `test_files`) + the shared suite-regression block below.

**Impl agent (role: impl) -> GREEN gate (targeted, per agent):**
1. For each file in the agent's `tests_to_satisfy`, run the single-file test command (substitute `{file}`). Capture exit + output per file.
2. Record `green_run` = `{cmd, exit, result: all target files passed ? "PASSED" : "FAILED"}`.
3. `captured_test_output` = the per-file `tests_to_satisfy` run output + the shared suite-regression block below.

**Standalone agent (role: standalone or classic):** no gate; `captured_test_output` is empty.

**Shared full-suite run (once per wave, not per agent):** after the targeted runs, if this wave gated at least one test-author or impl agent, run the FULL test command exactly once and diff the failing-test set against `tdd.baseline_failing`. Split the new failures: a new failing test that belongs to one of this wave's test-author `test_files` is that agent's expected red, not a regression. Every other new failure is a wave-level regression -- append one identical block labeled `WAVE SUITE REGRESSIONS (one shared suite run for the wave)`, listing those tests verbatim, to EVERY gated agent's `captured_test_output`; the verifier attributes each regression to the responsible agent(s) by owned files. A wave with only standalone agents runs no suite. (Before 1.14 the suite ran once per gated agent -- a wave of six gated agents serially re-ran a slow suite six times for the same diff.)

**Append evidence to the manifest `tdd.tasks` array** (one entry per testable task, keyed by `task_title`): `{task, test_files, red_run, green_run}`. The red_run is filled when the test-author wave runs; green_run when the paired impl wave runs (match by task_title / tests_to_satisfy).

**Invalid red (paired impl skipped):** if the red gate shows the new tests PASSED (exit 0 -- the orchestrator detects this directly), do NOT dispatch the paired impl agent -- mark it BLOCKED with reason "paired test red gate invalid" and set `valid_red: false` for that task in the manifest. The red-gate VERIFIER's judgment (syntax / collection error = invalid) may still be in flight when the paired impl dispatches on a pipelined run: when that verdict is already in hand and judged the red invalid, skip the impl the same way; when it is still outstanding, dispatch the impl on the mechanical exit-code evidence rather than stalling the wave -- if the verdict then lands invalid, backfill `valid_red: false`, and the invalid-red P1 bug plus the impl's own green gate and verifier flow the gap into the next cycle. The verifier still emits the P1 bug from the captured output either way.

### 4b. Commit the wave

The wave commits BEFORE its verification runs: the commit is mechanical persistence of the dev agents' delivered work, the verdict is reporting -- and the commit SHA is what the pipelined verifier pins its snapshot to. A wave with bugs still commits today (the bugs flow to the fix plan), so committing ahead of the verdict changes what the commit message can say, never what gets committed.

If `git_available` is false, skip this step: set `commit_sha = null` and `skipped_reason = "git not available"` in the wave's manifest entry, print `Wave <W>: git not available -- skipping commit.`, and continue to 4c -- in no-git mode verification runs synchronously against the working tree. Do NOT run any `git` command.

Otherwise (git is available):

Run:
```bash
git add -A
git status --porcelain | head -1   # check if there's anything to commit
```

If the working tree is clean, do NOT immediately conclude the wave is empty -- first check for rogue self-commits: run `git log --oneline <wave_start_sha>..HEAD`. If commits exist, the wave's work was self-committed by dev agents. Set `commit_sha = $(git rev-parse HEAD)`, `skipped_reason = "self-committed by dev agents (rogue)"`, print a warning listing the rogue commit SHAs, and continue to 4c (do not create an empty commit; the snapshot pins to the rogue HEAD).

If nothing to commit AND no commits since `wave_start_sha` (all dev agents BLOCKED, no files changed):
- Set `commit_sha = null`, `skipped_reason = "no changes"` in the manifest entry.
- Print `Wave <W>: nothing to commit.`
- Continue to 4c -- with no commit there is nothing to snapshot, so this wave's verification runs synchronously against the working tree.

Otherwise:
```bash
git commit -m "plan-runner cycle <cycle_n> wave <W>/<total_W>: <task_titles_summary>"
```

The `<task_titles_summary>` is a comma-joined list of agent task titles, truncated if >80 chars. Example: `"add User model, add Session model, define auth types"`. The commit message carries no verifier verdict -- under pipelined verification the verdict does not exist yet at commit time; it lands in the wave's bug JSON, the manifest, and the PR body instead.

Capture the commit SHA: `commit_sha=$(git rev-parse HEAD)`.

If the commit fails (pre-commit hook):
```
Pre-commit hook failed for wave <W>:
<hook output>

Continue without committing this wave? (Y/n)
```
If Y: leave wave uncommitted, continue (subsequent wave commits via `git add -A` will include it). An uncommitted wave has no snapshot to pin, so its verification runs synchronously against the working tree.
If n: STOP.

After the commit outcome is recorded, run the commit-time half of 4f (run-state checkpoint + wave timing) -- the wave counts as completed at its commit, not at its verdict. Then continue to 4c.

### 4c. Verify the wave (async dispatch, coverage per `verify_mode`)

**Pick up the previous wave's verdict first.** If an earlier wave's verification is still in flight, complete it now, before dispatching this wave's: wait for its verifier(s) (backend-aware -- see "Waiting for verifiers" below) and run the verdict capture for that wave -- bug JSON (4d), dashboard (4e), manifest entry + counters (capture half of 4f). At most one wave's verification is ever in flight, and a pipelined verifier gets the entire next wave's dev + gate + commit time to finish before this pickup blocks on it. If its bounded wait genuinely expires, that wave flows into 4d as `UNVERIFIABLE` per the no-self-verify rule below -- never re-read and judged by the orchestrator.

Print:

    [Wave <W>] Committed. Dispatching verification (mode: <verify_mode>, <pipelined | synchronous>)...

Whether this wave gets a semantic verifier depends on `verify_mode` (resolved in Step 1d-quater):
- `per-wave` (default): yes -- one verifier for the whole wave.
- `per-agent`: yes -- one verifier per dev agent.
- `last-wave-only`: only if this is the final wave (`W == total_W`). For any earlier wave, do NOT dispatch a verifier -- jump to "Unverified wave (SKIPPED)" below.

**Pin the snapshot (pipelined waves).** A pipelined verifier runs while the NEXT wave's dev agents mutate the working tree, so it must read this wave's files as of this wave's commit, never the live tree. When `verify_pipelined` is true AND `git_available` is true AND `commit_sha` is non-null, create a detached snapshot worktree OUTSIDE the repository, in a host temp location:

```bash
SNAP="$(mktemp -d)/plan-runner-verify-wave-<W>"   # or an equivalent host temp dir
git worktree add --detach "$SNAP" <commit_sha>
```

Pass the path as `snapshot_root` in the verifier prompt below (the role resolves every repo-relative path under it and reports paths repo-relative). If `git worktree add` fails, print a note and verify this wave synchronously against the working tree instead. **This wave verifies synchronously** -- no snapshot, verifier reads the working tree, and you wait for the verdict here before moving on -- whenever any of these hold: `verify_pipelined` is false (`--sync-verify` / `verification.pipelined: false`), `git_available` is false, `commit_sha` is null (nothing to commit, or an uncommitted wave), or the snapshot creation failed.

**Dispatch a semantic verifier** after reading `../../agents/plan-verifier.md` relative to this skill. Include the complete role definition in each verifier prompt. Prefer model `sonnet` when available. Build the per-invocation prompt with the `AGENTS IN THIS WAVE` block, varying only by mode:
- `per-wave`, and the final wave under `last-wave-only`: include ALL dev agents in ONE verifier's `AGENTS IN THIS WAVE` block (the original single-verifier behavior).
- `per-agent`: dispatch N verifiers, one per dev agent, each with a single-agent `AGENTS IN THIS WAVE` block containing only that agent. Label each `wave-<W>-agent-<n>-verifier`.

The per-invocation prompt (unchanged from the single-verifier form, repeated per agent for `per-agent`):

    You are being deployed as the wave verifier for plan-runner cycle <cycle_n>, wave <W>.

    wave_id: <W>
    snapshot_root: <absolute snapshot path, or "n/a" (read the working tree)>

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

**Do NOT wait (pipelined waves).** On a pipelined wave, dispatch the verifier(s) in the background (subagent backend) or as teammates (teams backend) and proceed straight to the next wave -- the verdict is captured at the next wave's pickup (top of this step) or the end-of-range drain (4g). On a synchronous wave, wait now (rules below) and run the capture -- 4d, 4e, capture half of 4f -- inline before moving on.

**Waiting for verifiers (backend-aware; applies at every capture point -- pickup, drain, or a synchronous wave).** For `per-agent`, wait for ALL N verifiers. The verdict must come from each verifier's own report -- never from the orchestrator's own reading of the code:

**Backend `subagent` (default):** each verifier runs as a background task; wait for its completion notification. Collect each return JSON.

**Backend `teams`:** each verifier runs as a teammate (or a plain subagent receiving the bundled role definition). Because the team task status lags, do NOT treat "no status update yet" as "no verdict." Deterministically poll the verifier's task result / mailbox with a generous bounded wait, re-reading each until the bug-report JSON (its final message) is retrieved. Read the verdict from the task result, not by inferring it.

**No-self-verify rule (both backends, hard requirement):** The orchestrator MUST NOT perform the verification itself, MUST NOT substitute its own judgment for a verifier's report, and MUST NOT write a wave's verdict-capture artifacts (4d) from its own reading of the code. Pipelining changes only WHEN a verdict is awaited, never WHETHER: no verdict may remain outstanding past the 4g drain, and Step 5 / Step 8 are unreachable while any dispatched verifier's report is missing. If the bounded wait genuinely expires without a report, do NOT self-verify to "rescue" the wave: the missing verdict flows into 4d as `UNVERIFIABLE` so the gap routes through the normal verify -> aggregate -> fix-plan -> re-run loop. A late or missing verdict becomes a tracked bug, never a silently-closed wave.

**Late-verdict reconciliation rule (both backends, hard requirement):** An expired bounded wait is not proof the verdict is dead -- a verifier that missed its wait (a slow or untracked dispatch, invisible to the host's task-listing facilities) may still deliver its report later. Recording `UNVERIFIABLE`, or dispatching a replacement verifier to keep the pipeline moving, is how the pipeline stays unblocked -- it does NOT close that wave to a later verdict. If a verifier's report arrives after its wave was recorded `UNVERIFIABLE`, or after a replacement verifier's verdict was already recorded for it, the orchestrator MUST reconcile rather than discard it: re-open that wave's verdict capture (4d), update `bugs/wave-<W>.json` and its manifest entry (4f), and record the supersession explicitly (e.g. a `superseded_by` / `reconciled_from` note in the bug JSON) rather than silently overwriting the history. Reconcile by UNION of findings: take the union of every verdict's `bugs` for that wave, and never let a later or replacement `CLEAN` verdict erase an earlier `BUGS_FOUND` -- a specific finding that cites a file and line is far more likely a true positive the other verifier missed than a fabrication, so that wave's `verifier_status` is `BUGS_FOUND` if any verifier for it ever reported bugs. The orchestrator may confirm a late finding is grounded by checking that its cited file exists, but it MUST NOT adjudicate the disagreement by substituting its own judgment of whether the code is correct -- that would violate the no-self-verify rule above. If aggregation, the fix-plan, or the PR were already produced from the superseded verdict, they must be revised: re-run the Step 5.1 aggregation so the late bugs reach `bugs.md` / `fix-plan.md`, and update an already-opened PR -- including returning it to draft when it was published as ready with a now-false zero-bug or full-coverage claim.

**Unverified wave (SKIPPED).** When `verify_mode` leaves this wave without a semantic verifier (an earlier wave under `last-wave-only`), dispatch no verifier and create no snapshot. The orchestrator writes the wave's bug JSON directly in 4d with `verifier_status: "SKIPPED"` -- inline, immediately (there is nothing to pipeline) -- synthesizing only the BLOCKED bugs from dev-reported status:
- For each dev agent whose declared `dev_status` is `BLOCKED`, synthesize the same P0 `missing_requirement` bug the verifier would (per plan-verifier.md step 1): `title` = `Dev agent BLOCKED: <first concern or 'no reason given'>`, `file` = `<owned_files[0] or 'n/a'>`, `line` = null, `evidence` = "Dev agent could not complete the task", `expected` = "Dev agent should complete all acceptance criteria", `suggested_fix` = `<concerns joined or 'investigate why agent was blocked'>`. This is relayed from the dev's own declared `dev_status`, not a correctness judgment of code -- so it does not violate the No-self-verify rule.
- Every other agent on a SKIPPED wave gets no bug: its code is deliberately not semantically verified in this mode.

### 4d. Write bug JSON (verdict capture)

4d, 4e, and the capture half of 4f are the **verdict-capture procedures**: they run at whichever point receives the wave's verdict -- the next wave's 4c pickup, the 4g drain, or inline on a synchronous or SKIPPED wave -- exactly once per wave, in this order (4d, then 4e, then 4f's wave entry).

Produce the wave's `bugs/wave-<W>.json` according to how 4c verified it:

**Single-verifier waves (`per-wave`, or the final wave under `last-wave-only`):** parse the verifier's return. If parse fails, synthesize:
```json
{"wave_id": <W>, "verifier_status": "UNVERIFIABLE", "agent_statuses": {}, "bugs": [{"bug_id": "wave-<W>-bug-1", "severity": "P2", "category": "incorrect_implementation", "title": "Wave verifier returned non-JSON output", "file": "n/a", "line": null, "evidence": "<truncated raw output>", "expected": "Valid JSON bug report", "suggested_fix": "Re-run verification manually"}]}
```

**Per-agent waves (`per-agent`):** parse each of the N verifier returns (apply the same synthetic UNVERIFIABLE fallback per verifier that fails to parse). Merge into one wave JSON: `bugs` = the union of every verifier's bugs; `agent_statuses` = each agent's own verdict from its verifier; `verifier_status` = `CLEAN` if all agents are clean, `BUGS_FOUND` if any agent has bugs, `UNVERIFIABLE` if any per-agent verifier's report was missing or unparseable.

**Unverified (SKIPPED) waves:** write
```json
{"wave_id": <W>, "verifier_status": "SKIPPED", "agent_statuses": {"<each agent_id>": "BUGS_FOUND if that agent's dev_status is BLOCKED else SKIPPED"}, "bugs": ["<the BLOCKED bugs synthesized in 4c, may be empty>"]}
```

Write the JSON to `$phase_dir/bugs/wave-<W>.json`. (`phase_dir` is `$cycle_dir` for an unphased run and `$cycle_dir/phase-<P>/` for the active phase of a phased run -- see Step 2-bis. The bug JSON keeps the global wave number, so the filename is identical either way.)

Capture each dispatched verifier's token usage (see **Token accounting**). Each verifier's bug-report JSON carries a `token_usage` self-report -- the fallback source when its completion result surfaces no usage figure (do not copy the field into the wave's bug JSON). Append one `verify` entry per verifier to `token_usage.by_agent`: `{"agent": "wave-<W>-verifier", "phase": "verify", ...}` for a single-verifier wave, or one `{"agent": "wave-<W>-agent-<n>-verifier", "phase": "verify", ...}` per verifier for a `per-agent` wave. A SKIPPED wave dispatched no verifier, so it appends no `verify` entries. Store the wave's summed verifier tokens as `verifier_tokens` (null when nothing was reported).

**Tear down the wave verifier(s).** Each dispatched verifier's report is now captured -- release it with the host-native stop facility if it remains resident, or stop its teammate agent ID/name on the teams backend. For a `per-agent` wave, tear down every verifier. A SKIPPED wave has no verifier to tear down. Do this regardless of `verifier_status` (`CLEAN`, `BUGS_FOUND`, `UNVERIFIABLE`, or `SKIPPED`).

**Remove the wave's snapshot worktree** (pipelined waves): `git worktree remove --force "$SNAP"`; if removal fails, run `git worktree prune` and continue -- never fail the pipeline over snapshot cleanup. A synchronous or SKIPPED wave has no snapshot.

### 4e. Render wave dashboard (verdict capture)

On a pipelined wave this dashboard prints at verdict capture -- typically while the NEXT wave's dev agents are already running. It is labeled by wave id, so the one-wave offset is harmless; a synchronous or SKIPPED wave prints it immediately.

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

For a SKIPPED wave (unverified under `verify_mode`), the "Wave verifier" line prints `SKIPPED` and "Total bugs" counts only any BLOCKED-derived bugs. For a `per-agent` wave, "Wave verifier" prints the merged wave `verifier_status` and each agent's own verdict appears in the "Status per agent" column.

### 4f. Update manifest and run-state (two timing points)

4f fires at two distinct moments per wave.

**Commit-time half (immediately after 4b, before 4c dispatches verification):**

- Record `t_wave_<W>_end = $(date +%s)`. `duration_seconds` measures dispatch through commit; a pipelined wave's verification time deliberately overlaps the next wave's execution and is not part of any single wave's duration.
- **Update the run-state checkpoint (phased runs only).** If `phasing_active` is true, rewrite `$cycle_dir/run-state.json` now (per the Run-state lifecycle in Step 2-bis): set the active phase's `last_completed_wave` to this global wave number `<W>`, its `status` to `in_progress`, and `updated_at` to the current ISO timestamp. When `<W>` is the last wave of the active phase, this is a phase boundary: set that phase's `status` to `complete` and the next phase's `status` to `in_progress` (leave `overall_status` `active` until the terminal phase finalizes in Step 5.2). This per-wave write is what makes crash recovery granular to the wave, with or without git. The wave counts as completed at its commit -- a verdict still in flight does not hold up the checkpoint; if the run dies before that verdict is captured, the Step 5.0 coverage gate backfills it as UNVERIFIABLE.

**Capture half (at verdict capture, after 4d and 4e):** append the wave entry to `$phase_dir/manifest.json` (`$cycle_dir/manifest.json` for an unphased run; the active phase's `$cycle_dir/phase-<P>/manifest.json` for a phased run):

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

The wave entry's `wave_verifier_status` may now be `SKIPPED`. Also update the top-level `verification` counters: increment `waves_verified` when this wave got a semantic verifier, or `waves_skipped` when it was SKIPPED. Ensure `verification.waves_total` is set to **this phase's own wave count** -- the number of waves in this phase's wave-plan slice, NOT the cycle-wide global `W` -- so that summing `waves_total` across the phase manifests in Step 5.2 yields exactly `W` and never `phase_count * W`. (On an unphased run the phase is the whole cycle, so this phase-scoped count is `W`, byte-for-byte the old behavior.)

Use Read+Write or jq to update the manifest in place. If jq is unavailable, read the JSON, mutate it in memory, write it back.

Move to the next wave -- its 4a dispatch runs while this wave's pipelined verifier is still working. After the last wave of the range completes 4c and its commit-time 4f, run the 4g drain below. Then: on an unphased run, proceed to Step 5. Inside a phase (`phasing_active` is true), control returns to Step 3-bis at the phase boundary instead -- a relay phase-runner returns its phase-summary JSON (Step 3-bis.0), and a stop-mode session ends or, on the terminal phase, proceeds to Step 5 (Step 3-bis.3). Step 5 runs only once, on the terminal phase.

### 4g. Drain outstanding verdicts (end of the wave range)

After the range's last wave, one wave's verification is normally still in flight (the final wave's). Before leaving Step 4 -- before a phase boundary (Step 3-bis.0's phase-summary return, Step 3-bis.3's stop boundary) and before Step 5 -- wait for EVERY outstanding verifier (backend-aware, bounded, per 4c's waiting rules) and run the verdict capture (4d, 4e, capture half of 4f) for each, then remove any remaining snapshot worktrees. A verifier whose bounded wait expires flows into 4d as `UNVERIFIABLE`, exactly per the no-self-verify rule. The wave range is complete only when no verdict is outstanding, so every phase manifest and phase-summary return carries a full set of verdicts and verifier tokens; the Step 5.0 coverage gate remains the terminal backstop for anything a crash still slipped through. If one of those drained verifiers' reports turns out to be a late arrival from a wave already recorded `UNVERIFIABLE` (or already superseded by a replacement verifier), do not record it as a fresh verdict -- apply the late-verdict reconciliation rule (4c) instead.

## Step 5: AGGREGATE

Step 5 runs **once, on the terminal phase** of this cycle. On an unphased run the single session reaches it after the last wave; on a phased run only the terminal phase's session reaches it -- the relay driver after the terminal phase-runner returns (Step 3-bis.2), or the terminal stop-mode session (Step 3-bis.3). Intermediate phases return to Step 3-bis at their boundary and never run aggregation. Aggregation is therefore **cross-phase**: it reads the per-wave bug JSONs of every phase, not only the phase that happens to be executing, from the artifacts already on disk.

**Resolve the bug-JSON locations for the whole cycle.** Each wave's bug JSON lives in its own phase's `bugs/` directory under its preserved global wave number:
- **Unphased run** (`phasing_active` false): every bug JSON is in `$cycle_dir/bugs/` -- byte-for-byte today's single-directory aggregation.
- **Phased run** (`phasing_active` true): wave `<W>`'s bug JSON is `$cycle_dir/phase-<P>/bugs/wave-<W>.json`, where `<P>` is the phase owning wave `<W>` (from the run-state `phases` wave ranges). The union across `phase-1/bugs/` .. `phase-<phase_count>/bugs/` is the complete set. `bugs.md` and `fix-plan.md` are written once, at the cycle root (`$cycle_dir`), as the terminal-phase aggregation output.

Below, "wave `<W>`'s bug JSON" means that per-phase path on a phased run and `$cycle_dir/bugs/wave-<W>.json` on an unphased run.

### 5.0. Verifier-coverage gate (runs before counting, on every path)

Before counting bugs, assert that **every** wave `1..W` of every phase produced a verdict: check that wave `<W>`'s bug JSON (`$cycle_dir/bugs/wave-<W>.json` unphased, else `$cycle_dir/phase-<P>/bugs/wave-<W>.json`) exists and parses with a non-null `verifier_status`. The sweep spans all phases, so a verdict missing from an earlier phase is caught here at terminal aggregation -- it is never left behind when that phase's session ended.

If any wave's bug JSON is missing or has a null `verifier_status`, the verifier for that wave never landed -- the wave must not be treated as clean. For each such wave, synthesize and write it to that wave's phase `bugs/` directory:

```json
{"wave_id": <W>, "verifier_status": "UNVERIFIABLE", "agent_statuses": {}, "bugs": [{"bug_id": "wave-<W>-bug-1", "severity": "P2", "category": "incorrect_implementation", "title": "Wave <W> verifier verdict missing -- wave closed without verification", "file": "n/a", "line": null, "evidence": "No bugs/wave-<W>.json with a verifier_status was found at aggregation time.", "expected": "Every wave is gated by its verifier before the cycle closes", "suggested_fix": "Re-run this cycle's wave <W> so the verifier produces a verdict"}]}
```

If a backfilled wave also lacks its manifest wave entry (its verdict was in flight when a crash killed the session, so the capture half of 4f never ran), append a minimal entry to that wave's phase manifest -- `wave_id`, `wave_verifier_status: "UNVERIFIABLE"`, `wave_bug_count: 1`, and null for anything unknown -- so the cross-phase stats (5.2) stay coherent.

Print a warning naming each backfilled wave (and its phase). This gate makes it structurally impossible to reach the PR step (Step 8, downstream of Step 5 on both the clean and buggy paths) while a verifier verdict for any wave of any phase is still outstanding. It remains upstream of the PR step on every path across phases: the terminal phase runs it before Step 7-bis / Step 8 can execute, and no intermediate phase reaches those steps at all.

A wave whose bug JSON carries `verifier_status: "SKIPPED"` was intentionally left unverified by `verify_mode` (e.g. an earlier wave under `last-wave-only`). `SKIPPED` is a present, non-null status, so this gate does NOT backfill it and does NOT treat it as a bug. The gate still backfills `UNVERIFIABLE` for any wave that was in scope for a semantic verifier but whose `bugs/wave-<W>.json` is missing or has a null `verifier_status` -- a dispatched verifier that never landed is still a tracked gap, exactly as before. So the "structurally impossible to open a PR while a requested verdict is outstanding" guarantee holds, while an intentional skip stays honest rather than masquerading as clean. A backfilled `UNVERIFIABLE` is still a placeholder, not a closed book: if that wave's real verifier report shows up later -- even after this gate ran, after aggregation, or after a PR was opened -- it is a late verdict and MUST be reconciled per the late-verdict reconciliation rule (4c), never discarded because the gate already moved on.

### 5.1. Count and aggregate

Count total bugs across all bug JSONs -- the cross-phase set resolved at the top of Step 5 (every phase's `bugs/` on a phased run; `$cycle_dir/bugs/` on an unphased run). If total bugs == 0:

```
[Phase 3/4] All waves complete. Zero bugs flagged -- skipping aggregation.
```

Finalize the token tally: compute `total_tokens`, `agents_reported`, `agents_total`, and `complete` from `token_usage.by_agent` (see **Token accounting**). No aggregator runs on this path, so it contributes no entry.

Update manifest: `total_bugs: 0`, `token_usage: <finalized tally>`, `completed_at: <ISO timestamp>`. Then run 5.2 (cross-phase roll-up + run-state completion) and skip to Step 7 (final summary).

If total bugs > 0:

```
[Phase 3/4] Aggregating <N> bugs across <W> waves...
```

Read `../../agents/plan-aggregator.md` relative to this skill, then dispatch one foreground aggregator with the complete role definition and these per-invocation parameters. Prefer model `sonnet` when available:

```
You are being deployed as the plan-aggregator for plan-runner cycle <cycle_n>.

cycle_dir: <absolute path to $cycle_dir>
input_plan: <absolute path to the original plan>

Read all of this cycle's bug JSONs: <cycle_dir>/phase-*/bugs/*.json (every phase, on a
phased run) or <cycle_dir>/bugs/*.json (on an unphased run) -- pass whichever set applies.
Read the canonical wave plan at <cycle_dir>/wave-plan.json for task context.

Write bugs.md and fix-plan.md to <cycle_dir> (the cycle root) as instructed. Return the status JSON.
```

The aggregator writes the two files itself. When it returns, parse its status JSON. Capture the aggregator's token usage (see **Token accounting**; its status JSON carries a `token_usage` self-report as the fallback source) and append it to `token_usage.by_agent` as `{"agent": "aggregator", "phase": "aggregate", ...}`.

If the aggregator crashes or returns non-JSON:
```
Aggregator failed -- bug JSONs are intact under the cycle's bug directories
(<cycle_dir>/phase-*/bugs/ on a phased run, else <cycle_dir>/bugs/).
You can run aggregation manually by re-invoking the agent.
```
Run 5.2 (cross-phase roll-up + run-state completion), then skip to Step 7 with `total_bugs = <count>`, `next_cycle_plan = null`.

Finalize the token tally: compute `total_tokens`, `agents_reported`, `agents_total`, and `complete` from `token_usage.by_agent` (see **Token accounting**).

Update manifest:
- `total_bugs: <from aggregator status>`
- `token_usage: <finalized tally>`
- `next_cycle_plan: <fix-plan path from aggregator>`
- `completed_at: <ISO timestamp>`

Then run 5.2 (cross-phase roll-up + run-state completion) and proceed to Step 6.

### 5.2. Cross-phase roll-up and run-state completion

Run this subsection at the end of Step 5 on **every** path (zero-bug, bugs-found, and aggregator-failure), before routing to Step 6 or Step 7. It reconciles a phased run's per-phase artifacts into one cross-phase view and closes the run-state.

**Unphased run** (`phasing_active` false): skip the roll-up -- `$cycle_dir/manifest.json` already holds the whole cycle (Step 4f appended every wave to it) and the token tally finalized in 5.1 is already complete -- and skip the run-state completion (an unphased run never wrote a run-state). Proceed unchanged.

**Phased run** (`phasing_active` true): the terminal session holds only the terminal phase locally -- the relay driver dispatched no dev agents or verifiers itself, and each phase wrote its own `phase-<P>/manifest.json` -- so roll the phases up from disk before reporting:

1. **Tokens (non-null only, honest coverage).** Read every `$cycle_dir/phase-<P>/manifest.json` and take the union of all phases' top-level `by_agent` arrays -- each phase persisted its own scoped tally at its boundary (relay phase-runner exit, Step 3-bis.0; stop boundary, Step 3-bis.3), so every phase manifest carries one. Then **explicitly fold in the analyzer's and aggregator's cycle-level entries from this terminal/driver session's in-memory `token_usage.by_agent`** -- those two agents belong to no phase (the analyzer ran in Step 2 of the driver/first session, the aggregator in Step 5.1 of this terminal session), so they are absent from the relay phase manifests and would be dropped otherwise. **Deduplicate the combined set by `agent` label** so an entry already present in a phase manifest (e.g. the analyzer captured in phase 1's stop-mode manifest) is counted exactly once. Recompute the tally over the deduplicated union with **Step 5.1's own computation**: `total_tokens` = the sum of every **non-null** per-agent `total`; `agents_total` = the count of entries in the union; `agents_reported` = the count of entries whose `total` is non-null; `complete` = `agents_reported == agents_total`. An agent left `null` in its phase manifest stays excluded from the sums and is never rescued with a guess. When `complete` is false the total is a lower bound -- the Run Report's honesty line (`! Tokens are a lower bound ...`) fires off this aggregated coverage.
2. **Timing.** The Wave-execution figure is the sum of every phase's wave `duration_seconds`; the other Run Report timing rows (Pre-flight, Analyze plan, Aggregation, Sync code atlas, Open PR) come from this terminal session's own timestamps.
3. **Bugs and verification.** `total_bugs` is the cross-phase count from 5.1. `verification.waves_total` is the global wave count `W`, taken directly from the cycle-root `wave-plan.json` -- equivalently the sum of every phase manifest's phase-scoped `waves_total` (Step 4f), which equals `W` by construction. Either way it must resolve to `W` and never `phase_count * W`. `waves_verified` / `waves_skipped` are the sums across all phase manifests.
4. **Write the roll-up to the cycle-root manifest.** Set `$cycle_dir/manifest.json` (the pre-slice starter from Step 1e) `token_usage` to the aggregated tally, plus the aggregated `total_bugs`, the summed `verification` counters, `next_cycle_plan` (fix-plan path or null), and `completed_at`. The cycle-root manifest is the single artifact the PR step and the Run Report read for cross-phase totals; the per-phase manifests are left intact for detail.
5. **Complete the run-state.** The terminal phase has finished, so set the run-state (`$cycle_dir/run-state.json`) `overall_status` to `complete`, mark the terminal phase's `status` `complete` if it is not already, rewrite `updated_at`, and write it back. This is the single point where a phased cycle's run-state reaches `complete`, and it fires on every terminal path -- clean, bugs-found `Y` handoff (the current cycle's phases are all done; the fix-plan re-run is a separate new cycle with its own run-state), and bugs-found `n`. A `complete` run-state is never re-offered or resumed by pre-flight auto-detect (Resume step R.1).

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

Do NOT print the full Run Report here -- this block stays compact so the re-run decision is quick. On the `Y` handoff path the token/timing detail is deferred to the next cycle's Run Report and remains recorded in this cycle's `manifest.json`; on the `n` path the full Run Report prints at the terminal end (after the PR step).

If cycle_n > 1, add a convergence hint:
```
(This was cycle <cycle_n>. Cycle <cycle_n - 1> had <prior_total> bugs, this cycle has <current_total>.)
```

If the previous cycle ran a different `verify_mode`, add: `(verification depth differed between cycles -- a lower bug count may reflect shallower verification, not real convergence.)` A drop in bugs across cycles is only meaningful when both cycles verified at the same depth.

Read `prior_total` from the previous cycle's manifest.json if it exists.

Then prompt:

```
Run plan-runner again with the generated fix-plan to address these bugs?
[Y] = auto-handoff to a fresh-context subagent running the Plan Runner run skill on <fix-plan.md>
[n] = stop here (you can resume later with the same skill invocation)

(Y/n)
```

A fix-plan re-run is a normal run through this same pipeline and **inherits phasing automatically, by the same rules -- no special-casing.** The fresh session (or the in-place teams re-run) reads `fix-plan.md` as its plan, analyzes it, and slices it in Step 2-bis exactly like a first cycle: when the fix-plan's own wave plan exceeds `max_waves_per_phase` it phases, writing its own per-cycle run-state; when it fits, it runs unphased. There is no phasing branch specific to fix-plan cycles -- the current (just-completed) phased cycle's run-state is already `complete` (Step 5.2), and the re-run starts a new cycle with a fresh checkpoint.

If `n`: print `Stopping fix-plan re-run. Proceeding to code-atlas sync + PR step.` Proceed to Step 7-bis.

If `Y` (or empty default), the re-run mechanism depends on `backend`:

**Backend `subagent`:** resolve this active `SKILL.md` to an absolute path, then dispatch a fresh-context general subagent with this self-contained prompt:

```
You are executing the Plan Runner run skill in a fresh session.

Read the complete skill instructions at <absolute path to this run SKILL.md>.
Treat them as the active instructions and execute them with this invocation input:
  <absolute path to fix-plan.md> --verify <verify_mode>

The fix-plan file already exists on disk. Read it fresh. Follow the skill exactly.

When the skill completes, return a concise summary: cycle number, waves run, total bugs found, whether the user accepted another re-run, and the path to the cycle's bugs.md. Do not re-describe work the user already saw -- just the outcome.
```

Carry the effective `verify_mode` forward explicitly (via `--verify`) so a `--verify` one-off does not silently revert to the committed `.plan-runner.yml` mode mid-loop, and the re-run's depth is a conscious, recorded choice. On the `teams` backend (in-place re-run), start the next cycle with the same `verify_mode` carried forward.

Use absolute paths so the subagent's path resolution does not depend on shared working-directory state. When the subagent returns, print its summary verbatim and STOP.

**Backend `teams`:** do NOT hand off to a fresh subagent -- a teammate cannot spawn its own team (no nested teams), and the lead is fixed for the session. Instead re-run **in place in the lead session**: re-enter this pipeline from Step 1 with the plan path set to the absolute `fix-plan.md` path (this starts a new cycle under the same date root). Carry the existing `backend = "teams"` forward. When that cycle completes, STOP.

## Step 7: FINALIZE (clean run only)

Reach this step ONLY when total_bugs == 0 (no aggregator dispatched, no re-run prompt).

Do not print a summary here. The clean-run summary now lives in the single End-of-run Run Report printed at the terminal end (its status-aware title reads `COMPLETE (clean, no bugs found)`, and the unverified-waves honesty line covers `verification.waves_skipped > 0`, so a reduced-coverage run still cannot read as fully verified-clean).

Update manifest `completed_at` and write to disk. Proceed to Step 7-bis.

## Step 7-bis: SYNC CODE ATLAS

This step keeps a code-atlas architecture index in sync with what this cycle just
implemented. All wave changes are already committed to disk (Step 4b), so the atlas
update picks them up automatically. It runs on the **terminal phase of the terminal
cycle only** -- the Step 6 "Y" re-run handoff never reaches this step, so intermediate
fix cycles do not re-index; and on a phased run only the terminal phase's session
reaches Step 5 and beyond (Step 3-bis routes every intermediate phase back at its
boundary), so code-atlas sync runs exactly once, never at an intermediate phase boundary.

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

Check whether `.code-atlas/state.json` exists with available filesystem or shell tools. This file exists only when code-atlas is installed AND has already been initialized with its map skill.

If it does NOT exist, skip: set `code_atlas_sync = {"ran": false, "reason": "code-atlas not detected"}` in the manifest and print:

```
code-atlas not detected (.code-atlas/state.json absent) -- skipping architecture index sync.
```

Then proceed to Step 8. Do NOT auto-run the Code Atlas map skill (a full map is expensive and the user never opted in).

### 7-bis.c. Run the incremental update

If `.code-atlas/state.json` exists, print:

```
code-atlas detected -- syncing architecture index with this cycle's changes...
```

Invoke the Code Atlas update skill with no arguments using the host's native skill mechanism. If the skill is not installed or cannot be invoked, record `code_atlas_sync = {"ran": false, "reason": "code-atlas update skill unavailable"}` and continue without failing the Plan Runner cycle.

Pass NO arguments. The update auto-selects its depth (micro / targeted / full) from the
size of the committed change set -- a small plan stays cheap; a large one re-scans as
needed. When the skill returns, print its final confirmation line verbatim, then set
`code_atlas_sync = {"ran": true, "reason": "synced"}` in the manifest and write it to disk.

Proceed to Step 8.

## Step 8: OPEN PR

Like Step 7-bis, this runs on the **terminal phase of the terminal cycle only**: it is downstream of the Step 5 cross-phase aggregation and the verifier-coverage gate, which only the terminal phase's session executes, so a PR is opened exactly once for the whole multi-phase run -- never at an intermediate phase boundary, and never while any wave of any phase still lacks a verdict. It reads the cycle-root `manifest.json` roll-up (Step 5.2) for cross-phase totals.

If `git_available` is false, skip this step entirely. Print:

```
Git not available -- skipping the PR step. Review the generated artifacts in the
cycle directory: <cycle_dir>.
```

Then proceed to the End-of-run Run Report (terminal print) and STOP. Do NOT invoke the Plan Runner PR skill.

Otherwise (git is available):

Delegate push + PR creation to the dedicated PR skill. Compute the absolute path to
the cycle directory (the `$cycle_dir` from Step 1b resolved to an absolute path):

```bash
realpath "$cycle_dir"
```

Capture as `cycle_dir_abs`. Resolve `../pr/SKILL.md` relative to this file and either invoke the registered Plan Runner PR skill or read and execute that sibling skill directly with `cycle_dir_abs` as its invocation input.

The Plan Runner PR skill reads `manifest.json`, `wave-plan.json`, and the bug JSONs
from that directory, pushes the current branch, and creates or updates the pull
request (conventional title, rich body, draft when bugs remain). When it returns,
print its confirmation line verbatim, then proceed to the End-of-run Run Report (terminal print) and STOP.

## End-of-run Run Report (terminal print)

Always reached as the last thing before a normal STOP (clean path, bugs-found `n` path, and git-absent path); never reached on the bugs-found `Y` handoff (that cycle STOPs after the handoff) or on an early-exit error STOP.

Compute the per-phase durations from the timestamps recorded through the run (Pre-flight, Analyze plan, Wave execution, Aggregation, Sync code atlas, Open PR) and the `Total`, excluding the User-confirm wait. Then render and print the **End-of-run Run Report** exactly per its spec in the Token accounting section -- status-aware title, two-column stat header, honesty lines, `Tokens by phase` table, `Timing by phase` table (using the durations just computed), and the `Artifacts` block. Then STOP.

On a phased run, this single report covers the whole multi-phase cycle: its token figures, coverage counters, `Waves` / `Dev agents` / `Verifiers` / `Commits` stats, bug count, and Wave-execution time come from the cross-phase roll-up computed in Step 5.2 (the sum across every phase's `manifest.json`), not from the terminal session's local tally. Token sums include non-null values only; the `! Tokens are a lower bound` honesty line prints whenever the aggregated coverage is partial (`agents_reported < agents_total` across the phases). The report still prints exactly once, only here on the terminal phase -- intermediate phases printed only the compact Intermediate phase summary.
