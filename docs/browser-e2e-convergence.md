# Browser E2E Convergence Test

This repository includes a browser-level Playwright test that validates:

frontend action -> contract tx -> event sync -> DB projection -> API response -> UI state

## Test

- Spec: `apps/web/e2e/production-convergence.spec.ts`
- UI harness: `apps/web/src/app/e2e/production-convergence/page.tsx`
- Internal API flow: `apps/web/src/app/api/internal/e2e/pause-convergence/route.ts`

The flow executes a real `pause`/`unpause` contract write (based on current state), runs `syncEscrowEventsOnce`, reads `contract_pause_states`, and verifies parity across DB/API/UI.

## Required env vars

Set these before running `pnpm --filter @escrowflow/web e2e`:

- `DATABASE_URL` (Postgres used by the app)
- `EVENT_SYNC_RPC_URL`
- `EVENT_SYNC_CHAIN_ID=421614`
- `EVENT_SYNC_CONTRACT_ADDRESS=0xe5AF7E2CF6435de6B0a0520518FCaaab851BB40c`
- `EVENT_SYNC_SCOPE=ESCROW_REGISTRY:0xe5af7e2cf6435de6b0a0520518fcaaab851bb40c`
- `EVENT_SYNC_START_BLOCK=263614332`
- `E2E_ENABLED=true`
- `E2E_INTERNAL_TOKEN=<strong token>`
- `NEXT_PUBLIC_E2E_INTERNAL_TOKEN=<same token>`
- `E2E_ADMIN_PRIVATE_KEY=<0x-prefixed private key for PAUSER_ROLE wallet>`

Optional:

- `E2E_WEB_PORT` (default `3100`)

## Run

```bash
pnpm --filter @escrowflow/web e2e
```

## Failure interpretation by layer

- `UI did not render tx hash...` -> frontend action or contract write did not complete.
- `API state endpoint failed` -> API layer failed to serve projected state.
- `DB projection row missing...` -> event sync did not project pause/unpause into DB.
- `DB tx hash diverges...` / `DB paused value diverges...` -> cross-layer state mismatch.
