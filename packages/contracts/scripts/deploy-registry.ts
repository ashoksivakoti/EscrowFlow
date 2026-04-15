import path from "node:path";

import { ethers } from "hardhat";

import type { EscrowFlowRegistry } from "../typechain-types/contracts/EscrowFlowRegistry";
import {
  type DeploymentArtifactV1,
  writeDeploymentArtifact,
} from "./lib/writeDeployment";

/**
 * Deploy EscrowFlowRegistry.
 *
 * Env:
 *   REGISTRY_ADMIN_ADDRESS — receives DEFAULT_ADMIN_ROLE + PAUSER_ROLE (defaults to deployer)
 *   ARBITRATOR_ADDRESS — optional; granted ARBITRATOR_ROLE after deploy (defaults to admin)
 *
 * Usage:
 *   pnpm exec hardhat run scripts/deploy-registry.ts --network localhost
 *   pnpm exec hardhat run scripts/deploy-registry.ts --network sepolia
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const net = await ethers.provider.getNetwork();

  const admin =
    process.env.REGISTRY_ADMIN_ADDRESS?.trim() || deployerAddress;
  if (!ethers.isAddress(admin)) {
    throw new Error("REGISTRY_ADMIN_ADDRESS must be a valid address");
  }

  const Factory = await ethers.getContractFactory("EscrowFlowRegistry");
  const deployed = await Factory.connect(deployer).deploy(admin);
  await deployed.waitForDeployment();
  const registry = deployed as unknown as EscrowFlowRegistry;
  const registryAddress = await ethers.resolveAddress(registry);

  const arbitrator =
    process.env.ARBITRATOR_ADDRESS?.trim() || admin;
  if (!ethers.isAddress(arbitrator)) {
    throw new Error("ARBITRATOR_ADDRESS must be a valid address");
  }

  if (deployerAddress.toLowerCase() === admin.toLowerCase()) {
    const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
    await registry.connect(deployer).grantRole(ARBITRATOR_ROLE, arbitrator);
  } else {
    console.warn(
      "[deploy-registry] Deployer is not REGISTRY_ADMIN_ADDRESS; grant ARBITRATOR_ROLE to",
      arbitrator,
      "from the admin account.",
    );
  }

  const contractsPackageRoot = path.join(__dirname, "..");
  const artifact: DeploymentArtifactV1 = {
    schemaVersion: 1,
    network: net.name,
    chainId: Number(net.chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployerAddress,
    contracts: {
      EscrowFlowRegistry: registryAddress,
    },
    roles: {
      defaultAdmin: admin,
      pauser: admin,
      arbitratorGranted: arbitrator,
    },
    notes: "Grant ARBITRATOR_ROLE to multisig in production; admin holds DEFAULT_ADMIN_ROLE.",
  };

  const written = writeDeploymentArtifact(contractsPackageRoot, artifact);
  console.log(JSON.stringify({ ...artifact, _writtenTo: written }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
