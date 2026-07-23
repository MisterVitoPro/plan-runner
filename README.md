# plan-runner

![version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FMisterVitoPro%2Fplan-runner%2Fv1.15.0%2F.claude-plugin%2Fplugin.json&query=%24.version&label=version&prefix=v&color=blue)

Take a free-form Markdown implementation plan and execute it through a parallel agent swarm with built-in verification and bug-driven re-planning in Claude Code or Codex.

Pairs with the [ideas](https://github.com/MisterVitoPro/ideas) plugin as the pipeline front door: its interview skill turns a raw idea into an audited spec and emits a plan-runner-ready plan for the run skill. The two install side by side; Ideas complements Plan Runner, it does not replace it.

## What it does

1. **Analyze.** A `plan-analyzer` agent reads your plan and buckets tasks into waves of file-disjoint work (max 6 agents per wave, ordered as a DAG).
2. **Confirm.** You see the wave plan and approve before any dev work runs.
3. **Execute per wave.** For each wave: dispatch up to 6 dev agents in parallel (TDD runs use `plan-test-author` for test-author roles and `plan-dev` for impl/standalone roles), run the TDD gates (one shared full-suite run per wave), commit the wave, then dispatch one `plan-verifier` against a snapshot of that commit -- the verifier runs while the next wave's dev agents work, so verification stays off the critical path between waves.
4. **Aggregate.** A `plan-aggregator` agent collects every verifier-flagged bug, deduplicates, ranks by severity (P0-P3), and writes both a `bugs.md` audit and a `fix-plan.md` (a new plan ready for re-runs).
5. **Re-run prompt.** You decide whether to auto-handoff to a fresh-context subagent that runs the generated `fix-plan.md` for cycle 2.

## Install

```bash
# Claude Code
claude plugin marketplace add MisterVitoPro/qa-claude-market
claude plugin install plan-runner@mistervitopro-plugin-marketplace

# Codex
codex plugin marketplace add MisterVitoPro/qa-claude-market
codex plugin add plan-runner@mistervitopro-plugin-marketplace
```

Start a new session after installation. The bundled SessionStart hook requires Node.js on `PATH`; in Codex, review and trust it with `/hooks` before expecting automatic `.gitignore` setup.

## Usage

```bash
# Claude Code
/plan-runner:run docs/foo/feature-plan.md

# Codex
$plan-runner:run docs/foo/feature-plan.md
```

The plan can be any Markdown file with task content. There is no required schema -- the analyzer reads it heuristically.

## Subagent backends

Plan Runner loads each bundled role definition relative to the active skill and dispatches it through the host's native subagent facility. This works in both Claude Code and Codex without depending on automatic registration of files under `agents/`.

Claude Code additionally supports its experimental **Agent
Teams** orchestration and uses it when available:

- **Enable it** by setting the environment variable
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (e.g. in `~/.claude/settings.json`
  under `"env"`). Requires **Claude Code v2.1.178 or later**.
- **What changes.** The session becomes the team lead and spawns teammates that
  self-claim each wave's tasks from a shared task list and report via the team
  mailbox, so the lead's context stays lean instead of accumulating every agent's
  full JSON return.
- **Same safety contract.** The per-wave dev barrier is unchanged: dispatch a
  wave -> wait for all -> run TDD gates -> commit -> next wave, with the wave's
  verifier dispatched right after the commit and its verdict captured while the
  next wave runs (pipelined). File-disjoint
  waves (already produced by the analyzer) satisfy the Agent Teams "each teammate
  owns different files" requirement.
- **Verifier-gated waves.** Because the team task status lags, the lead waits on
  the verifier's actual task result (not a status poll) before closing a wave, and
  never substitutes its own reading of the code for the verifier's verdict. If a
  verdict never lands the wave is marked `UNVERIFIABLE` and routed through the
  fix-plan loop. A coverage gate before aggregation backfills any missing verdict,
  so a PR can never open while a wave's verifier is still outstanding.
- **Fallback.** Codex always uses native subagents. If the variable is not set in Claude Code (or the build is older than 2.1.178),
  Plan Runner also uses the native subagent backend. The pre-flight
  output prints which backend is active, and `manifest.json` records it under
  `"backend"`.
- **Display note.** Split-pane teammate views need tmux or iTerm2; the default
  in-process view works everywhere (including Windows Terminal). The re-run loop
  on the teams backend continues in the same lead session, since teammates cannot
  spawn nested teams.
- **No idle agents.** A finished dev agent or verifier does not exit on its own --
  the lead explicitly tears it down (background task or teammate) the moment its
  result is captured, wave by wave, so agents never sit idle for the rest of the
  run.

## Token accounting

plan-runner tallies the tokens consumed by every subagent it dispatches -- the
analyzer, every dev agent, each wave verifier, and the aggregator -- so you can
see what a cycle cost. The tally is written to `manifest.json` under
`token_usage` (a per-agent `by_agent` breakdown plus a `total_tokens` grand
total) and surfaced in the wave dashboards, the end-of-run Run Report, and the
PR stats.

At the end of every run (both the clean path and the bugs-found path) plan-runner
prints one **Run Report**: a status-aware title, a two-column at-a-glance stat
header (waves, dev agents, verifiers, commits, duration, tokens, coverage, bugs),
then detail tables -- a per-phase token table (Analyze / Dev / Verify / Aggregate)
with input, output, and total sums, a per-phase reported-coverage column, and a
top-consumers line naming the most expensive subagents; a per-phase timing table;
and an artifacts block. Partial token coverage is flagged as a lower bound and any
unverified waves are called out, both directly under the stat header. The PR body
carries a compact per-phase token breakdown under its `Tokens:` stat.

Capture is **best-effort**, from two sources in precedence order: plan-runner
first records the usage figure the harness surfaces when each subagent finishes
(authoritative, `source: "harness"`). When that is unavailable -- most commonly
for teammates on the Agent Teams backend, whose usage is not always visible to
the lead -- it falls back to the agent's own **token self-report**: every
pipeline agent bubbles up a `token_usage` field in its return JSON carrying the
most recent usage figure the harness surfaced to it in-band, or `null` when none
appeared (`source: "self_report"`, a lower bound, never an estimate). When
neither source yields a figure that agent's entry is `null` and the run is
honest about it via the `agents_reported` / `agents_total` coverage counters and
a `complete` flag. A token count is never fabricated. Each cycle's manifest records its own tally; to
tally a full multi-cycle run, sum `token_usage.total_tokens` across every cycle's
`manifest.json` under the cycle root.

## TDD red-green mode

The Plan Runner run skill enables a Test-Driven Development red-green workflow by
default (no prompt); pass `--no-tdd` to run the classic pipeline instead:

- **Testable tasks** are split into a *test-author* step (writes a failing test)
  and an *impl* step (makes it pass). The orchestrator runs the test command at
  two checkpoints and records proven evidence in `manifest.json` under `tdd`:
  a `red_run` (the new test failed before implementation) and a `green_run`
  (it passed after).
- **Non-testable tasks** (docs, config, schemas) run as before, with static
  verification only. The analyzer labels them and shows the reason in the wave
  plan.
- The **red gate** requires the new tests to fail for a genuine reason
  (import / not-implemented / assertion) while pre-existing tests stay green;
  a syntax/collection error is an invalid red and is flagged as a bug.
- Gate failures are not retried inline -- the impl agent aims for a green
  full-suite, but a wave whose gate fails is **still committed** (marked
  `BUGS_FOUND`); the failures become bugs that flow through the existing
  aggregate -> fix-plan -> re-run loop and are resolved on the next cycle.

The test command is resolved as: `--test-cmd "<cmd>"` flag, else auto-detection
from repo markers (`package.json`, `pytest`, `go.mod`, `Cargo.toml`, `*.csproj`,
...), else a one-time prompt. If none can be resolved the run **stops** and
points you to `--no-tdd`.

**Flags:**
- `--no-tdd` -- disable TDD and run the classic (non-TDD) pipeline (TDD is on by default).
- `--test-cmd "<cmd>"` -- supply the test command explicitly; use `{file}` for
  single-file runs (e.g. `pytest {file}`).
- `--verify <mode>` -- verification coverage: `per-agent`, `per-wave` (default), or
  `last-wave-only`. Overrides `.plan-runner.yml`.
- `--sync-verify` -- disable pipelined verification and wait for each wave's verdict
  before the next wave starts (the pre-1.14 behavior). Overrides `.plan-runner.yml`.
- `--phase-size <N>` -- override `phasing.max_waves_per_phase` for this run. See
  "Phasing large plans" below.
- `--phase-mode <relay|stop>` -- override `phasing.mode` for this run.
- `--no-phasing` -- disable phasing entirely and run the whole plan in one session,
  regardless of plan size or `.plan-runner.yml` (the phasing kill switch).
- `--resume [run-state path]` -- resume an interrupted phased run. See "Resuming a
  run" below.

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
  pipelined: true  # default true; false = wait for each verdict before the next wave
```

or per-run with `--verify <mode>` (which overrides the file). Precedence:
`--verify` flag > `.plan-runner.yml` > default (`per-wave`).

**Pipelined verification (default since 1.14).** The verifier no longer sits
between waves: each wave is committed first, then its verifier is dispatched
against a read-only snapshot worktree pinned to that commit and runs while the
next wave's dev agents work. Every verdict still lands before aggregation -- an
end-of-range drain waits for stragglers, and the coverage gate backfills
`UNVERIFIABLE` for anything that never landed -- so the honesty guarantees are
unchanged; only the waiting moved. Runs without git, waves with nothing to
commit, and `--sync-verify` / `pipelined: false` runs verify synchronously as
before. TDD gates also got cheaper: the full suite runs once per wave for the
regression diff instead of once per gated agent.

`SKIPPED` is an intentional, transparent absence -- distinct from `UNVERIFIABLE`
(a *requested* verdict that never landed, still routed through the fix-plan loop).
A BLOCKED dev agent on a skipped wave still surfaces a P0. Any run that leaves
waves unverified opens its PR as a **draft** with a warning banner, and the
"no bugs found" summary says so -- reduced coverage never masquerades as a clean bill.

## Phasing large plans

Large plans (40+ tasks, ~10-15 waves) can run in one long-lived orchestrator
session, and that session's host-process memory is never freed -- on
constrained machines it can crash before the run finishes. Phasing splits an
oversized wave plan into sequential phases so that memory can be reclaimed at
phase boundaries.

- **Threshold.** Phasing only activates once the sliced wave plan has more
  waves than `max_waves_per_phase` (default `4`). At or under the threshold
  the run proceeds exactly as before -- no phase directories, no run-state
  file, nothing changes.
- **Defaults**, configurable in `.plan-runner.yml`:

```yaml
phasing:
  enabled: true            # default true
  max_waves_per_phase: 4   # default 4
  mode: auto                # auto (default) | relay | stop
  auto_stop_phases: 3      # auto mode: relay up to this many phases, stop above
  relay_max_minutes: 90    # relay guardrail: force stop at the next boundary past this
```

  Precedence for each setting is flag > `.plan-runner.yml` > default, the same
  pattern as `--verify`.
- **Relay vs. stop -- the honest memory trade-off.** In `relay` mode, a driver
  session stays alive across phase boundaries and dispatches each phase as its
  own subagent; the driver only ever keeps that phase's compact summary, never
  the underlying wave-by-wave agent transcripts, so the driver's *context*
  stays lean. But the driver's host process itself is never restarted, so its
  memory footprint can still grow over a long run. `stop` mode is the
  complete fix: each phase runs to completion in its own session, that
  session then ends, and a freshly started process picks up the next phase
  via `--resume` -- both context *and* host-process heap reset at every
  boundary. **Only `stop` fully resets process memory; `relay` resets context
  only.**
- **Adaptive default.** With `mode: auto` (the default), plan-runner picks per
  run: if the sliced phase count exceeds `auto_stop_phases` (default `3`) it
  uses `stop`; otherwise it relays. On the Agent Teams backend, phasing always
  uses `stop` regardless of configuration, since a teammate cannot spawn a
  nested team to lead a relay.
- **Relay guardrail.** Because relay never resets the host process, a long
  relay run is bounded by wall time rather than by hoping a small return
  payload is enough on its own: at every phase boundary, if elapsed time since
  the run started exceeds `relay_max_minutes` (default `90`), plan-runner
  forces a stop-and-resume at that boundary instead of continuing to relay.
  Each relayed phase does return a small, bounded summary (roughly 1-2k
  tokens) to the driver to keep its context lean -- that bound is a
  context-size optimization, not the memory fix by itself; it's the wall-time
  guardrail, not the small payload, that keeps a long relay run from creeping
  toward the process-memory ceiling.
- **Kill switch.** `--no-phasing` disables phasing entirely and runs the whole
  plan in one session regardless of size or config, restoring the
  pre-phasing behavior.

## Resuming a run

plan-runner checkpoints every phased run to a `run-state.json` at the cycle
root, updated after every wave. That checkpoint makes it possible to pick a
phased run back up after a planned `stop`-mode boundary, a guardrail-forced
stop, or a crash.

- **`--resume [run-state path]`.** With a path, resumes that specific
  `run-state.json`. Bare (no path), plan-runner scans
  `docs/plan-runner/**/run-state.json` for the most recently updated
  resumable run (one that isn't already complete or abandoned) and resumes
  it. A resume invocation carries no plan path -- all state, including which
  plan was run, comes from the run-state file:

  ```bash
  # Claude Code
  /plan-runner:run --resume

  # Codex
  $plan-runner:run --resume
  ```

- **Auto-detect.** On a normal fresh invocation, if an incomplete run-state is
  found under `docs/plan-runner/`, plan-runner offers to resume it before
  starting the new run; declining marks that run-state abandoned so it isn't
  offered again.
- **Crash recovery.** Resume re-enters at the last completed wave. It never
  assumes partial or uncommitted work from an interrupted wave is done, and
  re-runs that wave from its start. If git is available and the working tree
  is dirty, it asks once whether to stash first or let the wave's agents
  overwrite files as needed. If the plan file has changed since the run was
  checkpointed (by content hash), it warns and requires explicit confirmation
  before continuing -- resuming replays the checkpointed wave plan, it does
  not re-analyze the edited plan.
- Unphased runs (below the phasing threshold, or run with `--no-phasing`)
  write no run-state and are never resumable -- there is nothing to
  checkpoint, so re-invoking just starts a fresh run.

## Code Atlas sync

Right before opening the PR, plan-runner keeps a [code-atlas](../code-atlas)
architecture index in sync with what the cycle just built. If `.code-atlas/state.json`
is present (Code Atlas is installed and has been mapped), it invokes the Code Atlas update skill
with no arguments -- the update diffs file hashes against the committed wave changes and
refreshes only what changed, auto-selecting its depth (micro / targeted / full). If
`.code-atlas/` is absent it is skipped silently; plan-runner never auto-runs a full
Code Atlas map skill. The step is also skipped in no-git mode (the update relies on git).
The update skill writes only to `.code-atlas/` (gitignored), so it adds nothing to the
PR diff -- it runs only on the terminal cycle that opens the PR, not on intermediate
fix-plan re-runs. The outcome is recorded in `manifest.json` under `code_atlas_sync`.

## Pull request

At the end of a run, plan-runner pushes the branch and opens (or updates) a pull
request via the internal Plan Runner PR skill. The PR uses a conventional title
(`feat:`/`fix:`), a structured body (Summary, Changes with a whole-branch diff
summary, Bug counts by severity, and plan-runner stats), and a smart default: it
opens as a **draft** when unresolved bugs remain and ready-for-review otherwise. If a
PR already exists for the branch it is updated in place. When `gh` is not installed,
the title and body are printed for manual creation.

## No-git mode

git is **optional**. At pre-flight, plan-runner runs `git rev-parse
--is-inside-work-tree`; if git is not installed or the working directory is not a git
repository, it sets `git_available = false` (recorded in `manifest.json`) and skips
every git operation: no clean-tree check, no per-wave commits, and no PR step. The
pipeline still analyzes, dispatches dev + verifier agents, runs TDD gates, and
aggregates bugs -- all generated artifacts remain in the cycle directory for review.

## Output

Per cycle, output lives at:

```
docs/plan-runner/{DATE}/cycle-{N}/
  wave-plan.json         # analyzer output
  bugs/
    wave-W-agent-A.json  # one per verifier
  bugs.md                # aggregator's human-readable summary
  fix-plan.md            # aggregator's next-cycle input
  manifest.json          # pipeline metadata
```

**Output location detection.** plan-runner auto-detects where to store cycle artifacts by checking in order:
1. A `plan_runner.output_dir` key in CLAUDE.md (at the active project root or any parent in the config chain).
2. A `plan_runner.output_dir` key in AGENTS.md (same resolution scope).
3. A top-level scan for an existing `docs/plan-runner/`, `build/plan-runner/`, or `.plan-runner/` directory to maintain consistency with previous runs.
4. Default to `docs/plan-runner/` if none of the above resolve.

This allows projects to centralize output handling (e.g., in CI artifacts or non-docs directories) without modifying the plugin and keeps multi-project setups consistent across re-runs.

## Requirements

- Optional: git -- when present, plan-runner commits per wave and opens a PR; when
  absent (no git binary or not a repo), all git operations are skipped (see No-git mode)
- Clean working tree recommended when git is present (you can override, but commits are per-wave)
- Optional: Context7 MCP server for current framework docs (auto-detected; skipped if absent)

## Auto-Setup

On first session start, a hook automatically adds `docs/plan-runner/` to `.gitignore` (if a `.gitignore` exists). Generated output is not committed and remains local to the working tree.

## License

MIT
