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
  assert.match(f, /\.\.\/\.\.\/agents\/plan-test-author\.md/, "Step 4 must load the bundled plan-test-author role");
  assert.match(f, /complete bundled role definition|complete role definition/i, "Step 4 must include the role definition in portable prompts");
  // dispatch must branch on role
  assert.match(f, /role.{0,40}(test-author|impl)/is, "dispatch must select the agent by role");
  // impl agents must be told which tests to satisfy at dispatch time
  assert.match(f, /TESTS TO SATISFY|forward.{0,30}tests_to_satisfy|tests_to_satisfy.{0,40}(prompt|dispatch|impl agent)/is, "impl dispatch must forward tests_to_satisfy");
});

test("SKILL loads every bundled pipeline role relative to itself", () => {
  const f = read("skills/run/SKILL.md");
  for (const role of [
    "plan-analyzer.md",
    "plan-dev.md",
    "plan-test-author.md",
    "plan-verifier.md",
    "plan-aggregator.md",
  ]) {
    assert.match(f, new RegExp(`\\.\\.\\/\\.\\.\\/agents\\/${role.replace(".", "\\.")}`), `must load ${role} relative to the skill`);
  }
  assert.match(f, /Codex discovers the skills and does not automatically register `agents\/` files/i, "must explain why portable role loading is required");
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

test("SKILL selects an execution backend (Claude Agent Teams vs native subagents)", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS/, "must read the agent-teams env var");
  assert.match(f, /backend\s*=\s*"teams"/, "must select the teams backend");
  assert.match(f, /backend\s*=\s*"subagent"/, "must fall back to the subagent backend");
  assert.match(f, /In Codex[\s\S]{0,160}backend\s*=\s*"subagent"/i, "Codex must use native subagents");
  assert.match(f, /per-wave barrier|wave barrier/i, "both backends must keep the per-wave barrier");
});

test("docs + version reflect the TDD feature", () => {
  const claude = JSON.parse(read(".claude-plugin/plugin.json"));
  const codex = JSON.parse(read(".codex-plugin/plugin.json"));
  const npm = JSON.parse(read("package.json"));
  assert.equal(claude.version, "1.15.0", "plugin version is current");
  assert.equal(codex.version, claude.version, "Codex manifest version matches Claude manifest");
  assert.equal(npm.version, claude.version, "package version matches plugin manifests");
  const readme = read("README.md");
  assert.match(readme, /--no-tdd/, "README documents the --no-tdd flag");
  assert.match(readme, /red.{0,5}green|red→green/i, "README describes the red-green flow");
});

test("SKILL pins the three-tier output-base resolution ahead of Step 1a-0", () => {
  const f = read("skills/run/SKILL.md");
  // tier 1: an explicit CLAUDE.md / AGENTS.md / in-context statement
  assert.match(
    f,
    /CLAUDE\.md[\s\S]{0,60}AGENTS\.md[\s\S]{0,120}(context|session)/i,
    "tier 1 checks CLAUDE.md, then AGENTS.md, then in-context repository instructions"
  );
  // tier 2: top-level scan for a known docs-directory name, in this fixed order
  assert.match(
    f,
    /`docs`,\s*`doc`,\s*`documentation`,\s*`\.docs`/,
    "tier 2 top-level scan checks docs, doc, documentation, .docs in that fixed order"
  );
  // tier 3: default fallback to docs/
  assert.match(f, /docs_base\s*=\s*"docs"/, "tier 3 defaults docs_base to \"docs\"");
  // ordering: the resolution step must run before the Step 1a-0 auto-detect scan
  const resolveIdx = f.indexOf("1a-minus");
  const autoDetectIdx = f.indexOf("1a-0");
  assert.ok(resolveIdx >= 0, "must have a 1a-minus resolve-base step");
  assert.ok(autoDetectIdx >= 0, "must have a 1a-0 auto-detect step");
  assert.ok(resolveIdx < autoDetectIdx, "base resolution (1a-minus) must precede the 1a-0 auto-detect scan");
});

