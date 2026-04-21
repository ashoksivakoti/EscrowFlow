import type { Abi, Address, PublicClient } from "viem";

/**
 * Hardhat (and some dev chains) cap a single tx below the legacy 21M default estimate;
 * using an explicit capped gas avoids "exceeds transaction gas cap of 16777216".
 */
const DEV_CHAIN_TX_GAS_CEILING = 12_000_000n;

type EstimateArgs = {
  publicClient: PublicClient;
  account: Address;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  /** Used when estimation fails (e.g. RPC hiccup). */
  fallbackGas?: bigint;
};

/**
 * Returns a gas limit for `writeContract`, capped for local/dev RPC limits.
 */
export async function estimateCappedWriteGas({
  publicClient,
  account,
  address,
  abi,
  functionName,
  args,
  fallbackGas = 900_000n,
}: EstimateArgs): Promise<bigint> {
  try {
    const estimated = await publicClient.estimateContractGas({
      address,
      abi,
      functionName,
      args,
      account,
    });
    const buffered = (estimated * 130n) / 100n;
    if (buffered <= DEV_CHAIN_TX_GAS_CEILING) {
      return buffered;
    }
    if (estimated <= DEV_CHAIN_TX_GAS_CEILING) {
      return estimated;
    }
    return DEV_CHAIN_TX_GAS_CEILING;
  } catch {
    return fallbackGas;
  }
}
