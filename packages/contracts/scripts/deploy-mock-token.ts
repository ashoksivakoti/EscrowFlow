import path from "node:path";

import { ethers } from "hardhat";

import {
  type DeploymentArtifactV1,
  writeDeploymentArtifact,
} from "./lib/writeDeployment";

/**
 * Deploy MockERC20Stablecoin (6 decimals, owner = deployer).
 *
 * Usage:
 *   pnpm exec hardhat run scripts/deploy-mock-token.ts --network localhost
 *   pnpm exec hardhat run scripts/deploy-mock-token.ts --network arbitrumSepolia
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const net = await ethers.provider.getNetwork();

  const Factory = await ethers.getContractFactory("MockERC20Stablecoin");
  const token = await Factory.connect(deployer).deploy(deployerAddress);
  await token.waitForDeployment();
  const address = await ethers.resolveAddress(token);

  const contractsPackageRoot = path.join(__dirname, "..");
  const artifact: DeploymentArtifactV1 = {
    schemaVersion: 1,
    network: net.name,
    chainId: Number(net.chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployerAddress,
    contracts: {
      MockERC20Stablecoin: address,
    },
    notes: "Mint via mint(to, amount); owner-only.",
  };

  const written = writeDeploymentArtifact(contractsPackageRoot, artifact);
  console.log(JSON.stringify({ ...artifact, _writtenTo: written }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
