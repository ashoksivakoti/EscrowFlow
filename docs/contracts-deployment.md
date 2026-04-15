# EscrowFlow — contracts deployment

This guide covers deploying `EscrowFlowRegistry` and the dev `MockERC20Stablecoin` from `packages/contracts` using Hardhat.

## Prerequisites

- Node 20+
- `pnpm install` at the repo root
- For **testnets**: RPC URL + funded deployer key

## Environment (`packages/contracts/.env`)

Copy `packages/contracts/.env.example` to `packages/contracts/.env` and set:

| Variable | Purpose |
|----------|---------|
| `DEPLOYER_PRIVATE_KEY` | Hex private key for `sepolia` / `baseSepolia` (with `0x` or without) |
| `SEPOLIA_RPC_URL` | HTTPS RPC for Ethereum Sepolia |
| `BASE_SEPOLIA_RPC_URL` | HTTPS RPC for Base Sepolia |
| `REGISTRY_ADMIN_ADDRESS` | Optional; defaults to deployer. Receives `DEFAULT_ADMIN_ROLE` and `PAUSER_ROLE` |
| `ARBITRATOR_ADDRESS` | Optional; defaults to admin. Receives `ARBITRATOR_ROLE` if deployer is admin |

Never commit `.env`.

## Networks (Hardhat)

| Name | Chain ID | Use |
|------|----------|-----|
| `hardhat` | 31337 | In-process, tests |
| `localhost` | * | `npx hardhat node` or Anvil on `127.0.0.1:8545` |
| `sepolia` | 11155111 | Ethereum testnet |
| `baseSepolia` | 84532 | Base testnet |

## Commands

From repo root:

```bash
pnpm contracts:compile
pnpm contracts:test
```

From `packages/contracts` (or via `pnpm exec --dir packages/contracts`):

```bash
# Mock token only → deployments/<network>-<chainId>.json
pnpm exec hardhat run scripts/deploy-mock-token.ts --network localhost

# Registry only (set REGISTRY_ADMIN_ADDRESS / ARBITRATOR_ADDRESS if needed)
pnpm exec hardhat run scripts/deploy-registry.ts --network sepolia

# Mock + registry (typical local / demo)
pnpm exec hardhat run scripts/deploy-stack.ts --network localhost
```

Convenience from root:

```bash
pnpm contracts:deploy:stack -- --network localhost
pnpm contracts:deploy:registry -- --network sepolia
pnpm contracts:deploy:mock-token -- --network baseSepolia
```

## Deployment artifact (frontend / backend)

Scripts write **JSON** to:

`packages/contracts/deployments/<network>-<chainId>.json`

The same object is printed to **stdout** for CI piping.

### Schema version 1

```json
{
  "schemaVersion": 1,
  "network": "sepolia",
  "chainId": 11155111,
  "deployedAt": "2026-04-12T12:00:00.000Z",
  "deployer": "0x…",
  "contracts": {
    "MockERC20Stablecoin": "0x…",
    "EscrowFlowRegistry": "0x…"
  },
  "roles": {
    "defaultAdmin": "0x…",
    "pauser": "0x…",
    "arbitratorGranted": "0x…"
  },
  "notes": "…"
}
```

**App integration**

- Point `NEXT_PUBLIC_*` (or server env) at `contracts.EscrowFlowRegistry` and, for dev, `contracts.MockERC20Stablecoin`.
- Load ABIs from `packages/contracts/artifacts/contracts/EscrowFlowRegistry.sol/EscrowFlowRegistry.json` (or TypeChain in CI).

**Git**

- Generated `deployments/*.json` are gitignored (except `example.deployment.json`). Store committed addresses only if you accept repo drift; otherwise use CI secrets.

## Admin vs deployer

- If `REGISTRY_ADMIN_ADDRESS` **equals** the deployer, the script **grants** `ARBITRATOR_ROLE` to `ARBITRATOR_ADDRESS` (default admin).
- If the deployer is **not** the admin, you must call `grantRole(ARBITRATOR_ROLE, …)` from the admin wallet after deploy.

## Verification (optional)

Configure Etherscan / Basescan API keys in Hardhat `verify` task (not wired in this repo by default). After adding `@nomicfoundation/hardhat-verify` and keys, run `hardhat verify --network sepolia <address> <constructor args>`.

## Further reading

- Contract behavior: `docs/smart-contract-design.md`
- Auth for the web app: `docs/auth.md`