test("SKILL pins the dual-base resume glob and the printed Output location line", () => {
  const f = read("skills/run/SKILL.md");
  // resolved base glob
  assert.match(
    f,
    /<docs_base>\/plan-runner\/\*\*\/run-state\.json/,
    "resume scan globs run-state.json under the resolved docs_base"
  );
  // legacy fallback glob, only when docs_base differs from the default
  assert.match(
    f,
    /docs_base.{0,20}differs from `?docs`?[\s\S]{0,120}legacy `?docs\/plan-runner\/`?/i,
    "resume scan also globs the legacy docs/plan-runner/ base when docs_base differs from docs"
  );
  assert.match(
    f,
    /docs\/plan-runner\/\*\*\/run-state\.json/,
    "legacy glob targets docs/plan-runner/**/run-state.json"
  );
  // printed output-location line
  assert.match(
    f,
    /Output location:\s*<docs_base>\/plan-runner\//,
    "must print the resolved Output location line"
  );
});

test("hooks.json pins the base-agnostic **/plan-runner/ gitignore entry", () => {
  const hooks = JSON.parse(read("hooks/hooks.json"));
  const cmd = hooks.hooks.SessionStart[0].hooks[0].command;
  assert.match(cmd, /\*\*\/plan-runner\//, "hook writes the **/plan-runner/ gitignore entry");
  const description = hooks.description || "";
  assert.match(description, /\*\*\/plan-runner\//, "hook description also names **/plan-runner/");
});

test("README documents configurable verification coverage", () => {
  const readme = read("README.md");
  assert.match(readme, /--verify/, "README documents the --verify flag");
  assert.match(readme, /\.plan-runner\.yml/, "README documents the config file");
  assert.match(readme, /last-wave-only/, "README lists the verification modes");
});

test("SKILL releases dev agents and wave verifiers after every wave", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /Tear down wave dev agents/i, "must define a dev-agent teardown step");
  assert.match(f, /Tear down the wave verifier/i, "must tear down the wave verifier too");
  assert.match(f, /host-native (stop|facility)|host-native facility/i, "subagent teardown uses the host-native facility");
  assert.match(f, /teammate.{0,80}(agent ID|name@team|bare teammate name)/i, "teams backend tears down by teammate identity");
  // dev-agent teardown happens regardless of status, and before the next dispatch
  assert.match(f, /regardless of `?dev_status`?[\s\S]{0,40}(DONE|BLOCKED)/i, "dev agents are torn down regardless of DONE/BLOCKED status");
  // verifier teardown happens regardless of verdict
  assert.match(f, /regardless of `?verifier_status`?[\s\S]{0,60}(CLEAN|BUGS_FOUND|UNVERIFIABLE)/i, "verifier is torn down regardless of its verdict");
  // teardown must happen for every wave, not just at the end of the whole run
  assert.match(f, /every wave, not only the last one/i, "teardown must run wave by wave, not deferred to the end of the cycle");
  // the teardown step must precede the next dispatch point (verifier dispatch)
  assert.ok(
    f.indexOf("Tear down wave dev agents") < f.indexOf("### 4c. Verify the wave"),
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
  assert.match(f, /git_available.{0,3}is false[\s\S]{0,400}Plan Runner PR/i, "PR step skipped when git absent");
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
  assert.match(cmd, /\*\*\/plan-runner\//, "hook targets the **/plan-runner/ gitignore entry (base-agnostic)");
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

test("skills use Codex-compatible frontmatter and portable invocations", () => {
  for (const name of ["run", "pr"]) {
    const f = read(`skills/${name}/SKILL.md`);
    const frontmatter = f.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
    assert.match(frontmatter, new RegExp(`^name: ${name}$`, "m"), `${name} matches its folder`);
    assert.doesNotMatch(frontmatter, /^argument-hint:/m, `${name} omits unsupported argument-hint`);
    assert.doesNotMatch(f, /\{\$ARGUMENTS\}/, `${name} does not depend on Claude argument interpolation`);
  }
});

test("SKILL verifier dispatch honors verify_mode (per-agent | per-wave | last-wave-only)", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /verify_mode/, "Step 4c branches on verify_mode");
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

test("phasing config: .plan-runner.yml block keys and defaults are pinned", () => {
  const f = read("skills/run/SKILL.md");
  // CLI flags
  assert.match(f, /--phase-size <N>/, "documents --phase-size flag");
  assert.match(f, /--phase-mode <relay\|stop>/, "documents --phase-mode flag");
  assert.match(f, /--no-phasing/, "documents the --no-phasing kill-switch flag");
  // yml block and its five keys with their documented defaults
  assert.match(f, /phasing:\s*\n\s*enabled:\s*true\s*# default true/, "yml block: enabled default true");
  assert.match(f, /max_waves_per_phase:\s*4\s*# default 4/, "yml block: max_waves_per_phase default 4");
  assert.match(f, /mode:\s*auto\s*# auto \(default\) \| relay \| stop/, "yml block: mode default auto, enum relay|stop");
  assert.match(f, /auto_stop_phases:\s*3\s*#/, "yml block: auto_stop_phases default 3");
  assert.match(f, /relay_max_minutes:\s*90\s*#/, "yml block: relay_max_minutes default 90");
  // precedence
  assert.match(f, /flag > yml > default/, "documents flag > yml > default precedence");
});

test("phasing trigger: sub-threshold plans stay unphased with no run-state", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /phasing_enabled`? is (true AND|false).{0,80}W <= max_waves_per_phase|W <= max_waves_per_phase[\s\S]{0,200}phasing does not activate/i,
    "sub-threshold plans (W <= max_waves_per_phase) do not activate phasing"
  );
  assert.match(f, /byte-for-byte today's pipeline/i, "sub-threshold and --no-phasing runs stay byte-for-byte today's pipeline");
});

test("adaptive mode selection: stop above auto_stop_phases, relay at or below", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /phase_count > auto_stop_phases[\s\S]{0,40}effective_mode = "stop"/, "stop when phase_count exceeds auto_stop_phases");
  assert.match(f, /phase_count <= auto_stop_phases[\s\S]{0,40}effective_mode = "relay"/, "relay when phase_count is at most auto_stop_phases");
  assert.match(f, /Adaptive mode: <phase_count> phases <= auto_stop_phases[\s\S]{0,60}relaying/, "prints the relay adaptive-mode explanation");
  assert.match(f, /Adaptive mode: <phase_count> phases > auto_stop_phases[\s\S]{0,60}stopping at each boundary/, "prints the stop adaptive-mode explanation");
});

test("teams-backend override forces stop mode at every phase boundary", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /Teams-backend override \(wins over everything/i, "names the teams-backend override and its precedence");
  assert.match(f, /backend == "teams"[\s\S]{0,40}effective_mode = "stop"/, "teams backend sets effective_mode to stop");
  assert.match(f, /regardless of `?phase_mode`?/i, "override applies regardless of the configured mode");
  assert.match(
    f,
    /Agent Teams backend: forcing stop mode at every phase boundary \(a phase-runner cannot lead a nested team\)\./,
    "prints the teams-override explanation line"
  );
});

test("relay wall-time guardrail forces a stop-and-resume past relay_max_minutes", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /### 3-bis\.4\. Relay wall-time guardrail/, "defines the relay wall-time guardrail step");
  assert.match(f, /exceeds `?relay_max_minutes`?[\s\S]{0,80}force a \*\*stop-and-resume\*\*/i, "guardrail forces a stop-and-resume past the threshold");
  assert.match(
    f,
    /Relay guardrail: <elapsed>m elapsed since run start exceeds relay_max_minutes \(<relay_max_minutes>m\)\./,
    "prints the guardrail trip line"
  );
  assert.match(f, /Forcing a stop at the phase <P>\/<phase_count> boundary for a full process reset\./, "prints the forced-stop line");
});

test("stop-boundary resume invocation is printed in both client forms", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /\/plan-runner:run --resume <absolute run-state path>/, "Claude Code resume form");
  assert.match(f, /\$plan-runner:run --resume <absolute run-state path>/, "Codex resume form");
  assert.match(f, /Stopping here for a full process reset before phase <P\+1>\./, "stop-boundary message names the full process reset");
});

test("resume: pre-flight auto-detect offers resume and marks declined runs abandoned", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /### 1a-0\. Auto-detect resumable runs/, "defines the pre-flight auto-detect step");
  assert.match(f, /\[Y\] resume this run/, "offer prompt: resume option");
  assert.match(f, /\[n\] start a fresh run on <given plan path> \(marks the incomplete run abandoned\)/, "offer prompt: decline marks abandoned");
  assert.match(f, /set its `?overall_status`? to `?abandoned`?/i, "declining sets overall_status to abandoned");
  assert.match(f, /abandoned run-states are never re-offered or resumed/i, "abandoned run-states are excluded from the resumable scan");
  assert.match(f, /abandoned run-states are never resumed/i, "an explicit --resume onto an abandoned state still refuses");
});

test("resume: dirty-tree prompt offers stash or keep before re-dispatching a wave", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /### R\.6\. Interrupted-wave re-dispatch \(dirty tree, ask once\)/, "defines the interrupted-wave re-dispatch step");
  assert.match(f, /Dirty-tree prompt \(git only, ask once\)/, "names the dirty-tree prompt");
  assert.match(f, /\[s\] stash first \(git stash -u\), then re-run the wave against a clean tree/, "stash option");
  assert.match(f, /\[k\] keep the changes and let this wave's agents overwrite files as needed/, "keep option");
  assert.match(f, /never silently discard uncommitted work/i, "the prompt exists precisely to avoid silent data loss");
  assert.match(
    f,
    /In no-git mode \(`?git_available`? false\), skip this prompt entirely/i,
    "no-git mode skips the prompt and still drives resume from run-state.json alone"
  );
});

test("resume: plan-drift guard requires explicit confirmation on a hash mismatch", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /### R\.4\. Plan-drift guard/, "defines the plan-drift guard step");
  assert.match(f, /warn and \*\*require explicit confirmation\*\* before continuing/, "mismatch requires explicit confirmation");
  assert.match(f, /The default is No\./, "confirmation defaults to No");
});

test("resume: corrupt or missing run-state reports failure and offers a fresh run, never inferred", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /### R\.2\. Load and validate the run-state \(corrupt or missing\)/, "defines the corrupt/missing run-state step");
  assert.match(f, /Cannot resume: run-state is missing or unreadable\./, "prints the failure message");
  assert.match(f, /never infer state/i, "never infers state from a corrupt or missing run-state");
});

test("cross-phase verifier-coverage gate stays upstream of the PR step across all phases", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /### 5\.0\. Verifier-coverage gate \(runs before counting, on every path\)/, "defines the coverage gate step");
  assert.match(f, /every.{0,10}wave `?1\.\.W`? of every phase produced a verdict/i, "gate sweeps every wave of every phase");
  assert.match(f, /structurally impossible to reach the PR step/i, "gate makes an outstanding verdict block the PR step");
  assert.match(f, /upstream of the PR step on every path across phases/i, "gate stays upstream across every phase path");
});

test("Return budget sections are pinned in all five agent roles", () => {
  for (const a of [
    "plan-analyzer",
    "plan-dev",
    "plan-test-author",
    "plan-verifier",
    "plan-aggregator",
  ]) {
    const f = read(`agents/${a}.md`);
    assert.match(f, /## Return budget/, `${a} has a Return budget section`);
    assert.match(f, /distilled structured summary, not a transcript/, `${a} describes the return as a distilled summary`);
    assert.match(f, /roughly 1-2k tokens/, `${a} states the ~1-2k token budget`);
    assert.match(f, /Point at file paths and line ranges/, `${a} instructs pointing at file:line instead of quoting bodies`);
  }
});

test("run-state schema exists, parses, and documents the phase-checkpoint lifecycle", () => {
  assert.ok(exists("schemas/run-state.schema.json"), "schemas/run-state.schema.json must exist");
  const schema = JSON.parse(read("schemas/run-state.schema.json"));
  for (const key of [
    "plan_path",
    "plan_content_hash",
    "invocation_flags",
    "backend",
    "verify_mode",
    "tdd_enabled",
    "phases",
    "overall_status",
    "updated_at",
  ]) {
    assert.ok(schema.required.includes(key), `run-state schema requires ${key}`);
  }
  assert.deepEqual(
    schema.properties.overall_status.enum,
    ["active", "abandoned", "complete"],
    "overall_status enum lists only the values write sites actually set (no dead 'interrupted')"
  );
  assert.deepEqual(
    schema.properties.phases.items.properties.status.enum,
    ["pending", "in_progress", "complete"],
    "per-phase status enum"
  );
  // valid + invalid fixtures exist and are wired into the schema validator
  assert.ok(exists("schemas/examples/run-state.valid.json"), "valid run-state fixture must exist");
  assert.ok(exists("schemas/examples/run-state.invalid.json"), "invalid run-state fixture must exist");
  const validator = read("tests/validate_schemas.py");
  assert.match(validator, /run-state\.schema\.json.{0,10}run-state\.valid\.json.{0,10}run-state\.invalid\.json/, "validate_schemas.py wires up the run-state case");
});

test("phase boundaries persist their scoped token tally so the cross-phase roll-up is complete", () => {
  const f = read("skills/run/SKILL.md");
  // relay phase-runner exit (Step 3-bis.0) persists its own scoped token_usage to the phase manifest
  assert.match(
    f,
    /finalize and persist this phase's own scoped token tally before returning/i,
    "relay phase-runner finalizes and persists its scoped token tally before returning"
  );
  // stop-mode boundary (Step 3-bis.3) does the same at every boundary
  assert.match(
    f,
    /at every stop boundary \(terminal and non-terminal alike\)/i,
    "stop-mode boundary persists its scoped token tally at every boundary"
  );
  // both use the same computation as Step 5.1's tally finalization and write to the phase manifest
  assert.match(
    f,
    /same computation as Step 5\.1's tally finalization[\s\S]{0,200}\$phase_dir\/manifest\.json/i,
    "phase-manifest token persistence reuses Step 5.1's finalization computation"
  );
  // Step 5.2 folds the cycle-level analyzer + aggregator into the cross-phase union
  assert.match(
    f,
    /explicitly fold in the analyzer's and aggregator's cycle-level entries/i,
    "Step 5.2 folds the cycle-level analyzer + aggregator into the cross-phase token union"
  );
  assert.match(
    f,
    /[Dd]eduplicate the combined set by `?agent`? label/,
    "the fold-in deduplicates by agent label so nothing is double-counted"
  );
});

test("relay phase-runner derives cycle_dir from the run-state path", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /[Dd]erive `?cycle_dir`? = the \*\*parent directory of `?run_state_path`?\*\*/,
    "relay phase-runner derives cycle_dir from run_state_path's parent before Step 4f's rewrite"
  );
});

test("resume defers the TDD green-baseline capture until after the dirty-tree decision", () => {
  const f = read("skills/run/SKILL.md");
  // R.3 no longer captures the baseline; it defers to R.6
  assert.match(f, /Defer the green-baseline capture to R\.6/i, "R.3 defers the green-baseline capture to R.6");
  // R.6 captures it after the stash/keep decision resolves
  assert.match(f, /\*\*Green baseline \(deferred from R\.3/, "R.6 captures the deferred green baseline");
  assert.match(
    f,
    /after the stash\/keep decision resolves[\s\S]{0,160}(pre-stash|tainted)/i,
    "baseline is captured after R.6 resolves so it reflects the tree the wave re-runs over"
  );
});

test("waves_total is phase-scoped per manifest and cannot overcount by phase_count", () => {
  const f = read("skills/run/SKILL.md");
  // Step 4f writes a phase-scoped waves_total
  assert.match(
    f,
    /`?verification\.waves_total`? is set to \*\*this phase's own wave count\*\*/,
    "Step 4f sets a phase-scoped waves_total"
  );
  // both Step 4f and Step 5.2 rule out phase_count * W
  const overcountMatches = f.match(/phase_count \* W/g) || [];
  assert.ok(overcountMatches.length >= 2, "both Step 4f and Step 5.2 explicitly rule out phase_count * W");
  // Step 5.2 resolves waves_total to the global W from the cycle-root wave plan
  assert.match(
    f,
    /`?verification\.waves_total`? is the global wave count `?W`?, taken directly from the cycle-root `?wave-plan\.json`?/,
    "Step 5.2 resolves waves_total to the global W"
  );
});

test("stale (Step 7) cross-phase summation references were corrected to (Step 5.2)", () => {
  const f = read("skills/run/SKILL.md");
  // the two summation cross-refs now name Step 5.2
  assert.match(f, /sums across the per-phase manifests \(Step 5\.2\)/, "relay-driver summary ref points at Step 5.2");
  assert.match(f, /terminal-phase reporting \(Step 5\.2\) sums across the per-phase manifests/, "Step 2-bis ref points at Step 5.2");
  // no summation cross-ref still points at Step 7
  assert.doesNotMatch(f, /per-phase manifests \(Step 7\)|\(Step 7\) sums across the per-phase manifests/, "no stale (Step 7) summation ref remains");
});

test("verification is pipelined: commit precedes verifier dispatch, verdicts drain before aggregation", () => {
  const f = read("skills/run/SKILL.md");
  // the commit step now precedes the verification step in the wave flow
  assert.ok(
    f.indexOf("### 4b. Commit the wave") < f.indexOf("### 4c. Verify the wave"),
    "wave commit must come before verifier dispatch"
  );
  // pipelined verifiers read a snapshot pinned to the wave commit, never the live tree
  assert.match(f, /git worktree add --detach[^\n]*<commit_sha>/, "snapshot worktree is pinned to the wave commit SHA");
  assert.match(f, /snapshot_root/, "verifier prompt carries the snapshot root");
  // dispatch does not block the next wave
  assert.match(f, /\*\*Do NOT wait \(pipelined waves\)\.\*\*/, "pipelined dispatch does not wait for the verdict");
  assert.match(f, /At most one wave's verification is ever in flight/i, "in-flight verification is bounded to one wave");
  // every verdict drains before aggregation / phase boundaries
  assert.match(f, /### 4g\. Drain outstanding verdicts/, "defines the end-of-range drain");
  assert.ok(
    f.indexOf("### 4g. Drain outstanding verdicts") < f.indexOf("## Step 5: AGGREGATE"),
    "the drain precedes aggregation"
  );
  // kill-switch: flag + yml key, and no-git always synchronous
  assert.match(f, /--sync-verify/, "documents the --sync-verify kill-switch");
  assert.match(f, /verification\.pipelined/, "documents the verification.pipelined yml key");
  assert.match(f, /no-git run always verifies synchronously/i, "no-git mode falls back to synchronous verification");
  // README documents it
  const readme = read("README.md");
  assert.match(readme, /--sync-verify/, "README documents --sync-verify");
  assert.match(readme, /pipelined/i, "README describes pipelined verification");
});

test("TDD gates run the full suite once per wave, targeted tests per agent", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /Shared full-suite run \(once per wave, not per agent\)/, "one full-suite run per wave");
  assert.match(f, /WAVE SUITE REGRESSIONS/, "the shared regression block is labeled");
  assert.match(f, /only standalone agents runs no suite/i, "standalone-only waves skip the suite");
  const verifier = read("agents/plan-verifier.md");
  assert.match(verifier, /WAVE SUITE REGRESSIONS/, "verifier understands the shared regression block");
  assert.match(verifier, /snapshot_root/, "verifier resolves paths under the snapshot root");
  assert.match(verifier, /repo-relative/, "verifier reports repo-relative paths from the snapshot");
});

test("resume scan keeps only active run-states (no dead 'interrupted' filter)", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /Keep those that parse AND whose `?overall_status`? is `?active`? AND that have at least one phase/,
    "R.1 keeps run-states whose overall_status is active"
  );
  assert.doesNotMatch(
    f,
    /`?overall_status`? is `?active`? or `?interrupted`?/,
    "R.1 no longer filters on the unreachable 'interrupted' status"
  );
});
