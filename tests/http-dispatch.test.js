// Unit tests for scripts/http-dispatch.js.
// Written for local-endpoint-dispatch-t02. Never reaches the network: the
// curl transport is fully stubbed by monkeypatching child_process.spawnSync
// *before* scripts/http-dispatch.js is first required. That module destructures
// `const { spawnSync } = require("child_process")` once at load time and offers
// no dependency-injection seam of its own for it (see concerns), so this is the
// only way to intercept the call without editing the driver.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const childProcess = require("node:child_process");
let spawnSyncStub = () => {
  throw new Error("spawnSyncStub not configured for this test");
};
childProcess.spawnSync = (...args) => spawnSyncStub(...args);

const httpDispatch = require("../scripts/http-dispatch.js");

const STATUS_MARKER = "__PLAN_RUNNER_HTTP_STATUS__:";

function withTempCwd(fn) {
  const original = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plan-runner-http-dispatch-test-"));
  process.chdir(tmp);
  try {
    return fn(tmp);
  } finally {
    process.chdir(original);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function curlSuccess(bodyObj, httpCode) {
  const code = httpCode === undefined ? 200 : httpCode;
  return {
    error: undefined,
    signal: null,
    status: 0,
    stdout: JSON.stringify(bodyObj) + "\n" + STATUS_MARKER + code,
    stderr: "",
  };
}

function curlHttpError(httpCode, bodyText) {
  return {
    error: undefined,
    signal: null,
    status: 0,
    stdout: (bodyText || "") + "\n" + STATUS_MARKER + httpCode,
    stderr: "",
  };
}

function fencedContent(filePath, fileBody) {
  return filePath + "\n```js\n" + fileBody + "\n```";
}

function readRequestBody(args) {
  const dataIndex = args.indexOf("--data");
  assert.notEqual(dataIndex, -1, "expected curl invocation to pass --data");
  const ref = args[dataIndex + 1];
  assert.equal(
    ref[0],
    "@",
    "the request body must be passed via a file (@path), never inline, for cross-shell quoting safety"
  );
  return JSON.parse(fs.readFileSync(ref.slice(1), "utf8"));
}

function baseSpec(overrides) {
  return Object.assign(
    {
      base_url: "http://stub-endpoint:8000/v1",
      model: "stub-model",
      role: "dev",
      messages: [{ role: "user", content: "hi" }],
      owned_files: ["scripts/example.js"],
      headers: {},
      budgets: {},
      passthrough: {},
    },
    overrides
  );
}

test("buildRequestBody composes required defaults and merges passthrough.body over them", () => {
  const spec = baseSpec({
    passthrough: { body: { chat_template_kwargs: { enable_thinking: false, extra: "x" }, top_p: 0.9 } },
  });
  const body = httpDispatch.buildRequestBody(spec);
  assert.equal(body.model, "stub-model");
  assert.deepEqual(body.messages, spec.messages);
  assert.equal(body.max_tokens, httpDispatch.DEFAULT_MAX_TOKENS);
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false, extra: "x" });
  assert.equal(body.top_p, 0.9);
});

test("buildRequestBody composes the enable_thinking: false default absent any passthrough override", () => {
  assert.deepEqual(httpDispatch.buildRequestBody(baseSpec()).chat_template_kwargs, {
    enable_thinking: false,
  });
});

test("buildRequestBody honors an explicit maxTokensOverride ahead of passthrough/budgets/default", () => {
  const spec = baseSpec({ budgets: { max_tokens: 777 }, passthrough: { max_tokens: 42 } });
  const body = httpDispatch.buildRequestBody(spec, 13);
  assert.equal(body.max_tokens, 13);
});

test("resolveTimeoutSeconds falls back to the 240s default (below the 300s ceiling) absent an override", () => {
  assert.equal(httpDispatch.resolveTimeoutSeconds(baseSpec()), httpDispatch.DEFAULT_TIMEOUT_SECONDS);
  assert.ok(httpDispatch.DEFAULT_TIMEOUT_SECONDS < 300);
});

test("resolveTimeoutSeconds honors passthrough.timeout_seconds when present", () => {
  assert.equal(httpDispatch.resolveTimeoutSeconds(baseSpec({ passthrough: { timeout_seconds: 90 } })), 90);
});

