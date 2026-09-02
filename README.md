# plan-runner

![version](https://img.shields.io/github/v/tag/MisterVitoPro/plan-runner?label=version&color=blue)

Take a free-form Markdown implementation plan and execute it as a dependency-ready task DAG of parallel agents -- each task in its own disposable Git worktree, independently verified, and applied to a run-owned integration branch only by a central integrator -- with durable recovery evidence, bug-driven re-planning, and a human-reviewed pull request at the end. Works in Claude Code and Codex; falls back to verified file-disjoint waves when Git is unavailable.

Pairs with the [ideas](https://github.com/MisterVitoPro/ideas) plugin as the pipeline front door: its interview skill turns a raw idea into an audited spec and emits a plan-runner-ready plan for the run skill. The two install side by side; Ideas complements Plan Runner, it does not replace it.

## What it does

1. **Analyze.** A `plan-analyzer` agent turns the plan into a dependency-ready task graph with stable task IDs. DAG mode is the default; it keeps the existing six-task concurrency ceiling.
2. **Confirm.** You see the task graph / execution plan before any dev work runs.
3. **Execute tasks.** Each ready task runs in its own disposable Git worktree based on the integration commit that satisfies its dependencies. After deterministic checks and independent verification, only the central integrator applies an accepted task to the run-owned integration branch; unrelated ready tasks do not wait for one another.
4. **Aggregate.** A `plan-aggregator` agent collects every verifier-flagged bug, deduplicates, ranks by severity (P0-P3), and writes both a `bugs.md` audit and a `fix-plan.md` (a new plan ready for re-runs).
5. **Re-run prompt.** You decide whether to auto-handoff to a fresh-context subagent that runs the generated `fix-plan.md` for cycle 2.
6. **Deliver.** Once every required task is integrated and the final full-suite verification boundary passes, the run pushes the integration branch and opens (or updates) a pull request for human review. Plan Runner never merges.

Bundled roles, each loaded relative to the active skill: `plan-analyzer` (read-only graph analysis), `plan-test-author` and `plan-dev` (test-first and implementation work), `plan-verifier` (independent, read-only verification), `plan-integrator` (DAG mode only: ownership, stale-base, and evidence checks before serially applying a task commit), and `plan-aggregator` (bug dedup, ranking, and fix-plan generation).

## Install

```bash
# Claude Code
claude plugin marketplace add MisterVitoPro/esper
claude plugin install plan-runner@esper

# Codex
codex plugin marketplace add MisterVitoPro/esper
codex plugin add plan-runner@esper
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

## Configuration file

Every persistent setting below -- execution mode, verification coverage, phasing,
project-agent dispatch, model configuration -- lives in one optional
`.plan-runner.yml` committed at the repo root. Pre-flight reads that file exactly
once, before any setting resolves, and prints what it found:

```
Config: .plan-runner.yml loaded.
Config: no .plan-runner.yml at repo root -- using defaults.
```

The file is entirely optional; every setting has a default and per-run flags
override it. Keys are extracted individually, so no YAML parser needs to be
installed. If the second line appears in a repo that does have a
`.plan-runner.yml`, the run is silently using defaults for every setting -- treat
it as a bug and report it.

## DAG execution and fallback

`execution.mode` defaults to `dag` (since 2.0.0). The executor is chosen at pre-flight,
with precedence `--execution-mode <dag|wave>` flag > `.plan-runner.yml` `execution.mode`
> default `dag`, and the choice is printed once:
`Execution mode: <mode> (from <flag | .plan-runner.yml | default>).`

```yaml
execution:
  mode: dag # default; set wave for the explicit rollback executor
phasing:
  max_integrations_per_phase: 4 # DAG checkpoint boundary (default 4)
```

**Preflight.** DAG mode requires Git plus usable worktrees, probed without touching
your checkout (a throwaway detached worktree is created and removed). If the probe
fails, Plan Runner prints `DAG execution unavailable (<reason>) -- falling back to the
legacy wave executor.` and runs the wave pipeline instead; it never approximates task
worktrees on a shared tree. The checkout must be clean: a dirty tree gets a single
explicit `[s]tash / [a]bort` prompt, never a silent stash, discard, or "continue anyway".
It then captures `base_ref`, creates a run-owned integration branch named
`plan-runner/<YYYY-MM-DD>/cycle-<N>` at that commit in a dedicated worktree outside your
checkout, and writes `task-graph.json`, `run-state.json`, and an empty `events.jsonl`.
Your active branch is never checked out, committed to, reset, or merged by a DAG run.

**Scheduling.** The analyzer's output must validate both the wave-plan and task-graph
schemas: stable, unique task IDs; acyclic dependency edges that preserve every ordering
the plan declares; owned files, acceptance criteria, recommended model, TDD role, and a
verification scope per task. Any validation failure stops the run before dispatch --
a missing edge or completion is never inferred. A task becomes ready the moment every
dependency it declares is `integrated`; it does not wait for unrelated work. At most six
dev tasks are active at once, and two active tasks never share an owned (or declared
shared) file. Each dispatched task gets its own branch and detached worktree rooted at
the integration commit that satisfied its dependencies, and its agent may write only its
declared owned files plus its file-backed return artifact.

**Verify, then integrate.** When a task returns, it gets scoped deterministic checks
(its tests) and an independent `plan-verifier` pass -- a task never verifies itself.
Only `plan-integrator` mutates the integration branch, and it first compares the task
commit's complete diff (added, deleted, renamed, copied, generated, and shared files)
against declared ownership; an undeclared write rejects the task with durable evidence.
If intervening integrations touched the task's owned files or verification inputs, the
task is re-executed in a fresh worktree on the current integration commit rather than
integrated blindly. The full suite runs at dependency-frontier boundaries and once more
before the PR.

**Bounded repair.** Actionable findings from checks or verification earn exactly one
evidence-backed repair attempt; a second failure marks the task `blocked`. An
integration conflict rebuilds the task worktree at the current integration commit and
retries once; a second conflict blocks. A blocked task's dependents are recorded as
blocked too (never run speculatively), and every block flows through the normal
bugs -> fix-plan -> re-run loop.

**Durable evidence.** `run-state.json` holds one authoritative record per task
(`depends_on`, status, attempts, base/produced/integrated commits, worktree path,
verification artifact paths, block reason); `events.jsonl` gains exactly one
schema-validated line per transition (`task_dispatched`, `task_retry_requested`,
`task_verified`, `task_integrated`, `task_blocked`, `checkpoint`, `resume`) and is
never rewritten. Phasing counts successful integrations, not waves (see "Phasing large
plans"), and resume reads only this evidence (see "Resuming a run"). Task branches and
worktrees are removed once their final evidence is durable; graph, state, events,
returns, test output, and verifier artifacts stay in the cycle directory.

**Rollback.** `--execution-mode wave` (or `execution.mode: wave` in `.plan-runner.yml`)
selects the legacy wave executor explicitly: file-disjoint waves of at most six agents,
a barrier per wave, one commit per wave on your current branch, and pipelined per-wave
verification. It is also the automatic path whenever Git or worktrees are unavailable.
No-Git mode never attempts task worktree dispatch, commits, branch changes, or PR
creation; it preserves the wave pipeline and its local artifacts for review.

## Subagent backends

Plan Runner loads each bundled role definition relative to the active skill and dispatches it through the host's native subagent facility. This works in both Claude Code and Codex without depending on automatic registration of files under `agents/`.

Claude Code additionally supports its experimental **Agent
Teams** orchestration and uses it when available:

- **Enable it** by setting the environment variable
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (e.g. in `~/.claude/settings.json`
  under `"env"`). Requires **Claude Code v2.1.178 or later**.
- **What changes.** The session becomes the team lead and spawns teammates that
  self-claim dispatched tasks from a shared task list and report via the team
  mailbox, so the lead's context stays lean instead of accumulating every agent's
  full JSON return.
- **Same safety contract.** The executor's rules do not depend on the backend. In
  DAG mode a teammate runs one task inside that task's disposable worktree, never
  touches the integration branch or your checkout, and its commit is applied only
  by the central integrator after deterministic checks and independent
  verification. In wave mode the per-wave dev barrier is unchanged: dispatch a
  wave -> wait for all -> run TDD gates -> commit -> next wave, with the wave's
  verifier dispatched right after the commit and its verdict captured while the
  next wave runs (pipelined). File-disjoint tasks and waves (already produced by
  the analyzer) satisfy the Agent Teams "each teammate owns different files"
  requirement.
- **Verifier-gated integration.** Because the team task status lags, the lead waits
  on the verifier's actual result (its file-backed return, not a status poll)
  before integrating a task or closing a wave, and never substitutes its own
  reading of the code for the verifier's verdict. If a verdict never lands the
  task or wave is marked `UNVERIFIABLE` and routed through the fix-plan loop. A
  coverage gate before aggregation backfills any missing verdict, so a PR can never
  open while a verifier is still outstanding.
- **Fallback.** Codex always uses native subagents. If the variable is not set in Claude Code (or the build is older than 2.1.178),
  Plan Runner also uses the native subagent backend. The pre-flight
  output prints which backend is active, and `manifest.json` records it under
  `"backend"`.
- **Display note.** Split-pane teammate views need tmux or iTerm2; the default
  in-process view works everywhere (including Windows Terminal). The re-run loop
  on the teams backend continues in the same lead session, since teammates cannot
  spawn nested teams; for the same reason phased runs on this backend always use
  `stop` mode.
- **No idle agents.** A finished dev agent or verifier does not exit on its own --
  the lead explicitly tears it down (background task or teammate) the moment its
  result is captured, task by task or wave by wave, so agents never sit idle for
  the rest of the run.

## Project-agent dispatch

A dev dispatch (a DAG task, or a wave agent in wave mode) can be served by a
target repo's own specialized agent (a frontend expert, a Rust expert) instead
of the bundled generic `plan-dev`, when the repo ships one that clearly fits. This is on by default; verifier,
test-author, and aggregator dispatches always use their bundled definitions
regardless of what's discovered, which keeps verification independent of
the code's author.

**Discovery.** At pre-flight, plan-runner builds an in-session inventory of
candidate agents from `.claude/agents/*.md`, `.codex/agents/*.md` (when
present), and any additional location **explicitly named** by the repo-root
`AGENTS.md` or `CLAUDE.md` (e.g. "our agents live in `tools/agents/`") -- a
vague mention of "agents" with no named directory doesn't count. Each
file's frontmatter (`name`, `description`, `tools`, `model`) is parsed; an
absent `tools` field means the agent inherits all tools. `AGENTS.md` /
`CLAUDE.md` are also scanned for explicit routing directives of the form
"use agent X for Y work" -- only explicit directives count, never a passing
mention. A malformed or unreadable agent file is skipped with a logged
reason and never fails the run; a repo with no agent directories and no
directives behaves exactly as before, with no warnings.

**Selection**, per dev task, in order:
1. An explicit routing directive covering the task wins outright,
   overriding the description match below.
2. Otherwise a project agent is selected only when its `description`
   **clearly covers** the task's domain -- the bar is deliberately high,
   and any doubt (two plausible agents, or a fit resting on a generic word
   like "code" or "files") selects none.
3. Otherwise the task falls back to the bundled `plan-dev`.

**Tool guard.** A selected project agent whose `tools` frontmatter is
present and lists neither `Write` nor `Edit` is disqualified -- plan-runner
never widens its declared tools to make it eligible; it dispatches bundled
`plan-dev` instead and logs the disqualification.

**Model precedence.** A serving project agent's `model:` frontmatter wins;
when it declares none, the task's `recommended_model` applies. A bundled
`plan-dev` dispatch always uses `recommended_model`.

**The per-invocation contract always wins.** Whichever definition serves a
dispatch, the Dev Return Contract (return JSON shape, status enum,
owned-files rules, no-git-commit rule, token self-report) and the
per-invocation prompt are appended after it and declared overriding --
including the agent's own output format, status vocabulary, writable-file
scope, or any instruction to commit its own work. A project agent's return
is additionally validated against `schemas/dev-return.schema.json`; a
failure gets one re-prompt with the schema alone, and a second failure
records a bug and pins that task to bundled `plan-dev` for the next cycle,
without ever fabricating a return field.

**Provenance.** Each dispatch prints a `served by <plan-dev (bundled) |
<name> (project)>` line at dispatch time, and records `agent_source`
(`"bundled"` or `"project:<name>"`) in that dispatch's manifest entry, the
Run Report's `Served by:` line, and the PR body's provenance stat (omitted
entirely when a manifest predates the field, never inferred).

**Flags:**
- `--no-project-agents` -- disable project-agent dispatch for this run;
  every dispatch uses bundled definitions, byte-identical to pre-feature
  behavior. This is the project-agent kill switch.
- Persistently via `.plan-runner.yml`:

  ```yaml
  agents:
    project: true   # default true; false = bundled-only, same effect as --no-project-agents
  ```

- Precedence: `--no-project-agents` flag > `.plan-runner.yml`
  `agents.project` > default (`true`), the same pattern as `--verify`.

## Token accounting

plan-runner tallies the tokens consumed by every subagent it dispatches -- the
analyzer, every dev agent, each verifier, the integrator, and the aggregator --
so you can see what a cycle cost. The tally is written to `manifest.json` under
`token_usage` (a per-agent `by_agent` breakdown plus a `total_tokens` grand
total) and surfaced in the progress dashboards, the end-of-run Run Report, and
the PR stats.

At the end of every run (both the clean path and the bugs-found path) plan-runner
prints one **Run Report**: a status-aware title, a two-column at-a-glance stat
header (dev agents, verifiers, commits, duration, tokens, coverage, bugs, plus
task outcomes in DAG mode or the wave count in wave mode), then detail tables -- a per-phase token table (Analyze / Dev / Verify / Aggregate)
with input, output, and total sums, a per-phase reported-coverage column, and a
top-consumers line naming the most expensive subagents; a per-phase timing table;
and an artifacts block. Partial token coverage is flagged as a lower bound and any
unverified tasks or waves are called out, both directly under the stat header. In
DAG mode the manifest additionally carries a `dag` block (base ref, integration
branch and its ownership, event-log path, final-verification status, and one
outcome record per task with its retry/block evidence). The PR body
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
- **DAG mode:** a task whose scoped checks or independent verification return
  actionable findings gets exactly one evidence-backed repair attempt in its
  worktree; if that also fails the task is `blocked` (with its dependents), never
  integrated, and the findings flow through the aggregate -> fix-plan -> re-run
  loop.
- **Wave mode:** gate failures are not retried inline -- the impl agent aims for
  a green full-suite, but a wave whose gate fails is **still committed** (marked
  `BUGS_FOUND`); the failures become bugs that flow through the same loop and
  are resolved on the next cycle.

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
- `--execution-mode <dag|wave>` -- pick the executor for this run. Overrides
  `.plan-runner.yml` `execution.mode`; `dag` is the default and `wave` is the
  explicit rollback to the legacy wave executor. See "DAG execution and fallback".
- `--phase-size <N>` -- override `phasing.max_waves_per_phase` (wave mode) for this
  run. See "Phasing large plans" below.
- `--phase-mode <relay|stop>` -- override `phasing.mode` for this run.
- `--no-phasing` -- disable wave-mode phasing entirely and run the whole plan in
  one session, regardless of plan size or `.plan-runner.yml` (the phasing kill
  switch).
- `--resume [run-state path]` -- resume an interrupted run from its durable state.
  See "Resuming a run" below.
- `--no-project-agents` -- serve every dispatch from the bundled role definitions.
  See "Project-agent dispatch" above.
- `--no-model-config` -- ignore any `models:` block in `.plan-runner.yml` for this
  run; every role resolves exactly as it did before this feature (the model-policy
  kill-switch). Precedence: `--no-model-config` flag > `.plan-runner.yml`
  `models.enabled` > default.
- `--verbose` -- ask the analyzer for per-wave `rationale` and per-agent
  `complexity_signals` in its output.

## Model configuration

A target repo may declare a `models:` block in `.plan-runner.yml` to assign a
specific model to any pipeline role (analyzer, dev, test-author, verifier,
aggregator, integrator) or tier, instead of relying solely on bundled defaults.
Tier words (`haiku`, `sonnet`, `opus`) become an abstract vocabulary -- this
feature is what binds them to a concrete model identifier. It governs every
dispatch site: the analyzer, every dev and test-author agent, each verifier,
the aggregator, and the integrator.

Set it persistently in a committed `.plan-runner.yml` at the repo root:

```yaml
models:
  enabled: true
  tiers:
    haiku: claude-haiku-4-5-20251001
    sonnet: claude-sonnet-5
    opus: claude-opus-5
  analyzer: sonnet
  dev: sonnet
  test-author: haiku
  verifier: sonnet
  aggregator: sonnet
  integrator: sonnet
  endpoint:
    base_url: http://localhost:8000/v1
    api_key_env: LOCAL_LLM_API_KEY
    roles: [dev, test-author]
    request:
      timeout_seconds: 240
      max_tokens: 4000
      body:
        chat_template_kwargs:
          enable_thinking: false
```

or per-run with `--no-model-config` (which overrides the file). Precedence:
`--no-model-config` flag > `.plan-runner.yml` `models.enabled` > default (`true`).

**How it works.** For every role, the executor resolves the model in this order:
1. A serving project agent's `model:` frontmatter (dev dispatch only).
2. The per-role key for that role in `.plan-runner.yml`, if set.
3. The tier entry for the tier the role needs, if the tiers map declares that tier.
4. The built-in default (bundled agent `model:`, the analyzer heuristic, or
   `sonnet` for verification roles).

A configured value that is not a tier word (`haiku`, `sonnet`, `opus`) is
treated as a raw model identifier and passed verbatim to the host.

When `models.enabled: false` (or `--no-model-config` is passed), every role
resolves exactly as it did before this feature -- tier words are unused and
configuration is skipped entirely.

**Local models and endpoints.** When you serve models through a custom endpoint
(a local LLM, a corporate proxy, or an alternative provider), configure the
endpoint in the `models.endpoint` block:

- **`base_url`** -- the endpoint's OpenAI-compatible root URL, including its
  `/v1` prefix if it has one (e.g. `http://localhost:8000/v1` for a local vLLM
  service; the dispatch driver appends `/chat/completions` itself).
- **`api_key_env`** -- the name of an environment variable holding the endpoint's
  API key or credentials. Plan Runner never sets `ANTHROPIC_BASE_URL` itself; the
  operator is responsible for exporting this variable before invoking plan-runner.
  A model served through a configured endpoint is non-degradable: it shall never
  silently fall back to a hosted model if the endpoint becomes unavailable. If
  such a model becomes unreachable, plan-runner asks the operator when a
  structured-input facility is available; otherwise it halts that dispatch and
  records it -- it never reroutes the request to a hosted model.

**Dispatching dev work over the endpoint.** `models.endpoint.roles` names which
pipeline roles this run dispatches by issuing an OpenAI-compatible
chat-completions request to `base_url` directly, instead of handing the work to
a host subagent -- for example `roles: [dev, test-author]`. **`dev` and
`test-author` are the only eligible roles**: they are code-writing work with no
need for repository or tool access. Naming `analyzer`, `aggregator`, or
`verifier` here is a configuration error, not an honored setting -- plan-runner
prints it and stops before dispatching anything, because none of those three
can be served by a raw HTTP completion. When `roles` is non-empty, preflight
also checks that `curl` is executable (the dispatch driver shells out to
`curl`, never Node's `fetch`) and prints the resolved map so a run's actual
dispatch mechanism is never a silent surprise:

    Endpoint role map:
      analyzer:    host subagent
      dev:         endpoint (http://localhost:8000/v1)
      test-author: endpoint (http://localhost:8000/v1)
      verifier:    host subagent
      aggregator:  host subagent
      integrator:  host subagent

An endpoint-bound dev/test-author agent's request carries the task excerpt,
its acceptance criteria, a read-only "conventions sample" (existing test files
nearest the task's owned paths, at most 3 whole files and 32 KB total -- **a
request-size guard, not a context-window guarantee**: the cap only bounds what
fits in one HTTP request body, not how much of it a model can actually use),
and the full content of its owned files. It responds with one fenced code
block per file, which plan-runner's parser writes to disk directly -- there is
no JSON return from the model at all; plan-runner constructs that agent's
return object itself from the response, so nothing the model claims about its
own status is trusted. A failing request retries exactly once at a reduced
completion budget; a still-failing retry is a durable `BLOCKED`, never a
silent fallback to a host subagent or a hosted model -- degrading would move
source code off the operator's machine, the one outcome this feature exists to
prevent. Its work is still graded by an independent, host-dispatched verifier
like any other dev agent in the wave.

**Request passthrough.** `models.endpoint.request` overrides the dispatch
driver's own defaults -- a 240-second timeout (kept under the ~300-second
gateway bound many local/proxied endpoints impose) and
`chat_template_kwargs: {enable_thinking: false}` -- key by key, so setting one
key never discards the rest. See the `request:` block in the example above for
its shape (`timeout_seconds`, `max_tokens`, and a `body` object merged over the
composed request body).

**Availability gate.** When plan-runner finds one or more configured models that
cannot be served (an endpoint is unreachable, the API key environment variable
is absent or empty, or a configured value is malformed), it asks the operator
once, before any dev agent is dispatched, whether to substitute the closest
available model instead. This gate fires at most once per run. On an unattended
run (no structured input available), plan-runner degrades to the closest
available model, records the substitution, and continues rather than blocking.

## Verification coverage

plan-runner verifies work with an independent, read-only verifier agent that
never shares a definition with the code's author. In DAG mode every task is
verified before the integrator will accept it, so coverage is total by
construction. In wave mode, how much verification runs is configurable via
`verify_mode`:

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

**Pipelined verification (wave mode, default since 1.14).** The verifier no
longer sits between waves: each wave is committed first, then its verifier is dispatched
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
tasks or waves unverified opens its PR as a **draft** with a warning banner, and
the "no bugs found" summary says so -- reduced coverage never masquerades as a
clean bill.

## Phasing large plans

Large plans (40+ tasks, ~10-15 waves) can run in one long-lived orchestrator
session, and that session's host-process memory is never freed -- on
constrained machines it can crash before the run finishes. Phasing splits an
oversized wave plan into sequential phases so that memory can be reclaimed at
phase boundaries.

- **DAG mode boundary.** A DAG run checkpoints after a configured number of
  *successful task integrations* -- `phasing.max_integrations_per_phase`
  (default `4`) is the only DAG phase boundary; waves and dispatches are never
  counted. At the boundary the scheduler drains already-active task returns to
  durable state, writes a `checkpoint` event naming the next task to resume,
  and then applies the same relay/stop rules and wall-time guardrail described
  below.
- **Wave mode threshold.** Phasing only activates once the sliced wave plan has
  more waves than `max_waves_per_phase` (default `4`). At or under the threshold
  the run proceeds exactly as before -- no phase directories, no run-state
  file, nothing changes.
- **Defaults**, configurable in `.plan-runner.yml`:

```yaml
phasing:
  enabled: true                   # default true
  max_waves_per_phase: 4          # wave mode boundary, default 4
  max_integrations_per_phase: 4   # DAG mode boundary, default 4
  mode: auto                      # auto (default) | relay | stop
  auto_stop_phases: 3             # auto mode: relay up to this many phases, stop above
  relay_max_minutes: 90           # relay guardrail: force stop at the next boundary past this
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
- **Kill switch.** `--no-phasing` disables wave-mode phasing entirely and runs
  the whole plan in one session regardless of size or config, restoring the
  pre-phasing behavior.

## Resuming a run

plan-runner checkpoints to a `run-state.json` at the cycle root: every DAG run
writes it at preflight and updates it at every task state transition (alongside
the append-only `events.jsonl`), and every phased wave run updates it after every
wave. That checkpoint makes it possible to pick a run back up after a planned
`stop`-mode boundary, a guardrail-forced stop, or a crash.

- **`--resume [run-state path]`.** With a path, resumes that specific
  `run-state.json`. Bare (no path), plan-runner scans
  `<docs_base>/plan-runner/**/run-state.json` for the most recently updated
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
  found under `<docs_base>/plan-runner/`, plan-runner offers to resume it before
  starting the new run; declining marks that run-state abandoned so it isn't
  offered again.
- **DAG recovery.** A checkpoint whose state says `dag.mode: "dag"` takes a
  dedicated resume path that never reinterprets task state as waves. Before
  dispatching anything it validates the whole run-state against its schema,
  checks that the run-owned integration branch and base ref still exist (and
  that the base is an ancestor of the branch), re-validates `task-graph.json`
  against the recorded task set, and replays every `events.jsonl` line as audit
  evidence -- each integrated task must have its `task_integrated` event and
  commit, each blocked task its `task_blocked` event. Only then does it append a
  `resume` event and recompute the ready set. An `integrated` task is never
  redispatched; in-flight tasks continue from their durable worktree, return,
  and verification artifacts; blocked tasks stay blocked. Any mismatch,
  malformed line, or missing record is a safe stop that leaves the checkpoint
  intact for inspection -- completion is never inferred from Git history.
- **Wave crash recovery.** Resume re-enters at the last completed wave. It never
  assumes partial or uncommitted work from an interrupted wave is done, and
  re-runs that wave from its start. If git is available and the working tree
  is dirty, it asks once whether to stash first or let the wave's agents
  overwrite files as needed. If the plan file has changed since the run was
  checkpointed (by content hash), it warns and requires explicit confirmation
  before continuing -- resuming replays the checkpointed wave plan, it does
  not re-analyze the edited plan.
- Unphased wave runs (below the phasing threshold, or run with `--no-phasing`)
  write no run-state and are never resumable -- there is nothing to
  checkpoint, so re-invoking just starts a fresh run.

## Code Atlas sync

Right before opening the PR, plan-runner keeps a [code-atlas](../code-atlas)
architecture index in sync with what the cycle just built. If `.code-atlas/state.json`
is present (Code Atlas is installed and has been mapped), it invokes the Code Atlas update skill
with no arguments -- the update diffs file hashes against the cycle's committed changes and
refreshes only what changed, auto-selecting its depth (micro / targeted / full). If
`.code-atlas/` is absent it is skipped silently; plan-runner never auto-runs a full
Code Atlas map skill. The step is also skipped in no-git mode (the update relies on git).
The update skill writes only to `.code-atlas/` (gitignored), so it adds nothing to the
PR diff -- it runs only on the terminal cycle that opens the PR, not on intermediate
fix-plan re-runs. The outcome is recorded in `manifest.json` under `code_atlas_sync`.

## Pull request

At the end of a run, plan-runner pushes the run-owned integration branch and opens
(or updates) a pull request via the internal Plan Runner PR skill. The PR uses a conventional title
(`feat:`/`fix:`), a structured body (Summary, Changes with a whole-branch diff
summary, task outcomes, retry/block and ownership evidence, Bug counts by severity,
and plan-runner stats), and a smart default: it
opens as a **draft** when unresolved bugs remain and ready-for-review otherwise. If a
PR already exists for the branch it is updated in place. This is always human-reviewed
delivery: Plan Runner does **not** auto-merge a pull request. When `gh` is not installed,
the title and body are printed for manual creation.

## No-git mode

git is **optional**. At pre-flight, plan-runner runs `git rev-parse
--is-inside-work-tree`; if git is not installed or the working directory is not a git
repository, it sets `git_available = false` (recorded in `manifest.json`) and skips
every git operation: no clean-tree check, no task worktrees or integration branch,
no per-wave commits, and no PR step. The run uses the wave executor (DAG mode needs
Git), still analyzes, dispatches dev + verifier agents, runs TDD gates, and
aggregates bugs -- all generated artifacts remain in the cycle directory for review.

## Output

Per cycle, output lives at:

```
<docs_base>/plan-runner/{DATE}/cycle-{N}/    # <docs_base> defaults to docs
  wave-plan.json         # full analyzer output (task graph + legacy fallback waves)
  task-graph.json        # validated task/dependency graph (DAG mode)
  run-state.json         # durable checkpoint: per-task state (DAG) or phase/wave state (phased wave runs)
  events.jsonl           # append-only task lifecycle evidence (DAG mode)
  returns/               # file-backed dev and verifier returns (source of truth)
  bugs/                  # one verifier report per task (DAG) or per wave (wave mode)
  bugs.md                # aggregator's human-readable summary
  fix-plan.md            # aggregator's next-cycle input
  manifest.json          # pipeline metadata (token_usage, backend, dag evidence, ...)
  phase-{P}/             # phased wave runs only: that phase's slice, bugs/, returns/, manifest
```

**Output location detection.** plan-runner resolves the output base `<docs_base>` at pre-flight (before any resume discovery), then writes the cycle tree under `<docs_base>/plan-runner/`. There is no settings key to configure -- resolution is three tiers, in order:

1. **An explicit prose statement.** The repo-root `CLAUDE.md`, then the repo-root `AGENTS.md`, then any repository instructions already loaded into context, are checked for a sentence that explicitly names a documentation directory (e.g. "docs live in `documentation/`", "project docs are under `doc/`"). A vague mention of "docs" with no named directory does not count and falls through to the next tier.
2. **A top-level scan.** Otherwise the repo-root top-level entries are scanned for a directory named literally `docs`, `doc`, `documentation`, or `.docs`, in that fixed order; the first match wins. If several exist, only the first in that order is used -- a second base is never created or used.
3. **Default.** Otherwise `<docs_base>` is `docs`, which is the pre-1.15.0 behavior.

The resolved base and where it came from are printed once at run start:

```
Output location: <docs_base>/plan-runner/ (from <CLAUDE.md | AGENTS.md | top-level scan | default>).
```

The resolved value is also recorded as `docs_base` in the cycle `manifest.json`. This lets a project that keeps its documentation somewhere other than `docs/` get plan-runner artifacts in the right place without any plugin configuration, and it keeps re-runs and resume consistent: when the resolved base differs from `docs`, resume discovery scans both `<docs_base>/plan-runner/**/run-state.json` and the legacy `docs/plan-runner/**/run-state.json`.

## Requirements

- Optional: git -- with usable worktrees, plan-runner runs the task DAG on a run-owned
  integration branch and opens a PR; without worktrees it falls back to per-wave commits;
  when absent (no git binary or not a repo), all git operations are skipped (see No-git mode)
- Clean working tree required for DAG mode (a dirty tree gets an explicit stash-or-abort
  prompt) and recommended in wave mode (you can override, but commits are per-wave)
- Optional: Context7 MCP server for current framework docs (auto-detected; skipped if absent)

## Auto-Setup

On first session start, a hook automatically adds the base-agnostic `**/plan-runner/` entry to `.gitignore` (if a `.gitignore` exists), so generated artifacts stay ignored wherever `<docs_base>` resolves. Generated output is not committed and remains local to the working tree.

## License

MIT
