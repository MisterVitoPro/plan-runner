const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const validateAgainstSchema = (schemaRel, instance) => {
  const script = [
    "import json, pathlib, sys",
    "import jsonschema",
    "root = pathlib.Path(sys.argv[1])",
    "schema = json.loads((root / sys.argv[2]).read_text(encoding='utf-8'))",
    "jsonschema.validate(json.loads(sys.stdin.read()), schema)",
  ].join("\n");
  const result = spawnSync("python", ["-c", script, ROOT, schemaRel], {
    input: JSON.stringify(instance),
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `${schemaRel} rejected contract evidence:\n${result.stderr || result.stdout}`
  );
};

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

test("Step 2 validation resolves every tests_to_satisfy path (no vacuous green from invented paths)", () => {
  const f = read("skills/run/SKILL.md");
  // every impl tests_to_satisfy path must exist on disk OR be authored by an earlier-wave test-author
  assert.match(f, /every path in `tests_to_satisfy` MUST either \(a\) exist on disk/i, "case (a): path exists on disk");
  assert.match(f, /`owned_files` of a `test-author` agent in an EARLIER wave/i, "case (b): authored by an earlier-wave test-author");
  // the failure is a hard validation STOP that names the offender
  assert.match(f, /naming the impl agent and each unresolvable path/i, "STOP names the agent and the unresolvable path");
  // the rationale pins the failure mode being prevented
  assert.match(f, /match zero tests, exit 0, and record a vacuous `PASSED`/, "records the vacuous-green failure mode");
  // both TDD first runs and fix-plan re-runs are covered
  assert.match(f, /first-run TDD cycle[\s\S]{0,120}fix-plan re-run/i, "explains why both cases are needed");
});

test("Step 2 validation keeps test-author owned_files disjoint from the paired impl (no vacuous red)", () => {
  const f = read("skills/run/SKILL.md");
  // disjointness is required across waves, paired via tests_to_satisfy
  assert.match(f, /`owned_files` MUST be disjoint from the `owned_files` of every paired `impl` agent/i, "test-author/impl owned_files must be disjoint");
  assert.match(f, /impl's `tests_to_satisfy` intersects the test-author's `owned_files`/i, "pairing is derived from tests_to_satisfy");
  assert.match(f, /Waves being different does NOT excuse the overlap/i, "cross-wave overlap is still a failure");
  // the recorded consequence: vacuous red -> paired impl silently skipped
  assert.match(f, /red gate runs zero tests, exits 0, and the invalid-red rule silently skips the paired impl/i, "records the vacuous-red failure mode");
  // the single legitimate exception is an explicit schema-level opt-in, capped at one shared file
  assert.match(f, /`inline_tests: true`[\s\S]{0,220}exactly ONE file/i, "inline_tests exception shares exactly one file");
  assert.match(f, /naming both agents and each shared path/i, "STOP names both agents and the shared path");
  // the schema carries the opt-in field, back-compat noted
  const schema = JSON.parse(read("schemas/wave-plan.schema.json"));
  const agentProps = schema.properties.waves.items.properties.agents.items.properties;
  assert.equal(agentProps.inline_tests.type, "boolean", "wave-plan schema defines inline_tests as boolean");
  assert.match(agentProps.inline_tests.description, /pre-1\.18\.0/, "inline_tests description notes back-compat");
  // the analyzer role documents when to emit it
  const analyzer = read("agents/plan-analyzer.md");
  assert.match(analyzer, /inline_tests: true/, "analyzer role documents the inline_tests opt-in");
  assert.match(analyzer, /unreachable from an external test file/i, "analyzer role scopes the exception to unreachable targets");
});

test("green gate detects invalid greens: zero tests ran is never PASSED", () => {
  const f = read("skills/run/SKILL.md");
  // the orchestrator parses the runner-reported count and knows exit 0 alone proves nothing
  assert.match(f, /exits 0 when its filter matches zero tests/i, "records the exit-0-on-zero-match runner behavior");
  // zero tests ran -> INVALID + valid_green false, never PASSED
  assert.match(f, /Zero tests ran[\s\S]{0,80}`result: "INVALID"`, `valid_green: false`/, "zero tests ran records INVALID");
  assert.match(f, /NEVER record `PASSED` for a run that executed nothing/, "an empty run is never a pass");
  // unparseable count -> honest null, judged by the verifier (mirrors valid_red's division of labour)
  assert.match(f, /valid_green: null` -- the honest fallback/, "unparseable count records null, never a guess");
  assert.match(f, /never upgrades `null` to `true` on its own/i, "orchestrator cannot upgrade a null valid_green");
  // the count is surfaced to the verifier in the captured output
  assert.match(f, /GREEN GATE TEST COUNT/, "captured output carries the parsed count");
  // the named invalid-green rule mirrors invalid red and routes a P1 through the verifier path
  assert.match(f, /Invalid green \(mirrors invalid red\)/i, "invalid-green rule is named alongside invalid red");
  assert.match(f, /Invalid green[\s\S]{0,400}P1 `incorrect_implementation`/, "invalid green flows as a P1 via the verifier");
  // the verifier's green-gate mode is instructed to distrust a pass that ran nothing
  const verifier = read("agents/plan-verifier.md");
  assert.match(verifier, /Tests must actually run\.[\s\S]{0,340}INVALID green/i, "verifier green-gate mode checks the run count");
  assert.match(verifier, /that call is yours, not the orchestrator's/i, "unparsed counts are the verifier's judgment");
  // the manifest schema records valid_green with back-compat
  const schema = JSON.parse(read("schemas/manifest.schema.json"));
  const greenRun = schema.properties.tdd.properties.tasks.items.properties.green_run.properties;
  assert.deepEqual(greenRun.valid_green.type, ["boolean", "null"], "manifest schema defines valid_green as boolean|null");
  assert.match(greenRun.valid_green.description, /pre-1\.18\.0/, "valid_green description notes back-compat");
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
  // teams-aware verifier completion: poll the durable return file, not a status guess
  assert.match(f, /poll for the verifier's `return_file`/i, "teams backend must poll the verifier's return file");
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

test("release metadata and contract pins are synchronized at 2.2.0", () => {
  const claude = JSON.parse(read(".claude-plugin/plugin.json"));
  const codex = JSON.parse(read(".codex-plugin/plugin.json"));
  const npm = JSON.parse(read("package.json"));
  assert.equal(claude.version, "2.2.0", "contract-test release pin is current");
  assert.equal(codex.version, claude.version, "Codex manifest version matches Claude manifest");
  assert.equal(npm.version, claude.version, "package version matches plugin manifests");
  assert.match(read("CHANGELOG.md"), /^## 2\.2\.0 - \d{4}-\d{2}-\d{2}$/m, "changelog has the current release entry");
  // the marketplace blurb stays ecosystem-length (median ~150 chars across public
  // catalogs; every browsing surface truncates past a few lines) -- per-release
  // feature detail belongs in CHANGELOG/README, never appended here
  assert.ok(claude.description.length <= 300, "marketplace description stays a short blurb (see CLAUDE.md release protocol)");
  const readme = read("README.md");
  assert.match(readme, /--no-tdd/, "README documents the --no-tdd flag");
  assert.match(readme, /red.{0,5}green|red→green/i, "README describes the red-green flow");
});

test("docs and plugin metadata describe the 2.0 task-DAG executor", () => {
  const readme = read("README.md");
  assert.match(readme, /--execution-mode <dag\|wave>/, "README documents the --execution-mode flag");
  assert.match(readme, /max_integrations_per_phase/, "README documents the DAG phase boundary");
  assert.match(readme, /events\.jsonl/, "README lists the append-only task event log");
  assert.match(readme, /plan-integrator/, "README names the central integrator role");
  assert.match(readme, /plan-runner\/<YYYY-MM-DD>\/cycle-<N>/, "README names the run-owned integration branch");
  assert.match(readme, /exactly one\s+evidence-backed repair attempt/i, "README states the bounded-repair cap");
  assert.match(readme, /never merges|does \*\*not\*\* auto-merge/i, "README states that delivery stays human-reviewed");
  const codex = JSON.parse(read(".codex-plugin/plugin.json"));
  assert.match(codex.interface.longDescription, /task graph|task DAG/i, "Codex long description describes the DAG executor");
  assert.doesNotMatch(codex.interface.shortDescription, /wave/i, "Codex short description no longer pitches waves");
  assert.ok(codex.interface.defaultPrompt.some((p) => /task DAG/i.test(p)), "a Codex default prompt invokes DAG execution");
  const agents = read("AGENTS.md");
  assert.doesNotMatch(agents, /qa-claude-market/, "AGENTS.md names the current marketplace repo");
  assert.match(agents, /marketplace-pin/, "AGENTS.md points at the automated pin workflow");
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
  assert.deepEqual(manifest.$defs.tokenCount.properties.source.enum, ["harness", "self_report", "http_usage"], "tokenCount carries a source enum extended with http_usage for endpoint dispatch (2.2.0)");
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
  // analyzer must not carry write tools; verifier gets Write ONLY for its file-backed
  // return_file (reason recorded in its rules); aggregator writes only via Write
  const verifier = read("agents/plan-verifier.md");
  assert.match(verifier, /^tools:\s*Read,\s*Grep,\s*Glob,\s*Write\s*$/m, "verifier adds Write for its return_file, nothing broader");
  assert.match(verifier, /sole reason `Write` is in your tools/i, "verifier records why Write was broadened");
  const analyzer = read("agents/plan-analyzer.md");
  assert.match(analyzer, /^tools:\s*Read,\s*Grep,\s*Glob\s*$/m, "analyzer is read-only");
  const aggregator = read("agents/plan-aggregator.md");
  assert.match(aggregator, /^tools:\s*Read,\s*Grep,\s*Glob,\s*Write\s*$/m, "aggregator gets Write but nothing broader");
});

test("agent returns are file-backed: durable return_file handoff, mailbox is preview-only", () => {
  const f = read("skills/run/SKILL.md");
  // both dispatch prompts carry a deterministic return_file path under the cycle's returns/ dir
  assert.match(f, /return_file: <absolute path: \$phase_dir\/returns\/wave-<W>-<agent_id>\.json>/, "dev dispatch prompt names the agent's return_file");
  assert.match(f, /return_file: <absolute path: \$phase_dir\/returns\/wave-<W>-verifier\.json/, "verifier dispatch prompt names its return_file");
  assert.match(f, /wave-<W>-agent-<n>-verifier\.json/, "per-agent verifiers get per-agent return files");
  // both prompts instruct the write as the agent's LAST action
  assert.match(f, /FILE-BACKED RETURN: as your LAST action/, "dispatch prompts mandate the final-action file write");
  // the orchestrator reads the file as source of truth; the message is never load-bearing
  assert.match(f, /file as the source of truth/i, "return file is the source of truth");
  assert.match(f, /convenience preview/i, "task result / mailbox message is preview-only");
  assert.match(f, /TaskOutput` cannot resolve a named background agent/, "records why the mailbox cannot be depended on");
  assert.match(f, /races the (teammate|verifier)'s idle teardown/, "records the resend/teardown race");
  // capture order: file first, message fallback, synthetic BLOCKED/UNVERIFIABLE only when both fail
  assert.match(f, /`return_file` and parse the JSON; when the file is missing or unparseable, fall back/, "dev capture reads the file first");
  assert.match(f, /its `return_file` first, falling back to its returned message/, "verifier capture reads the file first");
  // the stuck-teammate fallback checks the return file before declaring BLOCKED
  assert.match(f, /check the teammate's `return_file` first/, "wave-barrier fallback consults the return file before BLOCKED");
  // teardown is explicitly safe because returns survive it
  assert.match(f, /return is file-backed in `\$phase_dir\/returns\/`, which survives the stop/, "teardown cannot lose a file-backed return");
  // the verifier role honors the handoff
  const verifier = read("agents/plan-verifier.md");
  assert.match(verifier, /File-backed return/i, "verifier role defines the file-backed return rule");
  assert.match(verifier, /exception is writing your own `return_file`/, "verifier no-modify rule carves out only the return file");
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

test("SKILL loads .plan-runner.yml once, and absence is only ever a not-found read", () => {
  const f = read("skills/run/SKILL.md");
  // a single canonical load step, ahead of every consumer
  assert.match(f, /### 1a-minus-bis\. Load `\.plan-runner\.yml`/, "has a dedicated config-load pre-flight step");
  const loadIdx = f.indexOf("1a-minus-bis. Load");
  for (const consumer of [
    "### 1d-quater. Resolve verification mode",
    "### 1d-quinquies. Resolve phasing config",
    "### 1d-sexies. Resolve project-agent dispatch",
    "### 1d-septies.",
  ]) {
    const idx = f.indexOf(consumer);
    assert.ok(idx >= 0, `consumer step present: ${consumer}`);
    assert.ok(loadIdx < idx, `config load precedes ${consumer}`);
  }
  assert.match(f, /run Step 1a-minus-bis below \(every invocation loads the configuration\)/, "an explicit --resume loads the config too");

  // the honesty rule: only the Read tool's not-found result proves absence
  assert.match(
    f,
    /\*\*Absence is established only by the Read tool reporting that `\.plan-runner\.yml` does not exist\.\*\*/,
    "pins how absence is established"
  );
  assert.match(f, /never from a shell command that chains the read behind another command/, "forbids chaining the config read");
  assert.match(f, /ls docs doc documentation \.docs && cat \.plan-runner\.yml/, "names the exact failing shape");
  assert.match(f, /Decide which candidates exist from the listing's \*output\*, never from its exit status/, "1a-minus scan reads output, not exit status");

  // the load is visible on the console, so a misread cannot be silent
  assert.match(f, /Config: \.plan-runner\.yml loaded\./, "prints the loaded line");
  assert.match(f, /Config: no \.plan-runner\.yml at repo root -- using defaults\./, "prints the absent line");
  assert.match(f, /Config: \.plan-runner\.yml unreadable \(<reason>\) -- using defaults\./, "prints the unreadable line");

  // every consumer reads the loaded text rather than re-reading the file
  for (const key of [
    /use the `verification\.mode` value from `config_text`/,
    /the `verification\.pipelined` value from `config_text`/,
    /Extract each key directly from `config_text` \(Step 1a-minus-bis\)/,
    /use the `agents\.project` value from `config_text`/,
    /use the `models\.enabled` value from `config_text`/,
    /extract the `models:` block\*\* from `config_text`/,
    /the `execution\.mode` value from `config_text`/,
  ]) {
    assert.match(f, key, `consumer reads from config_text: ${key}`);
  }
  assert.doesNotMatch(
    f,
    /if a `\.plan-runner\.yml` file exists at the repo root, read it with the Read tool/,
    "no step re-reads the config file for itself"
  );

  const readme = read("README.md");
  assert.match(readme, /## Configuration file/, "README documents the single config file");
  assert.match(readme, /Config: no \.plan-runner\.yml at repo root -- using defaults\./, "README shows the absent line so a misread is recognizable");
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

test("pr skill is agent-only: hidden from the user slash menu", () => {
  const pr = read("skills/pr/SKILL.md").match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
  assert.match(pr, /^user-invocable: false$/m, "pr frontmatter blocks user slash invocation");
  const run = read("skills/run/SKILL.md").match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
  assert.doesNotMatch(run, /^user-invocable:/m, "run skill stays user-invocable");
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

test("late-verdict reconciliation rule: an expired wait never closes a wave to a later verdict", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /\*\*Late-verdict reconciliation rule/, "must define the Late-verdict reconciliation rule");
  // an expired bounded wait does not close the wave to a later verdict
  assert.match(
    f,
    /does NOT close that wave to a later verdict/i,
    "recording UNVERIFIABLE or dispatching a replacement must not close the wave to a later verdict"
  );
  // late verdicts are reconciled, not discarded
  assert.match(
    f,
    /the orchestrator MUST reconcile rather than discard it/i,
    "a late verdict must be reconciled rather than discarded"
  );
  // reconciliation is by UNION of findings
  assert.match(f, /Reconcile by UNION of findings/, "reconciliation is by union of findings");
  // a later/replacement CLEAN must never erase an earlier BUGS_FOUND
  assert.match(
    f,
    /never let a later or replacement `?CLEAN`? verdict erase an earlier `?BUGS_FOUND`?/i,
    "a later or replacement CLEAN must never erase an earlier BUGS_FOUND"
  );
  // both 4g drain and the Step 5.0 coverage gate cross-reference this rule
  assert.match(
    f,
    /apply the late-verdict reconciliation rule \(4c\)/i,
    "the 4g drain cross-references the late-verdict reconciliation rule"
  );
  assert.match(
    f,
    /it is a late verdict and MUST be reconciled per the late-verdict reconciliation rule \(4c\)/i,
    "the Step 5.0 coverage gate cross-references the late-verdict reconciliation rule"
  );
});

test("pr skill Step 5 diffs against the fetched remote base, not a stale local ref", () => {
  const f = read("skills/pr/SKILL.md");
  assert.match(f, /git fetch origin "<base>"/, "pr skill must refresh the base branch before computing the branch diff");
  assert.match(f, /diff_base = "origin\/<base>"/, "pr skill must diff against origin/<base> when the fetch succeeds");
  assert.match(f, /git diff --numstat "<diff_base>\.\.\.HEAD"/, "numstat must use the resolved diff_base");
  assert.match(f, /could not fetch origin\/<base>[\s\S]{0,80}may be stale/i, "fallback to the local ref must be announced as possibly stale");
  assert.match(f, /stale-base drift/i, "prose must name the failure mode the fetch prevents");
});

test("pr skill Step 4 resolves a generated fix-plan back to its original plan", () => {
  const f = read("skills/pr/SKILL.md");
  // detects a fix-plan by its H1 and/or the Original plan line
  assert.match(
    f,
    /\^#\\s\+Fix Plan/,
    "must detect a fix-plan via its H1 pattern"
  );
  assert.match(
    f,
    /\^\\\*\\\*Original plan:\\\*\\\*\\s\*\(\.\+\)\$/,
    "must detect a fix-plan via the literal Original plan line pattern"
  );
  // chases transitively with a hop cap
  assert.match(f, /Chase this transitively/i, "must chase the original-plan resolution transitively");
  assert.match(f, /cap it at 3 hops/i, "transitive chase must be hop-capped");
  // the conventional-commit TYPE is derived from the resolved original plan, not the fix-plan
  assert.match(
    f,
    /the basename of the resolved `?input_plan`?[\s\S]{0,60}the original plan when one was resolved through a fix-plan, never the fix-plan/i,
    "TYPE must be derived from the resolved original plan, never the fix-plan's own basename"
  );
});

test("plan-analyzer: owned_files provenance, declared dependency order, and standalone non-testable tasks", () => {
  const f = read("agents/plan-analyzer.md");
  // owned_files may never be invented
  assert.match(
    f,
    /Every `?owned_files`? entry across every agent traces back to a path the source plan actually names/i,
    "owned_files must trace back to a path the source plan actually names, never invented"
  );
  // a plan-declared dependency graph is the ordering source of truth, not reordered for a TDD shape
  assert.match(
    f,
    /Wave ordering matches any dependency graph the plan declares explicitly \(e\.g\. "Blocked by:" lines\); no task was reordered to fit a preferred shape against a declared dependency/i,
    "a declared dependency graph (e.g. Blocked by: lines) is the ordering source of truth and is not reordered for a preferred (TDD) shape"
  );
  // non-runnable prose/docs/config tasks get role standalone / testable false, not a forced split
  assert.match(
    f,
    /do NOT force a TDD shape on it: every task emits as `?role: "standalone"`?, `?testable: false`?, with an honest `?non_testable_reason`?/i,
    "non-runnable prose/docs/config tasks get role standalone and testable false rather than a forced test-author+impl split"
  );
});

test("plan-aggregator: fix-plan template mandates the literal Original plan line, copied transitively", () => {
  const f = read("agents/plan-aggregator.md");
  // the emitted template mandates the literal **Original plan:** line
  assert.match(
    f,
    /\*\*Original plan:\*\* <absolute path to the original \(non-fix-plan\) source plan>/,
    "the fix-plan template mandates the literal **Original plan:** line"
  );
  assert.match(
    f,
    /The `?\*\*Original plan:\*\*`? line must ALWAYS reference the original \(non-fix-plan\) source plan/i,
    "the Original plan line's value must always be the true original"
  );
  // copied through transitively when the input was itself a fix-plan
  assert.match(
    f,
    /extract and copy its `?\*\*Original plan:\*\*`? value transitively rather than pointing at the intermediate fix-plan/i,
    "when the input plan is itself a fix-plan, its Original plan value is copied through transitively"
  );
});

test("SKILL pins the project-agent dispatch overlay: selection, guards, precedence, and provenance", () => {
  const f = read("skills/run/SKILL.md");
  // kill-switch flag and its yml counterpart
  assert.match(
    f,
    /--no-project-agents.{0,40}if present, disable project-agent dispatch for this run/i,
    "documents the --no-project-agents kill-switch flag"
  );
  assert.match(f, /Overrides `\.plan-runner\.yml` `agents\.project`/, "flag overrides the agents.project yml key");
  assert.match(f, /use the `agents\.project` value from `config_text`/, "resolves the agents.project key from the loaded config");
  // bundled-only rule for test-author, verifier, and aggregator dispatches
  assert.match(
    f,
    /Test-author, verifier, and aggregator dispatches always use their bundled definitions, regardless of the inventory/,
    "test-author/verifier/aggregator dispatches are always bundled-only"
  );
  // conservative selection rule and its plan-dev fallback
  assert.match(
    f,
    /select a project agent whose `description` \*\*clearly covers\*\* the task's domain/,
    "conservative selection rule requires the description to clearly cover the task's domain"
  );
  assert.match(f, /\*\*any doubt selects none\.\*\*/, "conservative selection rule: any doubt selects none");
  assert.match(
    f,
    /Otherwise select none: the task is served by the bundled `plan-dev\.md`/,
    "bundled fallback: unmatched tasks are served by bundled plan-dev.md"
  );
  // explicit-directive override
  assert.match(
    f,
    /overrides the conservative description match/,
    "an explicit routing directive overrides the conservative description match"
  );
  // tool-guard disqualification sentence
  assert.match(
    f,
    /lists \*\*neither `Write` nor `Edit`\*\* cannot write files, so it is disqualified/,
    "tool guard disqualifies a project agent lacking Write or Edit"
  );
  // model-precedence sentence
  assert.match(
    f,
    /a serving project agent's `model:` frontmatter wins; when it declares none, the task's wave-plan `recommended_model` applies/,
    "model precedence: agent frontmatter wins, else recommended_model"
  );
  // contract-overrides-agent-prose sentence
  assert.match(
    f,
    /OVERRIDE any conflicting instruction in the agent definition above/,
    "the per-invocation + Dev Return Contract explicitly override the serving agent's own prose"
  );
  // "served by <agent>" dispatch-line sentence
  assert.match(
    f,
    /<agent_id>: served by <plan-dev \(bundled\) \| <name> \(project\)>/,
    "prints the served-by provenance line at dispatch"
  );
  // return-validation flow: one re-prompt with the schema, then return_contract_violation + next-cycle pin
  assert.match(
    f,
    /Re-prompt that agent once, with the schema alone/,
    "return-contract validation re-prompts once with the schema"
  );
  assert.match(
    f,
    /add one `return_contract_violation` bug to this wave's bug JSON/,
    "a second validation failure adds a return_contract_violation bug"
  );
  assert.match(
    f,
    /pin that task to bundled `plan-dev` for the next cycle/,
    "a second validation failure pins the task to bundled plan-dev for the next cycle"
  );
});

test("agents/plan-dev.md Dev Return Contract section holds the shared return skeleton (split halves cannot drift)", () => {
  const f = read("agents/plan-dev.md");
  assert.match(f, /^## Dev Return Contract$/m, "must have a labeled Dev Return Contract section");
  const section = f.slice(f.indexOf("## Dev Return Contract"));
  for (const key of [
    "status",
    "files_written",
    "files_unexpectedly_modified",
    "context7_queries",
    "token_usage",
  ]) {
    assert.match(section, new RegExp(`"${key}"`), `Dev Return Contract skeleton includes ${key}`);
  }
  for (const status of ["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "NEEDS_CONTEXT"]) {
    assert.match(section, new RegExp(status), `Dev Return Contract documents status value ${status}`);
  }
});

test("DAG executor remains dependency-ready with a safe legacy-wave fallback", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /--execution-mode <dag\|wave>/, "supports an explicit executor mode");
  assert.match(f, /`dag` by default/, "DAG is the default executor");
  assert.match(f, /explicit `wave` mode is the rollback mode/i, "wave remains an explicit rollback");
  assert.match(f, /Git is unavailable or this probe fails[\s\S]{0,260}falling back to the legacy wave executor/i, "no-Git/worktree runs fall back without task dispatch");
  assert.match(f, /Never attempt task-worktree dispatch in this fallback path/, "fallback never approximates task worktrees");
  assert.match(f, /without waiting for unrelated active or ready work/i, "ready children do not wait for unrelated work");
  assert.match(f, /six active dev tasks total/i, "DAG preserves the six-task ceiling");
  assert.match(f, /Fallback waves remain valid legacy artifacts/i, "wave evidence remains durable for rollback");
});

test("DAG preflight, state, checkpoints, and recovery require durable evidence", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /dirty checkout[\s\S]{0,300}\[s\] stash tracked and untracked changes[\s\S]{0,120}\[a\] abort DAG execution/i, "dirty DAG preflight requires stash or abort");
  assert.match(f, /Do not create a branch from a dirty tree and do not silently stash or discard operator work/, "never silently accepts a dirty DAG base");
  assert.match(f, /run-owned integration branch/i, "creates a run-owned integration branch");
  assert.match(f, /operator's active branch is never checked out, committed to, reset, or merged/i, "operator branch remains untouched");
  assert.match(f, /max_integrations_per_phase/, "checkpoints use integrations rather than waves");
  assert.match(f, /checkpoints after successful integrations, not after waves/i, "integration count is the DAG boundary");
  assert.match(f, /must never redispatch a task whose state says `integrated`/, "resume preserves integrated tasks");
  assert.match(f, /malformed JSONL line[\s\S]{0,160}safe stop before dispatch/i, "malformed recovery evidence stops safely");
  assert.match(f, /Events are append-only|append-only; do not rewrite, reorder/i, "lifecycle evidence is append-only");
});

test("DAG worker and integrator contracts enforce ownership, stale-base, and bounded repair", () => {
  const integrator = read("agents/plan-integrator.md");
  const verifier = read("agents/plan-verifier.md");
  const dev = read("agents/plan-dev.md");
  assert.match(integrator, /added, deleted, renamed, copied, generated, and shared-file/i, "complete diff ownership includes every change kind");
  assert.match(integrator, /undeclared path rejects the task before verification\/integration/i, "undeclared writes are rejected");
  assert.match(integrator, /If `integration_commit` moved since\s+`base_commit`/, "stale bases are checked");
  assert.match(integrator, /Request a re-execution in a new disposable worktree/i, "stale overlapping work is re-executed");
  assert.match(integrator, /exactly one evidence-backed repair attempt/i, "repair is capped once");
  assert.match(integrator, /A second conflict marks the task[\s\S]{0,40}`blocked`/i, "conflict rebuild is capped once");
  assert.match(integrator, /ONLY component permitted to mutate the run-owned integration branch/i, "central integration owns the branch");
  assert.match(verifier, /independent verifier|Do not integrate, repair, commit/i, "verification remains independent");
  assert.match(dev, /return artifact is the sole exception to owned-file scope/i, "return artifact remains the only ownership exception");
});

test("DAG schemas validate valid, invalid, and legacy-compatible evidence", () => {
  const graph = JSON.parse(read("schemas/task-graph.schema.json"));
  const event = JSON.parse(read("schemas/task-event.schema.json"));
  const manifest = JSON.parse(read("schemas/manifest.schema.json"));
  const state = JSON.parse(read("schemas/run-state.schema.json"));
  assert.ok(graph.properties.tasks, "task graph carries scheduler tasks");
  assert.ok(graph.$defs.task.properties.depends_on, "task graph retains dependency edges");
  assert.ok(event.properties.event_type.enum.includes("task_integrated"), "events include task lifecycle evidence");
  assert.ok(event.properties.event_type.enum.includes("checkpoint"), "events include checkpoints");
  assert.ok(manifest.properties.dag, "manifest accepts additive DAG evidence");
  assert.ok(state.properties.dag, "run state accepts additive DAG evidence");
  const graphEvidence = JSON.parse(read("schemas/examples/task-graph-valid.json"));
  const eventEvidence = JSON.parse(read("schemas/examples/task-event-valid.json"));
  const legacyManifest = JSON.parse(read("schemas/examples/manifest-valid.json"));
  const legacyState = JSON.parse(read("schemas/examples/run-state.valid.json"));
  delete legacyManifest.dag;
  delete legacyState.dag;
  validateAgainstSchema("schemas/task-graph.schema.json", graphEvidence);
  validateAgainstSchema("schemas/task-event.schema.json", eventEvidence);
  validateAgainstSchema("schemas/manifest.schema.json", legacyManifest);
  validateAgainstSchema("schemas/run-state.schema.json", legacyState);
  const validator = read("tests/validate_schemas.py");
  for (const schema of ["task-graph.schema.json", "task-event.schema.json", "manifest.schema.json", "run-state.schema.json", "bug-report.schema.json"]) {
    assert.match(validator, new RegExp(schema.replace(".", "\\.")), `${schema} is schema-validated`);
  }
});

test("DAG test fixtures prove dependency-ready scheduling and deterministic recovery inputs", () => {
  const medium = read("test-fixtures/medium.md");
  const large = read("test-fixtures/large-plan.md");
  const graph = JSON.parse(read("schemas/examples/task-graph-valid.json"));
  const event = JSON.parse(read("schemas/examples/task-event-valid.json"));
  assert.equal(graph.source_plan, "test-fixtures/medium.md", "representative graph fixture corresponds to medium.md");
  assert.match(medium, /Independent slow audit/, "fixture has unrelated slow work");
  assert.match(medium, /Fast dependent/, "fixture has a dependent fast task");
  assert.match(medium, /must not wait for the unrelated slow audit/i, "fixture states dependency-ready behavior");
  assert.match(large, /integration-count checkpointing/i, "large fixture covers DAG checkpoint recovery");
  assert.match(large, /legacy wave\/phase fallback/i, "large fixture retains wave fallback evidence");
  assert.equal(graph.tasks.find((task) => task.task_id === "fast-dependent").depends_on[0], "fast-parent", "graph fixture encodes the fast dependency");
  assert.equal(event.event_type, "integration_branch_created", "event fixture records run-owned branch creation");
});

test("representative graph fixture maps its slow and fast tasks to medium.md", () => {
  const medium = read("test-fixtures/medium.md");
  const graph = JSON.parse(read("schemas/examples/task-graph-valid.json"));
  const taskById = new Map(graph.tasks.map((task) => [task.task_id, task]));
  const expectedTasks = {
    "slow-audit": {
      excerpt: "7-9",
      ownedFiles: ["src/audit/slow.ts"],
      verificationScope: ["src/audit/slow.ts"],
      planText: /## Task slow-audit: Independent slow audit[\s\S]{0,200}Create `src\/audit\/slow\.ts`/,
    },
    "fast-parent": {
      excerpt: "11-12",
      ownedFiles: ["src/fast/parent.ts"],
      verificationScope: ["src/fast/parent.ts"],
      planText: /## Task fast-parent: Fast parent[\s\S]{0,160}Create `src\/fast\/parent\.ts`/,
    },
    "fast-dependent": {
      excerpt: "14-17",
      ownedFiles: ["src/fast/dependent.ts"],
      verificationScope: ["src/fast/dependent.ts"],
      planText: /## Task fast-dependent: Fast dependent[\s\S]{0,200}Create `src\/fast\/dependent\.ts`[\s\S]{0,120}Blocked by: fast-parent/,
    },
  };

  assert.equal(graph.source_plan, "test-fixtures/medium.md", "fixture identifies the plan it represents");
  for (const [taskId, expected] of Object.entries(expectedTasks)) {
    const task = taskById.get(taskId);
    assert.ok(task, `graph contains the ${taskId} task from medium.md`);
    assert.equal(task.task_excerpt_lines, expected.excerpt, `${taskId} preserves its medium.md excerpt range`);
    assert.deepEqual(task.owned_files, expected.ownedFiles, `${taskId} owns the path named by medium.md`);
    assert.deepEqual(task.verification_scope, expected.verificationScope, `${taskId} verifies its owned path`);
    assert.match(medium, expected.planText, `${taskId} graph fields correspond to its source-plan task`);
  }
});

test("representative graph fixture preserves the slow task's full source-plan acceptance criterion", () => {
  const medium = read("test-fixtures/medium.md");
  const graph = JSON.parse(read("schemas/examples/task-graph-valid.json"));
  const slowAudit = graph.tasks.find((task) => task.task_id === "slow-audit");
  const sourceCriterion = medium
    .match(/Create `src\/audit\/slow\.ts` with a deliberately slow isolated audit helper\. It has no\s+dependencies and must not own files used by the fast path\./)[0]
    .replace(/\s+/g, " ");

  assert.ok(slowAudit, "graph contains the slow-audit task");
  assert.deepEqual(
    slowAudit.acceptance_criteria,
    [sourceCriterion],
    "slow-audit retains its complete source-plan acceptance criterion"
  );
});

// --- model-selection-config (model-selection-config-t01) ---

test("SKILL documents the --no-model-config flag and its models.enabled parity", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /--no-model-config.{0,60}ignore any `models:` block in `\.plan-runner\.yml` for this run/i,
    "documents the --no-model-config kill-switch flag"
  );
  assert.match(f, /no_model_config_flag\s*=\s*true/, "captures the flag into no_model_config_flag");
  assert.match(
    f,
    /`models_enabled = false` if `no_model_config_flag` is true/,
    "the flag wins over everything in the models_enabled precedence"
  );
  assert.match(
    f,
    /When `models_enabled` is false, this behaves exactly as `--no-model-config`/,
    "models.enabled: false is documented as identical to the flag"
  );
  assert.match(
    f,
    /the availability gate below is never opened/,
    "disabling model config never opens the gate"
  );
});

test("SKILL resolves the model-policy precedence chain: frontmatter > per-role > tiers > default", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /### 1d-septies\. Resolve model policy/, "has a dedicated model-policy resolution step");
  // pre-existing dev-dispatch precedence pin (tests/contract.test.js:1148) must survive untouched
  assert.match(
    f,
    /a serving project agent's `model:` frontmatter wins; when it declares none, the task's wave-plan `recommended_model` applies/,
    "existing dev-dispatch precedence sentence is preserved"
  );
  const chain = f.slice(f.indexOf("**Build the resolved model map.**"), f.indexOf("**Endpoint preflight**"));
  assert.match(chain, /A serving project agent's `model:` frontmatter/, "step 1: project-agent frontmatter");
  assert.match(chain, /The `models:` per-role key for that role, if set/, "step 2: per-role key");
  assert.match(chain, /The `models\.tiers` entry for the tier the role or task calls for/, "step 3: tier map");
  assert.match(chain, /The built-in default, unchanged from pre-feature behavior/, "step 4: built-in default");
  assert.match(
    f,
    /a raw model identifier and is passed to the host unmodified -- never validated against a model registry/,
    "raw identifiers pass through unmodified and unvalidated"
  );
});

test("SKILL leaves resolution untouched when no models: block is configured", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /`\.plan-runner\.yml` may be absent, unreadable, or missing a requested key -- any of those falls through to the next precedence level without raising/,
    "absent/unreadable/missing config falls through without raising"
  );
  assert.match(
    f,
    /an absent per-role key falls through to the tier map, and an absent tier entry falls through to the built-in default/,
    "empty config resolves to pre-feature built-in defaults"
  );
});

test("SKILL preflights only local facts and never enumerates host models", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /This preflight checks only endpoint reachability, `api_key_env` presence, and config well-formedness\. It does NOT attempt to enumerate the host's available models/,
    "preflight is scoped to locally checkable facts"
  );
  assert.match(
    f,
    /Issue at most one health-check request to `base_url` for the whole run, with a 5-second timeout/,
    "at most one bounded health check per run"
  );
  assert.match(
    f,
    /A failed or timed-out check records the endpoint's health as `"unreachable"` and continues without raising/,
    "a failed health check degrades rather than raising"
  );
  assert.match(
    f,
    /Compare `base_url` against the exported `ANTHROPIC_BASE_URL` environment variable\. If they differ, print a warning naming both values and do NOT modify the process environment/,
    "ANTHROPIC_BASE_URL mismatch is warned, never mutated"
  );
  assert.match(
    f,
    /check it directly -- do NOT print or persist its value, only its name\. Absent or empty -> the endpoint is unavailable/,
    "api_key_env absent/empty never prints or persists a credential"
  );
});

test("SKILL opens the availability gate exactly once and honors the operator's answer", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /ask the operator once, in a single structured question covering every unavailable entry, before any dev agent is dispatched/,
    "one structured question covering every unavailable entry"
  );
  assert.match(
    f,
    /If the availability gate has already been answered earlier in the same run, do NOT ask the operator about model availability again for the remainder of that run/,
    "never asks about model availability twice in one run"
  );
  assert.match(
    f,
    /\*\*Declined:\*\* do NOT substitute by task complexity\. Resolve the affected roles using the pre-feature built-in defaults, record the answer as `consent: "declined"`, and continue the run -- declining never aborts/,
    "declining falls back to built-in defaults and never aborts"
  );
  assert.match(
    f,
    /\*\*No structured-input facility available, or the gate goes unanswered:\*\* dispatch the closest available model, print the substitution, and record it\. Never abort the run/,
    "headless degrade prints and records the substitution without aborting"
  );
});

test("SKILL treats analyzer served-model mismatch as the first-dispatch availability probe", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /compare the model named in its return JSON's top-level `served_model` field -- the analyzer's self-report of which model actually served it, exactly as `token_usage` is a self-report the orchestrator reads back -- against the model configured for the analyzer role\. If they differ, open the availability gate above -- unless it has already been answered this run -- before dispatching any dev agent/,
    "analyzer served-model mismatch opens the gate before any dev dispatch"
  );
  assert.match(f, /run Step 1d-septies' analyzer probe/i, "DAG analyzer dispatch runs the same probe");
});

