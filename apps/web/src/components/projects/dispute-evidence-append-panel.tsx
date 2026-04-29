"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";
import { formatEscrowRegistryWriteError } from "@/lib/contracts/decode-error";
import { SyncStatusNotice } from "@/components/sync/sync-status-notice";
import { useSyncReconciliation } from "@/hooks/use-sync-reconciliation";

const MAX_EVIDENCE_URI_BYTES = 2048;

export function DisputeEvidenceAppendPanel(props: {
  projectId: string;
  chainId: number;
  escrowContractAddress: `0x${string}`;
  onChainProjectId: string;
  milestoneIndex: number;
  clientWalletAddress: string;
  freelancerWalletAddress: string | null;
}) {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const activeChainId = useChainId();
  const publicClient = usePublicClient({ chainId: props.chainId });
  const { data: walletClient } = useWalletClient({ chainId: props.chainId });
  const { switchChainAsync } = useSwitchChain();

  const [evidenceUri, setEvidenceUri] = useState("");
  const [phase, setPhase] = useState<"idle" | "signing" | "pending" | "success" | "failure">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [stateMismatchMessage, setStateMismatchMessage] = useState<string | null>(null);
  const syncTracker = useSyncReconciliation(true);

  const chainMismatch = activeChainId !== props.chainId;
  const isParticipant = useMemo(() => {
    if (!address) {
      return false;
    }
    const normalized = address.toLowerCase();
    if (normalized === props.clientWalletAddress.toLowerCase()) {
      return true;
    }
    return Boolean(
      props.freelancerWalletAddress &&
        normalized === props.freelancerWalletAddress.toLowerCase(),
    );
  }, [address, props.clientWalletAddress, props.freelancerWalletAddress]);

  function validateEvidenceUri(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return "Evidence URI is required.";
    }
    const bytes = new TextEncoder().encode(trimmed).length;
    if (bytes > MAX_EVIDENCE_URI_BYTES) {
      return `Evidence URI exceeds ${MAX_EVIDENCE_URI_BYTES} bytes.`;
    }
    if (!/^ipfs:\/\//.test(trimmed) && !/^https?:\/\//.test(trimmed)) {
      return "Evidence URI must start with ipfs:// or http(s)://";
    }
    return null;
  }

  async function appendEvidence(): Promise<void> {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!isParticipant) {
      setErrorMessage("Only project client or freelancer can append dispute evidence.");
      return;
    }
    if (!walletClient || !publicClient) {
      setErrorMessage("Connect your wallet on the project network first.");
      return;
    }
    if (chainMismatch) {
      setErrorMessage(`Switch your wallet to chain ${props.chainId} before appending evidence.`);
      return;
    }

    const uriError = validateEvidenceUri(evidenceUri);
    if (uriError) {
      setErrorMessage(uriError);
      return;
    }

    try {
      const [disputeTuple, paused] = await Promise.all([
        publicClient.readContract({
          address: props.escrowContractAddress,
          abi: escrowRegistryAbi,
          functionName: "getDispute",
          args: [BigInt(props.onChainProjectId), BigInt(props.milestoneIndex)],
        }),
        publicClient.readContract({
          address: props.escrowContractAddress,
          abi: escrowRegistryAbi,
          functionName: "paused",
        }),
      ]);
      if (Boolean(paused) || !Boolean(disputeTuple[0])) {
        setStateMismatchMessage(
          "On-chain dispute state changed. Refresh project data before appending evidence.",
        );
        setErrorMessage("Evidence append preflight failed due to chain/db mismatch.");
        return;
      }
      setPhase("signing");
      const hash = await walletClient.writeContract({
        address: props.escrowContractAddress,
        abi: escrowRegistryAbi,
        functionName: "appendDisputeEvidence",
        args: [BigInt(props.onChainProjectId), BigInt(props.milestoneIndex), evidenceUri.trim()],
        chain: walletClient.chain,
        account: walletClient.account,
      });
      setPhase("pending");
      await publicClient.waitForTransactionReceipt({ hash });
      const receipt = await publicClient.getTransactionReceipt({ hash });
      syncTracker.onTxConfirmed(receipt.blockNumber);
      await queryClient.invalidateQueries({ queryKey: ["project", props.projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-disputes"] });
      syncTracker.markUiRefreshed();
      setPhase("success");
      setSuccessMessage("Evidence appended on-chain successfully.");
      setEvidenceUri("");
    } catch (error) {
      setPhase("failure");
      setErrorMessage(formatEscrowRegistryWriteError(error, "Could not append dispute evidence."));
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-amber-300/35 bg-amber-300/10 p-3 sm:p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-200">
        Append on-chain dispute evidence
      </p>
      <p className="mt-2 text-xs leading-relaxed text-amber-100/85">
        Submit additional evidence URI to the dispute record on-chain.
      </p>
      {chainMismatch ? (
        <div className="mt-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={() => void switchChainAsync({ chainId: props.chainId })}
          >
            Switch network
          </Button>
        </div>
      ) : null}
      <div className="mt-3 space-y-2">
        <Input
          placeholder="ipfs://... or https://..."
          value={evidenceUri}
          onChange={(e) => setEvidenceUri(e.target.value)}
          disabled={phase === "signing" || phase === "pending"}
        />
      </div>
      {phase === "signing" ? (
        <p className="mt-2 text-xs text-zinc-300">Waiting for wallet signature...</p>
      ) : null}
      {phase === "pending" ? (
        <p className="mt-2 text-xs text-zinc-300">Transaction submitted. Waiting confirmation...</p>
      ) : null}
      {stateMismatchMessage ? (
        <p className="mt-2 text-xs text-amber-200">{stateMismatchMessage}</p>
      ) : null}
      <SyncStatusNotice
        stage={syncTracker.stage}
        syncStatus={syncTracker.syncStatus}
        syncStatusError={syncTracker.syncStatusError}
        onRefresh={() => {
          void queryClient.invalidateQueries({ queryKey: ["project", props.projectId] });
          void syncTracker.refetchSyncStatus();
        }}
      />
      {successMessage ? <p className="mt-2 text-xs text-emerald-300">{successMessage}</p> : null}
      <FieldError message={errorMessage ?? undefined} className="mt-2 text-xs" />
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          size="sm"
          className="w-full sm:w-auto"
          disabled={
            phase === "signing" ||
            phase === "pending" ||
            !isParticipant ||
            Boolean(validateEvidenceUri(evidenceUri))
          }
          onClick={() => void appendEvidence()}
        >
          {phase === "signing" || phase === "pending" ? "Submitting..." : "Append evidence"}
        </Button>
      </div>
    </div>
  );
}
