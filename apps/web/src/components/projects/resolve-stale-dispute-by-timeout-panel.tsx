"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";
import { formatEscrowRegistryWriteError } from "@/lib/contracts/decode-error";
import { SyncStatusNotice } from "@/components/sync/sync-status-notice";
import { useSyncReconciliation } from "@/hooks/use-sync-reconciliation";

const DISPUTE_ACTIVE_STATUSES = ["OPEN", "AWAITING_RESPONSE", "UNDER_ADMIN_REVIEW"] as const;

function toBigIntLoose(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new Error("Invalid bigint-like value");
}

export function ResolveStaleDisputeByTimeoutPanel(props: {
  projectId: string;
  chainId: number;
  escrowContractAddress: `0x${string}`;
  onChainProjectId: string;
  milestoneIndex: number;
  milestoneStatus: string;
  disputeStatus: string;
  disputeCreatedAt: string; // ISO
  clientWalletAddress: string;
}) {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const activeChainId = useChainId();
  const publicClient = usePublicClient({ chainId: props.chainId });
  const { data: walletClient } = useWalletClient({ chainId: props.chainId });
  const { switchChainAsync } = useSwitchChain();

  const [phase, setPhase] = useState<"idle" | "signing" | "pending" | "success" | "failure">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const syncTracker = useSyncReconciliation(true);

  const [nowUnixSeconds, setNowUnixSeconds] = useState<number>(() =>
    Math.floor(Date.now() / 1000),
  );

  const disputeIsActive = DISPUTE_ACTIVE_STATUSES.includes(
    props.disputeStatus as (typeof DISPUTE_ACTIVE_STATUSES)[number],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setNowUnixSeconds(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const [disputeTimeoutSeconds, setDisputeTimeoutSeconds] = useState<bigint | null>(null);
  const [disputeTimeoutReadError, setDisputeTimeoutReadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function readTimeout() {
      if (!publicClient) return;
      try {
        setDisputeTimeoutReadError(null);
        const timeoutValue = await publicClient.readContract({
          address: props.escrowContractAddress,
          abi: escrowRegistryAbi,
          functionName: "DISPUTE_TIMEOUT",
        });
        if (cancelled) return;
        setDisputeTimeoutSeconds(BigInt(timeoutValue as unknown as bigint));
      } catch {
        if (cancelled) return;
        setDisputeTimeoutReadError("Could not read dispute timeout from contract.");
        setDisputeTimeoutSeconds(null);
      }
    }
    void readTimeout();
    return () => {
      cancelled = true;
    };
  }, [publicClient, props.escrowContractAddress]);

  const [onChainMilestoneStatusCode, setOnChainMilestoneStatusCode] = useState<bigint | null>(null);
  const [onChainMilestoneReadError, setOnChainMilestoneReadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function readMilestone() {
      if (!publicClient) return;
      try {
        setOnChainMilestoneReadError(null);
        const milestone = await publicClient.readContract({
          address: props.escrowContractAddress,
          abi: escrowRegistryAbi,
          functionName: "getMilestone",
          args: [BigInt(props.onChainProjectId), BigInt(props.milestoneIndex)],
        });
        if (cancelled) return;
        const maybeStatusFromObject = (milestone as { status?: unknown }).status;
        const maybeStatusFromTuple = Array.isArray(milestone)
          ? (milestone as unknown[])[3]
          : undefined;
        const statusCodeRaw = maybeStatusFromObject ?? maybeStatusFromTuple;
        setOnChainMilestoneStatusCode(toBigIntLoose(statusCodeRaw));
      } catch {
        if (cancelled) return;
        setOnChainMilestoneReadError("Could not read milestone status from contract.");
        setOnChainMilestoneStatusCode(null);
      }
    }
    void readMilestone();
    return () => {
      cancelled = true;
    };
  }, [publicClient, props.escrowContractAddress, props.onChainProjectId, props.milestoneIndex]);

  const milestoneIsPending = onChainMilestoneStatusCode === 0n;

  const raisedAtUnixSeconds = useMemo(() => {
    const ms = new Date(props.disputeCreatedAt).getTime();
    if (!Number.isFinite(ms)) return null;
    return Math.floor(ms / 1000);
  }, [props.disputeCreatedAt]);

  const deadlineUnixSeconds = useMemo(() => {
    if (raisedAtUnixSeconds == null || disputeTimeoutSeconds == null) return null;
    return raisedAtUnixSeconds + Number(disputeTimeoutSeconds);
  }, [raisedAtUnixSeconds, disputeTimeoutSeconds]);

  const secondsUntilDeadline = useMemo(() => {
    if (deadlineUnixSeconds == null) return null;
    return Math.max(0, deadlineUnixSeconds - nowUnixSeconds);
  }, [deadlineUnixSeconds, nowUnixSeconds]);

  const timeoutPassed =
    deadlineUnixSeconds != null ? nowUnixSeconds >= deadlineUnixSeconds : false;

  const chainMismatch = activeChainId !== props.chainId;
  const isClientWallet = address
    ? address.toLowerCase() === props.clientWalletAddress.toLowerCase()
    : false;

  // Render only when the contract preconditions apply.
  if (!disputeIsActive) return null;
  if (onChainMilestoneStatusCode == null) return null;
  if (!milestoneIsPending) return null;

  return (
    <div className="mt-3 rounded-xl border border-amber-300/35 bg-amber-300/10 p-3 sm:p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-200">
        Resolve stale dispute (client timeout)
      </p>

      <p className="mt-2 text-xs leading-relaxed text-amber-100/85">
        If arbitrator resolution stalls, the client can resolve after the dispute timeout elapses.
      </p>

      {disputeTimeoutReadError ? (
        <p className="mt-2 text-xs text-amber-100/85">{disputeTimeoutReadError}</p>
      ) : null}

      {onChainMilestoneReadError ? (
        <p className="mt-2 text-xs text-amber-100/85">{onChainMilestoneReadError}</p>
      ) : null}

      <p className="mt-2 text-xs text-zinc-300">
        Time until timeout:{" "}
        {secondsUntilDeadline == null ? "Loading..." : `${secondsUntilDeadline}s`}
        {timeoutPassed ? " (ready)" : ""}
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {timeoutPassed ? (
          <Button
            type="button"
            size="sm"
            className="w-full sm:w-auto"
            disabled={phase === "signing" || phase === "pending" || !isClientWallet}
            onClick={async () => {
              setErrorMessage(null);
              setSuccessMessage(null);

              if (!walletClient || !publicClient) return;
              if (!isClientWallet) {
                setErrorMessage("Connect the project client wallet to resolve this dispute.");
                return;
              }
              if (chainMismatch) {
                await switchChainAsync({ chainId: props.chainId });
                return;
              }

              try {
                setPhase("signing");
                const hash = await walletClient.writeContract({
                  address: props.escrowContractAddress,
                  abi: escrowRegistryAbi,
                  functionName: "resolveStaleDisputeByTimeout",
                  args: [
                    BigInt(props.onChainProjectId),
                    BigInt(props.milestoneIndex),
                  ] as const,
                  chain: walletClient.chain,
                  account: walletClient.account,
                });
                setPhase("pending");
                await publicClient.waitForTransactionReceipt({ hash });
                const receipt = await publicClient.getTransactionReceipt({ hash });
                syncTracker.onTxConfirmed(receipt.blockNumber);

                await queryClient.invalidateQueries({ queryKey: ["project", props.projectId] });
                await queryClient.invalidateQueries({ queryKey: ["projects"] });

                // Admin disputes list also depends on dispute/milestone state.
                await queryClient.invalidateQueries({ queryKey: ["admin-disputes"] });
                syncTracker.markUiRefreshed();

                setPhase("success");
                setSuccessMessage("Stale dispute resolved on-chain.");
              } catch (e) {
                setPhase("failure");
                setErrorMessage(
                  formatEscrowRegistryWriteError(e, "Could not resolve stale dispute."),
                );
              }
            }}
          >
            {phase === "signing" || phase === "pending"
              ? "Resolving..."
              : "Resolve stale dispute by timeout"}
          </Button>
        ) : null}
      </div>

      {errorMessage ? <FieldError message={errorMessage} className="mt-2 text-xs" /> : null}
      {successMessage ? (
        <p className="mt-2 text-xs text-emerald-300">{successMessage}</p>
      ) : null}
      <div className="mt-2">
        <SyncStatusNotice
          stage={syncTracker.stage}
          syncStatus={syncTracker.syncStatus}
          syncStatusError={syncTracker.syncStatusError}
          onRefresh={() => {
            void queryClient.invalidateQueries({ queryKey: ["project", props.projectId] });
            void syncTracker.refetchSyncStatus();
          }}
        />
      </div>
    </div>
  );
}

