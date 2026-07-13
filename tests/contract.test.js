const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

test("plan-test-author agent exists and only writes failing tests", () => {
  assert.ok(exists("agents/plan-test-author.md"), "agents/plan-test-author.md must exist");
  const f = read("agents/plan-test-author.md");
  assert.match(f, /name:\s*plan-test-author/, "frontmatter name");
  assert.match(f, /failing test/i, "must describe writing a failing test");
  assert.match(f, /do not.{0,20}implement|never.{0,20}implement|not (write|implement).{0,40}implementation/i, "must forbid writing implementation");
  assert.match(f, /test_files/, "must return test_files");
});

test("plan-analyzer classifies testable tasks and splits them in TDD mode", () => {
  const f = read("agents/plan-analyzer.md");
  assert.match(f, /tdd_enabled/, "must read a tdd_enabled flag");
  assert.match(f, /testable/i, "must classify tasks testable vs non-testable");
  assert.match(f, /non_testable_reason/, "must record a reason for non-testable tasks");
  assert.match(f, /test-author/i, "must emit a test-author node");
  assert.match(f, /tests_to_satisfy/, "impl node must point at the paired tests");
  assert.match(f, /already exist/i, "re-run: detect pre-existing tests -> impl-only");
});

test("plan-verifier supports red-gate and green-gate modes", () => {
  const f = read("agents/plan-verifier.md");
  assert.match(f, /red-gate/i, "must define red-gate behavior");
  assert.match(f, /green-gate/i, "must define green-gate behavior");
  assert.match(f, /valid_red|valid red/i, "must judge whether red is valid");
  assert.match(f, /syntax|collection/i, "syntax/collection error = invalid red");
  assert.match(f, /broken_existing/, "must flag broken pre-existing tests");
  assert.match(f, /captured_test_output|test-run output/i, "consumes orchestrator-captured test output");
});

test("plan-dev consumes tests_to_satisfy and is gated on green", () => {
  const f = read("agents/plan-dev.md");
  assert.match(f, /tests_to_satisfy/, "impl must be told which tests to satisfy");
  assert.match(f, /green gate|make.{0,30}tests pass/i, "impl must aim to make the tests pass");
});

test("SKILL pre-flight handles --no-tdd, prompts, resolves test cmd, stops if none", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /--no-tdd/, "must document the --no-tdd flag");
  assert.match(f, /auto-enabled|on by default|enabled.{0,20}default/i, "TDD is auto-enabled by default (no prompt)");
  assert.match(f, /--test-cmd/, "must support a --test-cmd flag");
  assert.match(f, /package\.json|pytest|go\.mod|Cargo\.toml|csproj/i, "must list detection markers");
  assert.match(f, /baseline/i, "must capture a green baseline");
  assert.match(f, /\{file\}/, "must store a single-file invocation pattern");
  assert.match(f, /STOP[\s\S]{0,200}--no-tdd/, "must STOP (not downgrade) when no test cmd is resolved");
});

test("SKILL passes tdd flags to analyzer and shows roles in the wave plan", () => {
  const f = read("skills/run/SKILL.md");
  // analyzer dispatch block must forward the tdd flag + test command
  assert.match(f, /TDD enabled:\s*<tdd_enabled>|tdd_enabled:\s*<tdd_enabled>/, "analyzer prompt forwards tdd_enabled");
  assert.match(f, /Test command:\s*<.*single.*>|test_command/i, "analyzer prompt forwards the test command");
  // display must surface role / testability
  assert.match(f, /\[test\]|\[impl\]|role|testable|non-testable/i, "wave-plan display must surface roles/testability");
});

