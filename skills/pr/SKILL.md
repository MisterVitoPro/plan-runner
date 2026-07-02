---
name: plan-runner:pr
description: >
  Internal plan-runner step (invoked by /plan-runner:run at pipeline end, not run
  directly): push the current branch and open or update a proper pull request --
  conventional title, rich structured body (summary, whole-branch diff, bug counts,
  stats), and a smart draft/ready default based on remaining bugs. Reads everything
  from the completed cycle directory passed as the argument.
---

You are opening (or updating) the pull request for a completed plan-runner run.

The single argument is the absolute path to the completed cycle directory:

**"{$ARGUMENTS}"**

Set `cycle_dir = {$ARGUMENTS}` (strip surrounding whitespace/quotes). Follow these
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

(When invoked by `/plan-runner:run`, this case is already handled upstream and the PR
step is skipped, so this guard only matters for a direct invocation.)

## Step 1: Load cycle state

Read `$cycle_dir/manifest.json`. If it is missing or not valid JSON:

```
Error: cannot read manifest at <cycle_dir>/manifest.json -- cannot build a PR.
```

Then STOP.

From the manifest capture: `cycle`, `backend`, `total_bugs`, `input_plan`, the
`waves` array (length = wave count; sum of each wave's `agents` length = dev agent
count), and `token_usage` (may be absent on pre-1.5.0 manifests, or null).

Read `$cycle_dir/wave-plan.json` for the per-agent `task_title` values (used for the
Summary section). If it is missing, fall back to an empty task list.

## Step 2: Resolve branches and guard

Run:

```bash
git branch --show-current
```

Capture as `branch`. Then resolve the base branch:

```bash
git rev-parse --abbrev-ref origin/HEAD 2>/dev/null | sed 's#^origin/##'
```

Capture as `base`. If the command produces no output, set `base = "main"`.

Guard: if `branch` is empty (detached HEAD) OR `branch` equals `base`, `main`, or
`master`, print and STOP:

```
plan-runner:pr: current branch is "<branch>" -- refusing to open a PR from the base
branch. Check out a feature branch and re-run.
```

## Step 3: Push the branch

```bash
git push -u origin "<branch>"
```

If the push fails, print the git error and STOP (a PR needs a remote branch).

## Step 4: Build the conventional title

1. Determine the subject source, in priority order:
   - The plan's first H1 line. Read `input_plan` and take the first line matching
     `^#\s+(.+)$`; use the captured text.
   - Otherwise the first `task_title` from `wave-plan.json`.
   - Otherwise the literal `plan-runner run`.
2. Determine the type: if the basename of `input_plan` OR the subject text contains
   `fix` or `bug` (case-insensitive), use `fix`; otherwise use `feat`.
3. Normalize the subject: strip a leading `Implementation Plan`/trailing
   `Implementation Plan` boilerplate if present, lowercase the first character, strip
   a trailing period, and hard-truncate to 60 characters at a word boundary.
4. Final `title = "<type>: <subject>"`. Example: `feat: add agent teams backend`.

## Step 5: Build the PR body

Read every `$cycle_dir/bugs/*.json` (if the directory exists). Each file has a `bugs`
array whose entries carry a `severity` of `P0`..`P3`. Tally counts per severity.

Compute the whole-branch diff summary:

```bash
git diff --numstat "<base>...HEAD"
```

Sum column 1 (insertions) and column 2 (deletions) across all rows for totals; count
the rows for files-changed; keep the up-to-10 rows with the largest (ins+del) as the
"most-changed files" list (path with `+ins/-del`).

Assemble the body as Markdown (no "Test plan" section):

```
## Summary
<one "- <task_title>" bullet per agent task from wave-plan.json; "- (no tasks recorded)" if empty>

## Changes
<files-changed> files changed, +<total insertions> / -<total deletions>

Most-changed files:
<one "- <path>  +<ins>/-<del>" line per top file, up to 10>

## Bugs
P0: <n>   P1: <n>   P2: <n>   P3: <n>   (total: <total_bugs>)
<if total_bugs == 0, print "None flagged." instead of the counts line>

## plan-runner stats
- Cycles: <cycle>
- Waves: <wave count>
- Dev agents: <dev agent count>
- Backend: <backend>
- Tokens: <token_usage.total_tokens> across <agents_reported>/<agents_total> subagents<if token_usage present but not complete: " (partial)">

Generated with plan-runner
```

Omit the `Tokens:` line entirely when `token_usage` is absent or null (pre-1.5.0
manifests, or a run where no figure was captured).

## Step 6: Decide draft state

If `total_bugs > 0`, the PR should be a **draft** (unresolved bugs remain).
Otherwise it is **ready for review**. Set `want_draft = (total_bugs > 0)`.

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
gh pr view --json number,isDraft 2>/dev/null
```

- **No existing PR** (command fails / empty): create it. Write the body to a temp
  file to avoid quoting issues, then:

  ```bash
  gh pr create --base "<base>" --title "<title>" --body-file <tmp> <--draft if want_draft>
  ```

- **PR already exists** (parse `number` and `isDraft` from the JSON): update it.

  ```bash
  gh pr edit "<number>" --title "<title>" --body-file <tmp>
  ```

  Then reconcile draft state:
  - If `want_draft` is false and the existing PR `isDraft` is true: `gh pr ready "<number>"`.
  - If `want_draft` is true and the existing PR is already ready: leave it as-is and
    print a note (`gh` cannot re-mark a PR as draft).

Print the PR URL that `gh` returns (for an update, run `gh pr view --json url -q .url`
and print it).

## Step 8: Done

Print a one-line confirmation:

```
plan-runner:pr: <created|updated> <draft|ready> PR for <branch> -> <base>: <url>
```

STOP.
