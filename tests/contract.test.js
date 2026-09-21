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
  assert.match(f, /A red gate that PASSED \(exit 0 -- the orchestrator detects this directly\) is an \*\*invalid red\*\*/, "an invalid red is detected mechanically");
  assert.match(f, /`FAIL` on an invalid red/, "an invalid red fails the deterministic check: one repair, then blocked");
  assert.match(f, /No inline retries|no retries|without retr/i, "explicitly no inline retries");
  assert.match(f, /tdd\.tasks|red_run|green_run/i, "writes red/green evidence to the manifest");
});

test("Step 2 validation resolves every tests_to_satisfy path (no vacuous green from invented paths)", () => {
  const f = read("skills/run/SKILL.md");
  // every impl tests_to_satisfy path must exist on disk OR be authored by an earlier-wave test-author
  assert.match(f, /every path in `tests_to_satisfy` MUST either \(a\) exist on disk/i, "case (a): path exists on disk");
  assert.match(f, /`owned_files` of a `test-author` task this impl depends on, directly or transitively/i, "case (b): authored by a test-author task the impl depends on");
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
  assert.match(f, /A dependency edge between them does NOT excuse the overlap/i, "a dependency edge does not excuse the overlap");
  // the recorded consequence: vacuous red -> paired impl silently skipped
  assert.match(f, /red gate runs zero tests, exits 0, and a vacuous red gates the impl that depends on it/i, "records the vacuous-red failure mode");
  // the single legitimate exception is an explicit schema-level opt-in, capped at one shared file
  assert.match(f, /`inline_tests: true`[\s\S]{0,220}exactly ONE file/i, "inline_tests exception shares exactly one file");
  assert.match(f, /naming both agents and each shared path/i, "STOP names both agents and the shared path");
  // the schema carries the opt-in field, back-compat noted
  const schema = JSON.parse(read("schemas/task-graph.schema.json"));
  const agentProps = schema.$defs.task.properties;
  assert.equal(agentProps.inline_tests.type, "boolean", "task-graph schema defines inline_tests as boolean");
  assert.match(agentProps.inline_tests.description, /3\.0\.0/, "inline_tests description notes where it came from");
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

test("SKILL gates each task on its verifier and forbids the orchestrator self-verifying", () => {
  const f = read("skills/run/SKILL.md");
  // teams-aware verifier completion: poll the durable return file, not a status guess
  assert.match(f, /poll for the file rather than inferring anything from task status/i, "verdicts are read from the durable return file, never inferred");
  // explicit no-self-verify rule
  assert.match(f, /No-self-verify|MUST NOT perform the verification itself|MUST NOT substitute its own judgment/i, "must forbid the orchestrator from self-verifying");
  // missing verdict routes to UNVERIFIABLE, not a silently-closed wave
  assert.match(f, /UNVERIFIABLE[\s\S]{0,160}(aggregate|fix-plan|re-run)/i, "missing verdict must route through the fix-plan loop");
});

test("SKILL selects an execution backend (Claude Agent Teams vs native subagents)", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS/, "must read the agent-teams env var");
  assert.match(f, /backend\s*=\s*"teams"/, "must select the teams backend");
  assert.match(f, /backend\s*=\s*"subagent"/, "must fall back to the subagent backend");
  assert.match(f, /In Codex[\s\S]{0,160}backend\s*=\s*"subagent"/i, "Codex must use native subagents");
  assert.match(f, /per-wave barrier|wave barrier/i, "both backends must keep the per-wave barrier");
});

test("a CI guard blocks private infrastructure identifiers from reaching tracked files", () => {
  // This pin exists because the rule was broken once and the remedy cost the
  // repository its history: a real internal hostname shipped inside an example
  // comment, survived in refs/pull/<n>/head after a squash merge, and could only
  // be removed by deleting and recreating the repo.
  const script = read("scripts/check-no-private-identifiers.js");
  assert.match(script, /ALLOWED_HOSTS/, "the guard keeps an explicit host allow-list");
  assert.match(script, /IPV4/, "the guard scans for IPv4 literals");
  assert.match(script, /EMAIL/, "the guard scans for email addresses");
  assert.match(script, /process\.exit/, "the guard fails the build rather than only warning");

  const ci = read(".github/workflows/ci.yml");
  assert.match(
    ci,
    /node scripts\/check-no-private-identifiers\.js/,
    "CI runs the private-identifier guard"
  );

  const rules = read("CLAUDE.md");
  assert.match(
    rules,
    /Never commit a private infrastructure identifier/,
    "the rule is stated for anyone working in this repo, not only enforced after the fact"
  );
  assert.match(
    rules,
    /must be a placeholder/,
    "the rule tells a dispatcher to require a placeholder when handing an agent a real endpoint"
  );
});