test("SKILL analyzer parse-retry continues the same session (no plan resend)", () => {
  const f = read("skills/run/SKILL.md");
  // the retry must reuse the analyzer session via SendMessage, not respawn
  assert.match(f, /continuing the SAME analyzer session/i, "retry must continue the same analyzer session");
  assert.match(f, /SendMessage[\s\S]{0,80}agent id/i, "retry is sent via SendMessage to the analyzer's agent id");
  assert.match(f, /do NOT dispatch a fresh analyzer/i, "retry must not respawn a fresh analyzer");
  // the token-efficiency rationale (avoid resending the plan) is recorded
  assert.match(f, /resend the entire plan|resend.{0,20}plan/i, "must note that a fresh spawn would resend the whole plan");
});

test("SKILL runs per-agent red/green gates, routes bugs, records evidence", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /Red gate/i, "red gate step");
  assert.match(f, /Green gate/i, "green gate step");
  assert.match(f, /per agent|per-agent/i, "gates applied per agent within a wave");
  assert.match(f, /invalid red[\s\S]{0,160}(BLOCKED|skip)/i, "invalid red blocks/skips the paired impl");
  assert.match(f, /No inline retries|no retries|without retr/i, "explicitly no inline retries");
  assert.match(f, /tdd\.tasks|red_run|green_run/i, "writes red/green evidence to the manifest");
});

test("SKILL Step 4a dispatches agents by role (test-author vs impl)", () => {
  const f = read("skills/run/SKILL.md");
  // the test-author agent must be dispatched by registered subagent type (not inlined)
  assert.match(f, /plan-runner:plan-test-author/, "Step 4 must dispatch the plan-test-author agent by subagent type for test-author roles");
  // dispatch must branch on role
  assert.match(f, /role.{0,40}(test-author|impl)/is, "dispatch must select the agent by role");
  // impl agents must be told which tests to satisfy at dispatch time
  assert.match(f, /TESTS TO SATISFY|forward.{0,30}tests_to_satisfy|tests_to_satisfy.{0,40}(prompt|dispatch|impl agent)/is, "impl dispatch must forward tests_to_satisfy");
});

test("SKILL dispatches pipeline agents by registered subagent type (no inlining)", () => {
  const f = read("skills/run/SKILL.md");
  // all five pipeline agents are referenced by type, keeping prompts token-lean
  for (const t of [
    "plan-runner:plan-analyzer",
    "plan-runner:plan-dev",
    "plan-runner:plan-test-author",
    "plan-runner:plan-verifier",
    "plan-runner:plan-aggregator",
  ]) {
    assert.match(f, new RegExp(t), `must dispatch ${t} by subagent type`);
  }
  // the old inline-the-full-content pattern must be gone
  assert.doesNotMatch(f, /inline the full content of .*agents\/.*\.md/i, "must not inline agent .md bodies into prompts");
});

test("SKILL gates each wave on the verifier and forbids the orchestrator self-verifying", () => {
  const f = read("skills/run/SKILL.md");
  // teams-aware verifier completion: poll the actual task result, not a status guess
  assert.match(f, /poll the verifier's task result|task result \/ mailbox[\s\S]{0,200}verifier/i, "teams backend must poll the verifier's task result");
  // explicit no-self-verify rule
  assert.match(f, /No-self-verify|MUST NOT perform the verification itself|MUST NOT substitute its own judgment/i, "must forbid the orchestrator from self-verifying");
  // missing verdict routes to UNVERIFIABLE, not a silently-closed wave
  assert.match(f, /UNVERIFIABLE[\s\S]{0,160}(aggregate|fix-plan|re-run)/i, "missing verdict must route through the fix-plan loop");
});

test("SKILL has a verifier-coverage gate before aggregation", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /Verifier-coverage gate/i, "must define a verifier-coverage gate");
  // gate lives at the top of Step 5, before the bug count, so both the clean and buggy paths hit it
  assert.ok(
    f.indexOf("Verifier-coverage gate") < f.indexOf("Count total bugs across all bug JSONs"),
    "the coverage gate must run before counting bugs"
  );
  assert.match(f, /every.{0,10}wave[\s\S]{0,120}wave-<W>\.json/i, "must assert every wave produced a bug JSON");
  assert.match(f, /structurally impossible to reach the PR|PR.{0,40}(outstanding|while a verifier)/i, "gate must block opening a PR while a verdict is outstanding");
});

