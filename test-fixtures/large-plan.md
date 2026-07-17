# Large Plan Fixture: 52-task staged DAG (release smoke check)

Purpose: a representative large plan for exercising phasing, resume, and the
host-process memory envelope under the **default** `.plan-runner.yml`
configuration (no overrides). It is not a feature test of any one task --
every task below is documentation-shaped and inert, touching only scratch
paths under `test-fixtures/scratch/large-plan/`. Nothing in this fixture
touches product code, and none of its output is meant to be committed as
real repository content.

See `docs/release-smoke.md` for how and when to run this fixture.

## Structure

13 stages, 4 tasks each (52 tasks total). Within a stage the 4 tasks are
mutually independent and touch disjoint files, so they belong in the same
wave. Every task in stage `NN` (02-13) depends on completion of **all 4**
tasks in stage `NN-1`; stage 01 has no dependencies. This chain forces
exactly one wave per stage -- 13 waves -- regardless of the 6-agent-per-wave
cap, since each stage's wave only ever holds 4 agents.

Each task creates one Markdown scratch file with a single placeholder
heading line. Content is intentionally trivial -- the fixture's job is to
produce a large, correctly-shaped wave/phase DAG cheaply, not to exercise
any particular dev behavior.

## Stage 01 (no dependencies)

1. `test-fixtures/scratch/large-plan/stage-01/note-a.md` -- content: `# Stage 01 Note A`
2. `test-fixtures/scratch/large-plan/stage-01/note-b.md` -- content: `# Stage 01 Note B`
3. `test-fixtures/scratch/large-plan/stage-01/note-c.md` -- content: `# Stage 01 Note C`
4. `test-fixtures/scratch/large-plan/stage-01/note-d.md` -- content: `# Stage 01 Note D`

## Stage 02 (depends on all of Stage 01)

1. `test-fixtures/scratch/large-plan/stage-02/note-a.md` -- content: `# Stage 02 Note A`
2. `test-fixtures/scratch/large-plan/stage-02/note-b.md` -- content: `# Stage 02 Note B`
3. `test-fixtures/scratch/large-plan/stage-02/note-c.md` -- content: `# Stage 02 Note C`
4. `test-fixtures/scratch/large-plan/stage-02/note-d.md` -- content: `# Stage 02 Note D`

## Stage 03 (depends on all of Stage 02)

1. `test-fixtures/scratch/large-plan/stage-03/note-a.md` -- content: `# Stage 03 Note A`
2. `test-fixtures/scratch/large-plan/stage-03/note-b.md` -- content: `# Stage 03 Note B`
3. `test-fixtures/scratch/large-plan/stage-03/note-c.md` -- content: `# Stage 03 Note C`
4. `test-fixtures/scratch/large-plan/stage-03/note-d.md` -- content: `# Stage 03 Note D`

## Stage 04 (depends on all of Stage 03)

1. `test-fixtures/scratch/large-plan/stage-04/note-a.md` -- content: `# Stage 04 Note A`
2. `test-fixtures/scratch/large-plan/stage-04/note-b.md` -- content: `# Stage 04 Note B`
3. `test-fixtures/scratch/large-plan/stage-04/note-c.md` -- content: `# Stage 04 Note C`
4. `test-fixtures/scratch/large-plan/stage-04/note-d.md` -- content: `# Stage 04 Note D`

## Stage 05 (depends on all of Stage 04)

1. `test-fixtures/scratch/large-plan/stage-05/note-a.md` -- content: `# Stage 05 Note A`
2. `test-fixtures/scratch/large-plan/stage-05/note-b.md` -- content: `# Stage 05 Note B`
3. `test-fixtures/scratch/large-plan/stage-05/note-c.md` -- content: `# Stage 05 Note C`
4. `test-fixtures/scratch/large-plan/stage-05/note-d.md` -- content: `# Stage 05 Note D`

## Stage 06 (depends on all of Stage 05)

1. `test-fixtures/scratch/large-plan/stage-06/note-a.md` -- content: `# Stage 06 Note A`
2. `test-fixtures/scratch/large-plan/stage-06/note-b.md` -- content: `# Stage 06 Note B`
3. `test-fixtures/scratch/large-plan/stage-06/note-c.md` -- content: `# Stage 06 Note C`
4. `test-fixtures/scratch/large-plan/stage-06/note-d.md` -- content: `# Stage 06 Note D`

## Stage 07 (depends on all of Stage 06)

1. `test-fixtures/scratch/large-plan/stage-07/note-a.md` -- content: `# Stage 07 Note A`
2. `test-fixtures/scratch/large-plan/stage-07/note-b.md` -- content: `# Stage 07 Note B`
3. `test-fixtures/scratch/large-plan/stage-07/note-c.md` -- content: `# Stage 07 Note C`
4. `test-fixtures/scratch/large-plan/stage-07/note-d.md` -- content: `# Stage 07 Note D`

