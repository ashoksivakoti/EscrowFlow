"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { keccak256, stringToHex } from "viem";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";

import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";
import { formatEscrowRegistryWriteError } from "@/lib/contracts/decode-error";
import { mapMilestoneStatusToContract } from "@/lib/contracts/status-mapping";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SyncStatusNotice } from "@/components/sync/sync-status-notice";
import { useSyncReconciliation } from "@/hooks/use-sync-reconciliation";

export function DisputeCreatePanel(props: {
  projectId: string;
  milestoneId: string;
  chainId: number;
  escrowContractAddress: `0x${string}`;
  onChainProjectId: string;
  milestoneIndex: number;
  milestoneDueAt: string | null;
  milestoneStatus: string;
  projectStatus: string;
  milestoneOpenDisputeId: string | null;
  milestones: Array<{ sortOrder: number; status: string }>;
  clientWalletAddress: string;
  freelancerWalletAddress: string | null;
  relatedSubmissionId?: string | null;
}) {
  const queryClient = useQueryClient();
  const activeChainId = useChainId();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: props.chainId });
  const { data: walletClient } = useWalletClient({ chainId: props.chainId });
  const { switchChainAsync } = useSwitchChain();
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<"idle" | "signing" | "pending" | "reconciling">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [stateMismatchMessage, setStateMismatchMessage] = useState<string | null>(null);
  const syncTracker = useSyncReconciliation(true);

  const chainMismatch = activeChainId !== props.chainId;
  const isParticipant = useMemo(() => {
    if (!address) return false;
    const normalized = address.toLowerCase();
    if (normalized === props.clientWalletAddress.toLowerCase()) {
      return true;
    }
    return Boolean(
      props.freelancerWalletAddress &&
        normalized === props.freelancerWalletAddress.toLowerCase(),
    );
  }, [address, props.clientWalletAddress, props.freelancerWalletAddress]);
  const deadlineReached = useMemo(() => {
    if (!props.milestoneDueAt) return true;
    const due = new Date(props.milestoneDueAt);
    if (Number.isNaN(due.getTime())) return true;
    return Date.now() >= due.getTime();
  }, [props.milestoneDueAt]);
  const sequenceReady = useMemo(() => {
    return props.milestones
      .filter((m) => m.sortOrder < props.milestoneIndex)
      .every((m) => {
        const mapped = mapMilestoneStatusToContract(m.status);
        return mapped === "Released" || mapped === "Refunded";
      });
  }, [props.milestoneIndex, props.milestones]);

  function reasonUri(reasonText: string): string {
    const digest = keccak256(stringToHex(reasonText));
    return `escrowflow://disputes/reason/${digest}`;
  }

  function guardError(): string | null {
    if (!isParticipant) {
      return "Only the project client or freelancer can raise a dispute.";
    }
    if (props.milestoneOpenDisputeId) {
      return "This milestone already has an active dispute.";
    }
    if (props.projectStatus !== "ACTIVE" && props.projectStatus !== "DISPUTED") {
      return "Project status does not allow dispute creation.";
    }
    const mappedMilestone = mapMilestoneStatusToContract(props.milestoneStatus);
    if (mappedMilestone !== "Submitted" && mappedMilestone !== "Approved") {
      return "Milestone status does not allow raising a dispute.";
    }
    if (!deadlineReached) {
      return "Milestone deadline has not been reached yet.";
    }
    if (!sequenceReady) {
      return "Complete earlier milestones before raising a dispute on this milestone.";
    }
    return null;
  }

  async function onSubmitDispute(): Promise<void> {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (reason.trim().length < 10) {
      setErrorMessage("Please provide at least 10 characters in dispute reason.");
      return;
    }
    if (files.length === 0) {
      setErrorMessage("Please upload at least one evidence file.");
      return;
    }
    const blocked = guardError();
    if (blocked) {
      setErrorMessage(blocked);
      return;
    }
    if (!walletClient || !publicClient || !address) {
      setErrorMessage("Connect your wallet to create the dispute on-chain.");
      return;
    }
    if (chainMismatch) {
      setErrorMessage(`Switch your wallet to chain ${props.chainId} before raising dispute.`);
      return;
    }

    setSubmitting(true);
    try {
      const [projectTuple, milestoneTuple, disputeTuple, paused] = await Promise.all([
        publicClient.readContract({
          address: props.escrowContractAddress,
          abi: escrowRegistryAbi,
          functionName: "getProject",
          args: [BigInt(props.onChainProjectId)],
        }),
        publicClient.readContract({
          address: props.escrowContractAddress,
          abi: escrowRegistryAbi,
          functionName: "getMilestone",
          args: [BigInt(props.onChainProjectId), BigInt(props.milestoneIndex)],
        }),
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
      const projectStatus = Number(projectTuple.status);
      const milestoneStatus = Number(milestoneTuple.status);
      const disputeActive = Boolean(disputeTuple[0]);
      if (Boolean(paused) || (projectStatus !== 0 && projectStatus !== 1) || (milestoneStatus !== 1 && milestoneStatus !== 2) || disputeActive) {
        setStateMismatchMessage(
          "On-chain dispute preconditions changed. Refresh project state and try again.",
        );
        setErrorMessage("Dispute preflight failed due to chain/db mismatch.");
        return;
      }
      const normalizedReason = reason.trim();
      const disputeReasonUri = reasonUri(normalizedReason);
      setPhase("signing");
      const disputeTxHash = await walletClient.writeContract({
        address: props.escrowContractAddress,
        abi: escrowRegistryAbi,
        functionName: "raiseDispute",
        args: [
          BigInt(props.onChainProjectId),
          BigInt(props.milestoneIndex),
          disputeReasonUri,
        ],
        chain: walletClient.chain,
        account: walletClient.account,
      });
      setPhase("pending");
      await publicClient.waitForTransactionReceipt({ hash: disputeTxHash });
      const receipt = await publicClient.getTransactionReceipt({ hash: disputeTxHash });
      syncTracker.onTxConfirmed(receipt.blockNumber);

      const encodedFiles = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileBase64: await fileToBase64(file),
        })),
      );

      setPhase("reconciling");
      const response = await fetch(
        `/api/v1/projects/${props.projectId}/milestones/${props.milestoneId}/disputes`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: normalizedReason,
            reasonUri: disputeReasonUri,
            chainId: props.chainId,
            escrowContractAddress: props.escrowContractAddress,
            onChainProjectId: props.onChainProjectId,
            milestoneIndex: props.milestoneIndex,
            disputeTxHash,
            files: encodedFiles,
            relatedSubmissionId: props.relatedSubmissionId ?? null,
          }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? "Could not raise dispute");
      }

      setSuccessMessage(
        "Dispute confirmed on-chain and reconciled in app state. Milestone is now frozen pending review.",
      );
      setReason("");
      setFiles([]);
      await queryClient.invalidateQueries({ queryKey: ["project", props.projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-disputes"] });
      syncTracker.markUiRefreshed();
    } catch (error) {
      setErrorMessage(formatEscrowRegistryWriteError(error, "Could not raise dispute"));
    } finally {
      setSubmitting(false);
      setPhase("idle");
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-amber-300/35 bg-amber-300/10 p-3 sm:p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-200">
        Raise dispute
      </p>
      <p className="mt-2 text-xs leading-relaxed text-amber-100/85">
        This action sends an on-chain <code>raiseDispute</code> transaction first. App records are
        reconciled only after transaction confirmation. Attach evidence files to support your claim
        (up to 5 files).
      </p>
      {chainMismatch ? (
        <div className="mt-2 rounded-lg border border-amber-300/35 bg-amber-300/10 p-2 text-xs text-amber-100">
          <p>Wallet network mismatch. Switch to chain {props.chainId} first.</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2 w-full sm:w-auto"
            onClick={() => void switchChainAsync({ chainId: props.chainId })}
          >
            Switch network
          </Button>
        </div>
      ) : null}
      {guardError() ? (
        <div className="mt-2 rounded-lg border border-amber-300/35 bg-amber-300/10 p-2 text-xs text-amber-100">
          {guardError()}
        </div>
      ) : null}
      {stateMismatchMessage ? (
        <div className="mt-2 rounded-lg border border-amber-300/35 bg-amber-300/10 p-2 text-xs text-amber-100">
          {stateMismatchMessage}
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        <div className="space-y-1">
          <label
            htmlFor="dispute-reason"
            className="text-xs font-medium text-zinc-200"
          >
            Reason
          </label>
          <Textarea
            id="dispute-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe why this milestone requires dispute review"
            maxLength={5000}
            className="min-h-[110px]"
            disabled={submitting}
          />
        </div>

        <div className="space-y-1">
          <label
            htmlFor="dispute-evidence-files"
            className="text-xs font-medium text-zinc-200"
          >
            Evidence files
          </label>
          <Input
            id="dispute-evidence-files"
            type="file"
            multiple
            disabled={submitting}
            onChange={(event) => {
              const selected = event.target.files ? Array.from(event.target.files) : [];
              setFiles(selected);
            }}
          />
          {files.length ? (
            <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-2 text-xs text-zinc-300">
              {files.map((file) => (
                <p key={`${file.name}-${file.size}`} className="break-all">
                  {file.name} ({formatFileSize(file.size)})
                </p>
              ))}
            </div>
          ) : null}
        </div>

        {successMessage ? (
          <div className="rounded-xl border border-emerald-300/35 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100">
            {successMessage}
          </div>
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

        <FieldError message={errorMessage ?? undefined} className="text-xs" />
        {submitting ? (
          <p className="text-xs text-zinc-300">
            {phase === "signing"
              ? "Waiting wallet signature for on-chain dispute..."
              : phase === "pending"
                ? "Waiting on-chain dispute confirmation..."
                : "Reconciling confirmed dispute in app state..."}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            size="sm"
            className="w-full sm:w-auto"
            disabled={submitting || Boolean(guardError())}
            onClick={() => void onSubmitDispute()}
          >
            {submitting ? "Submitting dispute…" : "Submit dispute"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not encode file"));
        return;
      }
      const base64 = result.split(",")[1];
      if (!base64) {
        reject(new Error("Could not encode file"));
        return;
      }
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}
