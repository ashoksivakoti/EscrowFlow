"use client";

import { useMemo, useState } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";
import { formatEscrowRegistryWriteError } from "@/lib/contracts/decode-error";
import { canonicalDeployment } from "@/lib/contracts/contract-addresses";
import { useContractPaused } from "@/components/providers/contract-pause-provider";

export function PauseOpsPanel() {
  const { paused, isPauser, refreshPaused, isLoading } = useContractPaused();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: canonicalDeployment.chainId });
  const { data: walletClient } = useWalletClient({ chainId: canonicalDeployment.chainId });
  const { switchChainAsync } = useSwitchChain();

  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const canWrite = useMemo(() => Boolean(walletClient && publicClient && address && isPauser), [
    walletClient,
    publicClient,
    address,
    isPauser,
  ]);

  async function onPauseOrUnpause(): Promise<void> {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!walletClient || !publicClient) {
      setErrorMessage("Connect a wallet on the contract network first.");
      return;
    }
    if (!isPauser) {
      setErrorMessage("PAUSER_ROLE is required.");
      return;
    }
    if (walletClient.chain.id !== canonicalDeployment.chainId) {
      await switchChainAsync({ chainId: canonicalDeployment.chainId });
    }

    try {
      setBusy(true);
      const functionName = paused ? "unpause" : "pause";
      const hash = await walletClient.writeContract({
        address: canonicalDeployment.contracts.EscrowFlowRegistry,
        abi: escrowRegistryAbi,
        functionName,
        args: [] as const,
        chain: walletClient.chain,
        account: walletClient.account,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await refreshPaused();
      setSuccessMessage(paused ? "Contract unpaused." : "Contract paused.");
    } catch (e) {
      setErrorMessage(formatEscrowRegistryWriteError(e, "Pause/unpause failed."));
    } finally {
      setBusy(false);
    }
  }

  if (!isPauser) return null;

  return (
    <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/50 p-3 sm:p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">
        Pause / unpause controls
      </p>
      <p className="mt-1 text-xs text-zinc-300">
        Contract paused: {isLoading ? "Loading…" : paused ? "yes" : "no"}
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          size="sm"
          className="w-full sm:w-auto"
          disabled={!canWrite || busy || !isLoading || paused === false}
          variant={paused ? "secondary" : "primary"}
          onClick={() => void onPauseOrUnpause()}
        >
          Unpause
        </Button>
        <Button
          type="button"
          size="sm"
          className="w-full sm:w-auto"
          disabled={!canWrite || busy || !isLoading || paused === true}
          variant={!paused ? "secondary" : "primary"}
          onClick={() => void onPauseOrUnpause()}
        >
          Pause
        </Button>
      </div>

      {errorMessage ? <FieldError message={errorMessage} className="mt-2 text-xs" /> : null}
      {successMessage ? (
        <p className="mt-2 text-xs text-emerald-300">{successMessage}</p>
      ) : null}
    </div>
  );
}

