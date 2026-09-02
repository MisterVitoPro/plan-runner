// Unit tests for scripts/fenced-blocks.js.
// Written for local-endpoint-dispatch-t02.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const fencedBlocks = require("../scripts/fenced-blocks.js");

function withTempCwd(fn) {
  const original = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plan-runner-fenced-blocks-test-"));
  process.chdir(tmp);
  try {
    return fn(tmp);
  } finally {
    process.chdir(original);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- extractBlocks ----

test("extractBlocks parses a single path-headed fenced block", () => {
  const content = "scripts/example.js\n```js\nconst x = 1;\n```\n";
  const { blocks, truncated } = fencedBlocks.extractBlocks(content);
  assert.equal(truncated, false);
  assert.deepEqual(blocks, [{ path: "scripts/example.js", content: "const x = 1;" }]);
});

test("extractBlocks parses multiple path-headed fenced blocks in one response", () => {
  const content = [
    "scripts/a.js",
    "```js",
    "one",
    "```",
    "",
    "scripts/b.js",
    "```js",
    "two",
    "```",
  ].join("\n");
  const { blocks, truncated } = fencedBlocks.extractBlocks(content);
  assert.equal(truncated, false);
  assert.deepEqual(
    blocks.map((b) => b.path),
    ["scripts/a.js", "scripts/b.js"]
  );
  assert.deepEqual(
    blocks.map((b) => b.content),
    ["one", "two"]
  );
});

test("extractBlocks reports truncated when a fence opens with a valid path but never closes", () => {
  const content = "scripts/example.js\n```js\nhalf a file with no closing fence";
  const { blocks, truncated } = fencedBlocks.extractBlocks(content);
  assert.equal(truncated, true);
  assert.deepEqual(blocks, []);
});

test("extractBlocks keeps earlier fully-closed blocks when a later block is truncated", () => {
  const content = ["scripts/a.js", "```js", "complete", "```", "scripts/b.js", "```js", "never closes"].join("\n");
  const { blocks, truncated } = fencedBlocks.extractBlocks(content);
  assert.equal(truncated, true);
  assert.deepEqual(blocks, [{ path: "scripts/a.js", content: "complete" }]);
});

test("extractBlocks finds no blocks and is not truncated when the response has no fenced block at all", () => {
  const { blocks, truncated } = fencedBlocks.extractBlocks("just prose, no code fence here");
  assert.deepEqual(blocks, []);
  assert.equal(truncated, false);
});

test("extractBlocks ignores a fence whose preceding line does not look like a bare path", () => {
  const content = ["not a path, this has spaces", "```", "ignored body", "```"].join("\n");
  const { blocks, truncated } = fencedBlocks.extractBlocks(content);
  assert.deepEqual(blocks, []);
  assert.equal(truncated, false);
});

test("extractBlocks strips surrounding backticks from an inline-coded path line", () => {
  const content = ["`scripts/example.js`", "```js", "content", "```"].join("\n");
  const { blocks } = fencedBlocks.extractBlocks(content);
  assert.deepEqual(blocks, [{ path: "scripts/example.js", content: "content" }]);
});

test("extractBlocks handles CRLF line endings the same as LF", () => {
  const content = "scripts/example.js\r\n```js\r\nconst x = 1;\r\n```\r\n";
  const { blocks, truncated } = fencedBlocks.extractBlocks(content);
  assert.equal(truncated, false);
  assert.deepEqual(blocks, [{ path: "scripts/example.js", content: "const x = 1;" }]);
});

// ---- parse ----

test("parse writes a block whose path is in ownedFiles, ensuring a trailing newline", () => {
  withTempCwd((tmp) => {
    const { written, refused } = fencedBlocks.parse(
      [{ path: "scripts/example.js", content: "module.exports = 1;" }],
      ["scripts/example.js"]
    );
    assert.deepEqual(written, ["scripts/example.js"]);
    assert.deepEqual(refused, []);
    const full = path.join(tmp, "scripts", "example.js");
    assert.equal(fs.readFileSync(full, "utf8"), "module.exports = 1;\n");
  });
});

test("parse creates an owned path's parent directories and the file itself when neither exists yet", () => {
  withTempCwd((tmp) => {
    const target = path.join(tmp, "scripts", "nested", "new-file.js");
    assert.equal(fs.existsSync(target), false);
    const { written } = fencedBlocks.parse(
      [{ path: "scripts/nested/new-file.js", content: "x" }],
      ["scripts/nested/new-file.js"]
    );
    assert.deepEqual(written, ["scripts/nested/new-file.js"]);
    assert.equal(fs.existsSync(target), true);
  });
});

test("parse overwrites an owned path that already exists", () => {
  withTempCwd((tmp) => {
    fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
    const target = path.join(tmp, "scripts", "example.js");
    fs.writeFileSync(target, "old content\n");
    fencedBlocks.parse([{ path: "scripts/example.js", content: "new content" }], ["scripts/example.js"]);
    assert.equal(fs.readFileSync(target, "utf8"), "new content\n");
  });
});

test("parse refuses a block whose path is outside the owned set and leaves it untouched", () => {
  withTempCwd((tmp) => {
    const { written, refused } = fencedBlocks.parse(
      [{ path: "scripts/not-owned.js", content: "x" }],
      ["scripts/example.js"]
    );
    assert.deepEqual(written, []);
    assert.equal(refused.length, 1);
    assert.equal(refused[0].path, "scripts/not-owned.js");
    assert.match(refused[0].reason, /outside the task's owned file set/);
    assert.equal(fs.existsSync(path.join(tmp, "scripts", "not-owned.js")), false);
  });
});

test("parse refuses an absolute path even if it is literally present in ownedFiles", () => {
  withTempCwd(() => {
    const absPath = path.join(process.cwd(), "scripts", "example.js");
    const { written, refused } = fencedBlocks.parse([{ path: absPath, content: "x" }], [absPath]);
    assert.deepEqual(written, []);
    assert.equal(refused.length, 1);
    assert.match(refused[0].reason, /absolute or escapes its root/);
  });
});

test("parse refuses a path that escapes its root via .. even if it is literally present in ownedFiles", () => {
  withTempCwd(() => {
    const { written, refused } = fencedBlocks.parse(
      [{ path: "scripts/../../evil.js", content: "x" }],
      ["scripts/../../evil.js"]
    );
    assert.deepEqual(written, []);
    assert.equal(refused.length, 1);
    assert.match(refused[0].reason, /absolute or escapes its root/);
  });
});

test("parse does not double-count a path written twice in the same call", () => {
  withTempCwd(() => {
    const { written } = fencedBlocks.parse(
      [
        { path: "scripts/example.js", content: "first" },
        { path: "scripts/example.js", content: "second" },
      ],
      ["scripts/example.js"]
    );
    assert.deepEqual(written, ["scripts/example.js"]);
  });
});

test("parse handles a mix of owned and refused blocks in one call independently", () => {
  withTempCwd((tmp) => {
    const { written, refused } = fencedBlocks.parse(
      [
        { path: "scripts/example.js", content: "kept" },
        { path: "scripts/not-owned.js", content: "dropped" },
      ],
      ["scripts/example.js"]
    );
    assert.deepEqual(written, ["scripts/example.js"]);
    assert.equal(refused.length, 1);
    assert.equal(refused[0].path, "scripts/not-owned.js");
    assert.equal(fs.existsSync(path.join(tmp, "scripts", "example.js")), true);
    assert.equal(fs.existsSync(path.join(tmp, "scripts", "not-owned.js")), false);
  });
});