test("coverage gate treats SKIPPED as intentional, distinct from UNVERIFIABLE", () => {
  const f = read("skills/run/SKILL.md");
  // SKIPPED is a present, non-null status -> not backfilled, not a bug
  assert.match(f, /SKIPPED[\s\S]{0,240}(does NOT backfill|not.{0,20}backfill|not.{0,25}treat it as a bug)/i, "SKIPPED waves are not backfilled as bugs");
  // in-scope-but-missing verdict still becomes UNVERIFIABLE
  assert.match(f, /in scope for a semantic verifier[\s\S]{0,160}UNVERIFIABLE|UNVERIFIABLE[\s\S]{0,200}(missing|null)/i, "in-scope missing verdict still becomes UNVERIFIABLE");
});

test("SKILL selects an execution backend (Agent Teams vs subagent fallback)", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS/, "must read the agent-teams env var");
  assert.match(f, /backend\s*=\s*"teams"/, "must select the teams backend");
  assert.match(f, /backend\s*=\s*"subagent"/, "must fall back to the subagent backend");
  assert.match(f, /per-wave barrier|wave barrier/i, "both backends must keep the per-wave barrier");
});

test("docs + version reflect the TDD feature", () => {
  const pkg = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.equal(pkg.version, "1.11.0", "plugin version is current");
  const readme = read("README.md");
  assert.match(readme, /--no-tdd/, "README documents the --no-tdd flag");
  assert.match(readme, /red.{0,5}green|red→green/i, "README describes the red-green flow");
});

test("README documents configurable verification coverage", () => {
  const readme = read("README.md");
  assert.match(readme, /--verify/, "README documents the --verify flag");
  assert.match(readme, /\.plan-runner\.yml/, "README documents the config file");
  assert.match(readme, /last-wave-only/, "README lists the verification modes");
});

test("SKILL tears down dev agents and the wave verifier after every wave (no idle agents)", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /Tear down wave dev agents/i, "must define a dev-agent teardown step");
  assert.match(f, /Tear down the wave verifier/i, "must tear down the wave verifier too");
  // teardown for both backends via TaskStop
  assert.match(f, /TaskStop[\s\S]{0,120}task_id/i, "subagent backend tears down via TaskStop with the task_id");
  assert.match(f, /TaskStop[\s\S]{0,160}(teammate|name@team)/i, "teams backend tears down via TaskStop with the teammate id");
  // dev-agent teardown happens regardless of status, and before the next dispatch
  assert.match(f, /regardless of `?dev_status`?[\s\S]{0,40}(DONE|BLOCKED)/i, "dev agents are torn down regardless of DONE/BLOCKED status");
  // verifier teardown happens regardless of verdict
  assert.match(f, /regardless of `?verifier_status`?[\s\S]{0,60}(CLEAN|BUGS_FOUND|UNVERIFIABLE)/i, "verifier is torn down regardless of its verdict");
  // teardown must happen for every wave, not just at the end of the whole run
  assert.match(f, /every wave, not only the last one/i, "teardown must run wave by wave, not deferred to the end of the cycle");
  // the teardown step must precede the next dispatch point (verifier dispatch)
  assert.ok(
    f.indexOf("Tear down wave dev agents") < f.indexOf("### 4b. Verify the wave"),
    "dev-agent teardown must happen before the wave verifier is dispatched"
  );
});

