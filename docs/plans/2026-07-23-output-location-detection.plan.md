# Output location detection - implementation plan

Goal: Resolve plan-runner's output base from the project's real documentation directory (stated in CLAUDE.md/AGENTS.md/context, else a top-level docs-name scan, else the docs/ fallback) instead of hardcoding docs/.
Source spec: docs/specs/2026-07-23-output-location-detection.md
Flagged constraints (unconfirmed):
- The resolved base is printed once at run start in the format `Output location: <docs_base>/plan-runner/ (from <CLAUDE.md | AGENTS.md | top-level scan | default>).` (binding default).
- "Stated in CLAUDE.md/context" requires an explicit statement naming a docs directory; vague prose is not honored and falls through to the scan (binding default).
- Base resolution uses only directory listing / Glob + reading CLAUDE.md/AGENTS.md, no YAML parser or shell-specific tooling, deterministic for a given repo state (binding default).
- The manifest records the resolved base/cycle_root; the new schema field is optional and back-compatible (pre-1.15.0 manifests still validate) (binding default).
- Target release version for the synchronized version bump: 1.15.0 (minor; new pipeline behavior).

### Task 1: Resolve output base and make resume discovery base-aware in the run skill
Task ID: output-location-detection-t01
Owned files: skills/run/SKILL.md
Interfaces: consumes repo-root CLAUDE.md/AGENTS.md, in-context repository instructions, and a top-level directory listing filtered to ["docs","doc","documentation",".docs"]; produces the resolved `docs_base` string that feeds `cycle_root = "<docs_base>/plan-runner/$DATE/"`, the printed resolved-base line, the dual-base resume glob, and the manifest field consumed by output-location-detection-t03.
Acceptance criteria:
- WHEN CLAUDE.md or AGENTS.md at the repo root (or in-context repository instructions) explicitly names a documentation directory THEN THE SYSTEM SHALL set `docs_base` to that directory and write the cycle tree under `<docs_base>/plan-runner/$DATE/cycle-N`.
- IF no documentation location is stated AND a top-level docs/doc/documentation/.docs directory exists THEN THE SYSTEM SHALL set `docs_base` to the first match in the fixed order docs, doc, documentation, .docs.
- IF no documentation location is stated AND no known-name top-level directory exists THEN THE SYSTEM SHALL fall back to `docs`, preserving current behavior and creating it as today.
- WHEN two or more known-name docs directories both exist THEN THE SYSTEM SHALL choose deterministically by the fixed order and SHALL NOT create a second base.
- WHEN the run starts THEN THE SYSTEM SHALL resolve `docs_base` in a pre-flight step that runs before the resumable-run auto-detect (Step 1a-0), because Step 1a-0 and the resume discovery consume `docs_base` and run ahead of Step 1b.
- WHEN the base is resolved THE SYSTEM SHALL print one line naming the resolved base and its source in the same block as the existing verify-mode / phasing lines, in the format `Output location: <docs_base>/plan-runner/ (from <CLAUDE.md | AGENTS.md | top-level scan | default>).`.
- WHEN scanning for resumable runs (Step 1a-0 auto-detect or bare --resume, step R.1) AND the resolved base differs from docs/ THEN THE SYSTEM SHALL glob run-states under both `<docs_base>/plan-runner/**/run-state.json` and the legacy `docs/plan-runner/**/run-state.json`, de-duplicating when the two paths are identical.
- WHEN base resolution runs THE SYSTEM SHALL use only directory listing / Glob and reading CLAUDE.md/AGENTS.md, with no YAML parser or shell-specific tooling, and SHALL be deterministic for a given repository state.
- WHEN the manifest is written THE SYSTEM SHALL record the resolved base (or full resolved cycle_root) so downstream path reporting stays accurate.
Verification: node --test tests/contract.test.js (pins added by output-location-detection-t06); manual: run the plan on a repo whose docs live in documentation/ and confirm artifacts land under documentation/plan-runner/...; interrupt a run under documentation/plan-runner/ and confirm it is offered by both bare --resume and the fresh-run Step 1a-0 auto-detect.
Non-goals:
- Does not add a .plan-runner.yml output.dir key or a --output-dir flag.
- Does not change the subtree layout under the base (stays plan-runner/$DATE/cycle-N[/phase-M]).
- Does not migrate or relocate already-written run artifacts.
- Does not modify the gitignore hook (output-location-detection-t02) or the manifest schema (output-location-detection-t03).
Blocked by: none
Constraints: This is the walking skeleton and owns the hotspot file skills/run/SKILL.md. Edit prose only; this file is the product. Preserve every existing honesty and pipeline invariant (verifier-coverage gate, token accounting, no self-verify, per-wave dev barrier). Keep base resolution git-independent; resume/hook remain git-gated as today. The dual-base glob must de-duplicate when the resolved base equals docs/.

