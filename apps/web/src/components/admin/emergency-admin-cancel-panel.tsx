"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePublicClient, useSwitchChain, useWalletClient } from "wagmi";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { canonicalDeployment } from "@/lib/contracts/contract-addresses";
import { formatEscrowRegistryWriteError } from "@/lib/contracts/decode-error";
import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";
import { useContractRoles } from "@/lib/contracts/roles";
import { SyncStatusNotice } from "@/components/sync/sync-status-notice";
import { useSyncReconciliation } from "@/hooks/use-sync-reconciliation";

type PreflightResult = {
  projectStatusCode: number;
  submittedMilestones: number[];
  approvedMilestones: number[];
  activeDisputeMilestones: number[];
};

const CONFIRM_PHRASE = "EMERGENCY CANCEL";

export function evaluateEmergencyAdminCancelPreflight(input: PreflightResult): {
  canExecute: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (input.projectStatusCode !== 0) {
    reasons.push("Project is not Active on-chain.");
  }
  if (input.activeDisputeMilestones.length > 0) {
    reasons.push(
      `Active disputes on milestone(s): ${input.activeDisputeMilestones.join(", ")}.`,
    );
  }
  if (input.submittedMilestones.length > 0) {
    reasons.push(
      `Submitted milestone(s) block emergency cancel: ${input.submittedMilestones.join(", ")}.`,
    );
  }
  if (input.approvedMilestones.length > 0) {
    reasons.push(
      `Approved milestone(s) block emergency cancel: ${input.approvedMilestones.join(", ")}.`,
    );
  }
  return {
    canExecute: reasons.length === 0,
    reasons,
  };
}

