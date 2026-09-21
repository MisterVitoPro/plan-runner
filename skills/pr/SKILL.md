---
name: pr
user-invocable: false
description: >
  Internal plan-runner step (invoked by the run skill at pipeline end, not run
  directly): push the run-owned integration branch and open or update a proper pull
  request -- conventional title, rich structured body (task outcomes, whole-branch diff,
  bug counts, stats), and a smart draft/ready default based on remaining bugs and blocked tasks. Reads everything
  from the completed cycle directory passed as the argument.
---

You are opening (or updating) the pull request for a completed plan-runner run.

The skill invocation input is the absolute path to the completed cycle directory.

Set `cycle_dir` to that input (strip surrounding whitespace/quotes). Follow these
steps in order. Do not skip steps.

## Step 0: Git pre-check

This skill is entirely git-dependent (branch resolution, push, PR). Run
`git rev-parse --is-inside-work-tree 2>/dev/null`. If it does NOT succeed and print
`true` -- git is not installed, or the working directory is not a git repository --
print and STOP:

```
plan-runner:pr: git not available (no git binary or not a git repository) --
cannot push a branch or open a PR. Skipping the PR step.
```

(When invoked by the Plan Runner run skill, this case is already handled upstream and the PR
step is skipped, so this guard only matters for a direct invocation.)

## Step 1: Load cycle state

Read `$cycle_dir/manifest.json`. If it is missing or not valid JSON:

```
Error: cannot read manifest at <cycle_dir>/manifest.json -- cannot build a PR.
```

Then STOP.

From the manifest capture: `cycle`, `backend`, `total_bugs`, `input_plan`, the `dag`
object (`dag.tasks` length = task count; tasks with `status: "integrated"` and
`status: "blocked"` counted separately; dev dispatch count = the number of
`token_usage.by_agent` entries whose `phase` is `task`), and
`token_usage` (may be null).

A manifest with no `dag` object was written by the wave executor, which was removed in
plan-runner 3.0.0; there is no run-owned branch to deliver. Print `plan-runner:pr: this
manifest predates the task-DAG executor (no dag evidence) -- nothing to open a PR from.`
and STOP.

**Eligibility (checks, never fields to infer or repair).** `dag.integration_branch` is
the only permitted PR source; `dag.branch_owned` must be `true`; every `dag.tasks[]`
entry must be terminal (`integrated` or `blocked`) -- a task still in flight means the
run is not finished; at least one task must be `integrated` with an
`integrated_commit`; and `dag.final_verification.status` must be `"passed"`. A
`blocked` task does NOT make the run ineligible: the verified work that did integrate
is still worth a human's review, and the PR opens as a draft that names every blocked
task (Steps 5 and 6). If any check fails, print the reason and STOP -- do not push,
open, update, merge, or auto-merge a PR.

Read `$cycle_dir/task-graph.json` for the per-task `task_title` values (used for the
Summary section). If it is missing, fall back to the task ids alone.

## Step 2: Resolve branches and guard

Do **not** use `git branch --show-current` as the PR source and do **not** check out
any branch: the operator's checkout is not part of this run. Set
`branch = dag.integration_branch` (the Step 1 eligibility checks already passed). Resolve
the base branch:

```bash
git rev-parse --abbrev-ref origin/HEAD 2>/dev/null | sed 's#^origin/##'
```

Capture as `base`. If the command produces no output, set `base = "main"`.

Confirm that the local ref exists with:

```bash
git rev-parse --verify "refs/heads/<branch>"
```

If it does not exist, print and STOP: `plan-runner:pr: run-owned integration branch
"<branch>" is unavailable locally -- refusing to substitute the operator branch.`
Guard: if `branch` equals `base`, `main`, or `master`, print and STOP:

```
plan-runner:pr: integration branch is "<branch>" -- refusing to open a PR from the base
branch.
```

The integration branch is run-owned evidence: never fall back to the operator's active
branch.

## Step 3: Push the branch

Push the named integration ref without changing checkout:

```bash
git push -u origin "refs/heads/<branch>:refs/heads/<branch>"
```

If the push fails, print the git error and STOP (a PR needs a remote branch).

## Step 4: Build the conventional title