test("SKILL guards against rogue dev-agent self-commits", () => {
  const f = read("skills/run/SKILL.md");
  // a wave-start SHA is recorded so rogue commits are detectable, gated on git
  assert.match(f, /wave_start_sha/, "must record a wave-start SHA");
  assert.match(
    f,
    /git_available[\s\S]{0,200}wave_start_sha|wave_start_sha[\s\S]{0,200}git_available/i,
    "wave-start SHA capture must be gated on git availability"
  );
  // a named guard section exists
  assert.match(f, /Rogue-commit guard/, "must define a rogue-commit guard");
  // detection: commits since the wave-start SHA scoped to the agent's owned files
  assert.match(
    f,
    /git log[^\n]*wave_start_sha[^\n]*\.\.HEAD/,
    "guard must check commits since the wave-start SHA"
  );
  // a rogue self-commit counts as delivered work -- never a reason to dispatch a retry agent
  assert.match(
    f,
    /rogue[\s\S]{0,400}(do NOT dispatch a retry|counts as delivered)/i,
    "a rogue self-commit must not trigger a retry agent"
  );
  // 4e: a clean tree with rogue commits is NOT "nothing to commit"
  assert.match(
    f,
    /nothing to commit[\s\S]{0,700}rogue|rogue[\s\S]{0,700}nothing to commit/i,
    "the no-changes branch of the wave commit must consider rogue commits"
  );
});

