import { ethers } from "hardhat";

import type { EscrowFlowRegistry } from "../typechain-types/contracts/EscrowFlowRegistry";

function parseAddressList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function main() {
  const [caller] = await ethers.getSigners();
  const callerAddress = await caller.getAddress();

  const registryAddress = process.env.CANONICAL_ESCROW_REGISTRY_ADDRESS?.trim() ?? "";
  if (!ethers.isAddress(registryAddress)) {
    throw new Error("CANONICAL_ESCROW_REGISTRY_ADDRESS must be a valid address");
  }

  const pausers = parseAddressList(process.env.CANONICAL_PAUSER_ADDRESSES);
  const arbitrators = parseAddressList(process.env.CANONICAL_ARBITRATOR_ADDRESSES);
  const allowlistTokens = parseAddressList(process.env.CANONICAL_ALLOWLIST_TOKENS);
  const thresholdRaw = process.env.CANONICAL_ARBITRATOR_THRESHOLD?.trim() ?? "";
  const threshold = thresholdRaw ? BigInt(thresholdRaw) : null;

  for (const address of [...pausers, ...arbitrators, ...allowlistTokens]) {
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid address in setup inputs: ${address}`);
    }
  }

  const registry = (await ethers.getContractAt(
    "EscrowFlowRegistry",
    registryAddress,
    caller,
  )) as unknown as EscrowFlowRegistry;
  const pauserRole = await registry.PAUSER_ROLE();
  const arbitratorRole = await registry.ARBITRATOR_ROLE();
  const adminRole = await registry.DEFAULT_ADMIN_ROLE();

  const grants: Array<{ role: string; account: string }> = [];

  for (const pauser of pausers) {
    if (!(await registry.hasRole(pauserRole, pauser))) {
      const tx = await registry.grantRole(pauserRole, pauser);
      await tx.wait();
      grants.push({ role: "PAUSER_ROLE", account: pauser });
    }
  }

  for (const arbitrator of arbitrators) {
    if (!(await registry.hasRole(arbitratorRole, arbitrator))) {
      const tx = await registry.grantRole(arbitratorRole, arbitrator);
      await tx.wait();
      grants.push({ role: "ARBITRATOR_ROLE", account: arbitrator });
    }
  }

  if (threshold !== null) {
    const current = await registry.arbitratorThreshold();
    if (current !== threshold) {
      const tx = await registry.setArbitratorThreshold(threshold);
      await tx.wait();
    }
  }

  const tokenUpdates: Array<{ token: string; updated: boolean }> = [];
  for (const token of allowlistTokens) {
    const attestTx = await registry.attestTokenReviewForAllowlist(token);
    await attestTx.wait();
    const allowed = await registry.isAllowedToken(token);
    if (!allowed) {
      const tx = await registry.setAllowedToken(token, true);
      await tx.wait();
      tokenUpdates.push({ token, updated: true });
    } else {
      tokenUpdates.push({ token, updated: false });
    }
  }

  const roleChecks = {
    callerIsAdmin: await registry.hasRole(adminRole, callerAddress),
    callerIsPauser: await registry.hasRole(pauserRole, callerAddress),
    callerIsArbitrator: await registry.hasRole(arbitratorRole, callerAddress),
    arbitratorCount: (await registry.arbitratorCount()).toString(),
    arbitratorThreshold: (await registry.arbitratorThreshold()).toString(),
  };

  console.log(
    JSON.stringify(
      {
        caller: callerAddress,
        registry: registryAddress,
        grants,
        tokenUpdates,
        roleChecks,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
