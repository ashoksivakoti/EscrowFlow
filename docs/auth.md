# Authentication — EscrowFlow (SIWE + session)

**Status:** implemented in `apps/web` (`/api/v1/auth/*`)  
**Related:** [API specification](./api-spec.md), [Domain model](./domain-model.md)

## Goals

- **Wallet-native sign-in** using [Sign-In with Ethereum (EIP-4361)](https://docs.login.xyz/) patterns (`siwe` + `viem`).
- **Replay resistance** via **single-use server nonces** stored in PostgreSQL.
- **Secure sessions** via **signed JWT** in an **HttpOnly** cookie (optional `Authorization: Bearer` for API clients).
- Clear split between **authentication** (identity) and **authorization** (permissions).

---

## Authentication vs authorization

| Concern            | Question                                                | Where it lives                                                                                                        |
| ------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Authentication** | Who is this user? Did they prove wallet control?        | SIWE verify, JWT cookie, `getSessionUserFromRequest`, `authenticateRequest`                                           |
| **Authorization**  | May this user perform _this_ action on _this_ resource? | `authorizePlatformRoles` (platform roles), **future** project/milestone ownership checks in route handlers / services |

Authentication **does not** imply the user may access every API — each handler must enforce authorization rules appropriate to that resource.

---

## End-to-end flow

1. **Client** calls `GET /api/v1/auth/siwe/nonce`.
2. **Server** creates a random nonce, persists a `SiweNonce` row with `expiresAt`, prunes expired rows, returns `{ nonce, siwe: { domain, uri, chainId, chainIdsAllowed, … } }`.
3. **Client** builds a SIWE message (EIP-4361) using those parameters and asks the wallet to sign.
4. **Client** posts `POST /api/v1/auth/siwe/verify` with `{ message, signature }`.
5. **Server**:
   - Parses and validates the SIWE message (`chainId`, `uri` origin vs `AUTH_SIWE_URI`, domain vs `AUTH_SIWE_DOMAIN`).
   - Verifies the cryptographic signature (`siwe` + EIP-191 message).
   - In a **transaction**: marks the nonce as **used** (`updateMany` with `usedAt: null` guard → exactly one row) and **upserts** the `User` (+ stub `Profile` on first login).
   - Issues a **JWT** (`jose`, HS256) and returns `Set-Cookie: ef_session=…` (**HttpOnly**, `SameSite=Lax`, `Secure` in production).
   - JSON body matches `SessionResponse`: `user`, `expiresAt`, `isNewUser` (true when a new `User` row was created).

6. **Subsequent requests** send the cookie automatically (same-site) or `Authorization: Bearer <jwt>`.

7. **Session introspection**: `GET /api/v1/auth/session` → `GetSessionResponse` (always `200`; `authenticated` false if anonymous).

8. **Logout**: `POST /api/v1/auth/logout` clears the cookie (`Max-Age=0`).

---

## Replay attack controls

- **Nonce**: one row per challenge; **consumed once**; TTL enforced (`AUTH_NONCE_TTL_SECONDS`).
- **Concurrent reuse**: `updateMany` with `usedAt: null` ensures only one verifier wins.
- **SIWE time bounds**: `expirationTime` / `notBefore` on the message are enforced by `siwe` verification.
- **Signature**: binding to the exact EIP-4361 payload prevents reusing a signature against a different message.

---

## Environment variables (`apps/web`)

| Variable                       | Purpose                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`                  | HMAC key for JWT (≥ 32 characters).                                                            |
| `AUTH_SIWE_DOMAIN`             | Expected SIWE `domain` (e.g. `localhost:3000`).                                                |
| `AUTH_SIWE_URI`                | App origin URL (e.g. `http://localhost:3000`) — must match SIWE `uri` origin.                  |
| `AUTH_ALLOWED_CHAIN_IDS`       | Comma-separated EIP-155 ids (e.g. `31337,84532`).                                              |
| `AUTH_SESSION_MAX_AGE_SECONDS` | JWT / cookie lifetime (default 7 days).                                                        |
| `AUTH_NONCE_TTL_SECONDS`       | Nonce validity (default 300s).                                                                 |
| `AUTH_ADMIN_WALLETS`           | Optional comma-separated **lowercase** addresses bootstrapped with `ADMIN` `UserPlatformRole`. |

Also set `DATABASE_URL` (Prisma).

---

## Code map (`apps/web/src`)

| Path                                   | Role                                                               |
| -------------------------------------- | ------------------------------------------------------------------ |
| `app/api/v1/auth/siwe/nonce/route.ts`  | Nonce issuance                                                     |
| `app/api/v1/auth/siwe/verify/route.ts` | SIWE verify + session cookie                                       |
| `app/api/v1/auth/session/route.ts`     | Current session                                                    |
| `app/api/v1/auth/logout/route.ts`      | Clear session                                                      |
| `lib/auth/siwe.ts`                     | SIWE parse + signature verification                                |
| `lib/auth/nonce.ts`                    | Nonce persistence + cleanup                                        |
| `lib/auth/user-sync.ts`                | Nonce consume + user/profile upsert + admin bootstrap              |
| `lib/auth/jwt-session.ts`              | Sign / verify JWT                                                  |
| `lib/auth/cookies.ts`                  | Cookie serialization                                               |
| `lib/auth/session.ts`                  | Read session from `Request` or `cookies()` (RSC)                   |
| `lib/auth/guards.ts`                   | `authenticateRequest`, `authorizePlatformRoles`, `requireSession*` |
| `lib/auth/schemas.ts`                  | Zod input validation                                               |
| `lib/prisma.ts`                        | Prisma client singleton                                            |

---

## Database

- **`SiweNonce`**: stores issued nonces (`nonce`, `expiresAt`, `usedAt`).
- **`User` / `Profile`**: first login creates a **stub profile** (`displayName` derived from the wallet) so onboarding can refine fields tomorrow.
- **`UserPlatformRole`**: optional `ADMIN` via `AUTH_ADMIN_WALLETS`; other roles are **not** auto-assigned (onboarding / admin flows add `CLIENT` / `FREELANCER`).

Apply schema changes: `pnpm db:generate` and `pnpm db:migrate` (or `db:push` in early dev).

---

## Smart contract wallets (EIP-1271)

The `siwe` library may attempt **contract wallet** validation when EOA recovery mismatches. Production deployments that must support smart wallets should supply an **ethers/viem provider** for the user’s chain in verification options (future enhancement).

---

## Onboarding (next)

- Use **`isNewUser`** or **`SessionUser.profile.displayName`** (stub pattern) to route new users to an onboarding UI.
- Add `PATCH /users/me/profile` and optional flows to grant **`UserPlatformRole`** rows (`CLIENT` / `FREELANCER`) with proper authorization.
- Keep **authentication** in this module; put **business rules** for “profile complete” in onboarding services.
