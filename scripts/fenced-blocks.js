// plan-runner fenced-block parser.
// Implements local-endpoint-dispatch-t01. See
// docs/plans/2026-08-30-local-endpoint-dispatch.plan.md and
// docs/specs/2026-08-30-local-endpoint-dispatch.md (ADR-0010).
//
// Whole-file response format (model -> parser): one fenced code block per
// file, each preceded by that file's repository-relative path on its own
// line, e.g.:
//
//   scripts/example.js
//   ```js
//   ...file content...
//   ```
//
// Boundary (binding): this module never consults the wave plan, run-state,
// or `.plan-runner.yml`. It receives raw assistant content plus an
// owned-file list and returns written and refused paths -- nothing else.
//
// Two-step contract:
//   extractBlocks(content) -> { blocks: [{path, content}], truncated }
//     Pure parsing, no filesystem access. `truncated` is true when a fence
//     was opened (with a path line ahead of it) but never closed before the
//     content ended -- the caller (http-dispatch.js) treats that as a failed
//     attempt and retries rather than calling parse() with a partial block.
//   parse(blocks, ownedFiles) -> { written: string[], refused: [{path, reason}] }
//     Writes each block whose path is in the owned set (relative to
//     process.cwd(), creating the file and any missing parent directories
//     if it does not already exist) and refuses -- without touching disk --
//     every other path. This is the parser's full external contract:
//     `(blocks, ownedFiles) -> {written, refused}`.

"use strict";

const fs = require("fs");
const path = require("path");

/**
 * @param {string} raw a line immediately preceding a fence-open line
 * @returns {string|null} the normalized path candidate, or null if the line
 *   does not look like a bare repository-relative path
 */
function normalizePathCandidate(raw) {
  if (typeof raw !== "string") return null;
  const candidate = raw.trim().replace(/^`+|`+$/g, "").trim();
  if (!candidate) return null;
  if (candidate.length > 300) return null;
  if (/\s/.test(candidate)) return null;
  if (/[`*_#>|]/.test(candidate)) return null;
  if (!/[./]/.test(candidate)) return null;
  return candidate;
}

/**
 * Parses path-headed fenced code blocks out of raw assistant content.
 * @param {string} content
 * @returns {{blocks: Array<{path: string, content: string}>, truncated: boolean}}
 */
function extractBlocks(content) {
  const text = String(content == null ? "" : content);
  const lines = text.split(/\r\n|\r|\n/);
  const blocks = [];
  let truncated = false;

  let i = 0;
  while (i < lines.length) {
    const fenceOpenMatch = lines[i].match(/^\s*(`{3,})\s*[\w.+-]*\s*$/);
    if (fenceOpenMatch && i > 0) {
      const pathCandidate = normalizePathCandidate(lines[i - 1]);
      if (pathCandidate) {
        const fenceMarker = fenceOpenMatch[1];
        const bodyLines = [];
        let j = i + 1;
        let closed = false;
        while (j < lines.length) {
          if (lines[j].trim() === fenceMarker) {
            closed = true;
            break;
          }
          bodyLines.push(lines[j]);
          j++;
        }
        if (closed) {
          blocks.push({ path: pathCandidate, content: bodyLines.join("\n") });
          i = j + 1;
          continue;
        }
        // Fence opened but never closed before content ran out: the
        // response was truncated mid-file. Stop scanning -- nothing after
        // this point can be trusted -- and report it rather than emitting
        // a partial block.
        truncated = true;
        break;
      }
    }
    i++;
  }

  return { blocks, truncated };
}

/**
 * @param {string} candidatePath
 * @returns {boolean} true if the path is absolute or escapes above its own
 *   root via `..` -- refused even if it happens to be a literal owned-set
 *   member, as a defense-in-depth check.
 */
function escapesOwnedRoot(candidatePath) {
  if (path.isAbsolute(candidatePath)) return true;
  const parts = candidatePath.split(/[\/]/);
  return parts.includes("..");
}

/**
 * Writes each block whose path is in `ownedFiles`; refuses every other
 * path without touching disk. Never consults the plan or run-state.
 * @param {Array<{path: string, content: string}>} blocks
 * @param {string[]} ownedFiles repository-relative paths this task may write
 * @returns {{written: string[], refused: Array<{path: string, reason: string}>}}
 */
function parse(blocks, ownedFiles) {
  const owned = new Set(Array.isArray(ownedFiles) ? ownedFiles : []);
  const written = [];
  const refused = [];

  for (const block of blocks) {
    const blockPath = String(block.path).trim();

    if (escapesOwnedRoot(blockPath)) {
      refused.push({ path: blockPath, reason: "path is absolute or escapes its root" });
      continue;
    }
    if (!owned.has(blockPath)) {
      refused.push({ path: blockPath, reason: "path is outside the task's owned file set" });
      continue;
    }

    const dir = path.dirname(blockPath);
    if (dir && dir !== ".") {
      fs.mkdirSync(dir, { recursive: true });
    }
    const body = block.content.endsWith("\n") ? block.content : block.content + "\n";
    fs.writeFileSync(blockPath, body);
    if (!written.includes(blockPath)) written.push(blockPath);
  }

  return { written, refused };
}

module.exports = { extractBlocks, parse };