test("SKILL names the full consent vocabulary and the gate-never-opened omission", () => {
  const skill = read("skills/run/SKILL.md");
  const gate = skill.slice(
    skill.indexOf("**Availability gate.**"),
    skill.indexOf("**Print the resolved map once**")
  );
  assert.ok(gate.length > 0, "availability gate section is present");
  assert.match(
    gate,
    /record the answer as `consent: "granted"`/,
    "the granted branch names consent: \"granted\" literally"
  );
  assert.match(
    gate,
    /record the answer as `consent: "declined"`/,
    "the declined branch names consent: \"declined\" literally"
  );
  assert.match(
    gate,
    /Record the answer as `consent: "auto"`/,
    "the headless branch names consent: \"auto\" literally"
  );
  assert.match(
    gate,
    /The recorded `consent` vocabulary is exactly `granted`, `declined`, and `auto`, matching the enum in\s+`run-state\.schema\.json`/,
    "SKILL pins the consent vocabulary against the run-state schema enum"
  );
  assert.match(
    gate,
    /`consent` is OMITTED from\s+`model_policy` rather than being given a placeholder value/,
    "SKILL states consent is omitted when the gate never opened"
  );

  // the prose vocabulary and the schema enum must not drift apart
  const schema = JSON.parse(read("schemas/run-state.schema.json"));
  const enumv = schema.properties.model_policy.properties.consent.enum;
  assert.deepStrictEqual(
    [...enumv].sort(),
    ["auto", "declined", "granted"],
    "run-state consent enum matches the vocabulary SKILL.md documents"
  );
});

