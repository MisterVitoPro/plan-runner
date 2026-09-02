// plan-runner HTTP dispatch driver.
// Implements local-endpoint-dispatch-t01. See
// docs/plans/2026-08-30-local-endpoint-dispatch.plan.md and
// docs/specs/2026-08-30-local-endpoint-dispatch.md (ADR-0010).
//
// Reads a request-spec, composes an OpenAI-compatible chat-completions body,
// shells to `curl` (never Node's fetch -- ADR-0010), retries exactly once
// with a reduced completion budget on any failure, hands a successful
// response's content to the fenced-block parser (scripts/fenced-blocks.js)
// to write owned files, and constructs the response-record and a partial
// dev-return object itself, rather than trusting model-authored JSON.
//
// Node standard library and curl only. No npm dependencies.
//
// The request body is always written to a temp file and passed to curl via
// `--data @<file>` -- never as an inline shell argument -- so this survives
// both PowerShell and Git Bash quoting (a plan constraint).
//
// --- Contracts produced here (consumed by later tasks) ---
//
// Request spec (input; JS object or a path to one, read verbatim -- this
// module never selects the conventions sample or reads the plan/run-state):
//   {
//     base_url: string,        // e.g. "http://localhost:8000/v1" (no trailing /chat/completions)
//     model: string,           // requested model id
//     role: string,            // dispatched role name, informational only
//     messages: [{role, content}],
//     owned_files: string[],   // repo-relative paths this task may write
//     headers: {[name]: value} | undefined,  // e.g. Authorization; opaque, never logged
//     budgets: {max_tokens?: number},
//     passthrough: {           // mirrors .plan-runner.yml models.endpoint.request
//       timeout_seconds?: number,
//       max_tokens?: number,
//       body?: object          // merged over the composed defaults, e.g. chat_template_kwargs
//     }
//   }
//
// Response record (output):
//   {
//     content: string|null,
//     usage: {prompt_tokens, completion_tokens, total_tokens}|null,
//     served_model: string|null,
//     attempts: number,
//     error: string|null,
//     finish_reason: string|null
//   }
//
// dispatch() also returns a `returnJson` object holding the fields this
// module can derive on its own (status, files_written, concerns,
// token_usage, summary). The caller merges in agent_id/task_id/etc., which
// this module never sees.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const fencedBlocks = require("./fenced-blocks.js");

const DEFAULT_TIMEOUT_SECONDS = 240; // stays below the plan's 300s ceiling
const DEFAULT_MAX_TOKENS = 4000;
const STATUS_MARKER = "__PLAN_RUNNER_HTTP_STATUS__:";

/**
 * Deep-merges plain objects, key by key; `override` wins on conflict.
 * Arrays and non-plain values are replaced wholesale, never merged.
 */
function deepMerge(base, override) {
  if (override === undefined) return base;
  const baseIsPlain = base !== null && typeof base === "object" && !Array.isArray(base);
  const overrideIsPlain = override !== null && typeof override === "object" && !Array.isArray(override);
  if (!baseIsPlain || !overrideIsPlain) return override;
  const result = { ...base };
  for (const key of Object.keys(override)) {
    result[key] = deepMerge(base[key], override[key]);
  }
  return result;
}

function resolveTimeoutSeconds(spec) {
  const passthrough = spec.passthrough || {};
  if (typeof passthrough.timeout_seconds === "number") return passthrough.timeout_seconds;
  return DEFAULT_TIMEOUT_SECONDS;
}

function resolveMaxTokens(spec) {
  const passthrough = spec.passthrough || {};
  if (typeof passthrough.max_tokens === "number") return passthrough.max_tokens;
  if (spec.budgets && typeof spec.budgets.max_tokens === "number") return spec.budgets.max_tokens;
  return DEFAULT_MAX_TOKENS;
}

/**
 * Composes the chat-completions body: defaults (including the required
 * `chat_template_kwargs: {enable_thinking: false}`) merged with the
 * passthrough body, so a passthrough key overrides its corresponding
 * default without discarding the rest.
 */
function buildRequestBody(spec, maxTokensOverride) {
  const passthrough = spec.passthrough || {};
  const maxTokens = typeof maxTokensOverride === "number" ? maxTokensOverride : resolveMaxTokens(spec);
  const base = {
    model: spec.model,
    messages: spec.messages,
    max_tokens: maxTokens,
    temperature: 0,
    chat_template_kwargs: { enable_thinking: false },
  };
  return deepMerge(base, passthrough.body || {});
}

