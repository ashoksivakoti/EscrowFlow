# EscrowFlow

EscrowFlow is a milestone-based freelance escrow platform that combines:

- on-chain escrow guarantees for project funding and payout
- off-chain product workflows for teams and admins
- IPFS-backed evidence and submission metadata for transparent auditability

This repository is a portfolio-ready monorepo built with Next.js, Prisma/PostgreSQL, wagmi/viem, and Solidity/Hardhat.

For deployment hardening and release flow, use [docs/deployment.md](./docs/deployment.md).

## Problem statement

Freelance projects often fail at trust boundaries:

- clients fear paying upfront without delivery guarantees
- freelancers fear delayed or contested payouts after delivery
- disputes lack structured evidence and auditable resolution trails

EscrowFlow addresses this by splitting financial truth (on-chain) from collaboration and workflow UX (web app + database), while anchoring deliverable evidence to IPFS.

## Core features

- Wallet-based SIWE authentication with session management
- Role-aware onboarding for clients, freelancers, and admins
- Project and milestone creation with optional contract linkage
- ERC20 allowance + funding flow with clear transaction lifecycle states
- Milestone submission flow with delivery notes, external links, and file uploads
- Client approval and payout flow wired to contract actions
- Dispute creation with evidence uploads and frozen milestone handling
- Admin dispute dashboard with payout/refund/split resolution paths
- In-app notifications with unread/read management
- Event sync foundation for on-chain projection into PostgreSQL
- Dashboard and project detail views for operational visibility

## Architecture summary

### Monorepo structure

| Path                 | Purpose                                      |
| -------------------- | -------------------------------------------- |
| `apps/web`           | Next.js App Router frontend + API handlers   |
| `packages/contracts` | Solidity contracts + Hardhat scripts/tests   |
| `packages/ui`        | Shared UI primitives                         |
| `packages/types`     | Shared API/view/IPFS TypeScript contracts    |
| `prisma`             | PostgreSQL schema + migration source of truth|
| `docs`               | Architecture, auth, IPFS, contracts, deploy  |

### Runtime model

- **On-chain**: escrow state transitions and financial settlement
- **PostgreSQL**: query-optimized product state, user data, notifications, logs
- **IPFS**: immutable document/file references (agreements, submissions, dispute evidence)
- **Event sync**: idempotent projection of selected contract events into DB

## Smart contract summary

Primary contract: `EscrowFlowRegistry`

- Supports multi-project registry with milestone-level lifecycle control
- Handles project creation, funding, submission, approval, payout release
- Implements dispute raise/resolve with arbitrator role and payout math validation
- Emits indexer-friendly events for synchronization and audit trails
- Includes pause and role-based protections (`AccessControl`, `Pausable`, `ReentrancyGuard`, `SafeERC20`)

Contract documentation:

- [docs/smart-contract-design.md](./docs/smart-contract-design.md)
- [docs/contracts-deployment.md](./docs/contracts-deployment.md)

## IPFS integration summary

EscrowFlow uses server-side IPFS utilities (Pinata-backed) for:

- project agreement metadata and files
- milestone submission metadata and deliverable files
- dispute evidence metadata and evidence files

Safety controls include:

- MIME allowlists
- file and JSON size limits
- strict URI/CID parsing and gateway URL construction
- server-only credential handling

See [docs/ipfs-strategy.md](./docs/ipfs-strategy.md).

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20.10
- [pnpm](https://pnpm.io/) 9.x
- PostgreSQL

### Local bootstrap

```bash
pnpm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp packages/contracts/.env.example packages/contracts/.env

pnpm db:generate
pnpm db:migrate
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Testing and quality

### Root commands

| Script                                      | Description                                  |
| ------------------------------------------- | -------------------------------------------- |
| `pnpm lint`                                 | ESLint for web + shared packages             |
| `pnpm typecheck`                            | TypeScript checks across workspace           |
| `pnpm build`                                | Typecheck + production Next.js build         |
| `pnpm db:status` / `pnpm db:migrate:deploy` | Production-safe migration flow               |
| `pnpm web:validate:env`                     | Deployment env validation for web runtime    |
| `pnpm contracts:compile`                    | Compile Solidity contracts                   |
| `pnpm contracts:test`                       | Run Hardhat test suite                       |
| `pnpm event-sync:trigger`                   | Trigger one event-sync batch (scheduler use) |

### Package-level tests

- Web app unit/component/route tests: `pnpm --filter @escrowflow/web test`
- Contract tests: `pnpm --filter @escrowflow/contracts test`

## Deployment

For full deployment instructions, use [docs/deployment.md](./docs/deployment.md).

Quick order:

1. Configure env (`.env`, `apps/web/.env.local`, `packages/contracts/.env`)
2. Validate env: `pnpm web:validate:env`
3. Run migrations: `pnpm db:migrate:deploy`
4. Deploy contracts to testnet and capture deployment artifact
5. Wire contract addresses/defaults into web env
6. Build + deploy web app
7. Configure scheduler to run `pnpm event-sync:trigger`

## Future improvements

- Add end-to-end browser tests for full happy-path flows
- Expand event sync coverage for milestone and dispute events
- Add background queueing for notification side effects
- Add richer contract verification + testnet deployment automation in CI
- Add analytics and SLO-style observability for production reliability

Portfolio prep notes (resume bullets, interview talking points, demo outline):

- [docs/portfolio-prep.md](./docs/portfolio-prep.md)

## License

Private / unlicensed until you add one.