test("SKILL names the served_model field, by name, at every analyzer probe call site", () => {
  const f = read("skills/run/SKILL.md");
  const dagSection = f.slice(f.indexOf("### DAG.2 Analyze and validate the task graph"), f.indexOf("### DAG.3"));
  assert.match(
    dagSection,
    /compare the model named in its return JSON's top-level `served_model` field against the configured model, and open the availability gate before dispatching any dev task if they differ/,
    "DAG.2 names served_model, not just 'the model it reports'"
  );
  assert.match(
    dagSection,
    /A `null` `served_model` means the comparison is not possible -- it is NOT evidence of a mismatch and MUST NOT by itself open the gate/,
    "DAG.2 states the null case explicitly and forbids treating it as a mismatch"
  );

  const septiesSection = f.slice(
    f.indexOf("**Analyzer probe (first-dispatch detection).**"),
    f.indexOf("**Print the resolved map once**")
  );
  assert.match(
    septiesSection,
    /top-level `served_model` field/,
    "1d-septies' canonical analyzer-probe definition names served_model"
  );
  assert.match(
    septiesSection,
    /`served_model` may be `null` when the analyzer had no reliable way to determine which model served it; a `null` value means the comparison is not possible, is NOT evidence of a mismatch, and MUST NOT by itself open the availability gate/,
    "1d-septies states the null case explicitly and forbids treating it as a mismatch"
  );

  const step2Section = f.slice(f.indexOf("## Step 2: ANALYZE PLAN"), f.indexOf("## Step 2-bis: SLICE INTO PHASES"));
  assert.match(
    step2Section,
    /compare the model named in its return JSON's top-level `served_model` field against the model configured for the analyzer role, and open the availability gate before dispatching any dev agent if they differ/,
    "Step 2 names served_model, not just 'the model it reports'"
  );
  assert.match(
    step2Section,
    /A `null` `served_model` means the comparison is not possible -- it is NOT evidence of a mismatch and MUST NOT by itself open the gate/,
    "Step 2 states the null case explicitly and forbids treating it as a mismatch"
  );
});

