import { ethers } from "hardhat";

import type { EscrowFlowRegistry } from "../typechain-types/contracts/EscrowFlowRegistry";

/**
 * Sweep token balance not tied to escrow liabilities.
 *
 * Env:
 *   ESCROW_REGISTRY_ADDRESS — deployed EscrowFlowRegistry address (required)
 *   SWEEP_TOKEN_ADDRESS — ERC20 token address to sweep from (required)
 *   SWEEP_RECIPIENT_ADDRESS — recipient address for swept amount (required)
 *   SWEEP_AMOUNT — token amount in smallest units (required, uint256)
 *
 * Usage:
 *   pnpm exec hardhat run scripts/sweep-untracked-token.ts --network localhost
 *   pnpm exec hardhat run scripts/sweep-untracked-token.ts --network arbitrumSepolia
 */
async function main() {
  const [caller] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();

  const registryAddress = process.env.ESCROW_REGISTRY_ADDRESS?.trim() || "";
  const tokenAddress = process.env.SWEEP_TOKEN_ADDRESS?.trim() || "";
  const recipientAddress = process.env.SWEEP_RECIPIENT_ADDRESS?.trim() || "";
  const amountRaw = process.env.SWEEP_AMOUNT?.trim() || "";

  if (!ethers.isAddress(registryAddress)) {
    throw new Error("ESCROW_REGISTRY_ADDRESS must be a valid address");
  }
  if (!ethers.isAddress(tokenAddress)) {
    throw new Error("SWEEP_TOKEN_ADDRESS must be a valid address");
  }
  if (!ethers.isAddress(recipientAddress)) {
    throw new Error("SWEEP_RECIPIENT_ADDRESS must be a valid address");
  }
  if (!amountRaw || !/^\d+$/.test(amountRaw)) {
    throw new Error("SWEEP_AMOUNT must be a base-10 uint256 string");
  }

  const amount = BigInt(amountRaw);
  const registry = (await ethers.getContractAt(
    "EscrowFlowRegistry",
    registryAddress,
    caller,
  )) as EscrowFlowRegistry;

  const beforeUntracked = await registry.untrackedTokenBalance(tokenAddress);
  const beforeBalance = await (
    await ethers.getContractAt("IERC20", tokenAddress, caller)
  ).balanceOf(recipientAddress);

  const tx = await registry.sweepUntrackedToken(
    tokenAddress,
    recipientAddress,
    amount,
  );
  const receipt = await tx.wait();

  const afterUntracked = await registry.untrackedTokenBalance(tokenAddress);
  const afterBalance = await (
    await ethers.getContractAt("IERC20", tokenAddress, caller)
  ).balanceOf(recipientAddress);

  console.log(
    JSON.stringify(
      {
        network: net.name,
        chainId: Number(net.chainId),
        caller: await caller.getAddress(),
        registry: registryAddress,
        token: tokenAddress,
        recipient: recipientAddress,
        requestedAmount: amount.toString(),
        txHash: receipt?.hash ?? null,
        recipientBalanceBefore: beforeBalance.toString(),
        recipientBalanceAfter: afterBalance.toString(),
        untrackedBefore: beforeUntracked.toString(),
        untrackedAfter: afterUntracked.toString(),
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