## Stage 08 (depends on all of Stage 07)

1. `test-fixtures/scratch/large-plan/stage-08/note-a.md` -- content: `# Stage 08 Note A`
2. `test-fixtures/scratch/large-plan/stage-08/note-b.md` -- content: `# Stage 08 Note B`
3. `test-fixtures/scratch/large-plan/stage-08/note-c.md` -- content: `# Stage 08 Note C`
4. `test-fixtures/scratch/large-plan/stage-08/note-d.md` -- content: `# Stage 08 Note D`

## Stage 09 (depends on all of Stage 08)

1. `test-fixtures/scratch/large-plan/stage-09/note-a.md` -- content: `# Stage 09 Note A`
2. `test-fixtures/scratch/large-plan/stage-09/note-b.md` -- content: `# Stage 09 Note B`
3. `test-fixtures/scratch/large-plan/stage-09/note-c.md` -- content: `# Stage 09 Note C`
4. `test-fixtures/scratch/large-plan/stage-09/note-d.md` -- content: `# Stage 09 Note D`

## Stage 10 (depends on all of Stage 09)

1. `test-fixtures/scratch/large-plan/stage-10/note-a.md` -- content: `# Stage 10 Note A`
2. `test-fixtures/scratch/large-plan/stage-10/note-b.md` -- content: `# Stage 10 Note B`
3. `test-fixtures/scratch/large-plan/stage-10/note-c.md` -- content: `# Stage 10 Note C`
4. `test-fixtures/scratch/large-plan/stage-10/note-d.md` -- content: `# Stage 10 Note D`

## Stage 11 (depends on all of Stage 10)

1. `test-fixtures/scratch/large-plan/stage-11/note-a.md` -- content: `# Stage 11 Note A`
2. `test-fixtures/scratch/large-plan/stage-11/note-b.md` -- content: `# Stage 11 Note B`
3. `test-fixtures/scratch/large-plan/stage-11/note-c.md` -- content: `# Stage 11 Note C`
4. `test-fixtures/scratch/large-plan/stage-11/note-d.md` -- content: `# Stage 11 Note D`

## Stage 12 (depends on all of Stage 11)

1. `test-fixtures/scratch/large-plan/stage-12/note-a.md` -- content: `# Stage 12 Note A`
2. `test-fixtures/scratch/large-plan/stage-12/note-b.md` -- content: `# Stage 12 Note B`
3. `test-fixtures/scratch/large-plan/stage-12/note-c.md` -- content: `# Stage 12 Note C`
4. `test-fixtures/scratch/large-plan/stage-12/note-d.md` -- content: `# Stage 12 Note D`

## Stage 13 (depends on all of Stage 12)

1. `test-fixtures/scratch/large-plan/stage-13/note-a.md` -- content: `# Stage 13 Note A`
2. `test-fixtures/scratch/large-plan/stage-13/note-b.md` -- content: `# Stage 13 Note B`
3. `test-fixtures/scratch/large-plan/stage-13/note-c.md` -- content: `# Stage 13 Note C`
4. `test-fixtures/scratch/large-plan/stage-13/note-d.md` -- content: `# Stage 13 Note D`

## Expected wave plan

13 waves, one per stage, 4 agents each (Stage `NN`'s 4 tasks -> Wave `NN`;
each wave depends on the previous wave completing in full):

- Wave 01 (Stage 01, no deps) ... Wave 13 (Stage 13, depends on Wave 12).

## Expected phasing (default `.plan-runner.yml`, i.e. no overrides)

With `max_waves_per_phase` at its default of `4`, 13 waves exceeds the
threshold, so phasing activates: `phase_count = ceil(13 / 4) = 4`.

- Phase 1: waves 1-4
- Phase 2: waves 5-8
- Phase 3: waves 9-12
- Phase 4: wave 13

4 phases is greater than the default `auto_stop_phases` (`3`), so with
`mode: auto` (the default) plan-runner's adaptive resolution should select
**stop** mode: the run is expected to end its session at each phase
boundary and require `--resume` to continue, rather than relaying straight
through. This is deliberate -- it makes the fixture exercise both the
phase-slicing/memory-envelope path and the stop/resume path in one smoke
run under an unmodified default config.

If the shipped defaults for `max_waves_per_phase` or `auto_stop_phases`
ever change, adjust the stage count in this fixture (or the wave/phase math
above) so it keeps landing at 10+ waves and 3+ phases with at least one
stop boundary.
