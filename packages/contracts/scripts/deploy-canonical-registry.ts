import path from "node:path";

import { ethers } from "hardhat";

import type { EscrowFlowRegistry } from "../typechain-types/contracts/EscrowFlowRegistry";
import {
  type DeploymentArtifactV1,
  writeDeploymentArtifact,
} from "./lib/writeDeployment";

/**
 * Canonical production deployment for EscrowFlowRegistry (no proxy, no migration).
 *
 * Required env:
 *   CANONICAL_REGISTRY_ADMIN_ADDRESS
 *
 * Usage:
 *   pnpm exec hardhat run scripts/deploy-canonical-registry.ts --network arbitrumSepolia
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const network = await ethers.provider.getNetwork();

  const admin = process.env.CANONICAL_REGISTRY_ADMIN_ADDRESS?.trim() ?? "";
  if (!ethers.isAddress(admin)) {
    throw new Error("CANONICAL_REGISTRY_ADMIN_ADDRESS must be a valid address");
  }

  const Factory = await ethers.getContractFactory("EscrowFlowRegistry");
  const deployed = await Factory.connect(deployer).deploy(admin);
  await deployed.waitForDeployment();
  const registry = deployed as unknown as EscrowFlowRegistry;
  const registryAddress = await ethers.resolveAddress(registry);

  const code = await ethers.provider.getCode(registryAddress);
  const runtimeBytecodeSize = (code.length - 2) / 2;

  const contractsPackageRoot = path.join(__dirname, "..");
  const artifact: DeploymentArtifactV1 = {
    schemaVersion: 1,
    network: network.name,
    chainId: Number(network.chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployerAddress,
    contracts: {
      EscrowFlowRegistry: registryAddress,
    },
    roles: {
      defaultAdmin: admin,
      pauser: admin,
    },
    notes:
      "Canonical standalone EscrowFlowRegistry deployment. No proxy/upgrade/migration path.",
  };
  const written = writeDeploymentArtifact(contractsPackageRoot, artifact);

  console.log(
    JSON.stringify(
      {
        deployer: deployerAddress,
        admin,
        contract: registryAddress,
        chainId: Number(network.chainId),
        network: network.name,
        runtimeBytecodeSize,
        remainingBefore24576: 24576 - runtimeBytecodeSize,
        deploymentArtifact: written,
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
