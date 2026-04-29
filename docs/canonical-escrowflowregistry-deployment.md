# Canonical EscrowFlowRegistry Production Deployment

This runbook deploys a **new standalone canonical** `EscrowFlowRegistry` and deprecates all prior deployments.

## Hard rules

- No proxy upgrades.
- No previous contract address reuse.
- No storage/data migration from prior deployments.
- No deployment logic that references prior contracts.
- New deployment is the single canonical production contract.

## Required environment

Set these before running commands:

- `CANONICAL_REGISTRY_ADMIN_ADDRESS`
- `CANONICAL_ESCROW_REGISTRY_ADDRESS` (after deploy)
- `CANONICAL_PAUSER_ADDRESSES` (comma-separated)
- `CANONICAL_ARBITRATOR_ADDRESSES` (comma-separated)
- `CANONICAL_ARBITRATOR_THRESHOLD`
- `CANONICAL_ALLOWLIST_TOKENS` (comma-separated)

Network/deployer:

- `DEPLOYER_PRIVATE_KEY`
- `SEPOLIA_RPC_URL` / `BASE_SEPOLIA_RPC_URL` / `ARBITRUM_SEPOLIA_RPC_URL`

## Pre-deployment gate

From repo root:

```bash
pnpm contracts:compile
pnpm --filter @escrowflow/contracts test:strict
pnpm --filter @escrowflow/contracts measure:bytecode-runs
```

Expected:

- all tests pass (`0 fail`, `0 pending`, `0 skipped`)
- `EscrowFlowRegistry` runtime bytecode `< 24576` bytes

## Deploy canonical registry

```bash
pnpm contracts:deploy:canonical:registry -- --network <network>
```

This prints:

- deployer
- admin
- deployed contract
- chainId / network
- runtime bytecode size
- remaining bytes before EIP-170 limit
- deployment artifact path

## Verify on explorer

```bash
pnpm contracts:verify:canonical:registry -- --network <network>
```

If verification plugin keys are configured, this verifies constructor args:

- `EscrowFlowRegistry(CANONICAL_REGISTRY_ADMIN_ADDRESS)`

## Post-deployment setup

```bash
pnpm contracts:setup:canonical:registry -- --network <network>
```

This script can:

- grant `PAUSER_ROLE`
- grant `ARBITRATOR_ROLE`
- set arbitrator threshold
- attest token review
- allowlist tokens
- print role and threshold checks

## Sanity checks

```bash
pnpm contracts:sanity:canonical:registry -- --network <network>
```

Checks include:

- `projectCount() == 0` on fresh deployment
- role assignments (`DEFAULT_ADMIN_ROLE`, `PAUSER_ROLE`, `ARBITRATOR_ROLE`)
- `arbitratorCount` and `arbitratorThreshold`
- token allowlist and `untrackedTokenBalance()`
- pause/unpause round-trip (when caller has pauser role)

## Canonical cutover (env/config/indexer/frontend/backend)

Audit and optionally replace old addresses:

```bash
# dry-run audit
pnpm contracts:cutover:registry:refs

# optional apply mode (requires values)
APPLY_CHANGES=true \
CANONICAL_ESCROW_REGISTRY_ADDRESS=0x... \
DEPRECATED_ESCROW_REGISTRY_ADDRESSES=0xOld1,0xOld2 \
pnpm contracts:cutover:registry:refs
```

Then manually confirm updates in:

- root/app env files (`.env*`, `apps/web/.env*`, backend envs)
- contract defaults / constants
- event sync/indexer/subgraph config (`EVENT_SYNC_CONTRACT_ADDRESS`, start block)
- deployment artifacts and automation scripts
- monitoring and bots

## Final report

Generate a deployment report skeleton:

```bash
pnpm --filter @escrowflow/contracts report:canonical:deployment
```

Include in release notes:

- contract address
- network + chainId
- deployment block
- deployer + admin
- constructor args
- verification link
- runtime bytecode size
- test summary
- static-analysis summary (tool availability/outputs)
- role assignments
- arbitrator threshold
- allowlisted tokens
- env/config files updated
- any remaining manual steps

## Deprecation policy for previous deployments

After canonical deployment:

- treat all previous addresses as deprecated
- remove old addresses from active config paths
- ensure event/indexer starts from canonical deployment block
- keep historical references only in archival docs