### Task 2: Base-agnostic gitignore in the SessionStart hook
Task ID: output-location-detection-t02
Owned files: hooks/hooks.json
Interfaces: consumes the SessionStart hook contract (inlined node -e one-liner, no plugin-root or script-file dependency); produces a .gitignore entry that covers any resolved base.
Acceptance criteria:
- WHEN the SessionStart hook runs THEN THE SYSTEM SHALL ensure the .gitignore contains the base-agnostic entry `**/plan-runner/` instead of the literal `docs/plan-runner/`.
- IF `.gitignore` already contains the `**/plan-runner/` entry THEN THE SYSTEM SHALL NOT append a duplicate line.
- WHEN the hook logic is defined THEN THE SYSTEM SHALL keep it a self-contained inlined one-liner with no config, plugin-root, or script-file-path dependency.
Verification: node --test tests/contract.test.js (hook-entry pin added by output-location-detection-t06); manual: run a session in a fresh repo and confirm .gitignore gains exactly one `**/plan-runner/` line.
Non-goals:
- Does not read .plan-runner.yml or the resolved base at hook time.
- Does not remove a pre-existing docs/plan-runner/ line from a repo's .gitignore (both may coexist harmlessly).
- Does not change the hook description's silent-on-failure behavior.
Blocked by: output-location-detection-t01
Constraints: Keep the node -e logic inline in hooks/hooks.json per the repo's hook rule; do not introduce ${CLAUDE_PLUGIN_ROOT} or a script file. Update the hook's own description string to match the new entry.

### Task 3: Manifest schema field for the resolved output base
Task ID: output-location-detection-t03
Owned files: schemas/manifest.schema.json, schemas/examples/manifest-valid.json, schemas/examples/manifest-invalid.json
Interfaces: consumes the resolved base recorded by output-location-detection-t01; produces an optional, back-compatible manifest field capturing the resolved output base / cycle_root.
Acceptance criteria:
- WHEN the manifest schema is updated THEN THE SYSTEM SHALL add an optional field capturing the resolved output base (or cycle_root) with a description noting it is absent on pre-1.15.0 manifests.
- WHEN an old manifest without the new field is validated THEN THE SYSTEM SHALL still validate it (the field is not required).
- WHEN the valid fixture is validated against the schema THEN THE SYSTEM SHALL pass, and WHEN the invalid fixture is validated THEN THE SYSTEM SHALL fail on the intended violation.
Verification: python tests/validate_schemas.py
Non-goals:
- Does not make the field required.
- Does not alter any other schema (run-state, wave-plan, bug-report, dev-return).
- Does not change how the manifest is written (that is output-location-detection-t01).
Blocked by: output-location-detection-t01
Constraints: New manifest fields are optional with a "pre-1.15.0" note in the description per the repo schema rule; provide matching valid AND invalid fixtures; preserve back-compat so existing manifest fixtures still validate.

