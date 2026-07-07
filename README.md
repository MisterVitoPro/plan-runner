# plan-runner

![version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FMisterVitoPro%2Fplan-runner%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&label=version&color=blue)

Take a free-form Markdown implementation plan and execute it through a parallel agent swarm with built-in verification and bug-driven re-planning.

## What it does

1. **Analyze.** A `plan-analyzer` agent reads your plan and buckets tasks into waves of file-disjoint work (max 6 agents per wave, ordered as a DAG).
2. **Confirm.** You see the wave plan and approve before any dev work runs.
3. **Execute per wave.** For each wave: dispatch up to 6 dev agents in parallel (TDD runs use `plan-test-author` for test-author roles and `plan-dev` for impl/standalone roles), then dispatch one `plan-verifier` for the wave, then commit the wave with verifier status in the message.
4. **Aggregate.** A `plan-aggregator` agent collects every verifier-flagged bug, deduplicates, ranks by severity (P0-P3), and writes both a `bugs.md` audit and a `fix-plan.md` (a new plan ready for re-runs).
5. **Re-run prompt.** You decide whether to auto-handoff to a fresh-context subagent that runs `/plan-runner:run <fix-plan.md>` for cycle 2.

## Install

```bash
claude plugin marketplace add MisterVitoPro/qa-claude-market
claude plugin install plan-runner@mistervitopro-plugin-marketplace
```

## Usage

```bash
/plan-runner:run docs/foo/feature-plan.md
```

The plan can be any Markdown file with task content. There is no required schema -- the analyzer reads it heuristically.

## Token-efficient mode (Agent Teams, experimental)

plan-runner dispatches every pipeline agent (analyzer, dev, test-author,
verifier, aggregator) by its **registered subagent type** rather than pasting the
agent definition into each prompt. This alone removes the dominant token cost and
applies to every run.

On top of that, plan-runner auto-detects Claude Code's experimental **Agent
Teams** orchestration and uses it when available:

- **Enable it** by setting the environment variable
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (e.g. in `~/.claude/settings.json`
  under `"env"`). Requires **Claude Code v2.1.178 or later**.
- **What changes.** The session becomes the team lead and spawns teammates that
  self-claim each wave's tasks from a shared task list and report via the team
  mailbox, so the lead's context stays lean instead of accumulating every agent's
  full JSON return.
- **Same safety contract.** The per-wave barrier is unchanged: dispatch a wave ->
  wait for all -> run TDD gates -> verify -> commit -> next wave. File-disjoint
  waves (already produced by the analyzer) satisfy the Agent Teams "each teammate
  owns different files" requirement.
- **Verifier-gated waves.** Because the team task status lags, the lead waits on
  the verifier's actual task result (not a status poll) before closing a wave, and
  never substitutes its own reading of the code for the verifier's verdict. If a
  verdict never lands the wave is marked `UNVERIFIABLE` and routed through the
  fix-plan loop. A coverage gate before aggregation backfills any missing verdict,
  so a PR can never open while a wave's verifier is still outstanding.
- **Fallback.** If the variable is not set (or the build is older than 2.1.178),
  plan-runner transparently uses the original subagent backend. The pre-flight
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
total) and surfaced in the wave dashboards, the end-of-run Token Report, and the
PR stats.

At the end of every run (both the clean path and the bugs-found path) plan-runner
prints a **Token Report**: a per-phase table (Analyze / Dev / Verify / Aggregate)
with input, output, and total sums, a per-phase reported-coverage column, a
top-consumers line naming the most expensive subagents, and a grand total with an
honest coverage line. The PR body carries a compact per-phase breakdown under its
`Tokens:` stat.

Capture is **best-effort**: there is no tool that returns a subagent's token
count, so plan-runner records the usage figure the harness surfaces when each
subagent finishes. When a figure is unavailable -- most commonly for teammates on
the Agent Teams backend, whose usage is not always visible to the lead -- that
agent's entry is `null` and the run is honest about it via the
`agents_reported` / `agents_total` coverage counters and a `complete` flag. A
token count is never fabricated. Each cycle's manifest records its own tally; to
tally a full multi-cycle run, sum `token_usage.total_tokens` across every cycle's
`manifest.json` under the cycle root.

## TDD red-green mode

`/plan-runner:run` enables a Test-Driven Development red-green workflow by
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

## Code Atlas sync

Right before opening the PR, plan-runner keeps a [code-atlas](../code-atlas)
architecture index in sync with what the cycle just built. If `.code-atlas/state.json`
is present (code-atlas is installed and has been mapped), it invokes `/code-atlas:update`
with no arguments -- the update diffs file hashes against the committed wave changes and
refreshes only what changed, auto-selecting its depth (micro / targeted / full). If
`.code-atlas/` is absent it is skipped silently; plan-runner never auto-runs a full
`/code-atlas:map`. The step is also skipped in no-git mode (the update relies on git).
`code-atlas:update` writes only to `.code-atlas/` (gitignored), so it adds nothing to the
PR diff -- it runs only on the terminal cycle that opens the PR, not on intermediate
fix-plan re-runs. The outcome is recorded in `manifest.json` under `code_atlas_sync`.

## Pull request

At the end of a run, plan-runner pushes the branch and opens (or updates) a pull
request via the internal `plan-runner:pr` skill. The PR uses a conventional title
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

## Requirements

- Optional: git -- when present, plan-runner commits per wave and opens a PR; when
  absent (no git binary or not a repo), all git operations are skipped (see No-git mode)
- Clean working tree recommended when git is present (you can override, but commits are per-wave)
- Optional: Context7 MCP server for current framework docs (auto-detected; skipped if absent)

## Auto-Setup

On first session start, a hook automatically adds `docs/plan-runner/` to `.gitignore` (if a `.gitignore` exists). Generated output is not committed and remains local to the working tree.

## License

MIT
