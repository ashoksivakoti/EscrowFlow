# REST API specification — EscrowFlow

**Status:** contract-first (types in `@escrowflow/types`)  
**Base path:** `/api/v1`  
**Format:** JSON UTF-8  
**Errors:** HTTP problem status + body `{ "error": { "code", "message", "details?", "requestId?" } }` (see `ApiErrorBody` in `@escrowflow/types`)

## Conventions

- **Authentication:** primary mode is **HttpOnly cookie** `ef_session` set by `POST /auth/siwe/verify`; alternatively `Authorization: Bearer <jwt>` (same payload). See [docs/auth.md](./auth.md).
- **Dates:** ISO 8601 strings (`IsoDateTimeString` in types).
- **Money / chain integers:** decimal strings in smallest units (`WeiAmount`) or string ids safe for `uint256`.
- **Pagination:** default **cursor** lists return `{ items, nextCursor, hasMore }`. Some admin tools may add **offset** pagination later.
- **Ids:** opaque strings (`cuid` today); treat as opaque on the client.
- **Versioning:** URL prefix `v1`; breaking changes require `v2`.

TypeScript names for payloads are exported from **`@escrowflow/types`** (see `src/api/*` and `src/views/*`).

---

## Auth

| Method | Path                | Auth            | Request body        | Success body         |
| ------ | ------------------- | --------------- | ------------------- | -------------------- |
| `GET`  | `/auth/siwe/nonce`  | Public          | —                   | `AuthNonceResponse`  |
| `POST` | `/auth/siwe/verify` | Public          | `SiweVerifyRequest` | `SessionResponse`    |
| `GET`  | `/auth/session`     | Optional bearer | —                   | `GetSessionResponse` |
| `POST` | `/auth/logout`      | Bearer          | —                   | `LogoutResponse`     |

**Notes**

- **Nonce** must be single-use and bound to session/IP as appropriate.
- **Verify** validates SIWE message + signature, consumes a one-time nonce, upserts `User` / stub `Profile`, returns `SessionResponse` (`isNewUser`, `user`, `expiresAt`) and sets the session **JWT** cookie (`token` field omitted in cookie mode per types).
- **Session** returns `authenticated: false` when anonymous (200), not 401.

---

## Users & profile

| Method  | Path                    | Auth     | Request body             | Success body              |
| ------- | ----------------------- | -------- | ------------------------ | ------------------------- |
| `GET`   | `/users/me`             | User     | —                        | `GetMeResponse`           |
| `PATCH` | `/users/me/profile`     | User     | `UpdateMeProfileRequest` | `UpdateMeProfileResponse` |
| `GET`   | `/users/:userId/public` | Optional | —                        | `GetUserPublicResponse`   |

**Notes**

- **Public profile** exposes only non-sensitive fields (`UserPublicRef` / extended public profile policy).
- **Platform roles** (`ADMIN`, `CLIENT`, `FREELANCER`) are **not** self-granted via this surface; assign via admin tooling or internal jobs (documented when built).

---

## Dashboard

| Method | Path         | Auth | Query                         | Success body           |
| ------ | ------------ | ---- | ----------------------------- | ---------------------- |
| `GET`  | `/dashboard` | User | `GetDashboardQuery` (`lens?`) | `GetDashboardResponse` |

Aggregates project summaries, action items, and recent notifications for the active role lens.

---

## Projects

| Method  | Path                                     | Auth                        | Query / body              | Success body               |
| ------- | ---------------------------------------- | --------------------------- | ------------------------- | -------------------------- |
| `GET`   | `/projects`                              | User                        | `ListProjectsQuery`       | `ListProjectsResponse`     |
| `POST`  | `/projects`                              | User (client)               | `CreateProjectRequest`    | `CreateProjectResponse`    |
| `GET`   | `/projects/:projectId`                   | User (participant or admin) | —                         | `GetProjectResponse`       |
| `PATCH` | `/projects/:projectId`                   | User (client or admin)      | `UpdateProjectRequest`    | `UpdateProjectResponse`    |
| `POST`  | `/projects/:projectId/assign-freelancer` | User (client or admin)      | `AssignFreelancerRequest` | `AssignFreelancerResponse` |

**Query (`ListProjectsQuery`)**

- `cursor`, `limit`, `sortBy`, `sortOrder`
- `status` — filter by `ProjectStatus` (single or repeated param per framework convention)
- `participation` — `client` | `freelancer` | `any`

---

## Milestones

Nested under project for creation/list; direct id for single-resource updates (stable URLs).

