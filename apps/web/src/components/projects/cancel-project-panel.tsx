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

type MilestonePreflight = {
  index: number;
  title: string;
  // Contract milestone status codes: 0 Pending, 1 Submitted, 2 Approved, 3 Released, 4 Refunded.
  statusCode: bigint;
  reviewEnteredAt: bigint;
  // Dispute state from getDispute().
  disputeActive: boolean;
  disputeRaisedAt: bigint;
};

const CANCEL_WARNING_COPY =
  "Canceling this project will refund pending milestones to the client, and release only stale submitted milestones to the freelancer. Approved milestones cannot be cancelled. If any dispute is active, cancellation will be blocked unless it is an eligible stale pending case. Do you want to proceed?";

const STATUS_PENDING = 0n;
const STATUS_SUBMITTED = 1n;
const STATUS_APPROVED = 2n;

function isStale(timeoutBaseUnixSeconds: bigint, cancelTimeoutSeconds: bigint, nowUnixSeconds: number): boolean {
  return BigInt(nowUnixSeconds) >= timeoutBaseUnixSeconds + cancelTimeoutSeconds;
}

function asBigIntLoose(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new Error("Invalid bigint-like value");
}

export function CancelProjectPanel(props: {
  projectId: string;
  chainId: number;
  escrowContractAddress: `0x${string}`;
  onChainProjectId: string;
  clientWalletAddress: string;
  projectStatus: string;
  milestones: Array<{ id: string; sortOrder: number; title: string; status: string }>;
}) {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const activeChainId = useChainId();
  const publicClient = usePublicClient({ chainId: props.chainId });
  const { data: walletClient } = useWalletClient({ chainId: props.chainId });
  const { switchChainAsync } = useSwitchChain();

  const [nowUnixSeconds, setNowUnixSeconds] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "signing" | "success" | "failure">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const syncTracker = useSyncReconciliation(true);

  const isClientWallet = useMemo(() => {
    return address
      ? address.toLowerCase() === props.clientWalletAddress.toLowerCase()
      : false;
  }, [address, props.clientWalletAddress]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowUnixSeconds(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const [cancelTimeoutSeconds, setCancelTimeoutSeconds] = useState<bigint | null>(null);
  const [preflight, setPreflight] = useState<MilestonePreflight[] | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  async function refreshPreflight(): Promise<void> {
    if (!publicClient || !props.escrowContractAddress) return;
    setPhase("loading");
    setPreflightError(null);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const cancelTimeout = await publicClient.readContract({
        address: props.escrowContractAddress,
        abi: escrowRegistryAbi,
        functionName: "CANCEL_TIMEOUT",
      });
      const cancelTimeoutBig = BigInt(cancelTimeout as unknown as bigint);
      setCancelTimeoutSeconds(cancelTimeoutBig);

      const projectId = BigInt(props.onChainProjectId);
      const indices = props.milestones.map((m) => m.sortOrder);

      const tuples = await Promise.all(
        indices.map(async (index) => {
          const milestone = await publicClient.readContract({
            address: props.escrowContractAddress,
            abi: escrowRegistryAbi,
            functionName: "getMilestone",
            args: [projectId, BigInt(index)],
          });
          const dispute = await publicClient.readContract({
            address: props.escrowContractAddress,
            abi: escrowRegistryAbi,
            functionName: "getDispute",
            args: [projectId, BigInt(index)],
          });

          // getMilestone returns struct:
          // (amount, deadline, reviewEnteredAt, status, submissionURI)
          const milestoneStatus = Array.isArray(milestone)
            ? milestone[3]
            : (milestone as { status?: unknown }).status;
          const statusCode = asBigIntLoose(milestoneStatus);

          const milestoneReviewEnteredAt = Array.isArray(milestone)
            ? milestone[2]
            : (milestone as { reviewEnteredAt?: unknown }).reviewEnteredAt;
          const reviewEnteredAt = asBigIntLoose(milestoneReviewEnteredAt);

          // getDispute returns (active, raisedBy, raisedAt, reasonURI, lastAppendedEvidenceURI)
          const disputeActiveRaw = Array.isArray(dispute)
            ? dispute[0]
            : (dispute as { active?: unknown }).active;
          const disputeActive = Boolean(disputeActiveRaw);

          const disputeRaisedAtRaw = Array.isArray(dispute) ? dispute[2] : (dispute as { raisedAt?: unknown }).raisedAt;
          const disputeRaisedAt = asBigIntLoose(disputeRaisedAtRaw);

          const milestoneMeta = props.milestones.find((m) => m.sortOrder === index);
          return {
            index,
            title: milestoneMeta?.title ?? `Milestone ${index + 1}`,
            statusCode,
            reviewEnteredAt,
            disputeActive,
            disputeRaisedAt,
          } satisfies MilestonePreflight;
        }),
      );

      setPreflight(tuples);
      setPhase("ready");
    } catch (e) {
      setPreflightError(formatEscrowRegistryWriteError(e, "Could not load cancellation preflight."));
      setPreflight(null);
      setPhase("failure");
    }
  }

  useEffect(() => {
    void refreshPreflight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.chainId, props.escrowContractAddress, props.onChainProjectId]);

  const eligible = useMemo(() => {
    if (!preflight || cancelTimeoutSeconds == null) return false;
    if (!isClientWallet) return false;
    // cancelProject reverts if project status is Completed/Cancelled.
    if (props.projectStatus === "COMPLETED" || props.projectStatus === "CANCELLED") return false;

    const approvedBlock = preflight.some((m) => m.statusCode === STATUS_APPROVED);
    if (approvedBlock) return false;

    const submittedBlocks = preflight.some((m) => {
      if (m.statusCode !== STATUS_SUBMITTED) return false;
      // contract: reviewEnteredAt must be non-zero and now >= reviewEnteredAt + CANCEL_TIMEOUT
      if (m.reviewEnteredAt === 0n) return true;
      const stale = isStale(m.reviewEnteredAt, cancelTimeoutSeconds, nowUnixSeconds);
      return !stale;
    });
    if (submittedBlocks) return false;

    const disputeBlocks = preflight.some((m) => {
      if (!m.disputeActive) return false;
      if (m.statusCode !== STATUS_PENDING) return true;
      // if pending dispute isn't stale pending, contract reverts.
      const stale = isStale(m.disputeRaisedAt, cancelTimeoutSeconds, nowUnixSeconds);
      return !stale;
    });
    if (disputeBlocks) return false;

    return true;
  }, [cancelTimeoutSeconds, isClientWallet, nowUnixSeconds, preflight, props.projectStatus]);

  const pendingRefunds = useMemo(() => {
    if (!preflight) return [];
    return preflight.filter((m) => m.statusCode === STATUS_PENDING);
  }, [preflight]);

  const staleSubmittedReleases = useMemo(() => {
    if (!preflight || cancelTimeoutSeconds == null) return [];
    return preflight.filter((m) => {
      if (m.statusCode !== STATUS_SUBMITTED) return false;
      if (m.disputeActive) return false;
      if (m.reviewEnteredAt === 0n) return false;
      return isStale(m.reviewEnteredAt, cancelTimeoutSeconds, nowUnixSeconds);
    });
  }, [cancelTimeoutSeconds, nowUnixSeconds, preflight]);

  const approvedBlockers = useMemo(() => {
    if (!preflight) return [];
    return preflight.filter((m) => m.statusCode === STATUS_APPROVED);
  }, [preflight]);

  const activeDisputeBlockers = useMemo(() => {
    if (!preflight || cancelTimeoutSeconds == null) return [];
    return preflight.filter((m) => {
      if (!m.disputeActive) return false;
      if (m.statusCode !== STATUS_PENDING) return true;
      const stale = isStale(m.disputeRaisedAt, cancelTimeoutSeconds, nowUnixSeconds);
      return !stale;
    });
  }, [cancelTimeoutSeconds, nowUnixSeconds, preflight]);

  if (!props.projectStatus) return null;

  return (
    <div className="mt-4 rounded-xl border border-cyan-300/30 bg-cyan-300/10 p-3 sm:p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">
        Cancel project (contract-backed)
      </p>
      <p className="mt-2 text-xs leading-relaxed text-cyan-100/85">
        This will call <code>cancelProject</code> on the chain and then refresh app state. Preflight is
        derived from on-chain milestone/dispute state.
      </p>

      <div className="mt-3 space-y-2 text-xs text-zinc-300">
        <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/40 px-3 py-2">
          <p className="font-semibold text-zinc-200">Pending milestones refunded to client</p>
          <p className="mt-1 text-zinc-400">
            {preflight
              ? pendingRefunds.length > 0
                ? `${pendingRefunds.length} milestone(s): ${pendingRefunds.map((m) => m.title).join(", ")}`
                : "None"
              : "Loading…"}
          </p>
        </div>

        <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/40 px-3 py-2">
          <p className="font-semibold text-zinc-200">Stale submitted milestones released to freelancer</p>
          <p className="mt-1 text-zinc-400">
            {preflight
              ? staleSubmittedReleases.length > 0
                ? `${staleSubmittedReleases.length} milestone(s): ${staleSubmittedReleases
                    .map((m) => m.title)
                    .join(", ")}`
                : "None"
              : "Loading…"}
          </p>
        </div>

        <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/40 px-3 py-2">
          <p className="font-semibold text-zinc-200">Approved milestones block cancellation</p>
          <p className="mt-1 text-zinc-400">
            {preflight
              ? approvedBlockers.length > 0
                ? `${approvedBlockers.length} milestone(s): ${approvedBlockers.map((m) => m.title).join(", ")}`
                : "None"
              : "Loading…"}
          </p>
        </div>

        <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/40 px-3 py-2">
          <p className="font-semibold text-zinc-200">Active disputes block cancellation (except stale pending)</p>
          <p className="mt-1 text-zinc-400">
            {preflight
              ? activeDisputeBlockers.length > 0
                ? `${activeDisputeBlockers.length} milestone(s): ${activeDisputeBlockers
                    .map((m) => m.title)
                    .join(", ")}`
                : "None"
              : "Loading…"}
          </p>
        </div>

        {preflightError ? (
          <div className="rounded-lg border border-amber-300/35 bg-amber-300/10 px-3 py-2">
            <p className="text-amber-100 text-xs">{preflightError}</p>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          size="sm"
          className="w-full sm:w-auto"
          disabled={phase === "loading" || phase === "signing" || !eligible || activeChainId !== props.chainId}
          onClick={() => setIsConfirmOpen(true)}
        >
          Cancel project on-chain
        </Button>
        {activeChainId !== props.chainId ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={() => void switchChainAsync({ chainId: props.chainId })}
          >
            Switch network
          </Button>
        ) : null}
      </div>

      {isConfirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-zinc-800/90 bg-zinc-950 p-4 shadow-xl">
            <p className="text-sm font-semibold text-zinc-100">Confirm project cancellation</p>
            <p className="mt-2 text-xs leading-relaxed text-zinc-300">
              {CANCEL_WARNING_COPY}
            </p>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                disabled={phase === "signing"}
                onClick={() => setIsConfirmOpen(false)}
              >
                Keep project
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={phase === "signing" || !walletClient}
                onClick={async () => {
                  setErrorMessage(null);
                  setSuccessMessage(null);
                  if (!walletClient || !publicClient) return;
                  if (activeChainId !== props.chainId) {
                    await switchChainAsync({ chainId: props.chainId });
                    return;
                  }

                  try {
                    setPhase("signing");
                    const hash = await walletClient.writeContract({
                      address: props.escrowContractAddress,
                      abi: escrowRegistryAbi,
                      functionName: "cancelProject",
                      args: [BigInt(props.onChainProjectId)] as const,
                      chain: walletClient.chain,
                      account: walletClient.account,
                    });
                    setPhase("signing");
                    await publicClient.waitForTransactionReceipt({ hash });
                    const receipt = await publicClient.getTransactionReceipt({ hash });
                    syncTracker.onTxConfirmed(receipt.blockNumber);

                    await queryClient.invalidateQueries({
                      queryKey: ["project", props.projectId],
                    });
                    await queryClient.invalidateQueries({ queryKey: ["projects"] });
                    await queryClient.invalidateQueries({ queryKey: ["admin-disputes"] });
                    syncTracker.markUiRefreshed();

                    setPhase("success");
                    setSuccessMessage("Project canceled on-chain and synced in app state.");
                    setIsConfirmOpen(false);
                  } catch (e) {
                    setPhase("failure");
                    setErrorMessage(
                      formatEscrowRegistryWriteError(e, "Could not cancel project on-chain."),
                    );
                  }
                }}
              >
                Confirm cancellation
              </Button>
            </div>

            {errorMessage ? <FieldError message={errorMessage} className="mt-3 text-xs" /> : null}
            {successMessage ? (
              <p className="mt-3 text-xs text-emerald-300">{successMessage}</p>
            ) : null}
            <div className="mt-3">
              <SyncStatusNotice
                stage={syncTracker.stage}
                syncStatus={syncTracker.syncStatus}
                syncStatusError={syncTracker.syncStatusError}
                onRefresh={() => {
                  void refreshPreflight();
                  void queryClient.invalidateQueries({ queryKey: ["project", props.projectId] });
                  void syncTracker.refetchSyncStatus();
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