test("plan-dev explicitly forbids git writes", () => {
  const f = read("agents/plan-dev.md");
  assert.match(
    f,
    /NEVER run `?git (add|commit|push)/i,
    "plan-dev must name the forbidden git commands, not just say 'do not commit'"
  );
});

test("git is optional: run skill gates all git ops on availability", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /git rev-parse --is-inside-work-tree/, "must detect git via rev-parse --is-inside-work-tree");
  assert.match(f, /git_available/, "must set a git_available flag");
  // clean-tree check, per-wave commit, and PR step must each be gated
  // (allow backticks around `git_available` in the prose)
  assert.match(f, /git_available.{0,3}is false[\s\S]{0,80}skip this step/i, "clean-tree check skipped when git absent");
  assert.match(f, /git_available.{0,3}is false[\s\S]{0,120}(skipping commit|git not available)/i, "per-wave commit skipped when git absent");
  assert.match(f, /git_available.{0,3}is false[\s\S]{0,400}plan-runner:pr/i, "PR step skipped when git absent");
});

test("git is optional: pr skill guards on git availability", () => {
  const f = read("skills/pr/SKILL.md");
  assert.match(f, /git rev-parse --is-inside-work-tree/, "pr skill must pre-check git");
  assert.match(f, /git not available[\s\S]{0,120}(Skipping|STOP)/i, "pr skill must STOP gracefully when git is absent");
});

test("manifest schema documents git_available", () => {
  const schema = JSON.parse(read("schemas/manifest.schema.json"));
  assert.ok(schema.properties.git_available, "manifest schema must define git_available");
  assert.equal(schema.properties.git_available.type, "boolean", "git_available is a boolean");
});

test("run skill syncs code-atlas before the PR step", () => {
  const f = read("skills/run/SKILL.md");
  // a dedicated step exists and precedes OPEN PR
  assert.match(f, /Step 7-bis: SYNC CODE ATLAS/, "must define the code-atlas sync step");
  assert.ok(
    f.indexOf("Step 7-bis: SYNC CODE ATLAS") < f.indexOf("Step 8: OPEN PR"),
    "the sync step must come before the OPEN PR step"
  );
  // detection is gated on the code-atlas state file and invokes the incremental update
  assert.match(f, /\.code-atlas\/state\.json/, "must detect code-atlas via state.json");
  assert.match(f, /code-atlas:update/, "must invoke the code-atlas:update skill");
  // gated on git availability like the other git-dependent steps
  assert.match(f, /git_available.{0,3}is false[\s\S]{0,160}code-atlas sync skipped/i, "sync skipped when git absent");
  // both PR-bound paths route through the sync step
  assert.match(f, /Proceed to Step 7-bis/, "clean-run + stop-rerun paths route through the sync step");
});

test("manifest schema documents code_atlas_sync", () => {
  const schema = JSON.parse(read("schemas/manifest.schema.json"));
  assert.ok(schema.properties.code_atlas_sync, "manifest schema must define code_atlas_sync");
  assert.ok(schema.properties.code_atlas_sync.properties.ran, "code_atlas_sync has a ran flag");
});

test("README documents the code-atlas sync", () => {
  const readme = read("README.md");
  assert.match(readme, /code-atlas:update|Code Atlas sync/i, "README documents the code-atlas sync");
});

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

test("manifest schema documents token_usage", () => {
  const schema = JSON.parse(read("schemas/manifest.schema.json"));
  assert.ok(schema.properties.token_usage, "manifest schema must define token_usage");
  const tu = schema.properties.token_usage;
  for (const key of ["total_tokens", "agents_reported", "agents_total", "complete"]) {
    assert.ok(tu.required.includes(key), `token_usage requires ${key}`);
  }
  // per-agent token shape is reusable via $defs and attached to wave agents
  assert.ok(schema.$defs && schema.$defs.tokenCount, "schema defines a reusable tokenCount shape");
  const agentProps = schema.properties.waves.items.properties.agents.items.properties;
  assert.ok(agentProps.tokens, "wave agent entries carry per-agent tokens");
});

test("run skill captures and tallies subagent tokens", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /## Token accounting/, "run skill documents token accounting");
  // best-effort, never fabricated
  assert.match(f, /best-effort/i, "token capture is described as best-effort");
  assert.match(f, /[Nn]ever fabricate/, "skill forbids fabricating token counts");
  // captured for each subagent class
  assert.match(f, /analyzer["']?,\s*"phase":\s*"analyze"/, "analyzer tokens are captured");
  assert.match(f, /"phase":\s*"wave"/, "dev-agent tokens are captured");
  assert.match(f, /verifier["']?,\s*"phase":\s*"verify"/, "verifier tokens are captured");
  assert.match(f, /aggregator["']?,\s*"phase":\s*"aggregate"/, "aggregator tokens are captured");
  // tally fields are finalized and surfaced
  assert.match(f, /total_tokens/, "skill tallies a grand total");
  assert.match(f, /agents_reported/, "skill tracks reporting coverage");
});

test("every pipeline agent bubbles up a token self-report", () => {
  for (const a of [
    "plan-analyzer",
    "plan-dev",
    "plan-test-author",
    "plan-verifier",
    "plan-aggregator",
  ]) {
    const f = read(`agents/${a}.md`);
    assert.match(f, /## Token self-report/, `${a} has a Token self-report section`);
    assert.match(f, /"token_usage"|token_usage/, `${a} returns a token_usage field`);
    assert.match(f, /MOST RECENT figure/, `${a} reports the most recent harness-surfaced figure`);
    assert.match(f, /NEVER estimate, extrapolate/, `${a} forbids estimating a token count`);
    assert.match(f, /null is the honest answer/i, `${a} returns null when the harness showed nothing`);
  }
});

test("run skill prefers harness usage and falls back to the agent self-report", () => {
  const f = read("skills/run/SKILL.md");
  // two labeled sources with strict precedence
  assert.match(f, /"source":\s*"harness"/, "harness-sourced entries are labeled");
  assert.match(f, /self_report/, "self-report-sourced entries are labeled");
  assert.match(f, /precedence/i, "sources are applied in precedence order");
  assert.match(f, /self-report[\s\S]{0,240}lower bound|lower bound[\s\S]{0,240}self-report/i, "self-reports are described as a lower bound");
  // fallback fires when the completion result has no figure; null only when both sources are dry
  assert.match(f, /fall back to the `?token_usage`? self-report/i, "capture falls back to the agent's self-report");
  assert.match(f, /neither source[\s\S]{0,120}(null|unreported)/i, "tokens are null only when both sources are missing");
  // honesty invariant extends to self-reports
  assert.match(f, /token_usage: null`? must never be .{0,10}rescued|never.{0,30}rescued.{0,20}with a guess/i, "a null self-report is never replaced with a guess");
});