test("release metadata and contract pins are synchronized at 3.0.0", () => {
  const claude = JSON.parse(read(".claude-plugin/plugin.json"));
  const codex = JSON.parse(read(".codex-plugin/plugin.json"));
  const npm = JSON.parse(read("package.json"));
  assert.equal(claude.version, "3.0.0", "contract-test release pin is current");
  assert.equal(codex.version, claude.version, "Codex manifest version matches Claude manifest");
  assert.equal(npm.version, claude.version, "package version matches plugin manifests");
  assert.match(read("CHANGELOG.md"), /^## 3\.0\.0 - \d{4}-\d{2}-\d{2}$/m, "changelog has the current release entry");
  // the marketplace blurb stays ecosystem-length (median ~150 chars across public
  // catalogs; every browsing surface truncates past a few lines) -- per-release
  // feature detail belongs in CHANGELOG/README, never appended here
  assert.ok(claude.description.length <= 300, "marketplace description stays a short blurb (see CLAUDE.md release protocol)");
  const readme = read("README.md");
  assert.match(readme, /--no-tdd/, "README documents the --no-tdd flag");
  assert.match(readme, /red.{0,5}green|red→green/i, "README describes the red-green flow");
});

test("docs and plugin metadata describe the DAG-only executor", () => {
  const readme = read("README.md");
  assert.match(readme, /The task DAG is plan-runner's only executor \(since 3\.0\.0\)/, "README states the DAG is the only executor");
  assert.match(readme, /## Git is required/, "README replaces no-git mode with the Git requirement");
  assert.match(readme, /share: auto\s+# auto \(default\)/, "README documents the worktree bootstrap");
  assert.doesNotMatch(readme, /## No-git mode|falls back to verified file-disjoint waves|--sync-verify` --|last-wave-only/, "README carries no wave-executor documentation");
  assert.ok(exists("docs/adr/0011-remove-the-wave-executor.md"), "the removal is recorded as an ADR");
  assert.match(read("AGENTS.md"), /The task DAG is the only executor \(since 3\.0\.0; ADR-0011\)/, "AGENTS.md invariant matches");
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

test("plan-dev explicitly forbids git writes", () => {
  const f = read("agents/plan-dev.md");
  assert.match(
    f,
    /NEVER run `?git (add|commit|push)/i,
    "plan-dev must name the forbidden git commands, not just say 'do not commit'"
  );
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

test("manifest schema documents code_atlas_sync", () => {
  const schema = JSON.parse(read("schemas/manifest.schema.json"));
  assert.ok(schema.properties.code_atlas_sync, "manifest schema must define code_atlas_sync");
  assert.ok(schema.properties.code_atlas_sync.properties.ran, "code_atlas_sync has a ran flag");
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
  assert.match(f, /"phase":\s*"task"/, "dev-agent tokens are captured");
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
  assert.match(f, /no source yields a figure[\s\S]{0,120}(null|unreported)/i, "tokens are null only when every source is missing");
  // honesty invariant extends to self-reports
  assert.match(f, /token_usage: null`? must never be .{0,10}rescued|never.{0,30}rescued.{0,20}with a guess/i, "a null self-report is never replaced with a guess");
});

test("return schemas carry an optional token_usage self-report (back-compat)", () => {
  const dev = JSON.parse(read("schemas/dev-return.schema.json"));
  assert.ok(dev.properties.token_usage, "dev-return schema defines token_usage");
  assert.ok(!dev.required.includes("token_usage"), "dev-return token_usage is optional");
  assert.match(dev.properties.token_usage.description, /1\.11\.0/, "dev-return notes pre-1.11.0 back-compat");
  const tg = JSON.parse(read("schemas/task-graph.schema.json"));
  assert.ok(tg.properties.token_usage, "task-graph schema defines the analyzer's token_usage");
  assert.ok(!tg.required.includes("token_usage"), "task-graph token_usage is optional");
  assert.ok(!exists("schemas/wave-plan.schema.json"), "the wave-plan schema was removed with the wave executor");
  // manifest entries record where each figure came from
  const manifest = JSON.parse(read("schemas/manifest.schema.json"));
  const byAgent = manifest.properties.token_usage.properties.by_agent.items.properties;
  assert.deepEqual(byAgent.source.enum, ["harness", "self_report", "http_usage"], "by_agent entries carry a source enum, extended with http_usage in 3.0.0 so an endpoint-bound agent's entry validates");
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
  assert.match(f, /tasks are blocked and were not integrated/, "blocked-tasks honesty line");
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
  assert.match(f, /return_file: <absolute path: \$cycle_dir\/returns\/<task_id>-a<attempt>\.json>/, "dev dispatch prompt names the agent's return_file");
  assert.match(f, /return_file: <absolute path: \$cycle_dir\/returns\/<task_id>-a<n>-verifier\.json>/, "verifier dispatch prompt names the verifier's return_file");
  // both prompts instruct the write as the agent's LAST action
  assert.match(f, /FILE-BACKED RETURN: as your LAST action/, "dispatch prompts mandate the final-action file write");
  // the orchestrator reads the file as source of truth; the message is never load-bearing
  assert.match(f, /file as the source of truth/i, "return file is the source of truth");
  assert.match(f, /convenience preview/i, "task result / mailbox message is preview-only");
  assert.match(f, /TaskOutput` cannot resolve a named background agent/, "records why the mailbox cannot be depended on");
  assert.match(f, /races the (teammate|verifier)'s idle teardown/, "records the resend/teardown race");
  // capture order: file first, message fallback, synthetic BLOCKED/UNVERIFIABLE only when both fail
  assert.match(f, /`return_file` and parse the JSON; when the file is missing or unparseable, fall back/, "dev capture reads the file first");
  assert.match(f, /When the `return_file` appears, parse it \(falling back to the verifier's returned message/, "the verdict is read from the return file first");
  // the stuck-teammate fallback checks the return file before declaring BLOCKED
  assert.match(f, /check its `return_file` first/, "a stuck agent's return file is consulted before declaring it BLOCKED");
  // teardown is explicitly safe because returns survive it
  assert.match(f, /return is file-backed in `\$cycle_dir\/returns\/`, which survives the stop/, "teardown cannot lose a file-backed return");
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
    "### 1c-ter. Worktree bootstrap",
    "### 1d-bis. Resolve gate settings, test command + green baseline",
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
    /extract each key directly from `config_text` \(Step 1a-minus-bis\)/,
    /Extract each key directly from `config_text` \(Step 1a-minus-bis\)/,
    /use the `agents\.project` value from `config_text`/,
    /use the `models\.enabled` value from `config_text`/,
    /extract the `models:` block\*\* from `config_text`/,
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

test("phasing config: .plan-runner.yml block keys and defaults are pinned", () => {
  const f = read("skills/run/SKILL.md");
  // CLI flags
  assert.match(f, /--phase-size <N>/, "documents --phase-size flag");
  assert.match(f, /--phase-mode <relay\|stop>/, "documents --phase-mode flag");
  assert.match(f, /--no-phasing/, "documents the --no-phasing kill-switch flag");
  // yml block and its five keys with their documented defaults
  assert.match(f, /phasing:\s*\n\s*enabled:\s*true\s*# default true/, "yml block: enabled default true");
  assert.match(f, /max_integrations_per_phase: 12\s*# default 12/, "yml block: max_waves_per_phase default 4");
  assert.match(f, /mode:\s*auto\s*# auto \(default\) \| relay \| stop/, "yml block: mode default auto, enum relay|stop");
  assert.match(f, /auto_stop_phases:\s*3\s*#/, "yml block: auto_stop_phases default 3");
  assert.match(f, /relay_max_minutes:\s*90\s*#/, "yml block: relay_max_minutes default 90");
  // precedence
  assert.match(f, /flag > yml > default/, "documents flag > yml > default precedence");
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
    "tdd_enabled",
    "overall_status",
    "updated_at",
  ]) {
    assert.ok(schema.required.includes(key), `run-state schema requires ${key}`);
  }
  for (const key of ["verify_mode", "phases"]) {
    assert.ok(!schema.required.includes(key), `run-state schema no longer requires the wave-era ${key}`);
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

test("relay phase-runner derives cycle_dir from the run-state path", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /[Dd]erive `?cycle_dir`? = the \*\*parent directory of `?run_state_path`?\*\*/,
    "relay phase-runner derives cycle_dir from run_state_path's parent before Step 4f's rewrite"
  );
});

test("resume scan keeps only active run-states (no dead 'interrupted' filter)", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(
    f,
    /Keep those that parse AND whose `?overall_status`? is `?active`? AND that carry a `dag` member with at least one task that is not terminal/,
    "R.1 keeps run-states whose overall_status is active and whose graph is unfinished"
  );
  assert.doesNotMatch(
    f,
    /`?overall_status`? is `?active`? or `?interrupted`?/,
    "R.1 no longer filters on the unreachable 'interrupted' status"
  );
});

test("late-verdict reconciliation rule: an expired wait never closes a task to a later verdict", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /\*\*Late-verdict reconciliation rule/, "must define the Late-verdict reconciliation rule");
  // an expired bounded wait does not close the wave to a later verdict
  assert.match(f, /does NOT close that task to a later verdict/i, "recording UNVERIFIABLE or dispatching a replacement must not close the task to a later verdict");
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
  assert.match(f, /A late verdict can never un-integrate a task/, "a late P0 flows to the fix-plan; it never rewrites the branch");
  assert.match(f, /it is a late verdict and MUST be reconciled per the late-verdict reconciliation rule \(4d\)/i, "the coverage gate defers to the reconciliation rule");
});

test("pr skill Step 5 diffs against the fetched remote base, not a stale local ref", () => {
  const f = read("skills/pr/SKILL.md");
  assert.match(f, /git fetch origin "<base>"/, "pr skill must refresh the base branch before computing the branch diff");
  assert.match(f, /diff_base = "origin\/<base>"/, "pr skill must diff against origin/<base> when the fetch succeeds");
  assert.match(f, /git diff --numstat "<diff_base>\.\.\.refs\/heads\/<branch>"/, "numstat diffs the run-owned branch by name against the resolved diff_base, never HEAD");
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
    /Task ordering matches any dependency graph the plan declares explicitly \(e\.g\. "Blocked by:" lines\); no task was reordered to fit a preferred shape against a declared dependency/i,
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
    /a serving project agent's `model:` frontmatter wins; when it declares none, the task's `recommended_model` applies/,
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
    /add one `return_contract_violation` bug to this task's bug JSON/,
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
    /a serving project agent's `model:` frontmatter wins; when it declares none, the task's `recommended_model` applies/,
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
    /The resolved map, its provenance, the endpoint health, the consent answer, and every substitution persist as `model_policy` in `run-state\.json`/,
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
    /Load `backend`, `tdd_enabled`, `model_policy`, and the `dag` object from the run-state, and rehydrate `model_policy` \(Step 1d-septies\) rather than re-resolving the `models:` configuration or re-opening the availability gate/,
    "a relay phase runner rehydrates model_policy from the run-state"
  );
  // legacy resume (R.3) rehydrates model_policy alongside backend/verify_mode/tdd_enabled/phase_mode
  assert.match(
    f,
    /`backend`, `tdd_enabled`, `phase_mode`, and `model_policy` = the values recorded in the run-state/,
    "R.3 restores model_policy from the run-state rather than re-detecting it"
  );
  // DAG resume entry (DAG.5) rehydrates model_policy
  assert.match(
    f,
    /`model_policy` rehydrates \(Step 1d-septies\) rather than re-resolving the `models:` configuration or re-opening the availability gate/,
    "a resumed run rehydrates model_policy"
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
    /the verifier-coverage gate stays upstream of the PR step, and a model substitution never integrates or closes a task whose verdict is outstanding/,
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
    /dispatch the `plan-integrator` role \(complete role definition by absolute path per \*\*Portable role loading\*\*; model per Step 1d-septies, role `integrator`\)/,
    "integrator dispatch also routes through the model-policy step"
  );
});

test("PR body surfaces model substitutions alongside bug and verification counts", () => {
  const f = read("skills/pr/SKILL.md");
  assert.match(f, /## Model substitutions/, "PR body has a Model substitutions section");
  assert.match(
    f,
    /any task entry carries a non-null `model_substituted`.{0,80}insert this section here; omit entirely otherwise/s,
    "the section is present only when a substitution occurred"
  );
  assert.match(
    f,
    /one\s+bullet\s+per\s+substituted\s+task,\s+in\s+manifest\s+order.{0,120}<model_substituted\.configured>\s*->\s*<model_substituted\.dispatched>\s*\(<model_substituted\.reason>\)/s,
    "each bullet names the configured and dispatched model plus the reason"
  );
  assert.match(
    f,
    /Omit the whole section -- heading included -- when\s*no task entry carries a non-null `model_substituted`/,
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
    /`models\.endpoint\.request` -- an optional passthrough object \(`timeout_seconds`, `max_tokens`, `body`\) that Step 4a's HTTP endpoint dispatch merges over the HTTP dispatch driver's own defaults \(a timeout below the ~300s gateway limit, and `chat_template_kwargs: \{enable_thinking: false\}`\) key by key, so a passthrough key overrides its corresponding default without discarding the rest\./,
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
    /`dispatch_mechanism` is `"endpoint"` for an agent dispatched by the HTTP endpoint dispatch step \(4a\), `"host_subagent"` for every subagent\/teammate dispatch \(bundled or project alike\) -- both copied from the task-state map, never re-derived\./,
    "dispatch_mechanism provenance is copied from the task-state map, never re-derived"
  );
  assert.doesNotMatch(f, /dispatch_mechanism["']?:\s*"host"/, "dispatch_mechanism must never use the bare value 'host'");

  const manifest = JSON.parse(read("schemas/manifest.schema.json"));
  const dm = manifest.properties.dag.properties.tasks.items.properties.dispatch_mechanism;
  assert.deepEqual([...dm.enum].sort(), ["endpoint", "host_subagent"], "manifest schema's dispatch_mechanism enum matches SKILL.md's values exactly");
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

// ---------------------------------------------------------------------------
// 3.0.0 throughput changes. Each test pins one change that came out of a real
// 25-hour run: the orchestrator re-typing text into prompts, slow and stalled
// gates, a relay driver waiting on a runner that had already returned, no-git
// runs verifying synchronously, and an invalid red costing a task a whole cycle.
// ---------------------------------------------------------------------------

test("bundled roles are delivered by path, never pasted into a prompt", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /deliver the complete role definition to that subagent \*\*by reference\*\*/, "role delivery is by reference");
  assert.match(f, /ROLE DEFINITION: read <absolute role path> in full before anything else/, "the prompt's first line names the role file");
  assert.match(f, /\*\*Do NOT paste a bundled role file's text into a prompt\.\*\*/, "pasting a bundled role is forbidden");
  assert.match(f, /generated by you, token by token, before the subagent can start/, "records why: prompt text is orchestrator output");
  // the fallback keeps sandboxed hosts working, and registration is still never relied on
  assert.match(f, /\*\*Inline fallback\.\*\*[\s\S]{0,400}`role_delivery = "inline"`/, "a subagent that cannot read the role file gets it inline");
  assert.match(f, /never through native agent registration/, "delivery never depends on agent registration");
  assert.match(f, /reply with exactly ROLE_FILE_UNREADABLE and stop/, "the fallback has a mechanical detection token");
  assert.match(f, /record `"role_delivery": "inline"` at the top level of the cycle-root `manifest\.json`/, "the fallback persists for later phase runners");
  assert.match(f, /Exactly two dispatches still carry pasted definition text/, "the two pasting exceptions are named");
  const manifestSchema = JSON.parse(read("schemas/manifest.schema.json"));
  assert.deepEqual(manifestSchema.properties.role_delivery.enum, ["path", "inline"], "manifest schema documents role_delivery");
  assert.match(manifestSchema.properties.role_delivery.description, /pre-3\.0\.0/, "role_delivery notes back-compat");
  // a project agent's definition stays inline: its position under the override is part of the guard
  assert.match(f, /its position in the prompt -- above the contract that overrides it -- is part of the guard, so it stays inline/, "project-agent definitions stay inline");
  // every bundled dispatch site routes through the rule
  for (const role of ["plan-analyzer.md", "plan-verifier.md", "plan-aggregator.md"]) {
    assert.match(
      f,
      new RegExp(`${role.replace(".", "\\.")}\`[^\\n]{0,120}\\*\\*Portable role loading\\*\\*`),
      `${role} dispatch is delivered per Portable role loading`
    );
  }
});

test("the plan reaches the analyzer as a numbered file, and never enters the orchestrator's context", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /\*\*Do NOT read the plan into your own context\.\*\*/, "pre-flight validates the plan without reading it");
  assert.match(f, /awk '\{printf "%4d\\t%s\\n", NR, \$0\}' "<plan path>" > "\$cycle_dir\/plan\.numbered\.txt"/, "the numbered copy is redirected straight to disk");
  assert.match(f, /\*\*Never inline the plan into the analyzer prompt\.\*\*/, "the plan is never inlined");
  assert.match(f, /record `plan_total_lines` with `awk 'END\{print NR\}' "<path>"`/, "the line count matches the numbering, trailing newline or not");
  assert.match(f, /Numbered plan file: <absolute path to \$cycle_dir\/plan\.numbered\.txt>/, "analyzer prompt carries the file path");
  assert.doesNotMatch(f, /PLAN_WITH_LINES/, "the inlined-plan variable is gone");
  const analyzer = read("agents/plan-analyzer.md");
  assert.match(analyzer, /numbered plan file/i, "analyzer reads the numbered plan file");
  assert.match(analyzer, /page through it[\s\S]{0,80}until you have covered every line/, "analyzer pages through a large plan");
  assert.doesNotMatch(analyzer, /Do NOT use the Read tool/, "the old no-Read rule is gone");
});

test("Gate discipline: file-backed logs, time budgets, foreground waits, and an honest did-not-run state", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /^## Gate discipline$/m, "the skill has a Gate discipline section");
  assert.ok(f.indexOf("## Gate discipline") < f.indexOf("## Step 1: PRE-FLIGHT"), "it is global, ahead of pre-flight, so phase runners read it");
  assert.match(f, /1\. \*\*File-backed output\.\*\*/, "rule 1: file-backed output");
  assert.match(f, /Never stream a gate's output into your own context and never paste it into a prompt/, "gate output never enters a context or a prompt");
  assert.match(f, /2\. \*\*Time budget\.\*\*[\s\S]{0,500}`result: "TIMEOUT"`/, "rule 2: a gate past budget records TIMEOUT");
  assert.match(f, /never a pass, and never a fabricated failure list/, "a timeout is never a pass and never a fabricated failure list");
  assert.match(f, /3\. \*\*Wait in the foreground; never end your turn on a gate\.\*\*/, "rule 3: foreground waits");
  assert.match(f, /\*\*Never end your turn, return, or go idle "waiting on" a monitor, watcher, timer, or background-completion notification while a gate is outstanding\.\*\*/, "no idling on a monitor");
  assert.match(f, /4\. \*\*Did-not-run is its own state\.\*\*[\s\S]{0,300}`BUILD_FAILED`/, "rule 4: a build failure is not an empty failure set");
  // every gate site routes through it
  assert.match(f, /Every gate command runs under \*\*Gate discipline\*\*/, "wave gates run under Gate discipline");
  assert.match(f, /under \*\*Gate discipline\*\* \(log: `\$cycle_dir\/gates\/baseline\.log`/, "the baseline runs under Gate discipline");
  assert.match(f, /run the FULL test command exactly once in the integration worktree, under \*\*Gate discipline\*\*/, "boundary suites run under Gate discipline");
});

test("relay: a returned phase runner is never waited on, and a phase runner never re-runs the baseline", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /\*\*A returned runner is not running\.\*\*/, "driver rule is named");
  assert.match(f, /is a \*\*premature return\*\*, never a reason to wait or to report the phase as "still running"/, "a non-summary return is a premature return");
  assert.match(f, /a return that does not parse as a phase-summary at all/, "premature means unparseable, so it cannot overlap the interrupted branch");
  assert.match(f, /A summary that parses with `status: interrupted` is NOT premature/, "an interrupted summary takes the interrupted path");
  assert.match(f, /Recover at once, without asking/, "recovery is automatic");
  assert.match(f, /Allow at most two recoveries per phase/, "recovery is bounded");
  assert.match(f, /When the recoveries are exhausted, or `status` is `interrupted`, treat the phase as interrupted/, "exhausted recoveries fall back to the interrupted path");
  assert.match(f, /\*\*This phase-summary is your only permitted return\.\*\*/, "runner rule is named");
  assert.match(f, /agents and verifiers by polling their `return_file`/, "a phase runner polls return files instead of ending its turn");
  assert.match(f, /\*\*A phase runner NEVER re-runs the baseline\*\*/, "phase runners load the baseline from the cycle-root manifest");
  assert.match(f, /absorb earlier phases' regressions as "pre-existing"/, "records why a mid-cycle baseline is wrong, not just slow");
  // a recovered or resumed phase can never report token coverage it does not have
  assert.match(f, /\*\*The tally is durable, not in-memory\.\*\*/, "every scheduler session appends to one durable tally");
  assert.match(f, /work that ran always counts toward `agents_total`/, "a lost session's agents still count toward coverage");
  // resume reuses the recorded baseline; it captures only for a pre-2.3.0 checkpoint
  assert.match(f, /\*\*Never re-capture the baseline on resume\.\*\*/, "resume reuses the baseline of record");
  assert.match(f, /so an original `--test-cmd` survives the resume and the driver and its runners never diverge/, "R.3 loads the recorded test command");
  // the DAG resume entry loads the same recorded settings
});

test("fix-plans name their gates and owners, and the analyzer pairs by what the task says", () => {
  const aggregator = read("agents/plan-aggregator.md");
  assert.match(aggregator, /^\*\*Tests:\*\* <test file path\(s\) that gate this fix, comma-separated, or `none`>$/m, "fix-plan template has a Tests line");
  assert.match(aggregator, /\*\*Name the gate\.\*\*/, "rule: name the gate");
  assert.match(aggregator, /\*\*Every cited file gets an owner\.\*\*/, "rule: every cited file gets an owner");
  assert.match(aggregator, /\*\*Blockers first\.\*\*/, "rule: blockers first");
  assert.match(aggregator, /Never guess a nearby test file/, "the aggregator never guesses a gate");
  const analyzer = read("agents/plan-analyzer.md");
  assert.match(analyzer, /\*\*Pair by what the task says, never by proximity\.\*\*/, "analyzer pairs by the task's own text");
  assert.match(analyzer, /`\*\*Tests:\*\* none` means `role: "standalone"`/, "Tests: none is a standalone task");
  assert.match(analyzer, /A named test file that does not exist on disk[\s\S]{0,120}gets a test-author task that owns it/, "a named but missing test file is authored, never an unresolvable gate");
  assert.match(aggregator, /a file appears on exactly one `\*\*File:\*\*` line/, "no two fix tasks own the same file");
});

// ---------------------------------------------------------------------------
// 3.0.0: the task DAG is the ONLY executor. The wave executor, its no-Git
// fallback, configurable verification coverage, and wave-shaped artifacts are gone.
// These tests pin the DAG-only pipeline end to end.
// ---------------------------------------------------------------------------

test("the task DAG is the only executor: no waves, no wave flags, no fallback", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /plan-runner has ONE executor: the dependency-ready task DAG \(ADR-0006\)/, "one executor");
  assert.match(f, /there are no waves and no wave barriers/, "no wave barriers");
  assert.match(f, /Error: the wave executor was removed in plan-runner 3\.0\.0\. Plans run as a task DAG only\./, "--execution-mode wave is a hard error");
  assert.match(f, /`--verify <mode>`, `--sync-verify`, and `--execution-mode dag` are accepted and ignored/, "removed flags are accepted and ignored, never a crash");
  for (const gone of [/## Step 2-bis: SLICE INTO PHASES/, /## Step 4: WAVE EXECUTION/, /### 4b\. Commit the wave/, /wave_start_sha/, /verify_mode/, /max_waves_per_phase:\s*\d/, /\$phase_dir/, /wave-<W>/, /### DAG\.\d/]) {
    assert.doesNotMatch(f, gone, `wave-era construct is gone: ${gone}`);
  }
  assert.ok(!exists("schemas/wave-plan.schema.json"), "the wave-plan schema is removed");
  const analyzer = read("agents/plan-analyzer.md");
  assert.match(analyzer, /There are no waves -- you never bucket, batch, or order tasks beyond their real dependencies/, "the analyzer emits a graph, not waves");
  assert.doesNotMatch(analyzer, /"waves":/, "the analyzer output has no waves array");
  assert.match(analyzer, /## Graph rules \(these are hard constraints\)/, "graph rules replace bucketing rules");
  assert.match(analyzer, /`<base id>-test` and `<base id>-impl`/, "TDD split uses stable task ids");
  assert.match(analyzer, /Two tasks MAY own the same file: the scheduler never runs overlapping owners at the same time/, "overlap is the scheduler's job, not a reason to invent an edge");
});

test("Git with usable worktrees is required; DAG execution is never approximated on a shared tree", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /### 1b-bis\. Require Git and usable worktrees/, "pre-flight requires Git");
  assert.match(f, /\*\*Never approximate DAG execution on a shared working tree\*\*/, "no shared-tree approximation");
  assert.match(f, /plan-runner needs a Git repository with usable worktrees/, "the STOP message says what is needed");
  assert.match(f, /git add -A && git commit -m "baseline"/, "the STOP message says how to prepare the directory");
  assert.match(f, /Then re-run\. Nothing was changed\./, "a failed pre-flight changes nothing");
  assert.match(f, /A resume still requires Git and usable worktrees/, "resume re-checks the requirement");
  assert.match(read("CLAUDE.md"), /Git with usable worktrees is required/, "CLAUDE.md invariant replaces git-is-optional");
});

test("worktree bootstrap: untracked dependencies are linked, never rebuilt per task, and never committed", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /### 1c-ter\. Worktree bootstrap/, "has a bootstrap step");
  assert.match(f, /A fresh worktree contains only what Git tracks\./, "records why it exists");
  assert.match(f, /share: auto\s+# auto \(default\) \| none \| a list of repo-relative untracked directories/, "share key and default");
  assert.match(f, /`auto` resolves to whichever of `node_modules`, `\.venv`, `venv`, and `vendor` exist at the repository root and are untracked/, "auto is conservative: dependency dirs only");
  assert.match(f, /A link is never task output\./, "links never reach a commit");
  assert.match(f, /git add -A -- \. ':\(exclude\)<name>'/, "staging excludes every shared name");
  assert.match(f, /`dag\.worktree\.share` records the RESOLVED list \(never `auto`\)/, "later sessions bootstrap identically");
  const schema = JSON.parse(read("schemas/manifest.schema.json"));
  assert.equal(schema.properties.dag.properties.worktree.properties.share.type, "array", "manifest schema records the resolved share list");
});

test("scheduler: dependency-ready, six active tasks, progress by file, never idle", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /## Step 4: TASK EXECUTION \(dependency-ready scheduler\)/, "Step 4 is the scheduler");
  assert.match(f, /without waiting for unrelated active or ready work/i, "ready tasks do not wait for unrelated work");
  assert.match(f, /six active dev tasks total/i, "the six-task ceiling holds");
  assert.match(f, /Prefer, among the ready tasks, the one with the most transitive dependents/, "critical-path-first selection");
  assert.match(f, /Progress is a file/, "the scheduler advances on durable files");
  assert.match(f, /\*\*Never end your turn while any task is active\*\*/, "a scheduler never idles on a notification");
  assert.match(f, /the schedule degrades to dependency-correct batches/, "a blocking-dispatch host still schedules correctly");
  // reservations agree with the integrator protocol
  const integrator = read("agents/plan-integrator.md");
  assert.match(f, /atomically persist that transition together with a schema-valid `paths_reserved` event \(`reservation_id`, `task_id`, `attempt`, and `paths`, the normalized union of `owned_files` and `shared_files`\), per `\.\.\/\.\.\/agents\/plan-integrator\.md` step 1/, "dispatch is gated on a durable paths_reserved event");
  assert.match(f, /Only once the reservation is durable, append `task_dispatched`, then dispatch/, "task_dispatched follows the reservation");
  assert.match(f, /must have durably recorded the prior attempt's `paths_released` release \(4e\) before this fresh reservation is created/, "a repair releases before it re-reserves");
  assert.match(f, /atomically persist that terminal transition together with a schema-valid `paths_released` event \(`reservation_id`, `task_id`, `attempt`, `paths`, `terminal_status`, and `integration_commit`\)/, "terminal states release the reservation durably");
  assert.match(f, /per `\.\.\/\.\.\/agents\/plan-integrator\.md` step 8/, "release cites integrator step 8");
  assert.match(f, /This permits a child of a fast integrated task to start while an unrelated slow task remains active\./, "the throughput property is stated");
  assert.match(integrator, /Reserve paths before any writer dispatch/, "integrator step 1 still defines the reservation");
  assert.match(integrator, /Release every reservation with durable evidence/, "integrator step 8 still defines the release");
});

test("per-task pipeline: scheduler commits, ownership is a set comparison, gates run in the task worktree", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /### 4a-bis\. Tear down the task agent/, "per-task teardown");
  assert.match(f, /never let finished agents idle until the run ends/, "agents are released as each returns");
  assert.match(f, /The scheduler, never the agent, commits a task's work/, "the scheduler commits");
  assert.match(f, /git diff --name-status -M -C/, "ownership evidence is the complete rename-aware diff");
  assert.match(f, /This is a set comparison, not a judgment/, "ownership conformance is mechanical");
  assert.match(f, /Never silently discard an undeclared write and never widen ownership to fit it\./, "undeclared writes are never hidden");
  assert.match(f, /\*\*inside the task's worktree\*\* -- the only tree that contains this task's work and nobody else's unfinished edits/, "gates run in isolation");
  assert.match(f, /\*\*Every gated task -> scoped checks\.\*\*/, "scoped checks are the per-task regression net");
  assert.match(f, /\*\*Gate evidence is a pointer, never a paste\.\*\*/, "gate evidence travels as log paths");
  // rogue commits cannot reach the branch
  assert.match(f, /git -C "<worktree_path>" log --oneline <base_commit>\.\.HEAD/, "rogue-commit guard inspects the task branch");
  assert.match(f, /A rogue commit can never reach the integration branch on its own: only 4f applies commits there\./, "only central integration mutates the branch");
  // agents may check their own work in their own worktree; it is never evidence
  const dev = read("agents/plan-dev.md");
  assert.match(dev, /\*\*Run only your own targeted tests\.\*\*/, "dev agents may run their targeted tests");
  assert.match(dev, /Your runs are never evidence: the orchestrator re-runs the green gate itself after you return, and only that run counts\./, "an agent's own run is never evidence");
  assert.match(read("agents/plan-test-author.md"), /Your runs are never evidence -- the orchestrator runs the red gate itself/, "same for test authors");
});

test("verification is per task, not configurable, and off the scheduler's critical path", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /verification is not configurable, because a task cannot integrate without a verdict/, "every task attempt is verified");
  assert.match(f, /That tree is already a pinned snapshot: nothing else writes to it while the verdict is pending/, "the task worktree is the snapshot");
  assert.match(f, /\*\*Do NOT wait\.\*\* Persist status `verifying`[^\n]{0,140}dispatch the verifier asynchronously, and return to the scheduling loop/, "verification never blocks scheduling");
  assert.match(f, /No-self-verify rule \(both backends, hard requirement\)/, "no-self-verify survives");
  assert.match(f, /A late or missing verdict becomes a tracked bug, never a silently-integrated task\./, "a missing verdict blocks integration");
  const verifier = read("agents/plan-verifier.md");
  assert.match(verifier, /You are the independent verifier of one task attempt/, "the verifier verifies one task");
  assert.match(verifier, /never under the process working directory \(which is the operator's checkout and does not contain this task's work\)/, "paths resolve in the task worktree");
  assert.match(verifier, /\*\*Severity decides integration, so assign it honestly\.\*\*/, "severity is load-bearing");
  assert.match(verifier, /\*\*Open each log yourself\*\*/, "the verifier reads gate logs by path");
  assert.match(verifier, /`TIMEOUT` proves nothing in either direction/, "a timed-out gate is never a pass");
});

test("integration is severity-gated, repair is bounded at one, and integration is mechanical", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /A finding \*\*blocks integration\*\* when it is severity P0 or P1, when ownership conformance is `FAIL`, when the deterministic check is `FAIL`, or when the verdict is `UNVERIFIABLE`/, "what blocks integration");
  assert.match(f, /P2 and P3 findings do not hold a task, or the subtree behind it, out of the branch/, "nits never cost the dependents their turn");
  assert.match(f, /request exactly one evidence-backed repair attempt/, "one repair");
  assert.match(f, /REPAIR ATTEMPT \(2 of 2\)/, "the repair dispatch is labeled as the last attempt");
  assert.match(f, /Never retry speculatively or erase prior evidence\./, "no speculative retries");
  assert.match(f, /except when `baseline_state` is `build_failed` or `timeout`/, "an unbuildable baseline does not block every task");
  assert.match(f, /This is what lets a repair plan run against a codebase that does not compile yet\./, "records why");
  assert.match(f, /Integration is the ONLY place the run-owned branch is mutated, it happens one task at a time/, "integration is central and serial");
  assert.match(f, /dispatching an agent for every integration would put a serialized LLM round trip behind every task in the run/, "the mechanical path needs no agent");
  assert.match(f, /cherry-pick <base_commit>\.\.<task_commit>/, "verified commits are applied by cherry-pick");
  assert.match(f, /A second conflict marks the task `blocked`\./, "conflict rebuild is capped at one");
  const integrator = read("agents/plan-integrator.md");
  assert.match(integrator, /the scheduler executes its mechanical path directly/, "integrator role agrees");
  assert.match(integrator, /P2 and P3 findings do not block integration/, "integrator role agrees on severity gating");
});

