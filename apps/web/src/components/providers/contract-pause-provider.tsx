"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePublicClient } from "wagmi";

import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";
import { canonicalDeployment } from "@/lib/contracts/contract-addresses";
import { useContractRoles } from "@/lib/contracts/roles";

type ContractPauseContextValue = {
  paused: boolean;
  isPauser: boolean;
  isLoading: boolean;
  refreshPaused: () => Promise<void>;
};

const ContractPauseContext = createContext<ContractPauseContextValue | null>(null);

export function ContractPauseProvider({ children }: { children: React.ReactNode }) {
  const contractRoles = useContractRoles({
    chainId: canonicalDeployment.chainId,
    contractAddress: canonicalDeployment.contracts.EscrowFlowRegistry,
  });

  const publicClient = usePublicClient({ chainId: canonicalDeployment.chainId });
  const [paused, setPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refreshPaused = useCallback(async (): Promise<void> => {
    if (!publicClient) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const next = await publicClient.readContract({
        address: canonicalDeployment.contracts.EscrowFlowRegistry,
        abi: escrowRegistryAbi,
        functionName: "paused",
      });
      setPaused(Boolean(next));
    } finally {
      setIsLoading(false);
    }
  }, [publicClient]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!active) return;
      await refreshPaused();
    })();

    const timer = setInterval(() => {
      void refreshPaused();
    }, 5000);

    return () => {
      active = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient]);

  const value = useMemo<ContractPauseContextValue>(
    () => ({
      paused,
      isPauser: contractRoles.isPauser,
      isLoading: isLoading || contractRoles.isLoading,
      refreshPaused,
    }),
    [paused, contractRoles.isPauser, contractRoles.isLoading, isLoading, refreshPaused],
  );

  return (
    <ContractPauseContext.Provider value={value}>
      <ContractPausedBanner />
      {children}
    </ContractPauseContext.Provider>
  );
}

export function useContractPaused(): ContractPauseContextValue {
  const ctx = useContext(ContractPauseContext);
  if (!ctx) throw new Error("useContractPaused must be used within ContractPauseProvider");
  return ctx;
}

function ContractPausedBanner() {
  const { paused, isPauser, isLoading } = useContractPaused();

  if (isLoading || !paused) return null;

  return (
    <div className="z-50 w-full border-b border-amber-300/30 bg-amber-300/10 px-4 py-3 text-xs text-amber-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-amber-100">Contract is paused</p>
          <p className="text-amber-100/85">
            Normal on-chain actions are disabled until the contract is unpaused.
          </p>
        </div>
        {isPauser ? (
          <p className="sm:text-right text-amber-100/90 font-medium">You have PAUSER_ROLE access.</p>
        ) : null}
      </div>
    </div>
  );
}

