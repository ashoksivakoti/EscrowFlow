import { ethers } from "hardhat";

import type { EscrowFlowRegistry } from "../typechain-types/contracts/EscrowFlowRegistry";

async function main() {
  const [caller] = await ethers.getSigners();
  const callerAddress = await caller.getAddress();
  const network = await ethers.provider.getNetwork();

  const registryAddress = process.env.CANONICAL_ESCROW_REGISTRY_ADDRESS?.trim() ?? "";
  if (!ethers.isAddress(registryAddress)) {
    throw new Error("CANONICAL_ESCROW_REGISTRY_ADDRESS must be a valid address");
  }

  const registry = (await ethers.getContractAt(
    "EscrowFlowRegistry",
    registryAddress,
    caller,
  )) as unknown as EscrowFlowRegistry;

  const adminRole = await registry.DEFAULT_ADMIN_ROLE();
  const pauserRole = await registry.PAUSER_ROLE();
  const arbitratorRole = await registry.ARBITRATOR_ROLE();

  const checks = {
    chainId: Number(network.chainId),
    caller: callerAddress,
    registry: registryAddress,
    projectCount: (await registry.projectCount()).toString(),
    arbitratorCount: (await registry.arbitratorCount()).toString(),
    arbitratorThreshold: (await registry.arbitratorThreshold()).toString(),
    hasAdminRole: await registry.hasRole(adminRole, callerAddress),
    hasPauserRole: await registry.hasRole(pauserRole, callerAddress),
    hasArbitratorRole: await registry.hasRole(arbitratorRole, callerAddress),
  };

  const tokens = (process.env.CANONICAL_ALLOWLIST_TOKENS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const tokenChecks: Array<{
    token: string;
    isAllowedToken: boolean;
    untrackedTokenBalance: string;
  }> = [];
  for (const token of tokens) {
    if (!ethers.isAddress(token)) {
      throw new Error(`Invalid token in CANONICAL_ALLOWLIST_TOKENS: ${token}`);
    }
    tokenChecks.push({
      token,
      isAllowedToken: await registry.isAllowedToken(token),
      untrackedTokenBalance: (await registry.untrackedTokenBalance(token)).toString(),
    });
  }

  let pauseRoundTrip: "skipped" | "ok" | "failed" = "skipped";
  if (checks.hasPauserRole) {
    try {
      if (!(await registry.paused())) {
        const pauseTx = await registry.pause();
        await pauseTx.wait();
      }
      const unpauseTx = await registry.unpause();
      await unpauseTx.wait();
      pauseRoundTrip = "ok";
    } catch {
      pauseRoundTrip = "failed";
    }
  }

  console.log(
    JSON.stringify(
      {
        checks,
        tokenChecks,
        pauseRoundTrip,
      },
      null,
      2,
    ),
  );

  if (checks.projectCount !== "0") {
    throw new Error("Sanity check failed: projectCount is not zero on fresh canonical deployment.");
  }
  if (pauseRoundTrip === "failed") {
    throw new Error("Sanity check failed: pause/unpause round trip failed for pauser caller.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