test("the full suite runs rarely: baseline, phase boundaries, and one final verification that gates delivery", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /\*\*The full suite runs rarely, by design\.\*\*/, "stated in pre-flight");
  assert.match(f, /### 4h\. Boundary suite \(phase boundaries only\)/, "boundary suite");
  assert.match(f, /\*\*expected-red\*\* file -- a test file owned by an integrated test-author task whose paired impl task is not yet integrated/, "expected reds are read from the graph and the task state");
  assert.match(f, /### 4j\. Final verification \(once, after every task is terminal\)/, "final verification");
  assert.match(f, /`unverifiable` -- the suite did not run \(`BUILD_FAILED`\) or did not finish \(`TIMEOUT`\); never recorded as a pass/, "did-not-run is never a pass");
  assert.match(f, /Skip the PR step, and print why/, "a failed or unverifiable final suite opens no PR");
  assert.ok(f.indexOf("### 4j. Final verification") < f.indexOf("## Step 5: AGGREGATE"), "final verification precedes aggregation");
});

test("phases are integration-count checkpoints; every run writes a run-state and one manifest", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /EVERY run writes it, phased or not/, "every run is resumable");
  assert.match(f, /`T <= max_integrations_per_phase`/, "phasing activates on task count");
  assert.match(f, /A \*\*phase\*\* is one scheduler session, numbered `P` = the count of `checkpoint` events already in `events\.jsonl`, plus one/, "a phase is a scheduler session with a collision-free number");
  assert.match(f, /Waves are not counted anywhere\./, "no wave counting");
  assert.match(f, /It is the single cycle manifest: every scheduler session \(this one, every relay phase runner, every resumed session\) appends to the same file\./, "one manifest, no per-phase manifests");
  assert.match(f, /There is nothing to roll up: the cycle has one manifest, and every scheduler session wrote to it\./, "no cross-phase roll-up");
  assert.match(f, /It is the run's only plan artifact; there is no wave plan\./, "task-graph.json is the only plan artifact");
});