test("return schemas carry an optional token_usage self-report (back-compat)", () => {
  const dev = JSON.parse(read("schemas/dev-return.schema.json"));
  assert.ok(dev.properties.token_usage, "dev-return schema defines token_usage");
  assert.ok(!dev.required.includes("token_usage"), "dev-return token_usage is optional");
  assert.match(dev.properties.token_usage.description, /1\.11\.0/, "dev-return notes pre-1.11.0 back-compat");
  const wp = JSON.parse(read("schemas/wave-plan.schema.json"));
  assert.ok(wp.properties.token_usage, "wave-plan schema defines the analyzer's token_usage");
  assert.ok(!wp.required.includes("token_usage"), "wave-plan token_usage is optional");
  // manifest entries record where each figure came from
  const manifest = JSON.parse(read("schemas/manifest.schema.json"));
  const byAgent = manifest.properties.token_usage.properties.by_agent.items.properties;
  assert.deepEqual(byAgent.source.enum, ["harness", "self_report"], "by_agent entries carry a source enum");
  assert.deepEqual(manifest.$defs.tokenCount.properties.source.enum, ["harness", "self_report"], "tokenCount carries a source enum");
  assert.ok(!(manifest.properties.token_usage.properties.by_agent.items.required || []).includes("source"), "source is optional on by_agent entries");
});

test("pr skill surfaces token totals in stats", () => {
  const f = read("skills/pr/SKILL.md");
  assert.match(f, /token_usage/, "pr skill reads token_usage from the manifest");
  assert.match(f, /Tokens:.{0,80}subagents/, "pr stats include a Tokens line");
  assert.match(f, /By phase:.{0,80}(analyze|dev|verify|aggregate)/i, "pr stats include a per-phase breakdown");
});

