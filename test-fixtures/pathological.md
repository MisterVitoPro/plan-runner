# Pathological Fixture: 10 tasks, 8 touch the same file

Add the following 10 methods to `src/lib/utils.ts` (creating the file if it does not exist):

1. `add(a: number, b: number): number` -> `src/lib/utils.ts`
2. `sub(a: number, b: number): number` -> `src/lib/utils.ts`
3. `mul(a: number, b: number): number` -> `src/lib/utils.ts`
4. `div(a: number, b: number): number` -> `src/lib/utils.ts`
5. `mod(a: number, b: number): number` -> `src/lib/utils.ts`
6. `pow(a: number, b: number): number` -> `src/lib/utils.ts`
7. `min(a: number, b: number): number` -> `src/lib/utils.ts`
8. `max(a: number, b: number): number` -> `src/lib/utils.ts`
9. Add a README at `docs/utils-readme.md` describing the above functions.
10. Add a CHANGELOG entry at `CHANGELOG.md` mentioning the new module.

Expected wave plan: tasks 1-8 share `src/lib/utils.ts` so they cannot parallelize.
- Wave 1 (parallel): Task 1, Task 9, Task 10 (3 disjoint files)
- Waves 2-8 (sequential): Tasks 2, 3, 4, 5, 6, 7, 8 (one per wave; all touch utils.ts)

This fixture stress-tests the file-disjoint constraint.
