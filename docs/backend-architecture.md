# EscrowFlow Backend Architecture

This document defines backend conventions for `apps/web` API routes and server-side modules.

## Goals

- Keep route handlers thin and declarative.
- Centralize auth, authorization, validation, and error handling.
- Move domain logic into reusable services.
- Keep logs structured and request-correlated.

## Folder structure (`apps/web/src/server`)

- `route-handlers/`  
  Thin HTTP adapters for each endpoint (`v1/auth/*`, `v1/users/*`).
- `services/`  
  Business/domain logic (DB operations, auth orchestration).
- `validation/`  
  Shared request parsers and endpoint schema references.
- `guards/`  
  Reusable authn/authz guards (session, role, participant checks).
- `errors/`  
  Typed `AppError` pattern and centralized failure semantics.
- `http/`  
  Route wrapper for consistent error-to-response mapping.
- `logging/`  
  Structured logger utility with route/request context.

## Route conventions

### Route file responsibilities

`app/api/v1/**/route.ts` should only:

1. export `runtime = "nodejs"`
2. call one server route handler
3. avoid inline domain logic

Example pattern:

```ts
export async function POST(request: Request): Promise<NextResponse> {
  return handleSomeRoute(request);
}
```

### Handler pattern

Use `handleRoute(request, "route.name", async (ctx) => { ... })`:

- injects request id + logger
- maps `AppError` and `ZodError` to API error responses
- prevents repeated try/catch in each route

## Typed error pattern

- Throw `AppError(code, message, status, details?)` from guards/services.
- Prefer stable codes (`USER_NOT_FOUND`, `VALIDATION_FAILED`, etc.).
- Keep client-facing messages concise; put internals in `details`.

## Guard conventions

- `requireAuthenticated(request)` for session access.
- `requireRoles(session, roles)` for platform role access control.
- `requireProjectParticipant(projectId, userId)` for resource-level authorization.

Use guards in handlers or services depending on reuse needs.

## Validation conventions

- Use Zod schemas in `server/validation/schemas/*`.
- Parse request JSON through `parseJsonBody(request, schema)`.
- Never parse `request.json()` directly in route files.

## Service conventions

- Services should return typed data structures for handlers.
- Services may throw `AppError`; they should not return `NextResponse`.
- Prisma access belongs in services (or focused query modules used by services).

## Logging conventions

- Use `createLogger(scope, requestId)`.
- Include identifiers in context (`userId`, `projectId`, `milestoneId`).
- Avoid logging secrets (JWTs, signatures, private payloads).

## Existing implementation coverage

Current routes migrated to this architecture:

- `auth`: nonce, verify, session, logout
- `users/me`: get me, patch profile, complete onboarding

## Next expansion targets

- Project/milestone/dispute route groups should use the same structure.
- Add domain-specific services (`project-service`, `milestone-service`, `dispute-service`).
- Add reusable transaction wrappers and idempotency helpers for contract-triggered flows.