test("resolveMaxTokens prefers passthrough.max_tokens, then budgets.max_tokens, then the default", () => {
  assert.equal(httpDispatch.resolveMaxTokens(baseSpec()), httpDispatch.DEFAULT_MAX_TOKENS);
  assert.equal(httpDispatch.resolveMaxTokens(baseSpec({ budgets: { max_tokens: 777 } })), 777);
  assert.equal(
    httpDispatch.resolveMaxTokens(baseSpec({ budgets: { max_tokens: 777 }, passthrough: { max_tokens: 42 } })),
    42
  );
});

test("deepMerge merges nested plain objects, letting override win on conflicting keys", () => {
  const merged = httpDispatch.deepMerge({ a: 1, nested: { x: 1, y: 2 } }, { nested: { y: 99, z: 3 } });
  assert.deepEqual(merged, { a: 1, nested: { x: 1, y: 99, z: 3 } });
});

test("deepMerge replaces arrays wholesale instead of merging them element-wise", () => {
  const merged = httpDispatch.deepMerge({ list: [1, 2, 3] }, { list: [9] });
  assert.deepEqual(merged.list, [9]);
});

test("deepMerge returns the base unchanged when override is undefined", () => {
  const base = { a: 1 };
  assert.equal(httpDispatch.deepMerge(base, undefined), base);
});