test("run skill renders a unified end-of-run Run Report", () => {
  const f = read("skills/run/SKILL.md");
  // one reusable rendering spec, referenced by name
  assert.match(f, /### End-of-run Run Report/, "defines the unified Run Report spec");
  // three detail sections under one report
  assert.match(f, /Tokens by phase/, "report keeps a per-phase token table");
  assert.match(f, /Timing by phase/, "report folds in per-phase timing");
  assert.match(f, /^Artifacts$/m, "report lists artifacts");
  // status-aware title, both variants
  assert.match(f, /COMPLETE \(clean, no bugs found\)/, "clean title variant");
  assert.match(f, /bugs found \(P0:/, "bugs title variant carries the P-breakdown");
  // token honesty preserved from the old Token Report
  assert.match(f, /Top consumers/, "top-consuming subagents listed");
  assert.match(f, /lower bound/i, "partial coverage described as a lower bound");
  assert.match(f, /Omit a phase row/i, "empty phases omitted, not zero-filled");
  assert.match(f, /sums of the \*\*non-null\*\* values/i, "sums skip null entries");
  // honesty lines ride under the stat header
  assert.match(f, /!\s*Tokens are a lower bound/, "partial-token honesty line");
  assert.match(f, /waves were not semantically verified/, "unverified-waves honesty line");
  // it prints once at the terminal end -- the old per-step Token Report print is gone
  assert.doesNotMatch(f, /full \*\*Token Report\*\* block/, "old per-step Token Report print removed");
});

test("Run Report prints once at the terminal end, not per step", () => {
  const f = read("skills/run/SKILL.md");
  // a single terminal print section exists
  assert.match(f, /## End-of-run Run Report \(terminal print\)/, "terminal print section exists");
  // the old standalone timing section is gone
  assert.doesNotMatch(f, /## Phase Timing Summary/, "standalone Phase Timing Summary removed");
  // Step 6 keeps the compact decision block but not the full report
  assert.match(f, /\[Phase 4\/4\] Bug Report/, "Step 6 keeps the compact bug decision block");
  assert.doesNotMatch(f, /"End-of-run Token Report" spec/, "no lingering reference to the old Token Report spec name");
  // clean run defers its summary to the terminal report
  assert.match(f, /Step 7: FINALIZE \(clean run only\)/, "Step 7 finalizes rather than printing a summary");
});

test("README documents token accounting", () => {
  const readme = read("README.md");
  assert.match(readme, /## Token accounting/, "README has a token accounting section");
  assert.match(readme, /token_usage/, "README references the manifest token_usage field");
  assert.match(readme, /best-effort/i, "README is honest that capture is best-effort");
});

test("read-only pipeline agents declare least-privilege tools", () => {
  // verifier and analyzer must not carry write tools; aggregator writes only via Write
  const verifier = read("agents/plan-verifier.md");
  assert.match(verifier, /^tools:\s*Read,\s*Grep,\s*Glob\s*$/m, "verifier is read-only");
  const analyzer = read("agents/plan-analyzer.md");
  assert.match(analyzer, /^tools:\s*Read,\s*Grep,\s*Glob\s*$/m, "analyzer is read-only");
  const aggregator = read("agents/plan-aggregator.md");
  assert.match(aggregator, /^tools:\s*Read,\s*Grep,\s*Glob,\s*Write\s*$/m, "aggregator gets Write but nothing broader");
});

test("SessionStart hook is self-contained (no CLAUDE_PLUGIN_ROOT, no script paths)", () => {
  const hooks = JSON.parse(read("hooks/hooks.json"));
  const cmd = hooks.hooks.SessionStart[0].hooks[0].command;
  assert.doesNotMatch(cmd, /CLAUDE_PLUGIN_ROOT/, "hook must not rely on plugin-root substitution");
  assert.match(cmd, /^node -e /, "hook logic is inlined via node -e");
  assert.match(cmd, /docs\/plan-runner\//, "hook targets the docs/plan-runner/ gitignore entry");
  assert.ok(!exists("scripts/ensure-gitignore.js"), "the old script file must be gone");
  assert.ok(hooks.hooks.SessionStart[0].hooks[0].timeout <= 10, "hook keeps a short timeout");
});

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

test("docs cover the Agent Teams backend", () => {
  const readme = read("README.md");
  assert.match(readme, /CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS/, "README documents the agent-teams env var");
  assert.match(readme, /2\.1\.178/, "README notes the Claude Code version requirement");
});

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

test("SKILL keeps 'clean' honest about verification depth", () => {
  const f = read("skills/run/SKILL.md");
  // the zero-bug summary must qualify itself when waves were skipped
  assert.match(f, /waves_skipped[\s\S]{0,240}(not.{0,20}semantically verified|not.{0,20}verified)/i, "clean summary qualifies when waves were skipped");
  // the re-run handoff carries the effective mode forward
  assert.match(f, /--verify <verify_mode>|carry.{0,40}verify_mode[\s\S]{0,40}re-run/i, "re-run handoff carries the effective verify_mode");
  // convergence hint acknowledges differing modes
  assert.match(f, /different[\s\S]{0,40}verify_mode|verify_mode[\s\S]{0,60}(shallower|convergence)/i, "convergence hint notes differing verify_mode");
});

test("pr skill drafts + banners when waves were left unverified", () => {
  const f = read("skills/pr/SKILL.md");
  assert.match(f, /verification/, "pr skill reads the verification block");
  assert.match(f, /waves_skipped/, "pr skill checks waves_skipped");
  assert.match(f, /draft[\s\S]{0,160}waves_skipped|waves_skipped[\s\S]{0,160}draft/i, "skipped waves force a draft PR");
  assert.match(f, /not semantically verified|not verified/i, "PR body banners the unverified waves");
});
