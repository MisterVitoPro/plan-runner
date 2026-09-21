# plan-runner

![version](https://img.shields.io/github/v/tag/MisterVitoPro/plan-runner?label=version&color=blue)

Take a free-form Markdown implementation plan and execute it as a dependency-ready task DAG of parallel agents -- each task in its own disposable Git worktree, independently verified, and applied to a run-owned integration branch only by a central integrator -- with durable recovery evidence, bug-driven re-planning, and a human-reviewed pull request at the end. Works in Claude Code and Codex. Requires Git.

Pairs with the [ideas](https://github.com/MisterVitoPro/ideas) plugin as the pipeline front door: its interview skill turns a raw idea into an audited spec and emits a plan-runner-ready plan for the run skill. The two install side by side; Ideas complements Plan Runner, it does not replace it.

## What it does

1. **Analyze.** A `plan-analyzer` agent turns the plan into a dependency-ready task graph with stable task IDs. The task DAG is the only executor; at most six tasks run at once.
2. **Confirm.** You see the task graph / execution plan before any dev work runs.
3. **Execute tasks.** Each ready task runs in its own disposable Git worktree based on the integration commit that satisfies its dependencies. After deterministic checks and independent verification, only central integration applies an accepted task to the run-owned integration branch; unrelated ready tasks do not wait for one another, and a task with blocking findings gets one repair attempt before it (and the tasks behind it) is blocked.
4. **Aggregate.** A `plan-aggregator` agent collects every verifier-flagged bug, deduplicates, ranks by severity (P0-P3), and writes both a `bugs.md` audit and a `fix-plan.md` (a new plan ready for re-runs).
5. **Re-run prompt.** You decide whether to auto-handoff to a fresh-context subagent that runs the generated `fix-plan.md` for cycle 2.
6. **Deliver.** Once every task is integrated or blocked and the final full-suite verification passes, the run pushes the integration branch and opens (or updates) a pull request for human review. Plan Runner never merges.

Bundled roles, each loaded relative to the active skill: `plan-analyzer` (read-only graph analysis), `plan-test-author` and `plan-dev` (test-first and implementation work), `plan-verifier` (independent, read-only verification), `plan-integrator` (the central-integration protocol the scheduler follows, and the agent that adjudicates an integration conflict), and `plan-aggregator` (bug dedup, ranking, and fix-plan generation).

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

Every persistent setting below -- execution mode, verification coverage, gate
budgets, phasing, project-agent dispatch, model configuration -- lives in one optional
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

## Task-DAG execution

The task DAG is plan-runner's only executor (since 3.0.0). There is no wave executor, no
wave barrier, and no fallback: a task starts the moment the tasks it depends on are
integrated, without waiting for unrelated work. `--execution-mode wave` and
`execution.mode: wave` stop the run with an error; the other wave-era flags (`--verify`,
`--sync-verify`, `--execution-mode dag`) are accepted and ignored.

**Preflight.** plan-runner requires Git with usable worktrees, probed without touching
your checkout (a throwaway detached worktree is created and removed). Without Git, a
first commit, or worktree support it stops, changes nothing, and tells you how to prepare
the directory (`git init`, a `.gitignore`, one commit); it never approximates task
worktrees on a shared tree. The checkout must be clean: a dirty tree gets a single
explicit `[s]tash / [a]bort` prompt, never a silent stash, discard, or "continue anyway".
It then captures `base_ref`, creates a run-owned integration branch named
`plan-runner/<YYYY-MM-DD>/cycle-<N>` at that commit in a dedicated worktree outside your
checkout, and writes `task-graph.json`, `run-state.json`, and an empty `events.jsonl`.
Your active branch is never checked out, committed to, reset, or merged.

**Worktree bootstrap.** A fresh worktree contains only what Git tracks, so installed
dependencies and build caches are missing from it and every task's tests would reinstall,
cold-build, or fail to start. plan-runner links untracked directories from your checkout
into each new worktree instead, and can run a setup command once per worktree:

```yaml
# .plan-runner.yml
worktree:
  setup: ""       # e.g. "npm ci --prefer-offline"; run once in every new worktree
  share: auto     # auto (default) | none | [node_modules, target, web/node_modules]
```

`share: auto` links whichever of `node_modules`, `.venv`, `venv`, and `vendor` exist at
the repository root and are untracked. List build-output directories such as `target`
explicitly, and only when concurrent builds sharing them are safe for your toolchain
(cargo serializes on a lock and keeps the cache warm). Links are excluded from every task
commit.

**Scheduling.** The analyzer returns a task graph and nothing else: stable, unique task
IDs; acyclic dependency edges that preserve every ordering the plan declares; owned
files, acceptance criteria, recommended model, TDD role, and a verification scope per
task. Any validation failure stops the run before dispatch -- a missing edge or
completion is never inferred. At most six dev tasks are active at once, two active tasks
never share an owned (or declared shared) file, and among ready tasks the one with the
most work waiting behind it goes first. The scheduler advances on durable files (agent
returns, verdicts, gate exit markers) and never idles on a notification.

**One task's pipeline.** Reserve its paths and create its worktree at the integration
commit that satisfies its dependencies; dispatch its agent, which may write only its
declared files (and may run its own targeted tests there -- never as evidence); the
scheduler commits the work and compares the complete diff (added, deleted, renamed,
copied, generated, shared) against declared ownership; its gates run inside that
worktree; an independent `plan-verifier` reads the same pinned tree. A task never
verifies itself.

**Integrate, repair once, or block.** A P0 or P1 finding, an ownership failure, a failed
deterministic check, or a missing verdict blocks integration; P2 and P3 findings ride
along to the fix-plan so a nit never costs the tasks behind it their turn. Blocking
findings earn exactly one evidence-backed repair attempt; a second failure marks the task
`blocked`, and its dependents with it (never run speculatively). Integration is central,
serial, and mechanical -- an ownership re-check, a stale-base comparison, and a
cherry-pick onto the run-owned branch -- so no agent sits behind every task; the
`plan-integrator` role is dispatched only to adjudicate a conflict, which gets one rebuild
before it blocks. If intervening integrations touched a task's files or verification
inputs, the task is re-executed on the current integration commit rather than integrated
blindly.

**Durable evidence.** `run-state.json` holds one authoritative record per task
(`depends_on`, status, attempts, base/produced/integrated commits, worktree path,
verification artifact paths, block reason); `events.jsonl` gains exactly one
schema-validated line per transition (`paths_reserved`, `task_dispatched`,
`task_retry_requested`, `task_verified`, `task_integrated`, `task_blocked`,
`paths_released`, `checkpoint`, `resume`, `final_verification`) and is never rewritten.
Every run writes them, so every run is resumable. Task branches and worktrees are removed
once their final evidence is durable; graph, state, events, returns, gate logs, ownership
evidence, and bug reports stay in the cycle directory.

## Subagent backends

Plan Runner resolves each bundled role definition relative to the active skill and dispatches it through the host's native subagent facility. This works in both Claude Code and Codex without depending on automatic registration of files under `agents/`.

**Nothing bulky is typed into a prompt (since 3.0.0).** Every character of a subagent prompt is generated by the orchestrator, token by token, before that subagent can start, and then stays in the orchestrator's context. So the orchestrator hands over file paths instead of text: a bundled role is delivered as `ROLE DEFINITION: read <absolute path> ...` (pasted inline only as a fallback, when a sandboxed subagent cannot read the plugin directory), the plan reaches the analyzer as a numbered file (`plan.numbered.txt`), and test output reaches the verifier as gate-log paths. Two dispatches still paste definition text, deliberately: a project agent's definition (its position above the overriding contract is part of the guard) and an HTTP endpoint dispatch (the model has no tools to read a file with).

Claude Code additionally supports its experimental **Agent
Teams** orchestration and uses it when available:

- **Enable it** by setting the environment variable
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (e.g. in `~/.claude/settings.json`
  under `"env"`). Requires **Claude Code v2.1.178 or later**.
- **What changes.** The session becomes the team lead and spawns teammates that
  self-claim dispatched tasks from a shared task list and report via the team
  mailbox, so the lead's context stays lean instead of accumulating every agent's
  full JSON return.
- **Same safety contract.** The executor's rules do not depend on the backend. A
  teammate runs one task inside that task's disposable worktree, never touches the
  integration branch or your checkout, and its commit is applied only by central
  integration after deterministic checks and independent verification. Tasks that are
  active at the same time never share a file, which satisfies the Agent Teams "each
  teammate owns different files" requirement.
- **Verifier-gated integration.** Because the team task status lags, the lead waits
  on the verifier's actual result (its file-backed return, not a status poll)
  before integrating a task, and never substitutes its own
  reading of the code for the verifier's verdict. If a verdict never lands the
  task is marked `UNVERIFIABLE` and routed through the fix-plan loop. A
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
  result is captured, task by task, so agents never sit idle for
  the rest of the run.

## Project-agent dispatch

A dev dispatch can be served by a
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
  `agents.project` > default (`true`).

## Token accounting

plan-runner tallies the tokens consumed by every subagent it dispatches -- the
analyzer, every dev agent, each verifier, the integrator, and the aggregator --
so you can see what a cycle cost. The tally is written to `manifest.json` under
`token_usage` (a per-agent `by_agent` breakdown plus a `total_tokens` grand
total) and surfaced in the progress dashboards, the end-of-run Run Report, and
the PR stats.

At the end of every run (both the clean path and the bugs-found path) plan-runner
prints one **Run Report**: a status-aware title, a two-column at-a-glance stat
header (tasks, dev agents, verifiers, repairs, duration, tokens, coverage, bugs), then detail tables -- a per-phase token table (Analyze / Dev / Verify / Aggregate)
with input, output, and total sums, a per-phase reported-coverage column, and a
top-consumers line naming the most expensive subagents; a per-phase timing table;
and an artifacts block. Partial token coverage is flagged as a lower bound and any
blocked tasks are called out, both directly under the stat header. The
manifest carries a `dag` block (base ref, integration
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
  verification only. The analyzer labels them and shows the reason in the task
  plan.
- The **red gate** requires the new tests to fail for a genuine reason
  (import / not-implemented / assertion) while pre-existing tests stay green;
  a syntax/collection error is an invalid red and is flagged as a bug.
- **An invalid red is repaired, not deferred.** New tests that pass before any
  implementation exists fail the test-author task's gate: it gets its one repair
  attempt, and only if that also fails is it blocked (with the impl task that depends
  on it).
- **Bounded repair.** A task whose gates or independent verification return blocking
  findings (P0/P1, an ownership failure, a failed check) gets exactly one
  evidence-backed repair attempt in its worktree; if that also fails the task is
  `blocked` (with its dependents), never integrated, and the findings flow through
  the aggregate -> fix-plan -> re-run loop. P2 and P3 findings never block.
- **Agents check their own work.** Each task owns its worktree, so an impl agent may
  run its own targeted tests, and a test author may confirm its red, before returning.
  Those runs are never evidence: the orchestrator re-runs the gate of record.

**Gate discipline (since 3.0.0).** Gates, not agents, dominated the wall-clock
of long runs, so every test command the orchestrator runs follows four rules:

- **File-backed.** Output goes to a log under the cycle's `gates/` directory;
  the verifier reads the log by path. Test output is never streamed into the
  orchestrator's context or re-typed into a prompt.
- **Budgeted.** A gate that exhausts its budget is killed and recorded
  `TIMEOUT` -- evidence that it did not finish, never a pass and never a
  fabricated failure list.
- **Waited on in the foreground.** A gate is never backgrounded behind a
  monitor while the agent ends its turn: a subagent that returns is never woken,
  which is how one phase runner once sat idle for four hours on a gate that had
  already finished.
- **Honest when it did not run.** A suite that fails to build or collect is
  recorded `BUILD_FAILED`, never as an empty failure list that would read as
  "no regressions"; a baseline that did not run labels every later suite block
  `BASELINE DID NOT RUN`.

```yaml
# .plan-runner.yml
gates:
  targeted_timeout_minutes: 10   # budget for one single-file red/green or scoped run
  suite_timeout_minutes: 30      # budget for one full-suite run (baseline, boundary suite, final verification)
```

Gates run inside the task's own worktree, the only tree that contains that task's work
and nobody else's unfinished edits. Each task runs its targeted red or green gate plus
scoped checks over its `verification_scope`; the full suite runs only for the baseline,
at phase boundaries, and as the final verification. If the baseline itself cannot build
or finish, a gate that cannot build is recorded rather than blocking the task -- which is
what lets a repair plan run against a codebase that does not compile yet.

The test command is resolved as: `--test-cmd "<cmd>"` flag, else auto-detection
from repo markers (`package.json`, `pytest`, `go.mod`, `Cargo.toml`, `*.csproj`,
...), else a one-time prompt. If none can be resolved the run **stops** and
points you to `--no-tdd`.

**Flags:**
- `--no-tdd` -- disable TDD and run the classic (non-TDD) pipeline (TDD is on by default).
- `--test-cmd "<cmd>"` -- supply the test command explicitly; use `{file}` for
  single-file runs (e.g. `pytest {file}`).
- `--phase-size <N>` -- override `phasing.max_integrations_per_phase` for this run. See
  "Phasing large plans" below.
- `--phase-mode <relay|stop>` -- override `phasing.mode` for this run.
- `--no-phasing` -- disable phasing entirely and run the whole graph in
  one scheduler session, regardless of plan size or `.plan-runner.yml` (the phasing kill
  switch).
- `--resume [run-state path]` -- resume an interrupted run from its durable state.
  See "Resuming a run" below.
- `--no-project-agents` -- serve every dispatch from the bundled role definitions.
  See "Project-agent dispatch" above.
- `--no-model-config` -- ignore any `models:` block in `.plan-runner.yml` for this
  run; every role resolves exactly as it did before this feature (the model-policy
  kill-switch). Precedence: `--no-model-config` flag > `.plan-runner.yml`
  `models.enabled` > default.
- `--verbose` -- ask the analyzer for per-task `complexity_signals` in its output.
- Removed in 3.0.0: `--verify`, `--sync-verify`, and `--execution-mode dag` are accepted
  and ignored; `--execution-mode wave` stops the run (the wave executor is gone).

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
like any other task.

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

## Verification

Verification is not configurable: every task attempt gets one independent `plan-verifier`,
because a task cannot integrate without a verdict. It costs the scheduler nothing to wait
for -- the verifier reads the task's own worktree, which nothing else writes to, while
other tasks keep moving. The orchestrator never substitutes its own judgment for a
verdict: a missing verdict is recorded `UNVERIFIABLE`, blocks that task, and flows through
the fix-plan loop. A verdict that arrives late is reconciled by union of findings, never
discarded, and can never un-integrate a task. `--verify`, `--sync-verify`,
`verification.mode`, and `verification.pipelined` belonged to the removed wave executor
and are ignored.

The full suite runs rarely, by design: once for the baseline (in the integration worktree,
before any task), once at each phase boundary, and once as the final verification. Each
task is covered by its targeted gate plus scoped checks over its `verification_scope`,
where a regression is attributable and repairable. The final verification gates delivery:
a run whose integrated branch fails, or cannot run, the full suite opens no PR, and a run
with blocked tasks opens its PR as a **draft** with a banner naming them.

## Phasing large plans

A large plan run in one long-lived scheduler session grows that session's context and
host-process memory without bound -- on constrained machines it can crash before the
run finishes. Phasing bounds it so memory can be reclaimed at phase boundaries.

- **Boundary.** A run checkpoints after a configured number of *successful task
  integrations* -- `phasing.max_integrations_per_phase` (default `12`) is the only
  phase boundary; dispatches are never counted, and there are no waves to count. At
  the boundary the scheduler drains already-active task pipelines to durable state,
  runs the full suite once in the integration worktree, writes a `checkpoint` event
  naming the next task, and then applies the relay/stop rules and wall-time guardrail
  described below. A graph with no more tasks than the boundary runs in one session.
- **Defaults**, configurable in `.plan-runner.yml`:

```yaml
phasing:
  enabled: true                   # default true
  max_integrations_per_phase: 12  # integrations per phase, default 12
  mode: auto                      # auto (default) | relay | stop
  auto_stop_phases: 3             # auto mode: relay up to this many phases, stop above
  relay_max_minutes: 90           # relay guardrail: force stop at the next boundary past this
```

  Precedence for each setting is flag > `.plan-runner.yml` > default.
- **Relay vs. stop -- the honest memory trade-off.** In `relay` mode, a driver
  session stays alive across phase boundaries and dispatches each phase as its
  own subagent; the driver only ever keeps that phase's compact summary, never
  the underlying task-by-task agent transcripts, so the driver's *context*
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
- **A returned runner is never waited on.** If a relayed phase
  runner returns anything other than its phase summary -- a progress note,
  "waiting on the gates" -- the driver treats it as a premature return and
  recovers at once (continuing the same runner, or dispatching a fresh one that
  continues from the durable task state), at most twice per phase, before falling
  back to the normal interrupted-phase path. Phase runners and resumed sessions
  all load the TDD baseline, test command, and resolved
  gate settings from the cycle manifest instead of re-running the baseline: a
  baseline re-captured mid-cycle would absorb earlier phases' regressions as
  "pre-existing", and costs a full suite run per phase. The token tally is
  durable -- appended to the one cycle manifest as each agent's usage is captured --
  so a lost session's agents still count toward coverage.
- **Kill switch.** `--no-phasing` disables phasing entirely and runs
  the whole plan in one session regardless of size or config, restoring the
  pre-phasing behavior.

## Resuming a run

plan-runner checkpoints to a `run-state.json` at the cycle root: every run
writes it before the first dispatch and updates it at every task state transition
(alongside the append-only `events.jsonl`). That checkpoint makes it possible to pick a run back up after a planned
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
- **Recovery.** Before dispatching anything, resume validates the whole run-state against its schema,
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
- **What resume never does.** It never re-captures the TDD baseline (a baseline
  re-captured mid-cycle would absorb integrated tasks' regressions as pre-existing),
  never asks about your working tree (the run never wrote to it; an interrupted
  task's partial work lives only in its disposable worktree), and never spends a
  task's repair budget on an agent that was lost with its session. If the plan file
  has changed since the run was checkpointed (by content hash), it warns and requires
  explicit confirmation before continuing -- resuming replays the checkpointed task
  graph, it does not re-analyze the edited plan.
- A checkpoint written by the removed wave executor (no `dag` state) cannot be
  resumed; start a fresh run on its plan.

## Code Atlas sync

plan-runner no longer syncs a [code-atlas](../code-atlas) index before opening the PR. A
run never changes your checkout -- every integrated commit is on the run-owned branch --
so an incremental update would diff an unchanged tree and index nothing. When
`.code-atlas/state.json` is present, the run prints a one-line reminder to run the Code
Atlas update skill after you merge the PR, and records
`code_atlas_sync: {"ran": false, ...}` in `manifest.json`. It never auto-runs a full map.

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

## Git is required

plan-runner requires a Git repository with at least one commit and usable worktrees.
Every task runs in its own disposable worktree and only verified commits reach a
run-owned branch; without that isolation, gates cannot run while other agents are
editing, and nothing proves which task wrote what. Before 3.0.0 a repository without Git
fell back to a wave executor on the shared working tree; that executor was removed
(ADR-0011). Pre-flight stops, changes nothing, and prints the three commands that prepare
a directory:

```
git init
(add a .gitignore for build output and dependencies first)
git add -A && git commit -m "baseline"
```

## Output

Per cycle, output lives at:

```
<docs_base>/plan-runner/{DATE}/cycle-{N}/    # <docs_base> defaults to docs
  plan.numbered.txt      # numbered plan copy the analyzer reads (never inlined into a prompt)
  task-graph.json        # validated task/dependency graph -- the only plan artifact
  run-state.json         # durable checkpoint: authoritative per-task state + phase boundary
  events.jsonl           # append-only task lifecycle evidence
  manifest.json          # the single cycle manifest (token_usage, backend, dag outcomes, tdd evidence)
  gates/                 # file-backed gate logs: baseline, per-task runs, boundary and final suites
  ownership/             # per-attempt complete-diff ownership evidence
  returns/               # file-backed dev, verifier, and integrator returns (source of truth)
  bugs/                  # one verifier report per task
  bugs.md                # aggregator's human-readable summary
  fix-plan.md            # aggregator's next-cycle input
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

- Git, with at least one commit and usable worktrees (see "Git is required"). plan-runner
  runs on a run-owned integration branch and never touches your active branch.
- A clean working tree at the start of a run (a dirty tree gets an explicit stash-or-abort
  prompt).
- Optional: `gh` for creating the pull request (the title and body are printed otherwise).
- Optional: Context7 MCP server for current framework docs (auto-detected; skipped if absent)

## Auto-Setup

On first session start, a hook automatically adds the base-agnostic `**/plan-runner/` entry to `.gitignore` (if a `.gitignore` exists), so generated artifacts stay ignored wherever `<docs_base>` resolves. Generated output is not committed and remains local to the working tree.

## License

MIT
