import path from "node:path";

import { ethers } from "hardhat";

import type { EscrowFlowRegistry } from "../typechain-types/contracts/EscrowFlowRegistry";
import {
  type DeploymentArtifactV1,
  writeDeploymentArtifact,
} from "./lib/writeDeployment";

/**
 * Deploy mock token + registry for local / testnet dev (single tx flow for demos).
 *
 * Env: same as deploy-registry.ts (REGISTRY_ADMIN_ADDRESS, ARBITRATOR_ADDRESS).
 *
 * Usage:
 *   pnpm exec hardhat run scripts/deploy-stack.ts --network localhost
 *   pnpm exec hardhat run scripts/deploy-stack.ts --network sepolia
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

  const Mock = await ethers.getContractFactory("MockERC20Stablecoin");
  const token = await Mock.connect(deployer).deploy(deployerAddress);
  await token.waitForDeployment();
  const tokenAddress = await ethers.resolveAddress(token);

  const Reg = await ethers.getContractFactory("EscrowFlowRegistry");
  const regDeployed = await Reg.connect(deployer).deploy(admin);
  await regDeployed.waitForDeployment();
  const registry = regDeployed as unknown as EscrowFlowRegistry;
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
      "[deploy-stack] Deployer is not REGISTRY_ADMIN_ADDRESS; grant ARBITRATOR_ROLE manually.",
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
      MockERC20Stablecoin: tokenAddress,
      EscrowFlowRegistry: registryAddress,
    },
    roles: {
      defaultAdmin: admin,
      pauser: admin,
      arbitratorGranted: arbitrator,
    },
    notes: "Mock token owner = deployer. Mint mUSD to fund test users.",
  };

  const written = writeDeploymentArtifact(contractsPackageRoot, artifact);
  console.log(JSON.stringify({ ...artifact, _writtenTo: written }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
