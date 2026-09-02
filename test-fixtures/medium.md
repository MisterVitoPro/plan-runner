# Medium Fixture: dependency-ready task DAG

Scheduling proof: `Independent slow audit` may remain active while `Fast parent`
integrates. `Fast dependent` becomes ready immediately after `Fast parent` integrates;
it must not wait for the unrelated slow audit.

## Task slow-audit: Independent slow audit
Create `src/audit/slow.ts` with a deliberately slow isolated audit helper. It has no
dependencies and must not own files used by the fast path.

## Task fast-parent: Fast parent
Create `src/fast/parent.ts` with the dependency result consumed by Fast dependent.

## Task fast-dependent: Fast dependent
Create `src/fast/dependent.ts` using `src/fast/parent.ts`.

Blocked by: fast-parent

## Task 1: User model
Create `src/models/user.ts` with a `User` interface: `{ id: string, email: string, createdAt: Date }`.

## Task 2: Session model
Create `src/models/session.ts` with a `Session` interface: `{ id: string, userId: string, expiresAt: Date }`. Depends on User existing.

## Task 3: Auth types
Create `src/types/auth.ts` with `LoginRequest` and `LoginResponse` types. Independent of Tasks 1-2.

## Task 4: Login handler
Create `src/handlers/login.ts` exporting `handleLogin(req: LoginRequest): Promise<LoginResponse>`. Imports User and Session. Depends on Tasks 1, 2, 3.

## Task 5: Login handler tests
Create `tests/handlers/login.test.ts` with at least one test for `handleLogin`. Depends on Task 4.

Expected DAG behavior: Fast dependent is eligible after fast-parent integrates even
if slow-audit is still active. Legacy fallback preserves topological waves:

- Wave 1 (parallel): slow-audit, fast-parent, Task 1, Task 3
- Later waves follow each declared dependency.
