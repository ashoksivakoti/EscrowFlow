"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";

import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Textarea } from "@/components/ui/textarea";

type ReviewPhase =
  | "idle"
  | "approve_signing"
  | "approve_pending"
  | "approve_success"
  | "release_signing"
  | "release_pending"
  | "success"
  | "failure";

export function MilestoneApprovalPanel(props: {
  projectId: string;
  milestoneId: string;
  milestoneIndex: number;
  submissionId: string;
  chainId: number;
  onChainProjectId: string;
  escrowContractAddress: `0x${string}`;
  releasedAmountWei: string;
}) {
  const queryClient = useQueryClient();
  const activeChainId = useChainId();
  const publicClient = usePublicClient({ chainId: props.chainId });
  const { data: walletClient } = useWalletClient({ chainId: props.chainId });
  const { switchChainAsync } = useSwitchChain();

  const [reviewNote, setReviewNote] = useState("");
  const [phase, setPhase] = useState<ReviewPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const chainMismatch = activeChainId !== props.chainId;
  const isBusy =
    phase === "approve_signing" ||
    phase === "approve_pending" ||
    phase === "release_signing" ||
    phase === "release_pending";

  async function approveAndPayout(): Promise<void> {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (chainMismatch) {
      setErrorMessage(`Switch your wallet to chain ${props.chainId} before approving payout.`);
      return;
    }
    if (!walletClient || !publicClient) {
      setErrorMessage("Wallet client not ready. Reconnect wallet and try again.");
      return;
    }

    try {
      setPhase("approve_signing");
      const approveTxHash = await walletClient.writeContract({
        address: props.escrowContractAddress,
        abi: escrowRegistryAbi,
        functionName: "approveMilestone",
        args: [BigInt(props.onChainProjectId), BigInt(props.milestoneIndex)],
        chain: walletClient.chain,
        account: walletClient.account,
      });

      setPhase("approve_pending");
      await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
      setPhase("approve_success");

      setPhase("release_signing");
      const releaseTxHash = await walletClient.writeContract({
        address: props.escrowContractAddress,
        abi: escrowRegistryAbi,
        functionName: "releaseMilestone",
        args: [BigInt(props.onChainProjectId), BigInt(props.milestoneIndex)],
        chain: walletClient.chain,
        account: walletClient.account,
      });

      setPhase("release_pending");
      await publicClient.waitForTransactionReceipt({ hash: releaseTxHash });

      const reconcileRes = await fetch(
        `/api/v1/projects/${props.projectId}/milestones/${props.milestoneId}/approve-payout`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            submissionId: props.submissionId,
            reviewNote: reviewNote.trim() ? reviewNote.trim() : null,
            chainId: props.chainId,
            escrowContractAddress: props.escrowContractAddress,
            onChainProjectId: props.onChainProjectId,
            milestoneIndex: props.milestoneIndex,
            approveTxHash,
            releaseTxHash,
            releasedAmountWei: props.releasedAmountWei,
          }),
        },
      );
      if (!reconcileRes.ok) {
        throw new Error("On-chain payout succeeded, but app sync failed. Refresh the page.");
      }

      await queryClient.invalidateQueries({ queryKey: ["project", props.projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });

      setPhase("success");
      setSuccessMessage("Milestone approved and payout released successfully.");
      setReviewNote("");
    } catch (error) {
      setPhase("failure");
      setErrorMessage(error instanceof Error ? error.message : "Approval/payout failed");
    }
  }

  const statusMessage = (() => {
    if (phase === "approve_signing") {
      return "Waiting for wallet signature to approve milestone…";
    }
    if (phase === "approve_pending") {
      return "Approval transaction submitted. Waiting for confirmation…";
    }
    if (phase === "approve_success") {
      return "Milestone approval confirmed.";
    }
    if (phase === "release_signing") {
      return "Waiting for wallet signature to release payout…";
    }
    if (phase === "release_pending") {
      return "Payout release transaction submitted. Waiting for confirmation…";
    }
    if (phase === "success") {
      return successMessage ?? "Approval and payout complete.";
    }
    if (phase === "failure") {
      return errorMessage ?? "Approval flow failed.";
    }
    return null;
  })();

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
        Review and approve payout
      </p>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          1) Add optional review note for audit trail. 2) Approve submission and release
          payout on-chain.
        </p>
        <Textarea
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          placeholder="Optional client review note"
          maxLength={5000}
          className="min-h-[90px]"
          disabled={isBusy}
        />
      </div>

      {chainMismatch ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <p>Wallet network mismatch. Switch to chain {props.chainId} first.</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => {
              void switchChainAsync({ chainId: props.chainId });
            }}
          >
            Switch network
          </Button>
        </div>
      ) : null}

      {statusMessage ? (
        <div
          className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
            phase === "failure"
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
              : "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300"
          }`}
          role="status"
        >
          {statusMessage}
        </div>
      ) : null}

      <FieldError message={errorMessage ?? undefined} className="mt-2 text-xs" />

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" size="sm" disabled={isBusy} onClick={() => void approveAndPayout()}>
          {isBusy ? "Processing…" : "Approve and release payout"}
        </Button>
      </div>
    </div>
  );
}