function numOrNull(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function extractUsage(parsedBody) {
  if (!parsedBody || typeof parsedBody !== "object" || !parsedBody.usage) return null;
  return {
    prompt_tokens: numOrNull(parsedBody.usage.prompt_tokens),
    completion_tokens: numOrNull(parsedBody.usage.completion_tokens),
    total_tokens: numOrNull(parsedBody.usage.total_tokens),
  };
}

/**
 * Runs one curl attempt against `url` with `body`. Never throws; every
 * outcome (transport failure, non-2xx, malformed JSON, missing content) is
 * reported via the returned `ok` flag and `error` string.
 */
function performAttempt(url, body, timeoutSeconds, headers, tmpDir) {
  const bodyFile = path.join(
    tmpDir,
    `plan-runner-http-dispatch-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  fs.writeFileSync(bodyFile, JSON.stringify(body));

  try {
    const args = ["-sS", "-X", "POST", url, "-H", "Content-Type: application/json"];
    for (const [name, value] of Object.entries(headers || {})) {
      args.push("-H", `${name}: ${value}`);
    }
    args.push("--max-time", String(timeoutSeconds));
    args.push("--data", `@${bodyFile}`);
    args.push("-w", `\n${STATUS_MARKER}%{http_code}`);

    const result = spawnSync("curl", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: (timeoutSeconds + 10) * 1000,
    });

    if (result.error) {
      return { ok: false, error: `curl exec failed: ${result.error.message}` };
    }
    if (result.signal) {
      return { ok: false, error: `curl was terminated by signal ${result.signal} (likely a timeout)` };
    }

    const stdout = result.stdout || "";
    const markerIndex = stdout.lastIndexOf(STATUS_MARKER);
    if (markerIndex === -1) {
      return { ok: false, error: "curl output was missing the HTTP status marker" };
    }
    const bodyText = stdout.slice(0, markerIndex).replace(/\n$/, "");
    const httpCode = parseInt(stdout.slice(markerIndex + STATUS_MARKER.length).trim(), 10);

    if (result.status !== 0) {
      return { ok: false, error: `curl exited with status ${result.status}: ${(result.stderr || "").trim()}` };
    }
    if (!(httpCode >= 200 && httpCode < 300)) {
      return { ok: false, error: `endpoint returned HTTP ${httpCode}: ${bodyText.slice(0, 500)}` };
    }

    let parsedBody;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch (e) {
      return { ok: false, error: `response was not valid JSON: ${e.message}` };
    }

    const usage = extractUsage(parsedBody);
    const servedModel = typeof parsedBody.model === "string" ? parsedBody.model : null;
    const choice = Array.isArray(parsedBody.choices) ? parsedBody.choices[0] : null;
    const finishReason = choice && typeof choice.finish_reason === "string" ? choice.finish_reason : null;
    const content = choice && choice.message && typeof choice.message.content === "string" ? choice.message.content : null;

    if (content === null) {
      return { ok: false, error: "response had no assistant message content", usage, servedModel, finishReason };
    }

    return { ok: true, content, usage, servedModel, finishReason };
  } finally {
    try {
      fs.unlinkSync(bodyFile);
    } catch (_) {
      // best-effort cleanup
    }
  }
}

/**
 * Builds the caller-mergeable partial dev-return object from a completed
 * response record and the fenced-block parser's result. The orchestrator
 * fills in agent_id/task_id/context7_queries, which this module never sees.
 */
function buildReturnJson(responseRecord, parseResult) {
  const concerns = parseResult.refused.map(
    (r) => `Refused fenced block for ${r.path}: ${r.reason}`
  );

  let status;
  if (responseRecord.error) {
    status = "BLOCKED";
    concerns.push(responseRecord.error);
  } else if (concerns.length > 0) {
    status = "DONE_WITH_CONCERNS";
  } else {
    status = "DONE";
  }

  const summary = responseRecord.error
    ? `Endpoint dispatch failed after ${responseRecord.attempts} attempt(s): ${responseRecord.error}`
    : `Endpoint dispatch wrote ${parseResult.written.length} file(s) via ${responseRecord.served_model || "the configured model"}.`;

  return {
    status,
    files_written: parseResult.written,
    files_unexpectedly_modified: [],
    concerns,
    summary,
    // source: "http_usage" tags this as endpoint-reported usage so the
    // orchestrator counts the role as reported; null (no usage reported)
    // is left as-is so the orchestrator's unreported coverage counter can
    // pick it up -- this module never estimates a value.
    token_usage: responseRecord.usage
      ? {
          input: responseRecord.usage.prompt_tokens,
          output: responseRecord.usage.completion_tokens,
          total: responseRecord.usage.total_tokens,
          source: "http_usage",
        }
      : null,
  };
}

/**
 * Dispatches one endpoint-bound task: composes the request, calls the
 * endpoint via curl with exactly one retry (reduced completion budget) on
 * any failure -- including a response with no parsable fenced block or one
 * truncated mid-file -- writes owned files via the fenced-block parser on
 * success, and returns { responseRecord, returnJson }.
 *
 * @param {object|string} requestSpecInput a request-spec object, or a path
 *   to a JSON file containing one.
 */
function dispatch(requestSpecInput) {
  const spec =
    typeof requestSpecInput === "string"
      ? JSON.parse(fs.readFileSync(requestSpecInput, "utf8"))
      : requestSpecInput;

  const url = `${String(spec.base_url).replace(/\/+$/, "")}/chat/completions`;
  const timeoutSeconds = resolveTimeoutSeconds(spec);
  const ownedFiles = Array.isArray(spec.owned_files) ? spec.owned_files : [];
  const headers = spec.headers || {};
  const tmpDir = os.tmpdir();

  const primaryMaxTokens = resolveMaxTokens(spec);
  // No hard floor: a floor could push the retry budget to or above the primary
  // budget when the primary itself resolves small, which is the opposite of
  // "reduced". Halving with a floor of 1 keeps the retry strictly below the
  // primary for every primary > 1; at primary == 1 there is no smaller usable
  // positive budget, so the retry stays at 1 (equal, not smaller -- see concerns).
  const retryMaxTokens = Math.max(1, Math.floor(primaryMaxTokens / 2));
  const attemptBodies = [buildRequestBody(spec, primaryMaxTokens), buildRequestBody(spec, retryMaxTokens)];

  let lastError = null;
  let lastUsage = null;
  let lastServedModel = null;
  let lastFinishReason = null;

  for (let attemptNum = 1; attemptNum <= attemptBodies.length; attemptNum++) {
    const result = performAttempt(url, attemptBodies[attemptNum - 1], timeoutSeconds, headers, tmpDir);
    if (result.usage) lastUsage = result.usage;
    if (result.servedModel) lastServedModel = result.servedModel;
    if (result.finishReason !== undefined) lastFinishReason = result.finishReason;

    if (!result.ok) {
      lastError = result.error;
      continue;
    }

    const extracted = fencedBlocks.extractBlocks(result.content);
    const trulyTruncated = extracted.truncated || result.finishReason === "length";
    if (trulyTruncated || extracted.blocks.length === 0) {
      lastError = trulyTruncated
        ? "response was truncated mid-file"
        : "response had no parsable fenced block";
      continue; // do not write anything from a truncated/blockless attempt
    }

    const parseResult = fencedBlocks.parse(extracted.blocks, ownedFiles);
    const responseRecord = {
      content: result.content,
      usage: lastUsage,
      served_model: lastServedModel,
      attempts: attemptNum,
      error: null,
      finish_reason: lastFinishReason,
    };
    return { responseRecord, returnJson: buildReturnJson(responseRecord, parseResult) };
  }

  const responseRecord = {
    content: null,
    usage: lastUsage,
    served_model: lastServedModel,
    attempts: attemptBodies.length,
    error: lastError || "endpoint dispatch failed",
    finish_reason: lastFinishReason,
  };
  return { responseRecord, returnJson: buildReturnJson(responseRecord, { written: [], refused: [] }) };
}

module.exports = {
  dispatch,
  buildRequestBody,
  resolveTimeoutSeconds,
  resolveMaxTokens,
  deepMerge,
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_MAX_TOKENS,
};

// CLI: node scripts/http-dispatch.js <request-spec.json> <response-record-out.json> [return-json-out.json]
if (require.main === module) {
  const [, , specPath, responseOutPath, returnOutPath] = process.argv;
  if (!specPath || !responseOutPath) {
    process.stderr.write(
      "usage: node http-dispatch.js <request-spec.json> <response-record-out.json> [return-json-out.json]\n"
    );
    process.exit(2);
  }
  const { responseRecord, returnJson } = dispatch(specPath);
  fs.writeFileSync(responseOutPath, JSON.stringify(responseRecord, null, 2));
  if (returnOutPath) {
    fs.writeFileSync(returnOutPath, JSON.stringify(returnJson, null, 2));
  }
  process.exit(responseRecord.error ? 1 : 0);
}