test("coverage gate is per task and stays upstream of the PR step", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /### 5\.0\. Verifier-coverage gate \(runs before counting, on every path\)/, "the gate exists");
  assert.match(f, /assert that \*\*every\*\* graph task has a verdict on disk or a durable reason it never needed one/, "every task is covered");
  assert.match(f, /never aggregate over a task that is still in flight/, "an unfinished scheduler cannot aggregate");
  assert.match(f, /This gate makes it structurally impossible to reach the PR step/, "upstream of the PR step");
  assert.ok(f.indexOf("### 5.0. Verifier-coverage gate") < f.indexOf("### 5.1. Count and aggregate"), "the gate runs before counting bugs");
  assert.ok(f.indexOf("### 5.0. Verifier-coverage gate") < f.indexOf("## Step 8: OPEN PR"), "the gate precedes the PR step");
});

test("resume is DAG-only: a wave checkpoint cannot resume, the baseline is never re-captured, the operator checkout is never touched", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /### R\.3\. Validate the checkpoint against its branch, graph, and events/, "R.3 validates the DAG checkpoint");
  assert.match(f, /A pre-3\.0\.0 checkpoint -- a run-state with no `dag` member, written by the removed wave executor -- cannot be resumed\./, "wave checkpoints are refused, never reinterpreted");
  assert.match(f, /this consumes no repair budget, because no verdict was ever produced/, "a lost session is not a failed attempt");
  assert.match(f, /\*\*Never re-capture the baseline on resume\.\*\*/, "the baseline of record survives a resume");
  assert.match(f, /The operator's checkout needs no decision on resume: plan-runner never wrote to it/, "no dirty-tree prompt on resume");
  for (const gone of [/### R\.6\./, /### R\.7\./, /resume_from_wave/]) assert.doesNotMatch(f, gone, `wave recovery is gone: ${gone}`);
});

test("a fix-plan re-run builds on the previous cycle's integrated work", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /`--base <ref>` -- internal, passed by the Step 6 fix-plan re-run/, "the internal base flag exists");
  assert.match(f, /a re-run based on the operator's `HEAD` would be fixing code that is not there/, "records why");
  assert.match(f, /<absolute path to fix-plan\.md> --base <this cycle's dag\.integration_branch>/, "the handoff passes the base");
  assert.match(f, /skip the dirty-checkout prompt below -- nothing is read from the operator's working tree/, "a based re-run never prompts about the operator tree");
});

test("code-atlas sync is deferred to the merge; the PR comes from the run-owned branch and tolerates blocked tasks", () => {
  const f = read("skills/run/SKILL.md");
  assert.match(f, /## Step 7-bis: CODE ATLAS \(deferred until the PR merges\)/, "no pre-PR atlas sync");
  assert.match(f, /An incremental atlas update run now would diff an unchanged tree and index nothing/, "records why");
  const pr = read("skills/pr/SKILL.md");
  assert.match(pr, /A\s+`blocked` task does NOT make the run ineligible/, "blocked tasks do not suppress the PR");
  assert.match(pr, /Set `want_draft = \(total_bugs > 0\) OR \(any task is blocked\)`/, "blocked tasks force a draft");
  assert.match(pr, /tasks are blocked and are NOT in this branch/, "the PR body names what is missing");
  assert.match(pr, /Diff the run-owned branch by name, never `HEAD`/, "the diff never uses the operator's HEAD");
  assert.doesNotMatch(pr, /waves_skipped|wave-plan\.json|legacy manifest/, "the pr skill carries no wave-era paths");
  assert.match(read("agents/plan-aggregator.md"), /\*\*A blocked task is unfinished work, not just a bug\.\*\*/, "blocked tasks are re-planned, not patched");
});

test("schemas: wave-era requirements relaxed, DAG-only fixtures registered", () => {
  const manifest = JSON.parse(read("schemas/manifest.schema.json"));
  assert.ok(!manifest.required.includes("waves"), "a DAG-only manifest has no waves array");
  assert.ok(manifest.properties.token_usage.properties.by_agent.items.properties.phase.enum.includes("task"), "by_agent gains the task phase");
  assert.ok(manifest.properties.token_usage.properties.by_agent.items.properties.phase.enum.includes("integrate"), "by_agent gains the integrate phase");
  for (const key of ["baseline_state", "baseline_suite_seconds", "gates"]) {
    assert.match(manifest.properties.tdd.properties[key].description, /pre-3\.0\.0/, `${key} notes back-compat`);
  }
  const bug = JSON.parse(read("schemas/bug-report.schema.json"));
  const bugId = new RegExp(bug.properties.bugs.items.properties.bug_id.pattern);
  assert.ok(bugId.test("task-002-add-user-model-impl-bug-1"), "task-based bug ids validate");
  assert.ok(bugId.test("wave-1-agent-1-bug-1"), "pre-3.0.0 bug ids still validate");
  const dev = JSON.parse(read("schemas/dev-return.schema.json"));
  assert.ok(new RegExp(dev.properties.agent_id.pattern).test("task-002-add-user-model-impl-a1"), "task-based agent ids validate");
  const graph = JSON.parse(read("schemas/task-graph.schema.json"));
  assert.ok(graph.properties.served_model, "the task graph carries the analyzer's served_model");
  const validator = read("tests/validate_schemas.py");
  for (const fixture of ["manifest-dag-only-valid.json", "run-state-dag-only-valid.json", "bug-report-task-valid.json"]) {
    assert.ok(exists(`schemas/examples/${fixture}`), `${fixture} exists`);
    assert.match(validator, new RegExp(fixture.replace(/\./g, "\\.")), `${fixture} is registered`);
  }
  assert.doesNotMatch(validator, /wave-plan/, "the wave-plan case is gone");
});

test("review hardening: task states, empty ranges, mechanical blocks, cleanup, and link safety", () => {
  const f = read("skills/run/SKILL.md");
  // the state machine matches what run-state.schema.json validates per status
  assert.match(f, /\*\*Task states\.\*\* `pending` -> `dispatched` \(attempt 1 in flight\) -> `verifying`/, "the task state machine is spelled out");
  assert.match(f, /a task being repaired is still active/, "a repair keeps its place under the six-task ceiling");
  assert.match(f, /A same-worktree repair \(4e\) skips this paragraph entirely: it keeps attempt 1's `worktree_path` and `base_commit`/, "a repair never moves its base, so the ownership diff stays the task's own work");
  assert.match(f, /A task gets ONE second attempt, whatever triggered it/, "repair, re-execution, and conflict rebuild share one budget (attempts max 2)");
  assert.match(f, /never wipe the commit a repair builds on/, "a lost repair agent does not erase attempt 1");
  // an already-satisfied task is not blocked for having nothing to commit
  assert.match(f, /record `task_commit` = `base_commit` and carry on through every step/, "an empty range still runs ownership, gates, and verification");
  assert.match(f, /an empty range applies nothing, and its `integrated_commit` is the current integration HEAD/, "an empty range integrates as a no-op");
  // a blocked task always reaches the fix-plan
  assert.match(f, /A blocked task with no bug would vanish from the fix-plan, and the run would report zero bugs with work missing from the branch\./, "mechanical blocks get a relayed P0");
  // nothing leaks, nothing is double-run, nothing is deleted through a link
  assert.match(f, /\*\*A STOP before the first dispatch cleans up what this step created\.\*\*/, "pre-dispatch STOPs remove the run-owned branch and worktree");
  assert.match(f, /append a `checkpoint` event with `reason: malformed task graph`/, "the malformed-graph event validates (task_blocked needs a task id)");
  assert.match(f, /any later session finds it with `git worktree list --porcelain`/, "a phase runner or resumed session can find the integration worktree");
  assert.match(f, /do NOT continue to Step 4j, Step 5, Step 6, or any terminal step -- even when this phase made the last task terminal/, "a phase runner never runs final verification");
  assert.match(f, /\*\*Unlink before you remove\.\*\*/, "links are removed before any worktree is");
  assert.match(f, /never a recursive delete that could follow the link into the operator's real `node_modules` or build cache/, "records what the unlink rule protects");
  assert.match(f, /`base_flag` unset -- a Step 6 fix-plan re-run must never be diverted into resuming some other run/, "a based re-run skips the resume offer");
  const integrator = read("agents/plan-integrator.md");
  assert.match(integrator, /\*\*You have no shell and you never run git\*\*/, "the integrator agent is told it cannot mutate anything");
  assert.match(integrator, /share ONE second\s+attempt/, "the integrator agrees on the shared retry budget");
  const verifier = read("agents/plan-verifier.md");
  assert.match(verifier, /Handle BLOCKED and NEEDS_CONTEXT agents/, "NEEDS_CONTEXT is a P0, as the scheduler assumes");
  assert.match(verifier, /P2 when `baseline_state` is `build_failed` or `timeout`/, "a gate timeout does not defeat the unbuildable-baseline exception");
  const pr = read("skills/pr/SKILL.md");
  assert.match(pr, /skipping superseded first-attempt reports \(`\*\.a1\.json`\)/, "repaired tasks are not double-counted");
  assert.match(pr, /gh pr ready "<number>" --undo/, "a ready PR can be pulled back to draft");
});
