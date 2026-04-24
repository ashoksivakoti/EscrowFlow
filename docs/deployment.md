# EscrowFlow deployment guide

This guide keeps deployment portfolio-friendly while still realistic for production behavior.

## 1) Deployment model

- **Web app**: Next.js (`apps/web`) deployed as a Node runtime (`output: "standalone"`).
- **Database**: PostgreSQL + Prisma migrations.
- **Contracts**: deploy from `packages/contracts` to testnet (`arbitrumSepolia`).
- **Event sync**: cron/scheduler triggers `/api/internal/event-sync` (token protected).
- **IPFS**: Pinata-backed server uploads with constrained MIME/size policy.

## 2) Environment setup

Copy:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp packages/contracts/.env.example packages/contracts/.env
```

Then set at minimum:

- `DATABASE_URL` (root + `apps/web`)
- `AUTH_SECRET`, `AUTH_SIWE_DOMAIN`, `AUTH_SIWE_URI`, `AUTH_ALLOWED_CHAIN_IDS`
- `NEXT_PUBLIC_CHAIN_IDS`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `EVENT_SYNC_RPC_URL`, `EVENT_SYNC_CHAIN_ID`, `EVENT_SYNC_CONTRACT_ADDRESS`
- `EVENT_SYNC_TRIGGER_TOKEN` (required in production)
- `IPFS_PINATA_JWT`

Validate before build:

```bash
pnpm web:validate:env
```

## 3) Database migration flow (production)

Local/dev:

```bash
pnpm db:migrate
```

Production/staging:

```bash
pnpm db:status
pnpm db:migrate:deploy
```

Use `db:migrate:deploy` in CI/CD before releasing the web app.

## 4) Contract testnet deployment

From root:

```bash
pnpm contracts:test
pnpm contracts:deploy:stack -- --network arbitrumSepolia
```

Artifact is written to:

`packages/contracts/deployments/<network>-<chainId>.json`

Use that artifact to feed app config:

- `CONTRACTS_DEPLOYMENT_PATH`
- `CONTRACTS_DEFAULT_CHAIN_ID`
- `CONTRACTS_ESCROW_REGISTRY_ADDRESS`
- `CONTRACTS_PAYMENT_TOKEN_ADDRESS`

Optional UX-prefill vars for the create-project form:

- `NEXT_PUBLIC_DEFAULT_CHAIN_ID`
- `NEXT_PUBLIC_DEFAULT_ESCROW_REGISTRY_ADDRESS`
- `NEXT_PUBLIC_DEFAULT_PAYMENT_TOKEN_ADDRESS`

## 5) Frontend build + run

Build:

```bash
pnpm build
```

Run:

```bash
pnpm --filter @escrowflow/web start
```

The app is hardened with:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY`
- disabled `x-powered-by`

## 6) Event sync execution strategy

### API trigger endpoint

- Endpoint: `POST /api/internal/event-sync`
- Token header: `x-event-sync-token: <EVENT_SYNC_TRIGGER_TOKEN>`
- Uses retry/backoff for RPC fetches and preserves idempotent checkpoints.

### Scheduler-friendly command

```bash
pnpm event-sync:trigger
```

Variables:

- `EVENT_SYNC_INTERNAL_URL` (default `http://127.0.0.1:3000`)
- `EVENT_SYNC_TRIGGER_TOKEN`
- `EVENT_SYNC_TRIGGER_RETRIES`
- `EVENT_SYNC_TRIGGER_RETRY_DELAY_MS`

This is suitable for:

- cron on a VM
- GitHub Actions schedule
- platform scheduler webhooks/jobs

## 7) IPFS production safety

- MIME/size limits enforced server-side for all uploads.
- Base64 payload size caps are enforced before decode-heavy processing.
- Agreement upload fallback can be enabled via:
  - `IPFS_ALLOW_AGREEMENT_FALLBACK=true`
- Keep fallback `false` for strict production if agreement persistence is mandatory.

## 8) Auth/session safety checklist

- Set strong `AUTH_SECRET` (>=32 chars).
- Use HTTPS origin in `AUTH_SIWE_URI` in production.
- Session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` (in production), `Priority=High`.
- Keep `AUTH_ALLOWED_CHAIN_IDS` aligned with `NEXT_PUBLIC_CHAIN_IDS`.

## 9) Release checklist

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm --filter @escrowflow/web test`
4. `pnpm contracts:test`
5. `pnpm web:validate:env`
6. `pnpm db:migrate:deploy`
7. deploy web app
8. configure scheduler for `pnpm event-sync:trigger`