export function EmergencyAdminCancelPanel() {
  const queryClient = useQueryClient();
  const publicClient = usePublicClient({ chainId: canonicalDeployment.chainId });
  const { data: walletClient } = useWalletClient({ chainId: canonicalDeployment.chainId });
  const { switchChainAsync } = useSwitchChain();
  const roles = useContractRoles({
    chainId: canonicalDeployment.chainId,
    contractAddress: canonicalDeployment.contracts.EscrowFlowRegistry,
  });
  const syncTracker = useSyncReconciliation(true);

  const [projectIdInput, setProjectIdInput] = useState("");
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [warningOpen, setWarningOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const parsedProjectId = useMemo(() => {
    const trimmed = projectIdInput.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    return BigInt(trimmed);
  }, [projectIdInput]);

  const preflightDecision = preflight
    ? evaluateEmergencyAdminCancelPreflight(preflight)
    : null;

  async function ensureChain(): Promise<boolean> {
    if (!walletClient) return false;
    if (walletClient.chain.id !== canonicalDeployment.chainId) {
      await switchChainAsync({ chainId: canonicalDeployment.chainId });
    }
    return true;
  }

  async function runPreflight(): Promise<void> {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!publicClient || parsedProjectId === null) {
      setErrorMessage("Enter a valid project id and connect an admin wallet.");
      return;
    }
    try {
      const project = await publicClient.readContract({
        address: canonicalDeployment.contracts.EscrowFlowRegistry,
        abi: escrowRegistryAbi,
        functionName: "getProject",
        args: [parsedProjectId],
      });
      const milestoneCount = Number(project.milestoneCount);
      const indices = Array.from({ length: milestoneCount }, (_, idx) => idx);
      const milestoneAndDispute = await Promise.all(
        indices.map(async (index) => {
          const [milestone, dispute] = await Promise.all([
            publicClient.readContract({
              address: canonicalDeployment.contracts.EscrowFlowRegistry,
              abi: escrowRegistryAbi,
              functionName: "getMilestone",
              args: [parsedProjectId, BigInt(index)],
            }),
            publicClient.readContract({
              address: canonicalDeployment.contracts.EscrowFlowRegistry,
              abi: escrowRegistryAbi,
              functionName: "getDispute",
              args: [parsedProjectId, BigInt(index)],
            }),
          ]);
          return { index, milestoneStatus: Number(milestone.status), disputeActive: Boolean(dispute[0]) };
        }),
      );
      const submittedMilestones = milestoneAndDispute
        .filter((row) => row.milestoneStatus === 1)
        .map((row) => row.index);
      const approvedMilestones = milestoneAndDispute
        .filter((row) => row.milestoneStatus === 2)
        .map((row) => row.index);
      const activeDisputeMilestones = milestoneAndDispute
        .filter((row) => row.disputeActive)
        .map((row) => row.index);
      setPreflight({
        projectStatusCode: Number(project.status),
        submittedMilestones,
        approvedMilestones,
        activeDisputeMilestones,
      });
    } catch (error) {
      setPreflight(null);
      setErrorMessage(formatEscrowRegistryWriteError(error, "Could not run emergency cancel preflight."));
    }
  }

  async function executeEmergencyAdminCancel(): Promise<void> {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!roles.isContractAdmin) {
      setErrorMessage("DEFAULT_ADMIN_ROLE is required.");
      return;
    }
    if (!walletClient || !publicClient || parsedProjectId === null) {
      setErrorMessage("Connect admin wallet and provide a valid project id.");
      return;
    }
    if (confirmInput.trim() !== CONFIRM_PHRASE) {
      setErrorMessage(`Type "${CONFIRM_PHRASE}" to confirm.`);
      return;
    }
    await ensureChain();
    await runPreflight();
    if (preflightDecision && !preflightDecision.canExecute) {
      setErrorMessage("Preflight failed. Resolve blockers before emergency admin cancel.");
      return;
    }

    try {
      setBusy(true);
      const hash = await walletClient.writeContract({
        address: canonicalDeployment.contracts.EscrowFlowRegistry,
        abi: escrowRegistryAbi,
        functionName: "emergencyAdminCancel",
        args: [parsedProjectId],
        chain: walletClient.chain,
        account: walletClient.account,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const receipt = await publicClient.getTransactionReceipt({ hash });
      syncTracker.onTxConfirmed(receipt.blockNumber);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["project"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-disputes"] }),
      ]);
      syncTracker.markUiRefreshed();
      setSuccessMessage("Emergency admin cancellation executed and sync refresh triggered.");
      setWarningOpen(false);
      setConfirmInput("");
    } catch (error) {
      setErrorMessage(formatEscrowRegistryWriteError(error, "emergencyAdminCancel failed."));
    } finally {
      setBusy(false);
    }
  }

  if (!roles.isContractAdmin) return null;

  return (
    <div className="rounded-xl border border-red-300/35 bg-red-300/10 p-3 sm:p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-red-100">
        Emergency admin cancel
      </p>
      <p className="mt-1 text-xs text-red-100/90">
        Dangerous operation. Only use for production incident mitigation.
      </p>

      <div className="mt-3 space-y-2">
        <Input
          placeholder="On-chain project id"
          inputMode="numeric"
          value={projectIdInput}
          onChange={(event) => setProjectIdInput(event.target.value)}
          disabled={busy}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full sm:w-auto"
            disabled={parsedProjectId === null || busy}
            onClick={() => void runPreflight()}
          >
            Run preflight
          </Button>
          <Button
            type="button"
            size="sm"
            className="w-full sm:w-auto"
            disabled={parsedProjectId === null || busy}
            onClick={() => setWarningOpen(true)}
          >
            Open emergency cancel
          </Button>
        </div>
      </div>

      {preflight ? (
        <div className="mt-3 rounded-lg border border-red-300/30 bg-red-950/35 p-3 text-xs text-red-100">
          <p>Project status code: {preflight.projectStatusCode}</p>
          <p>Submitted milestones: {preflight.submittedMilestones.length ? preflight.submittedMilestones.join(", ") : "none"}</p>
          <p>Approved milestones: {preflight.approvedMilestones.length ? preflight.approvedMilestones.join(", ") : "none"}</p>
          <p>Active disputes: {preflight.activeDisputeMilestones.length ? preflight.activeDisputeMilestones.join(", ") : "none"}</p>
          {preflightDecision && !preflightDecision.canExecute ? (
            <div className="mt-2">
              {preflightDecision.reasons.map((reason) => (
                <p key={reason}>- {reason}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <SyncStatusNotice
        stage={syncTracker.stage}
        syncStatus={syncTracker.syncStatus}
        syncStatusError={syncTracker.syncStatusError}
        onRefresh={() => {
          void runPreflight();
          void syncTracker.refetchSyncStatus();
        }}
      />

      {errorMessage ? <FieldError message={errorMessage} className="mt-2 text-xs" /> : null}
      {successMessage ? <p className="mt-2 text-xs text-emerald-200">{successMessage}</p> : null}

      {warningOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-red-300/35 bg-zinc-950 p-4">
            <p className="text-sm font-semibold text-red-100">Confirm emergency admin cancel</p>
            <p className="mt-2 text-xs text-red-100/90">
              This action can force-cancel a project and move funds according to contract emergency rules.
              It is irreversible and should be used only in incident response.
            </p>
            <p className="mt-2 text-xs text-red-100/90">
              Type <span className="font-semibold">{CONFIRM_PHRASE}</span> to continue.
            </p>
            <Input
              className="mt-2"
              value={confirmInput}
              onChange={(event) => setConfirmInput(event.target.value)}
              disabled={busy}
            />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                disabled={busy}
                onClick={() => setWarningOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={busy}
                onClick={() => void executeEmergencyAdminCancel()}
              >
                Execute emergencyAdminCancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
