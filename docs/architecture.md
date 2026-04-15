# Architecture — EscrowFlow

**Status:** foundation — high-level map for implementation

## Monorepo layout

- **`apps/web`** — Next.js App Router UI, server actions / route handlers as the app grows, wagmi/viem client wiring (later).
- **`packages/contracts`** — Escrow smart contracts, Hardhat toolchain, tests.
- **`packages/ui`** — Shared React components and design primitives (Tailwind classes; shadcn can be adopted here incrementally).
- **`packages/types`** — Cross-cutting TypeScript types (and later Zod-inferred types if desired).
- **`prisma`** — PostgreSQL schema at repo root; Prisma Client consumed from `apps/web` (and future workers).

## Runtime boundaries

| Concern                 | Where it lives                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------- |
| User-facing UI          | `apps/web`                                                                            |
| HTTP / server logic     | Next route handlers, server actions, or future API routes in `apps/web`               |
| Persistence             | PostgreSQL via Prisma                                                                 |
| Authoritative funds     | Smart contracts (EVM)                                                                 |
| Large / immutable blobs | IPFS (metadata, deliverables, dispute evidence) — integrate when implementing uploads |
| Auth                    | SIWE-style wallet auth (to be added) + session strategy TBD                           |

## Data flow (target)

1. **User** connects wallet and signs in (SIWE).
2. **App** reads/writes **Postgres** for profiles, projects, milestone state machine, IPFS CIDs, notifications.
3. **User** submits on-chain txs (deposit, approve, dispute hooks) via **wagmi/viem**; **indexer or event sync** reconciles chain → DB.
4. **Admin** tools use role-gated server paths + contract admin functions.

## Environment strategy

- **Root `.env`** — shared tooling (`DATABASE_URL` for Prisma CLI).
- **`apps/web/.env.local`** — runtime secrets and `NEXT_PUBLIC_*` client config.
- **`packages/contracts/.env`** — deployer keys and RPC for Hardhat scripts.

Keep **secrets out of git**; document keys only in `.env.example` files.

## Quality bar

- Strong typing end-to-end; validate inputs at boundaries (HTTP, chain payloads).
- Explicit UI states: loading, empty, error, success.
- Tests: Hardhat for contracts; Vitest/RTL or Playwright for web (introduce as features land).

## Evolution

Add packages (e.g. `packages/config`, `packages/eslint-config`) only when duplication justifies extraction. Prefer **incremental** extraction over speculative abstraction.