test("SKILL Step 2 (legacy wave pipeline) resolves the analyzer model through Step 1d-septies and runs its probe", () => {
  const f = read("skills/run/SKILL.md");
  const section = f.slice(f.indexOf("## Step 2: ANALYZE PLAN"), f.indexOf("## Step 2-bis: SLICE INTO PHASES"));
  assert.ok(section.length > 0, "Step 2 section is present");
  assert.match(
    section,
    /Use the model resolved for the `analyzer` role in Step 1d-septies -- which layers on top of, and preserves as its built-in default, the `analyzer_model` from step 1c-bis/,
    "Step 2's analyzer dispatch resolves through Step 1d-septies, keeping step 1c-bis as the no-config default"
  );
  assert.match(
    section,
    /run Step 1d-septies' analyzer probe: compare the model named in its return JSON's top-level `served_model` field against the model configured for the analyzer role, and open the availability gate before dispatching any dev agent if they differ/,
    "Step 2 runs the same served-vs-configured analyzer probe as DAG.2 before any dev dispatch"
  );
});

test("SKILL makes an endpoint-resolved model non-degradable", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /A model resolved through `endpoint\.base_url` SHALL NOT be substituted with a model not served by that same endpoint, on any path, including the headless path above/,
    "endpoint-resolved models never silently reroute to a hosted model"
  );
  assert.match(
    f,
    /ask when an input facility exists; when none exists, halt that dispatch and record it/,
    "unavailable endpoint model halts its dispatch instead of degrading"
  );
});

