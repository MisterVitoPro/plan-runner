#!/usr/bin/env node
// Fails the build when a private infrastructure identifier reaches a tracked file.
//
// Why this exists: this plugin dispatches agents that are often handed a real,
// working endpoint so they implement against reality instead of guessing at a
// wire format. That is the right call for correctness and the wrong thing to
// commit. A real internal hostname once reached a public release this way, in a
// single example comment, and removing it afterwards cost the repository its
// entire history. This check is cheaper than that.
//
// Node standard library only, matching the repo's no-npm-dependency rule.

"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Hosts that are documentation placeholders or genuinely public. Anything else
// appearing as a URL host is treated as possibly-private and must be justified.
const ALLOWED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "example.com",
  "example.org",
  "host",
  "your-host",
  "github.com",
  "raw.githubusercontent.com",
  "api.github.com",
  "img.shields.io",
  "semver.org",
  "keepachangelog.com",
  "json-schema.org",
  "docs.github.com",
  "claude.ai",
  "claude.com",
  "www.anthropic.com",
  "docs.anthropic.com",
  "api.anthropic.com",
  "registry.npmjs.org",
  "nodejs.org",
  "spdx.org",
  "opensource.org",
]);

// A dotted quad that is not a documented placeholder or loopback.
const IPV4 = /\b(?!0\.0\.0\.0\b|127\.0\.0\.1\b|1\.2\.3\.4\b)(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Any http(s) URL host.
const URL_HOST = /https?:\/\/([A-Za-z0-9._-]+)(?::\d+)?/g;
// An email address that is not a GitHub noreply address.
const EMAIL = /\b(?!noreply@)[A-Za-z0-9._%+-]+@(?!(?:[A-Za-z0-9-]+\.)?users\.noreply\.github\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Hosts that are self-evidently fictional: RFC 2606 reserved TLDs, the
// .internal documentation suffix, and hosts named for what they are (a stub, a
// mock). None can resolve to real infrastructure, so they are safe examples.
const PLACEHOLDER_HOST =
  /(?:^|\.)(?:example|invalid|test|localhost)$|\.internal$|^(?:stub|fake|mock|dummy|placeholder|your|my)[-.]/;

function hostAllowed(host) {
  return ALLOWED_HOSTS.has(host) || PLACEHOLDER_HOST.test(host);
}

// Files whose job is to describe this check, so they legitimately contain the
// patterns as examples.
const SELF = new Set([
  path.join("scripts", "check-no-private-identifiers.js").replace(/\\/g, "/"),
]);

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter(Boolean);
}

function isProbablyText(buf) {
  // A NUL byte in the first 8 KiB is the usual binary tell.
  return !buf.subarray(0, 8192).includes(0);
}

function scanFile(file) {
  const findings = [];
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return findings;
  }
  if (!isProbablyText(buf)) return findings;
  const text = buf.toString("utf8");
  const lines = text.split(/\r?\n/);

  lines.forEach((line, i) => {
    const at = (m) => ({ file, line: i + 1, excerpt: line.trim().slice(0, 120), match: m });

    for (const m of line.matchAll(URL_HOST)) {
      const host = m[1].toLowerCase();
      if (!hostAllowed(host)) {
        findings.push({ ...at(m[0]), kind: "non-placeholder URL host" });
      }
    }
    for (const m of line.matchAll(IPV4)) {
      findings.push({ ...at(m[0]), kind: "IPv4 literal" });
    }
    for (const m of line.matchAll(EMAIL)) {
      findings.push({ ...at(m[0]), kind: "email address" });
    }
  });
  return findings;
}

function main() {
  const files = trackedFiles().filter((f) => !SELF.has(f));
  const findings = files.flatMap(scanFile);

  if (findings.length === 0) {
    console.log(`check-no-private-identifiers: clean (${files.length} tracked files scanned)`);
    return 0;
  }

  console.error("check-no-private-identifiers: FAILED\n");
  console.error(
    "A private infrastructure identifier may have reached a tracked file. Committed\n" +
      "text must use placeholders (localhost, example.com) rather than a real host,\n" +
      "address, or personal email, even inside a comment or an example.\n"
  );
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.kind}: ${f.match}`);
    console.error(`      ${f.excerpt}`);
  }
  console.error(
    `\n${findings.length} finding(s). If a host is genuinely public and belongs here,\n` +
      "add it to ALLOWED_HOSTS in scripts/check-no-private-identifiers.js with a reason."
  );
  return 1;
}

process.exit(main());
