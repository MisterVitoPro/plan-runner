# Medium Fixture: 5-task DAG

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

Expected wave plan: 3 waves
- Wave 1 (parallel): Task 1, Task 3
- Wave 2: Task 2 (needs Task 1)
- Wave 3: Task 4 (needs Task 2, 3)
- Wave 4: Task 5 (needs Task 4)