test("SKILL prints the resolved model policy once and degrades mid-run without a second gate", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /Model policy: <setting>: <value> \(from <flag \| \.plan-runner\.yml \| default>\)\./,
    "prints the resolved map in the established <setting>: <value> (from ...) form"
  );
  assert.match(
    f,
    /A configured model that becomes unavailable after the gate has already been answered degrades to the closest available model.{0,80}and is recorded as a substitution -- it does NOT open a second gate/s,
    "mid-run degradation records a substitution without a second gate"
  );
});

test("SKILL persists and rehydrates model_policy across resume and phase relay", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /the resolved map, its provenance, the endpoint health, the consent answer, and every substitution persist as `model_policy` in `run-state\.json`/,
    "model_policy is the persisted checkpoint shape"
  );
  assert.match(
    f,
    /rehydrate `model_policy` from run-state rather than re-resolving the configuration or re-asking the gate/,
    "resume/relay rehydrates rather than re-resolving"
  );
  // relay phase-runner entry (Step 3-bis.0) rehydrates model_policy
  assert.match(
    f,
    /Load `phase_dir`, `verify_mode`, `tdd_enabled`, `backend`, `model_policy`, and phase `phase_runner_id`'s global wave range from it/,
    "phase relay entry loads model_policy from the run-state"
  );
  // legacy resume (R.3) rehydrates model_policy alongside backend/verify_mode/tdd_enabled/phase_mode
  assert.match(
    f,
    /`backend`, `verify_mode`, `tdd_enabled`, `phase_mode`, and `model_policy` = the values recorded in the run-state/,
    "R.3 restores model_policy from the run-state rather than re-detecting it"
  );
  // DAG resume entry (DAG.5) rehydrates model_policy
  assert.match(
    f,
    /When the loaded state carries `model_policy`, rehydrate it \(Step 1d-septies\) rather than re-resolving the `models:` configuration or re-opening the availability gate/,
    "DAG.5 resume rehydrates model_policy"
  );
  assert.match(
    f,
    /An unphased run \(no run-state file\) keeps the policy session-local -- a single session cannot lose it, so the once-per-run rule still holds/,
    "unphased runs keep the once-per-run guarantee session-locally"
  );
});