1. Determine the subject source, in priority order:
   - Resolve `input_plan` back to the true originating plan first: a
     plan-runner-generated fix-plan is identifiable by its header -- its first H1
     matches `^#\s+Fix Plan` AND/OR it contains a line matching
     `^\*\*Original plan:\*\*\s*(.+)$`. When `input_plan` matches, read the path
     captured from that `**Original plan:**` line and use that file in place of
     `input_plan`. Chase this transitively (a fix-plan's original plan may itself be
     a fix-plan) but cap it at 3 hops; if a hop's target is missing, unreadable, or
     revisits a path already seen (a cycle), stop chasing and fall through to the
     next priority below instead of using the fix-plan's own "Fix Plan (cycle N)" H1
     as a title subject.
   - The resolved plan's first H1 line. Read the resolved `input_plan` and take the
     first line matching `^#\s+(.+)$`; use the captured text.
   - Otherwise the first `task_title` from `task-graph.json`.
   - Otherwise the literal `plan-runner run`.
2. Determine the type: if the basename of the resolved `input_plan` (from step 1 --
   the original plan when one was resolved through a fix-plan, never the fix-plan
   itself) OR the subject text contains `fix` or `bug` (case-insensitive), use `fix`;
   otherwise use `feat`.
3. Normalize the subject: strip a leading `Implementation Plan`/trailing
   `Implementation Plan` boilerplate if present, lowercase the first character, strip
   a trailing period, and hard-truncate to 60 characters at a word boundary.
4. Final `title = "<type>: <subject>"`. Example: `feat: add agent teams backend`.

## Step 5: Build the PR body

Read every `$cycle_dir/bugs/*.json` (if the directory exists), skipping superseded first-attempt reports (`*.a1.json`): a repaired task's current report already carries whatever survived. Each file has a `bugs`
array whose entries carry a `severity` of `P0`..`P3`. Tally counts per severity.

Compute the whole-branch diff summary against the base branch's REMOTE tip, never
the local ref -- a local `<base>` that has not been pulled since the last release
silently inflates the diff with commits already merged upstream (stale-base drift).
Refresh it first:

```bash
git fetch origin "<base>"
```

If the fetch succeeds, set `diff_base = "origin/<base>"`; if it fails (offline, no
such remote branch), print `plan-runner:pr: could not fetch origin/<base>; diffing
against local <base>, which may be stale` and set `diff_base = "<base>"`. Then:

```bash
git diff --numstat "<diff_base>...refs/heads/<branch>"
```

Diff the run-owned branch by name, never `HEAD`: `HEAD` is the operator's checkout,
which this run never touched.

Sum column 1 (insertions) and column 2 (deletions) across all rows for totals; count
the rows for files-changed; keep the up-to-10 rows with the largest (ins+del) as the
"most-changed files" list (path with `+ins/-del`).

Assemble the body as Markdown (no "Test plan" section). When any task is `blocked`,
prepend these lines as the FIRST lines of the body, before `## Summary`:

```
> [!WARNING]
> <blocked count> of <task count> tasks are blocked and are NOT in this branch:
> <comma-joined blocked task ids>. See the fix plan.
```

```
## Summary
<one bullet per dag.tasks entry, integrated tasks first: "- <task_title> (<task_id>): <integrated <integrated_commit, 7 chars> | BLOCKED: <block_reason>> (attempts: <attempts>; bugs: <bug_count>)"; "- (no tasks recorded)" if empty>

## Changes
<files-changed> files changed, +<total insertions> / -<total deletions>

Most-changed files:
<one "- <path>  +<ins>/-<del>" line per top file, up to 10>

## Bugs
P0: <n>   P1: <n>   P2: <n>   P3: <n>   (total: <total_bugs>)
<if total_bugs == 0, print "None flagged." instead of the counts line>

<if any task entry carries a non-null `model_substituted`, insert this section here; omit entirely otherwise:>
## Model substitutions
<one "- <task id>: <configured> -> <dispatched> (<reason>)" line per substituted task>

## plan-runner stats
- Cycles: <cycle>
- Tasks: <integrated count>/<task count> integrated (<blocked count> blocked)
- Dev agents: <dev dispatch count, repairs included>
- Backend: <backend>
- Agent sources: <bundled count and per-project-agent counts -- see below; line omitted when absent>
- Tokens: <token_usage.total_tokens> across <agents_reported>/<agents_total> subagents<if token_usage present but not complete: " (partial)">
  - By phase: analyze <sum>, dev <sum>, verify <sum>, integrate <sum>, aggregate <sum>

- Integration branch: <dag.integration_branch> (run-owned)
- Final verification: <dag.final_verification.status> (<artifact count> artifacts)
- Lifecycle events: <dag.events_path>
<if dag.stop_reason is non-null: "- Last stop reason: <dag.stop_reason>">

Generated with plan-runner. This pull request requires human review; plan-runner
does not merge or enable auto-merge.
```

