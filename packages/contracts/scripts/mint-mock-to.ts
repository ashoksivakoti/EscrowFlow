/**
 * Mint MockERC20Stablecoin (mUSD, 6 decimals) to an address. Caller must be token owner (deployer on localhost).
 *
 * Usage (from packages/contracts, with `hardhat node` running):
 *   MINT_TO=0x... pnpm exec hardhat run scripts/mint-mock-to.ts --network localhost
 *
 * Optional:
 *   DEPLOYMENT_FILE=deployments/localhost-31337.json   (default)
 *   AMOUNT_HUMAN=10000000   (human mUSD, default 10_000_000)
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { BaseContract, ContractTransactionResponse } from "ethers";
import { ethers } from "hardhat";

import type { DeploymentArtifactV1 } from "./lib/writeDeployment";

type MintableToken = BaseContract & {
  owner(): Promise<string>;
  mint(to: string, amount: bigint): Promise<ContractTransactionResponse>;
};

async function main(): Promise<void> {
  const recipientRaw =
    process.env.MINT_TO?.trim() || process.argv.find((a) => /^0x[a-fA-F0-9]{40}$/.test(a));
  if (!recipientRaw) {
    throw new Error("Set MINT_TO=0x... or pass a 40-hex wallet as the last CLI argument.");
  }
  const recipient = ethers.getAddress(recipientRaw);

  const human = process.env.AMOUNT_HUMAN?.trim() || "10000000";
  if (!/^\d+$/.test(human)) {
    throw new Error("AMOUNT_HUMAN must be a non-negative integer string (human mUSD units).");
  }

  const deploymentRel =
    process.env.DEPLOYMENT_FILE?.trim() || "deployments/localhost-31337.json";
  const deploymentPath = path.join(__dirname, "..", deploymentRel);
  const raw = readFileSync(deploymentPath, "utf8");
  const artifact = JSON.parse(raw) as DeploymentArtifactV1;
  const tokenAddress = artifact.contracts.MockERC20Stablecoin;
  if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
    throw new Error(`Missing MockERC20Stablecoin in ${deploymentPath}`);
  }

  const [deployer] = await ethers.getSigners();
  const tokenAbi = [
    "function mint(address to, uint256 amount) external",
    "function owner() view returns (address)",
  ];
  const token = new ethers.Contract(tokenAddress, tokenAbi, deployer) as unknown as MintableToken;
  const owner = await token.owner();
  const deployerAddr = await deployer.getAddress();
  if (owner.toLowerCase() !== deployerAddr.toLowerCase()) {
    throw new Error(
      `Connected signer ${deployerAddr} is not token owner ${owner}. Use the deployer key on localhost.`,
    );
  }

  const amount = ethers.parseUnits(human, 6);
  const tx = await token.mint(recipient, amount);
  await tx.wait();

  console.log(
    JSON.stringify(
      {
        token: tokenAddress,
        recipient,
        amountHuman: human,
        amountWei: amount.toString(),
        decimals: 6,
        txHash: tx.hash,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