test("SKILL records the resolved model and any substitution in the manifest per agent", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /record its resolved model in the manifest entry for that agent \(`resolved_model`, alongside the existing `agent_source`\), and any substitution as `model_substituted: \{configured, dispatched, reason\}` or `null`/,
    "manifest records resolved_model and model_substituted per agent"
  );
});

test("SKILL applies the same model-policy chain on the Codex backend with no client-specific key", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /The same `models:` block, read the same way, applies on the Codex backend: the resolution chain above is unchanged, tier words and raw identifiers are passed to whatever the host understands, and degradation follows the same closest-available rule\. No client-specific key is required/,
    "Codex reads the same models: config with no client-specific key"
  );
});

test("model policy leaves the honesty invariants unweakened", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /the verifier-coverage gate stays upstream of the PR step, and a model substitution never closes a wave whose verdict is outstanding/,
    "verifier-coverage gate stays upstream of the PR step under this feature"
  );
  assert.match(
    f,
    /The orchestrator does not self-verify because a substitution occurred/,
    "a substitution never becomes a self-verify shortcut"
  );
  assert.match(
    f,
    /No credential value -- from `api_key_env` or anywhere else -- is ever printed to the console or persisted to `\.plan-runner\.yml`, the manifest, or `run-state\.json`/,
    "no credential value is ever printed or persisted"
  );
});

test("dev/verifier/aggregator dispatch sites route through the model-policy resolution", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /a `models:` per-role `dev` key overrides `recommended_model`'s tier entirely, and absent a per-role key, `models\.tiers` resolves that tier to a concrete identifier before dispatch/,
    "dev dispatch layers model-policy resolution onto the existing precedence"
  );
  assert.match(
    f,
    /Resolve its model per Step 1d-septies \(role `verifier`; built-in default `sonnet` when available\)/,
    "verifier dispatch resolves its model per the model-policy step"
  );
  assert.match(
    f,
    /Resolve its model per Step 1d-septies \(role `aggregator`; built-in default `sonnet` when available\)/,
    "aggregator dispatch resolves its model per the model-policy step"
  );
  assert.match(
    f,
    /the model-policy precedence \(Step 1d-septies, which layers on top of and preserves the existing recommended-model precedence\)/,
    "DAG dev-task dispatch also routes through the model-policy step"
  );
});