The `By phase` sub-bullet is computed from `token_usage.by_agent`: group entries by
`phase` and sum the non-null `total` values per phase, with thousands separators.
Print `n/a` for a phase where nothing reported; omit a phase entirely when no
subagent was dispatched in it (e.g. integrate when every integration was mechanical,
aggregate on a zero-bug run). The manifest's `task` phase is the `dev` bucket.

Omit the `Tokens:` line (and its `By phase` sub-bullet) entirely when `token_usage`
is absent or null (a run where no figure was captured).

The `Agent sources:` line is built from every task's `dag.tasks[].agent_source` (see
`schemas/manifest.schema.json`: `"bundled"` for the built-in
`plan-dev` role, or `"project:<name>"` when a project agent served the dispatch).
Walk `dag.tasks[]` and tally the exact
`agent_source` string of each entry that has one. Render `bundled <n>` first (when
that bucket is non-empty), followed by one `project:<name> <n>` clause per distinct
project agent, sorted alphabetically by name, each joined with `, `. Example:
`Agent sources: bundled 3, project:frontend-dev-expert 2`.

Omit the `Agent sources:` line entirely when no task entry carries
`agent_source` -- an absent field may mean every dispatch was bundled, but that is an
inference, not a recorded fact, so it must not be reported. Tally only entries that actually carry the field;
never count, guess, or backfill a value for an entry that lacks it.

Omit the warning banner entirely when no task is blocked (nothing to warn about).

The `## Model substitutions` section is built the same way as `Agent sources:`
above: walk `dag.tasks[]` and collect every entry whose `model_substituted` field
(schema addition, model-selection-config feature) is non-null. Render one bullet
per substituted task, in manifest order: `- <task id>:
<model_substituted.configured> -> <model_substituted.dispatched>
(<model_substituted.reason>)`. Omit the whole section -- heading included -- when
no task entry carries a non-null `model_substituted`; a manifest
written before this feature predates the field and every dispatch on it reported
no substitution, so there is nothing to surface. This sits alongside the existing
bug and verification counts precisely so a reviewer sees, in one place, whether a
task ran on a model other than the one configured.

## Step 6: Decide draft state

Set `want_draft = (total_bugs > 0) OR (any task is blocked)`. Unresolved bugs OR any
planned work missing from the branch makes the PR a **draft**; only a run with zero
bugs AND every task integrated opens **ready for review**.

## Step 7: Create or update the PR

Check whether `gh` is available:

```bash
gh --version
```

**If `gh` is NOT available**, print and STOP:

```
Branch pushed to origin/<branch>.

Open a PR manually with these details:

Title: <title>
Base:  <base>
Draft: <want_draft>

Body:
<body>
```

**If `gh` IS available**, check for an existing PR on this branch:

```bash
gh pr view "<branch>" --json number,isDraft,headRefName 2>/dev/null
```

The positional selector is required even when the operator currently has some other
branch checked out. `<branch>` is the run-owned
`dag.integration_branch` resolved in Step 2, so this lookup must never be replaced
with an unqualified `gh pr view` or a lookup based on the active checkout.

- **No existing PR** (command fails / empty): create it. Write the body to a temp
  file to avoid quoting issues, then:

  ```bash
  gh pr create --base "<base>" --head "<branch>" --title "<title>" --body-file <tmp> <--draft if want_draft>
  ```

- **PR already exists** (parse `number`, `isDraft`, and `headRefName` from the JSON):
  first require `headRefName == branch`. If it differs, STOP rather than updating a
  PR sourced from another branch. Otherwise update it.

  ```bash
  gh pr edit "<number>" --title "<title>" --body-file <tmp>
  ```

  Then reconcile draft state:
  - If `want_draft` is false and the existing PR `isDraft` is true: `gh pr ready "<number>"`.
  - If `want_draft` is true and the existing PR is already ready: `gh pr ready "<number>" --undo`
    (a late verdict or a blocked task must be able to pull a ready PR back to draft); if
    that fails on an older `gh`, leave it as-is and print a note.

Never run `gh pr merge`, enable auto-merge, or invoke a merge API. A ready PR is
only ready for human review and delivery remains a human decision.

Print the PR URL that `gh` returns (for an update, run
`gh pr view "<branch>" --json url -q .url` and print it). The URL lookup must use the
same named head branch as the existence check so an unrelated PR from the operator's
checkout cannot be reported.

## Step 8: Done

Print a one-line confirmation:

```
plan-runner:pr: <created|updated> <draft|ready> PR for <branch> -> <base>: <url>
```

STOP.
