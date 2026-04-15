# EscrowFlow

Production-style monorepo for **EscrowFlow** — a milestone-based freelance escrow platform (Next.js, Prisma, PostgreSQL, wagmi/viem, Solidity/Hardhat). See [AGENTS.md](./AGENTS.md) for product context and [docs/](./docs/) for architecture and domain notes.

## Structure

| Path                 | Purpose                         |
| -------------------- | ------------------------------- |
| `apps/web`           | Next.js App Router frontend     |
| `packages/contracts` | Solidity + Hardhat              |
| `packages/ui`        | Shared React UI primitives      |
| `packages/types`     | Shared TypeScript types         |
| `prisma`             | Database schema (PostgreSQL)    |
| `docs`               | PRD, architecture, domain model |

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 20.10
- [pnpm](https://pnpm.io/) 9.x (`corepack enable` recommended)
- PostgreSQL (for Prisma)

## Setup

```bash
pnpm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
# Set DATABASE_URL in both (or symlink) so Prisma and Next agree.

pnpm db:generate
pnpm db:migrate   # first time: creates migration from prisma/schema.prisma (requires DATABASE_URL)
pnpm dev
```

`pnpm db:generate` runs from the repo root. Root `devDependencies` pin matching `prisma` and `@prisma/client` versions so generation works cleanly under **pnpm workspaces** (the app imports `@prisma/client` from `apps/web`).

Open [http://localhost:3000](http://localhost:3000).

## Scripts (root)

| Script                                      | Description                                 |
| ------------------------------------------- | ------------------------------------------- |
| `pnpm dev`                                  | Next.js dev server (`apps/web`)             |
| `pnpm build`                                | Typecheck workspace + production Next build |
| `pnpm lint`                                 | ESLint for web + shared TS packages         |
| `pnpm format`                               | Prettier write                              |
| `pnpm format:check`                         | Prettier check                              |
| `pnpm typecheck`                            | `tsc --noEmit` in packages + web            |
| `pnpm db:generate`                          | `prisma generate`                           |
| `pnpm db:push` / `db:migrate` / `db:studio` | Prisma workflows                            |
| `pnpm contracts:compile`                    | Hardhat compile                             |
| `pnpm contracts:test`                       | Hardhat tests                               |

## Environment variables

- **Root** `.env` — `DATABASE_URL` for Prisma CLI (`pnpm db:*`).
- **`apps/web/.env.local`** — same `DATABASE_URL` for the app at runtime, plus future `NEXT_PUBLIC_*` and auth secrets (see `apps/web/.env.example`).
- **`packages/contracts/.env`** — RPC / keys for deploy scripts (see `packages/contracts/.env.example`).

Never commit real secrets; only `.env.example` files are tracked.

## Path aliases

- In `apps/web`, imports from `@/` resolve to `apps/web/src/`.
- Workspace packages use published-style names: `@escrowflow/ui`, `@escrowflow/types`.

## License

Private / unlicensed until you add one.