| Method  | Path                                      | Auth                        | Query / body               | Success body                |
| ------- | ----------------------------------------- | --------------------------- | -------------------------- | --------------------------- |
| `GET`   | `/projects/:projectId/milestones`         | User (participant or admin) | `ListMilestonesQuery`      | `ListMilestonesResponse`    |
| `POST`  | `/projects/:projectId/milestones`         | User (client or admin)      | `CreateMilestoneRequest`   | `CreateMilestoneResponse`   |
| `GET`   | `/milestones/:milestoneId`                | User (participant or admin) | —                          | `GetMilestoneResponse`      |
| `PATCH` | `/milestones/:milestoneId`                | User (participant or admin) | `UpdateMilestoneRequest`   | `UpdateMilestoneResponse`   |
| `PUT`   | `/projects/:projectId/milestones/reorder` | User (client or admin)      | `ReorderMilestonesRequest` | `ReorderMilestonesResponse` |

**Notes**

- Status transitions must follow `docs/domain-model.md`; server returns `VALIDATION_FAILED` or domain-specific codes when rules fail.
- On-chain funding may not have a dedicated REST action in v1 (wagmi-only); optional `PATCH` fields like `fundedAt` may be set by **sync workers** using `TransactionLog`.

---

## Submissions

| Method  | Path                                   | Auth                                        | Query / body              | Success body               |
| ------- | -------------------------------------- | ------------------------------------------- | ------------------------- | -------------------------- |
| `GET`   | `/milestones/:milestoneId/submissions` | User (participant or admin)                 | `ListSubmissionsQuery`    | `ListSubmissionsResponse`  |
| `POST`  | `/milestones/:milestoneId/submissions` | User (assigned freelancer)                  | `CreateSubmissionRequest` | `CreateSubmissionResponse` |
| `GET`   | `/submissions/:submissionId`           | User (participant or admin)                 | —                         | `GetSubmissionResponse`    |
| `PATCH` | `/submissions/:submissionId`           | User (client / freelancer / admin per rule) | `UpdateSubmissionRequest` | `UpdateSubmissionResponse` |

**Notes**

- New attempts bump `attemptNumber`; prior active rows should move to `SUPERSEDED` in the service layer when `submit` is true.

---

## Disputes

| Method  | Path                                | Auth                               | Query / body           | Success body            |
| ------- | ----------------------------------- | ---------------------------------- | ---------------------- | ----------------------- |
| `GET`   | `/milestones/:milestoneId/disputes` | User (participant or admin)        | `ListDisputesQuery`    | `ListDisputesResponse`  |
| `POST`  | `/milestones/:milestoneId/disputes` | User (participant)                 | `CreateDisputeRequest` | `CreateDisputeResponse` |
| `GET`   | `/disputes/:disputeId`              | User (participant or admin)        | —                      | `GetDisputeResponse`    |
| `PATCH` | `/disputes/:disputeId`              | User (admin for resolution fields) | `UpdateDisputeRequest` | `UpdateDisputeResponse` |

**Notes**

- `internalNotes` and terminal `DisputeStatus` values are **admin-gated** in implementation.
- `resolutionTxHash` links off-chain record to settlement transaction when applicable.

---

## Notifications

| Method   | Path                                  | Auth | Query / body                      | Success body                       |
| -------- | ------------------------------------- | ---- | --------------------------------- | ---------------------------------- |
| `GET`    | `/notifications`                      | User | `ListNotificationsQuery`          | `ListNotificationsResponse`        |
| `PATCH`  | `/notifications/:notificationId/read` | User | —                                 | `MarkNotificationReadResponse`     |
| `POST`   | `/notifications/read-all`             | User | `MarkAllNotificationsReadRequest` | `MarkAllNotificationsReadResponse` |
| `DELETE` | `/notifications/:notificationId`      | User | —                                 | `DeleteNotificationResponse`       |

---

## Reviews

| Method | Path                           | Auth                        | Query / body          | Success body           |
| ------ | ------------------------------ | --------------------------- | --------------------- | ---------------------- |
| `GET`  | `/projects/:projectId/reviews` | User (participant or admin) | `ListReviewsQuery`    | `ListReviewsResponse`  |
| `POST` | `/projects/:projectId/reviews` | User (participant)          | `CreateReviewRequest` | `CreateReviewResponse` |

**Notes**

- One review per `(projectId, authorUserId, subjectUserId)` (see Prisma `@@unique`).
- Enforce **project completed** and **rating 1–5** in the service layer.

---

## Implementation mapping (Next.js)

Place handlers under `apps/web/src/app/api/v1/.../route.ts` (or a single catch-all router) following this layout. Keep **Zod** schemas co-located with handlers, importing shapes from `@escrowflow/types` for return types and shared literals (`PLATFORM_ROLES`, etc.).

---

## Related documents

- [Domain model & status transitions](./domain-model.md)
- [Architecture](./architecture.md)
- Package: `@escrowflow/types` (`packages/types`)