test("dispatch: a response with a usage object records usage, writes the owned file, and reports DONE", () => {
  const spec = baseSpec();
  let calls = 0;
  spawnSyncStub = (cmd) => {
    calls++;
    assert.equal(cmd, "curl");
    return curlSuccess({
      model: "served-model",
      choices: [{ message: { content: fencedContent("scripts/example.js", "module.exports = 1;") }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  };

  withTempCwd((tmp) => {
    const target = path.join(tmp, "scripts", "example.js");
    assert.equal(fs.existsSync(target), false);

    const { responseRecord, returnJson } = httpDispatch.dispatch(spec);

    assert.equal(calls, 1);
    assert.equal(responseRecord.error, null);
    assert.equal(responseRecord.attempts, 1);
    assert.equal(responseRecord.served_model, "served-model");
    assert.deepEqual(responseRecord.usage, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });

    assert.equal(returnJson.status, "DONE");
    assert.deepEqual(returnJson.files_written, ["scripts/example.js"]);
    assert.deepEqual(returnJson.token_usage, { input: 10, output: 5, total: 15, source: "http_usage" });

    assert.equal(fs.existsSync(target), true);
    assert.equal(fs.readFileSync(target, "utf8"), "module.exports = 1;\n");
  });
});

test("dispatch: a response with no usage object records null token_usage rather than estimating one", () => {
  const spec = baseSpec();
  spawnSyncStub = () =>
    curlSuccess({
      model: "served-model",
      choices: [{ message: { content: fencedContent("scripts/example.js", "x") }, finish_reason: "stop" }],
    });

  withTempCwd(() => {
    const { responseRecord, returnJson } = httpDispatch.dispatch(spec);
    assert.equal(responseRecord.usage, null);
    assert.equal(returnJson.token_usage, null);
    assert.equal(returnJson.status, "DONE");
  });
});

test("dispatch: headers from the request spec are forwarded to curl as -H flags", () => {
  const spec = baseSpec({ headers: { Authorization: "Bearer secret-token" } });
  let capturedArgs;
  spawnSyncStub = (cmd, args) => {
    capturedArgs = args;
    return curlSuccess({ choices: [{ message: { content: fencedContent("scripts/example.js", "x") }, finish_reason: "stop" }] });
  };
  withTempCwd(() => {
    httpDispatch.dispatch(spec);
    const headerIndex = capturedArgs.indexOf("Authorization: Bearer secret-token");
    assert.notEqual(headerIndex, -1);
    assert.equal(capturedArgs[headerIndex - 1], "-H");
  });
});

test("dispatch: the resolved timeout is passed to curl via --max-time", () => {
  const spec = baseSpec({ passthrough: { timeout_seconds: 55 } });
  let capturedArgs;
  spawnSyncStub = (cmd, args) => {
    capturedArgs = args;
    return curlSuccess({ choices: [{ message: { content: fencedContent("scripts/example.js", "x") }, finish_reason: "stop" }] });
  };
  withTempCwd(() => {
    httpDispatch.dispatch(spec);
    const idx = capturedArgs.indexOf("--max-time");
    assert.equal(capturedArgs[idx + 1], "55");
  });
});

test("dispatch: base_url has trailing slashes stripped before /chat/completions is appended", () => {
  const spec = baseSpec({ base_url: "http://stub-endpoint:8000/v1///" });
  let capturedArgs;
  spawnSyncStub = (cmd, args) => {
    capturedArgs = args;
    return curlSuccess({ choices: [{ message: { content: fencedContent("scripts/example.js", "x") }, finish_reason: "stop" }] });
  };
  withTempCwd(() => {
    httpDispatch.dispatch(spec);
    const url = capturedArgs[capturedArgs.indexOf("-X") + 2];
    assert.equal(url, "http://stub-endpoint:8000/v1/chat/completions");
  });
});

test("dispatch: a fenced block naming a path outside owned_files is refused, reported as a concern, and not written", () => {
  const spec = baseSpec({ owned_files: ["scripts/example.js"] });
  spawnSyncStub = () =>
    curlSuccess({ choices: [{ message: { content: fencedContent("scripts/not-owned.js", "x") }, finish_reason: "stop" }] });
  withTempCwd((tmp) => {
    const { returnJson } = httpDispatch.dispatch(spec);
    assert.equal(returnJson.status, "DONE_WITH_CONCERNS");
    assert.deepEqual(returnJson.files_written, []);
    assert.ok(
      returnJson.concerns.some((c) => c.includes("scripts/not-owned.js") && c.includes("outside the task's owned file set"))
    );
    assert.equal(fs.existsSync(path.join(tmp, "scripts", "not-owned.js")), false);
  });
});

test("dispatch: a response truncated mid-file on both attempts retries once, writes nothing, and reports the truncation", () => {
  const spec = baseSpec();
  let calls = 0;
  spawnSyncStub = () => {
    calls++;
    return curlSuccess({
      choices: [{ message: { content: "scripts/example.js\n```js\nhalf a file..." }, finish_reason: "stop" }],
    });
  };

  withTempCwd((tmp) => {
    const { responseRecord, returnJson } = httpDispatch.dispatch(spec);
    assert.equal(calls, 2);
    assert.equal(responseRecord.attempts, 2);
    assert.equal(responseRecord.error, "response was truncated mid-file");
    assert.equal(returnJson.status, "BLOCKED");
    assert.equal(fs.existsSync(path.join(tmp, "scripts", "example.js")), false);
  });
});

test("dispatch: a finish_reason of length is treated as truncated even when the fence happens to close", () => {
  const spec = baseSpec();
  spawnSyncStub = () =>
    curlSuccess({ choices: [{ message: { content: fencedContent("scripts/example.js", "content") }, finish_reason: "length" }] });
  withTempCwd((tmp) => {
    const { responseRecord } = httpDispatch.dispatch(spec);
    assert.equal(responseRecord.error, "response was truncated mid-file");
    assert.equal(fs.existsSync(path.join(tmp, "scripts", "example.js")), false);
  });
});

test("dispatch: a response with no fenced block at all retries once then reports the failure without writing anything", () => {
  const spec = baseSpec();
  let calls = 0;
  spawnSyncStub = () => {
    calls++;
    return curlSuccess({ choices: [{ message: { content: "just some prose, no code fence here" }, finish_reason: "stop" }] });
  };
  withTempCwd((tmp) => {
    const { responseRecord, returnJson } = httpDispatch.dispatch(spec);
    assert.equal(calls, 2);
    assert.equal(responseRecord.error, "response had no parsable fenced block");
    assert.equal(returnJson.status, "BLOCKED");
    assert.equal(fs.existsSync(path.join(tmp, "scripts", "example.js")), false);
  });
});

test("dispatch: a response with no assistant message content is treated as a failed attempt, not a crash", () => {
  const spec = baseSpec();
  let calls = 0;
  spawnSyncStub = () => {
    calls++;
    return curlSuccess({
      model: "served-model",
      choices: [{ message: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  };
  withTempCwd(() => {
    const { responseRecord } = httpDispatch.dispatch(spec);
    assert.equal(calls, 2);
    assert.equal(responseRecord.error, "response had no assistant message content");
    assert.equal(responseRecord.served_model, "served-model");
    assert.deepEqual(responseRecord.usage, { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
  });
});

test("dispatch: a curl timeout (process killed by signal) on both attempts is reported, not thrown", () => {
  const spec = baseSpec();
  let calls = 0;
  spawnSyncStub = () => {
    calls++;
    return { error: undefined, signal: "SIGTERM", status: null, stdout: "", stderr: "" };
  };
  withTempCwd(() => {
    const { responseRecord } = httpDispatch.dispatch(spec);
    assert.equal(calls, 2);
    assert.match(responseRecord.error, /terminated by signal SIGTERM/);
    assert.match(responseRecord.error, /likely a timeout/);
  });
});

test("dispatch: a curl exec failure (e.g. ENOENT) is reported as a failed attempt, never thrown", () => {
  const spec = baseSpec();
  spawnSyncStub = () => ({ error: new Error("spawnSync curl ENOENT"), signal: null, status: null, stdout: "", stderr: "" });
  withTempCwd(() => {
    const { responseRecord } = httpDispatch.dispatch(spec);
    assert.match(responseRecord.error, /curl exec failed: spawnSync curl ENOENT/);
  });
});

test("dispatch: a 5xx on both attempts surfaces the HTTP status and response body in the error", () => {
  const spec = baseSpec();
  spawnSyncStub = () => curlHttpError(503, JSON.stringify({ error: "upstream unavailable" }));
  withTempCwd(() => {
    const { responseRecord, returnJson } = httpDispatch.dispatch(spec);
    assert.match(responseRecord.error, /endpoint returned HTTP 503/);
    assert.match(responseRecord.error, /upstream unavailable/);
    assert.equal(returnJson.status, "BLOCKED");
    assert.ok(returnJson.concerns.some((c) => c.includes("endpoint returned HTTP 503")));
  });
});

test("dispatch: a 2xx response whose body is not valid JSON is treated as a failed attempt", () => {
  const spec = baseSpec();
  spawnSyncStub = () => ({
    error: undefined,
    signal: null,
    status: 0,
    stdout: "not-json-at-all\n" + STATUS_MARKER + "200",
    stderr: "",
  });
  withTempCwd(() => {
    const { responseRecord } = httpDispatch.dispatch(spec);
    assert.match(responseRecord.error, /response was not valid JSON/);
  });
});

test("dispatch: curl output missing the HTTP status marker is treated as a failed attempt", () => {
  const spec = baseSpec();
  spawnSyncStub = () => ({ error: undefined, signal: null, status: 0, stdout: "garbage with no marker", stderr: "" });
  withTempCwd(() => {
    const { responseRecord } = httpDispatch.dispatch(spec);
    assert.match(responseRecord.error, /missing the HTTP status marker/);
  });
});

test("regression: the retry budget is strictly reduced from the primary (100 -> 50), not floored to 256", () => {
  const spec = baseSpec({ passthrough: { max_tokens: 100 } });
  const bodies = [];
  let calls = 0;
  spawnSyncStub = (cmd, args) => {
    calls++;
    bodies.push(readRequestBody(args));
    if (calls === 1) return curlHttpError(500, "boom");
    return curlSuccess({ choices: [{ message: { content: fencedContent("scripts/example.js", "ok") }, finish_reason: "stop" }] });
  };
  withTempCwd(() => {
    const { responseRecord } = httpDispatch.dispatch(spec);
    assert.equal(calls, 2);
    assert.equal(responseRecord.attempts, 2);
    assert.equal(bodies[0].max_tokens, 100);
    assert.equal(bodies[1].max_tokens, 50);
    assert.ok(bodies[1].max_tokens < bodies[0].max_tokens, "retry budget must be strictly less than the primary");
  });
});

test("regression: at a primary budget of 1 the retry also uses 1, the documented degenerate case (equal, not smaller)", () => {
  const spec = baseSpec({ passthrough: { max_tokens: 1 } });
  const bodies = [];
  let calls = 0;
  spawnSyncStub = (cmd, args) => {
    calls++;
    bodies.push(readRequestBody(args));
    return curlHttpError(500, "boom");
  };
  withTempCwd(() => {
    const { responseRecord } = httpDispatch.dispatch(spec);
    assert.equal(calls, 2);
    assert.equal(bodies[0].max_tokens, 1);
    assert.equal(bodies[1].max_tokens, 1);
    assert.equal(responseRecord.attempts, 2);
  });
});