test("PR body surfaces model substitutions alongside bug and verification counts", () => {
  const f = read("skills/pr/SKILL.md");
  assert.match(f, /## Model substitutions/, "PR body has a Model substitutions section");
  assert.match(
    f,
    /any agent entry carries a non-null `model_substituted`.{0,80}insert this section here; omit entirely otherwise/s,
    "the section is present only when a substitution occurred"
  );
  assert.match(
    f,
    /one\s+bullet\s+per\s+substituted\s+agent\s+or\s+task,\s+in\s+manifest\s+order.{0,120}<model_substituted\.configured>\s*->\s*<model_substituted\.dispatched>\s*\(<model_substituted\.reason>\)/s,
    "each bullet names the configured and dispatched model plus the reason"
  );
  assert.match(
    f,
    /Omit the whole section -- heading included -- when\s*no entry in any wave or task carries a non-null `model_substituted`/,
    "the whole section is omitted, heading included, when nothing substituted"
  );
  assert.match(
    f,
    /alongside the existing\s*bug and verification counts/,
    "substitutions are documented as sitting alongside the bug/verification counts"
  );
});

test("SKILL documents the models.endpoint config surface: roles list and request passthrough", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /`models\.endpoint\.roles` -- the list of roles this run dispatches over that endpoint instead of a host subagent \(eligibility validated below\)\. Absent or empty means no role is endpoint-bound and every role resolves and dispatches exactly as it did before this feature\./,
    "models.endpoint.roles is the config key naming endpoint-bound roles"
  );
  assert.match(
    f,
    /`models\.endpoint\.request` -- an optional passthrough object \(`timeout_seconds`, `max_tokens`, `body`\) that Step 4a-quater merges over the HTTP dispatch driver's own defaults \(a timeout below the ~300s gateway limit, and `chat_template_kwargs: \{enable_thinking: false\}`\) key by key, so a passthrough key overrides its corresponding default without discarding the rest\./,
    "models.endpoint.request merges key by key over the driver's own defaults"
  );
});

test("SKILL restricts models.endpoint.roles to dev and test-author, and rejects any other role at preflight", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /Of the six roles above, only `dev` and `test-author` are eligible -- neither is code-writing work that also needs repository or tool access, unlike the other four \(see the eligibility check below\)\./,
    "only dev and test-author are eligible roles"
  );
  assert.match(
    f,
    /\*\*Endpoint role eligibility\*\*, only when `models\.endpoint\.roles` is non-empty: `analyzer`, `aggregator`, and `verifier` are never eligible\. If any of them appears in `models\.endpoint\.roles`, this is a configuration error, not an honored setting -- print and STOP before dispatching anything:/,
    "analyzer/aggregator/verifier in models.endpoint.roles is a configuration error, not an honored setting"
  );
  assert.match(
    f,
    /Configuration error: models\.endpoint\.roles names "<role>", which cannot be served over[\s\S]{0,10}an endpoint\. Only dev and test-author are eligible; analyzer, aggregator, and verifier[\s\S]{0,10}require repository or tool access an HTTP completion cannot supply\./,
    "the ineligible-role error names the role and states which roles require repository/tool access"
  );
});

test("SKILL probes curl before dispatching any endpoint-bound role, and never substitutes on a curl failure", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /\*\*curl probe\*\*, only when `models\.endpoint\.roles` is non-empty \(and role eligibility above passed\): probe that `curl` is executable \(an available shell's `curl --version` or equivalent\) and record the result\. A missing or non-executable `curl` is reported as a named preflight failure, never silently retried later:/,
    "curl probe runs only after role eligibility passes and never silently retries later"
  );
  assert.match(
    f,
    /Endpoint preflight: curl is not executable -- endpoint-bound roles cannot dispatch\./,
    "the curl-missing failure is a named preflight message"
  );
  assert.match(
    f,
    /A missing `curl` is NOT routed through the availability gate below: an endpoint-bound role with no usable `curl` fails loudly at preflight and is NEVER substituted with a host-dispatched or hosted model, on this or any later failure path/,
    "a curl failure fails loudly and is never substituted, bypassing the ordinary availability gate"
  );
});

test("SKILL prints two distinct endpoint dispatch artifacts: the preflight role map and the per-agent dispatch line", () => {
  const f = read("skills/run/SKILL.md");
  const preflightIdx = f.indexOf("**Print the endpoint role map**");
  const perAgentIdx = f.indexOf("**Print the dispatch line**");
  assert.ok(preflightIdx >= 0 && perAgentIdx >= 0 && preflightIdx < perAgentIdx, "the two print sites are distinct and the preflight one comes first");

  // artifact 1: a one-time preflight map, one line per pipeline role
  assert.match(
    f,
    /\*\*Print the endpoint role map\*\*, only when `models\.endpoint\.roles` is non-empty and the two checks above passed: one line per pipeline role, naming its dispatch mechanism, so a run's actual dispatch never silently differs from its configuration/,
    "the preflight role map prints once, one line per pipeline role"
  );
  assert.match(
    f,
    /Endpoint role map:\s*\n\s*analyzer:\s*host subagent\s*\n\s*dev:\s*endpoint \(<base_url>\)\s*\n\s*test-author:\s*endpoint \(<base_url>\)\s*\n\s*verifier:\s*host subagent\s*\n\s*aggregator:\s*host subagent\s*\n\s*integrator:\s*host subagent/,
    "the preflight role map lists all six pipeline roles with their dispatch mechanism"
  );
  assert.match(
    f,
    /A role not listed in `models\.endpoint\.roles` always prints `host subagent`, regardless of whether an endpoint is configured at all\./,
    "an unlisted role always prints host subagent in the preflight map"
  );

  // artifact 2: a per-agent line extending the existing Step 4a provenance line, carrying the empty-conventions-sample report
  assert.match(
    f,
    /\*\*Print the dispatch line\*\*, in the same place the existing host-dispatch provenance line prints:/,
    "the per-agent dispatch line prints in the same place as the existing provenance line"
  );
  assert.match(f, /<agent_id>: served by endpoint \(<base_url>\)/, "the per-agent dispatch line names the serving endpoint");
  assert.match(f, /<agent_id>: conventions sample empty -- see request/, "the per-agent dispatch line carries the empty-conventions-sample report");
});

test("SKILL caps the conventions sample at 3 files or 32 KB, dropping whole files rather than truncating, and reports when it's empty", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /\*\*Select the conventions sample\.\*\* The orchestrator alone performs this selection -- neither the driver nor the parser ever consults the plan or the repository, by contract\./,
    "only the orchestrator selects the conventions sample"
  );
  assert.match(
    f,
    /Take whole files only, nearest-first, until either 3 files or 32 KB total would be exceeded; a file that would cross either cap is dropped whole, never truncated\./,
    "the conventions sample caps at 3 files or 32 KB, dropping whole files rather than truncating"
  );
  assert.match(
    f,
    /These files are read-only context, never members of the task's `owned_files`, so a returned block naming one is refused by the parser exactly as any other unowned path/,
    "conventions-sample files are read-only context, never owned files"
  );
  assert.match(
    f,
    /\*\*When every candidate is dropped by the cap, or none exist, the sample is empty\*\*: say so plainly in the composed message \(e\.g\. "No conventions sample available -- no nearby test files fit within the cap\."\) rather than silently omitting the section, and report it on this agent's dispatch line next\./,
    "an empty conventions sample is stated plainly, not silently omitted"
  );
});

