import { useEffect, useMemo, useState } from "react";
import { keccak256, stringToHex } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";
import { canonicalDeployment } from "@/lib/contracts/contract-addresses";

export const DEFAULT_ADMIN_ROLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
export const PAUSER_ROLE = keccak256(stringToHex("PAUSER_ROLE"));
export const ARBITRATOR_ROLE = keccak256(stringToHex("ARBITRATOR_ROLE"));

export type ContractRoleFlags = {
  isContractAdmin: boolean;
  isPauser: boolean;
  isArbitrator: boolean;
};

export async function readHasRole(input: {
  publicClient: ReturnType<typeof usePublicClient>;
  contractAddress: `0x${string}`;
  role: `0x${string}`;
  account: `0x${string}`;
}): Promise<boolean> {
  const { publicClient, contractAddress, role, account } = input;
  if (!publicClient) {
    return false;
  }
  const result = await publicClient.readContract({
    address: contractAddress,
    abi: escrowRegistryAbi,
    functionName: "hasRole",
    args: [role, account],
  });
  return Boolean(result);
}

export async function readContractRoles(input: {
  publicClient: ReturnType<typeof usePublicClient>;
  contractAddress: `0x${string}`;
  account: `0x${string}`;
}): Promise<ContractRoleFlags> {
  const [isContractAdmin, isPauser, isArbitrator] = await Promise.all([
    readHasRole({
      publicClient: input.publicClient,
      contractAddress: input.contractAddress,
      role: DEFAULT_ADMIN_ROLE,
      account: input.account,
    }),
    readHasRole({
      publicClient: input.publicClient,
      contractAddress: input.contractAddress,
      role: PAUSER_ROLE,
      account: input.account,
    }),
    readHasRole({
      publicClient: input.publicClient,
      contractAddress: input.contractAddress,
      role: ARBITRATOR_ROLE,
      account: input.account,
    }),
  ]);
  return { isContractAdmin, isPauser, isArbitrator };
}

export function useContractRoles(input?: {
  chainId?: number;
  contractAddress?: `0x${string}`;
}) {
  const { address } = useAccount();
  const chainId = input?.chainId ?? canonicalDeployment.chainId;
  const contractAddress =
    input?.contractAddress ?? canonicalDeployment.contracts.EscrowFlowRegistry;
  const publicClient = usePublicClient({ chainId });

  const [roles, setRoles] = useState<ContractRoleFlags>({
    isContractAdmin: false,
    isPauser: false,
    isArbitrator: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function run(): Promise<void> {
      if (!address || !publicClient || !contractAddress) {
        if (active) {
          setRoles({ isContractAdmin: false, isPauser: false, isArbitrator: false });
          setError(null);
          setIsLoading(false);
        }
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const next = await readContractRoles({
          publicClient,
          contractAddress,
          account: address,
        });
        if (active) {
          setRoles(next);
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : "Could not load contract roles.");
          setRoles({ isContractAdmin: false, isPauser: false, isArbitrator: false });
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [address, publicClient, contractAddress]);

  const warnings = useMemo(() => {
    const items: string[] = [];
    if (roles.isContractAdmin && roles.isArbitrator) {
      items.push("Role separation warning: admin wallet should not also hold ARBITRATOR_ROLE.");
    }
    if (roles.isPauser && roles.isArbitrator) {
      items.push("Role separation warning: pauser wallet should not also hold ARBITRATOR_ROLE.");
    }
    return items;
  }, [roles.isArbitrator, roles.isContractAdmin, roles.isPauser]);

  return {
    ...roles,
    isLoading,
    error,
    warnings,
  };
}
