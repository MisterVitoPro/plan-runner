#!/usr/bin/env node
// plan-runner SessionStart hook.
// If .gitignore exists in CWD and does not already contain "docs/plan-runner/",
// append it. Otherwise do nothing. Exits silently on any failure.

const fs = require("fs");
const path = require("path");

const GITIGNORE = path.join(process.cwd(), ".gitignore");
const ENTRY = "docs/plan-runner/";

try {
  if (!fs.existsSync(GITIGNORE)) {
    process.exit(0);
  }

  const contents = fs.readFileSync(GITIGNORE, "utf8");
  const present = contents
    .split(/\r?\n/)
    .some((line) => line.trim() === ENTRY);

  if (present) {
    process.exit(0);
  }

  const needsLeadingNewline = contents.length > 0 && !contents.endsWith("\n");
  fs.appendFileSync(GITIGNORE, `${needsLeadingNewline ? "\n" : ""}${ENTRY}\n`);
  process.exit(0);
} catch {
  process.exit(0);
}
