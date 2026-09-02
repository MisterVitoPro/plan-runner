# ADR-0010: A bundled Node driver with curl as the transport

Status: accepted
Date: 2026-08-30

## Context

ADR-0009 decided plan-runner issues its own inference requests for endpoint-bound roles. This
repository's product is Markdown prose: `skills/*/SKILL.md` and `agents/*.md` are the behavior,
and `tests/contract.test.js` pins exact phrases in that prose. Deciding *where* the request
logic lives is therefore an architectural decision, not an implementation detail.

The work the new path has to do is unusually failure-prone for prose: composing a JSON body that
survives both PowerShell and Git Bash quoting, applying request defaults, enforcing a timeout well
under the operator's ~300s gateway limit, retrying once with a reduced completion budget, parsing
path-headed fenced code blocks into files, refusing any file outside the task's owned set, and
extracting `usage` and the served model name from the response.

## Options

1. **Prose-only.** SKILL.md carries the whole procedure; the orchestrator composes and runs the
   `curl` invocation and parses the response inline.
2. **A bundled dependency-free Node driver that shells to curl.** `scripts/http-dispatch.js` takes
   a request-spec JSON file and writes a response JSON file; skill prose calls it and pins its
   contract.
3. **An MCP server** exposing a local-model call tool, with the host handling transport.

## Decision

Choose option 2. curl remains the transport -- it is the only new runtime dependency, and it is
what the operator demonstrated working -- while Node builds the body, applies defaults, performs
the retry, and parses the response.

The parts most likely to break are the parts option 1 leaves to a model to re-derive on every run,
on two different shells, with no way to test any of it. Moving them into a script makes them
`node --test` territory, which is how this repo already pins behavior. The prose keeps its
authority over *what* happens and *when*; the script owns only the mechanical *how*.

The script is resolved relative to the active `SKILL.md`, the same mechanism already used for
`../../agents/` and `../../schemas/`. The repo's rule against script-file paths applies to the
SessionStart hook specifically -- where `${CLAUDE_PLUGIN_ROOT}` is unreliable -- and does not
extend to skill-relative resolution.

Option 3 was rejected for its install and registration burden on both backends, and for being
adjacent to the delegate-tool shape the v2.1.0 interview already declined.

## Consequences

- plan-runner ships executable code for the first time beyond its test suite, so `scripts/` needs
  the same no-dependency discipline the rest of the repo has: standard library only, no install
  step, and a contract test asserting it stays dependency-free.
- The driver becomes the single choke point for endpoint requests, which is what makes the request
  defaults (`chat_template_kwargs: {enable_thinking: false}`, timeout) enforceable rather than
  advisory, and what makes the owned-file restriction a code path rather than an instruction.
- Codex must resolve the script path the same skill-relative way it resolves role files. If a host
  cannot execute it, the affected roles have no HTTP path and must fail loudly rather than
  silently falling back to a hosted model.
- Prose and script can drift. The contract test suite has to pin the invocation contract from both
  sides -- the phrases in SKILL.md and the driver's actual input/output shape.
- curl's presence is now a real runtime floor for endpoint-bound roles, and must be probed and
  reported at preflight rather than discovered at the first dispatch.
