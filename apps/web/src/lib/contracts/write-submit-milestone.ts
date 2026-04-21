import type { Address, PublicClient, WalletClient } from "viem";

import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi";
import { estimateCappedWriteGas } from "@/lib/contracts/safe-write-gas";

export async function writeSubmitMilestoneTx(input: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  escrowContractAddress: `0x${string}`;
  onChainProjectId: string;
  milestoneIndex: number;
  submissionUri: string;
}): Promise<`0x${string}`> {
  const rawAccount = input.walletClient.account?.address;
  if (!rawAccount) {
    throw new Error("Wallet account is not available for submitMilestone.");
  }
  const account = rawAccount as Address;
  const args = [
    BigInt(input.onChainProjectId),
    BigInt(input.milestoneIndex),
    input.submissionUri,
  ] as const;

  const gas = await estimateCappedWriteGas({
    publicClient: input.publicClient,
    account,
    address: input.escrowContractAddress,
    abi: escrowRegistryAbi,
    functionName: "submitMilestone",
    args,
    fallbackGas: 1_200_000n,
  });

  return input.walletClient.writeContract({
    address: input.escrowContractAddress,
    abi: escrowRegistryAbi,
    functionName: "submitMilestone",
    args,
    gas,
    chain: input.walletClient.chain,
    account,
  });
}