### Task 4: Correct illustrative output-path references in pr skill and aggregator
Task ID: output-location-detection-t04
Owned files: skills/pr/SKILL.md, agents/plan-aggregator.md
Interfaces: consumes the new base-resolution behavior from output-location-detection-t01; produces accurate, base-neutral example paths in downstream prose (no behavior change - these steps already receive the cycle path as an argument).
Acceptance criteria:
- WHEN either file shows an example output path THEN THE SYSTEM SHALL present it as base-neutral (e.g. `<docs_base>/plan-runner/...`) or explicitly note docs/ is only the default, so the prose no longer implies docs/ is hardcoded.
- WHEN these steps consume the cycle directory THEN THE SYSTEM SHALL continue to take it as a passed argument (behavior unchanged).
Verification: claude plugin validate . ; manual read-through confirming no remaining prose asserts docs/plan-runner/ is the fixed base.
Non-goals:
- Does not change the runtime behavior of the pr step or the aggregator (both are already path-agnostic).
- Does not touch skills/run/SKILL.md.
Blocked by: output-location-detection-t01
Constraints: Prose-only edits; keep examples illustrative. Do not weaken the verifier-coverage gate description in the pr skill.

### Task 5: Version bump (four places) and user-facing docs
Task ID: output-location-detection-t05
Owned files: README.md, CHANGELOG.md, .claude-plugin/plugin.json, .codex-plugin/plugin.json, package.json
Interfaces: consumes the shipped feature from output-location-detection-t01..t04; produces the synchronized release metadata (four of the five version-bump places; the fifth, the contract-test version assertion, is owned by output-location-detection-t06) and the user-facing changelog/readme note.
Acceptance criteria:
- WHEN the version is bumped THEN THE SYSTEM SHALL set `version` to 1.15.0 in .claude-plugin/plugin.json, .codex-plugin/plugin.json, and package.json, keeping all three equal.
- WHEN CHANGELOG.md is updated THEN THE SYSTEM SHALL add a 1.15.0 entry describing the auto-detected output location (SemVer minor: new pipeline behavior).
- WHEN README.md documents output location THEN THE SYSTEM SHALL describe the CLAUDE.md/AGENTS.md-then-top-level-scan-then-docs/ resolution.
Verification: node --test tests/contract.test.js (the version assertion, bumped by output-location-detection-t06, must equal 1.15.0)
Non-goals:
- Does not edit tests/contract.test.js (owned by output-location-detection-t06).
- Does not hand-tag the release or hand-edit the marketplace (the marketplace-pin workflow automates that on merge to main).
Blocked by: output-location-detection-t01
Constraints: Target version is exactly 1.15.0 so it matches the contract-test assertion in output-location-detection-t06. Follow the repo version-bump protocol: all synchronized version places move together in the release.

### Task 6: Contract tests for detection, resume, hook, and the version pin
Task ID: output-location-detection-t06
Owned files: tests/contract.test.js
Interfaces: consumes the prose landed by output-location-detection-t01 (SKILL.md) and output-location-detection-t02 (hook); produces pinned regex/phrase assertions plus the bumped version assertion (the fifth version-bump place).
Acceptance criteria:
- WHEN the contract suite runs THEN THE SYSTEM SHALL assert skills/run/SKILL.md pins the three-tier base resolution (CLAUDE.md/AGENTS.md/context, then the docs/doc/documentation/.docs top-level scan, then docs/ fallback) and that resolution precedes Step 1a-0.
- WHEN the contract suite runs THEN THE SYSTEM SHALL assert skills/run/SKILL.md pins the dual-base resume glob (resolved base plus legacy docs/plan-runner/) and the printed `Output location:` line.
- WHEN the contract suite runs THEN THE SYSTEM SHALL assert hooks/hooks.json pins the `**/plan-runner/` gitignore entry.
- WHEN the contract suite runs THEN THE SYSTEM SHALL assert the plugin/package version equals 1.15.0 and that the Codex and npm versions match the Claude manifest.
- IF any pinned phrase is absent THEN THE SYSTEM SHALL fail the corresponding test naming the missing pin.
Verification: node --test tests/contract.test.js
Non-goals:
- Does not edit the manifest version files (owned by output-location-detection-t05); only the version assertion in the test file moves here.
- Does not add pins for behavior not present in the shipped prose.
Blocked by: output-location-detection-t01, output-location-detection-t02
Constraints: Update the existing "docs + version reflect the ... feature" assertion to 1.15.0 and add a pin tied to this feature per the repo rule that new features get a contract test. Keep pins tolerant of incidental wording but exact on the load-bearing tokens (`**/plan-runner/`, the docs-name list, the legacy glob path).