test("SKILL records dispatch_mechanism per agent, matching the manifest schema enum exactly", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /When the agent is endpoint-bound, also record `dispatch_mechanism: "endpoint"` \(`"host_subagent"` for every subagent\/teammate dispatch, including a project agent\) so the manifest carries which process actually made the call, not merely which label was configured\./,
    "manifest recording documents dispatch_mechanism: endpoint vs host_subagent"
  );
  assert.match(
    f,
    /"dispatch_mechanism":\s*"host_subagent \| endpoint"/,
    "the per-agent manifest shape example carries dispatch_mechanism"
  );
  assert.match(
    f,
    /`dispatch_mechanism` is `"endpoint"` for an agent dispatched by the HTTP endpoint dispatch step above, `"host_subagent"` for every subagent\/teammate dispatch \(bundled or project alike\) -- also copied from the wave-state map, never re-derived\./,
    "dispatch_mechanism provenance is copied from the wave-state map, never re-derived"
  );
  assert.doesNotMatch(f, /dispatch_mechanism["']?:\s*"host"/, "dispatch_mechanism must never use the bare value 'host'");

  const manifest = JSON.parse(read("schemas/manifest.schema.json"));
  const dm = manifest.properties.waves.items.properties.agents.items.properties.dispatch_mechanism;
  assert.deepEqual(dm.enum, ["endpoint", "host_subagent"], "manifest schema's dispatch_mechanism enum matches SKILL.md's values exactly");
});

test("SKILL re-probes endpoint health and curl fresh at resume/relay, never trusting the rehydrated policy for reachability", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /including `models\.endpoint\.roles`, so a rehydrated run still knows which roles are endpoint-bound\./,
    "persisted model_policy includes models.endpoint.roles so a rehydrated run knows which roles are endpoint-bound"
  );
  assert.match(
    f,
    /\*\*Endpoint health is the one exception to "rehydrate, don't re-resolve":\*\* re-probe it, and the `curl` check, fresh at a resume or a phase relay \(an endpoint healthy at run start may be dead after a relay, and the reverse\), and print the endpoint role map again from the rehydrated `roles` list\./,
    "endpoint health and curl are re-probed fresh at resume/relay, unlike the rest of model_policy"
  );
  assert.match(
    f,
    /A re-probe failure at resume\/relay is handled exactly as a first-run preflight failure: named, never substituted for an endpoint-bound role\./,
    "a resume/relay re-probe failure is handled exactly like a first-run preflight failure"
  );
});

test("SKILL never prints or persists the endpoint credential, at preflight or at dispatch", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /`headers` = `\{"Authorization": "Bearer <api_key_env value>"\}` when `api_key_env` is set, read directly and never printed \(Step 1d-septies credential rule\)/,
    "the HTTP dispatch request spec reads api_key_env directly and never prints it"
  );
  assert.match(
    f,
    /Write the spec to a file in a host temp location outside the cycle directory -- never under `returns\/` or anywhere else a cycle artifact is retained\./,
    "the credential-bearing request spec is written outside the retained cycle directory"
  );
  assert.match(
    f,
    /Delete the request-spec temp file once the driver returns, whether or not the call succeeded\./,
    "the credential-bearing request-spec temp file is deleted after every call, success or failure"
  );
});

test("SKILL states HTTP endpoint dispatch has full backend parity with no client-specific branch", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /This includes endpoint dispatch: the HTTP dispatch driver is invoked identically on both backends \(skill-relative script resolution, above\), and the eligibility check, curl probe, endpoint role map, and non-degradable-endpoint exception all apply without a client-specific branch\./,
    "endpoint dispatch mechanics apply identically on both backends with no client-specific branch"
  );
});

test("DAG.3/DAG.4 dispatch and integration gates agree with plan-integrator.md's reservation and release steps", () => {
  const skill = read("skills/run/SKILL.md");
  const dag3 = skill.slice(skill.indexOf("### DAG.3"), skill.indexOf("### DAG.4"));
  const dag4 = skill.slice(skill.indexOf("### DAG.4"), skill.indexOf("### DAG.5"));
  const integrator = read("agents/plan-integrator.md");
  assert.ok(dag3.length > 0 && dag4.length > 0, "DAG.3 and DAG.4 sections are present");

  // DAG.3: a durable paths_reserved event gates dispatch, citing plan-integrator step 1
  assert.match(
    dag3,
    /atomically persist that transition together with a schema-valid `paths_reserved` event \(`reservation_id`, `task_id`, `attempt`, and `paths`, the normalized union of `owned_files` and `shared_files`\), per `agents\/plan-integrator\.md` step 1/,
    "DAG.3 requires a durable paths_reserved event before dispatch, citing plan-integrator step 1"
  );
  assert.match(
    dag3,
    /Only once the reservation is durable, append `task_dispatched` before native-subagent\/teammate dispatch/,
    "DAG.3 only appends task_dispatched after the reservation is durable"
  );
  // retry ordering: the prior attempt's release is durable before a fresh reservation is created
  assert.match(
    dag3,
    /a retry or re-execution reuses this same gate and must have durably recorded the prior attempt's `paths_released` release \(DAG\.4\) before this fresh reservation is created/,
    "DAG.3 requires the prior attempt's paths_released before a retry's fresh reservation"
  );

  // DAG.4: a durable paths_released event gates re-dispatch on every terminal/disposal transition, citing plan-integrator step 8
  assert.match(
    dag4,
    /atomically persist that terminal state transition together with a schema-valid `paths_released` event \(`reservation_id`, `task_id`, `attempt`, `paths`, `terminal_status`, and `integration_commit`\), releasing that attempt's reservation before its paths become dispatchable again/,
    "DAG.4 requires a durable paths_released event before paths become dispatchable again"
  );
  assert.match(
    dag4,
    /the same release gate applies whenever the central integrator instead marks an attempt `BLOCKED` or disposes a worktree, per `agents\/plan-integrator\.md` step 8/,
    "DAG.4's release gate also covers BLOCKED outcomes and worktree disposal, citing plan-integrator step 8"
  );

  // agents/plan-integrator.md steps 1 and 8 state the same two-event contract, so the files cannot drift apart again
  assert.match(
    integrator,
    /Before\s+changing\s+the\s+task\s+record\s+to\s+`dispatched`\s+or\s+dispatching\s+a\s+developer,\s+test\s+author,\s+repair\s+worker,\s+or\s+re-execution,\s+the\s+scheduler\s+must\s+atomically\s+persist\s+the\s+state\s+transition\s+and\s+a\s+schema-valid\s+`event_type:\s+"paths_reserved"`\s+lifecycle\s+event/,
    "plan-integrator step 1 requires paths_reserved before any writer dispatch"
  );
  assert.match(
    integrator,
    /When\s+an\s+attempt\s+becomes\s+`INTEGRATED`,\s+`BLOCKED`,\s+or\s+is\s+disposed,\s+the\s+scheduler\s+must\s+atomically\s+persist\s+that\s+terminal\/disposal\s+state\s+transition\s+and\s+a\s+schema-valid\s+`event_type:\s+"paths_released"`\s+lifecycle\s+event/,
    "plan-integrator step 8 requires paths_released on every terminal/disposal transition"
  );
  assert.match(
    integrator,
    /Retrying\/re-executing\s+a\s+task\s+first\s+records\s+the\s+release\/disposal\s+of\s+the\s+old\s+attempt,\s+then\s+creates\s+a\s+fresh\s+`paths_reserved`\s+event\s+and\s+dispatch\s+transition\s+for\s+the\s+new\s+attempt/,
    "plan-integrator step 8 states the same release-before-re-reserve retry ordering as DAG.3"
  );
});

test("scripts/ declares no runtime dependency outside the Node standard library", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(!pkg.dependencies, "package.json declares no runtime dependencies");
  const scriptFiles = ["scripts/http-dispatch.js", "scripts/fenced-blocks.js"];
  const nodeBuiltins = new Set(["fs", "os", "path", "child_process", "http", "https", "url", "util", "crypto"]);
  for (const file of scriptFiles) {
    const src = read(file);
    const requires = [...src.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
    for (const req of requires) {
      const isLocal = req.startsWith(".");
      const isBuiltin = nodeBuiltins.has(req);
      assert.ok(isLocal || isBuiltin, `${file} requires "${req}", which is neither a local module nor a Node standard-library builtin`);
    }
  }
});
