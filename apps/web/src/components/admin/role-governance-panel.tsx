"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { canonicalDeployment } from "@/lib/contracts/contract-addresses";
import { formatEscrowRegistryWriteError } from "@/lib/contracts/decode-error";
import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";
import {
  ARBITRATOR_ROLE,
  DEFAULT_ADMIN_ROLE,
  PAUSER_ROLE,
  readHasRole,
  useContractRoles,
} from "@/lib/contracts/roles";
import { SyncStatusNotice } from "@/components/sync/sync-status-notice";
import { useSyncReconciliation } from "@/hooks/use-sync-reconciliation";

type RoleChoice = "DEFAULT_ADMIN_ROLE" | "PAUSER_ROLE" | "ARBITRATOR_ROLE";
type IndexedRoleGovernanceState = {
  memberships: {
    DEFAULT_ADMIN_ROLE: `0x${string}`[];
    PAUSER_ROLE: `0x${string}`[];
    ARBITRATOR_ROLE: `0x${string}`[];
  };
  arbitrator: {
    count: number;
    threshold: string | null;
    lastUpdatedBlock: string | null;
    lastUpdatedTxHash: `0x${string}` | null;
  };
  thresholdHistory: Array<{
    previousThreshold: string;
    newThreshold: string;
    updatedBy: `0x${string}` | null;
    txHash: `0x${string}`;
    blockNumber: string;
    logIndex: number;
  }>;
};

const ROLE_VALUES: Record<RoleChoice, `0x${string}`> = {
  DEFAULT_ADMIN_ROLE,
  PAUSER_ROLE,
  ARBITRATOR_ROLE,
};

export function RoleGovernancePanel() {
  const router = useRouter();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: canonicalDeployment.chainId });
  const { data: walletClient } = useWalletClient({ chainId: canonicalDeployment.chainId });
  const { switchChainAsync } = useSwitchChain();
  const roles = useContractRoles({
    chainId: canonicalDeployment.chainId,
    contractAddress: canonicalDeployment.contracts.EscrowFlowRegistry,
  });

  const [roleChoice, setRoleChoice] = useState<RoleChoice>("ARBITRATOR_ROLE");
  const [targetWalletInput, setTargetWalletInput] = useState("");
  const [roleCheckWalletInput, setRoleCheckWalletInput] = useState("");
  const [thresholdInput, setThresholdInput] = useState("");
  const [renounceConfirmInput, setRenounceConfirmInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [arbitratorCount, setArbitratorCount] = useState<bigint | null>(null);
  const [arbitratorThreshold, setArbitratorThreshold] = useState<bigint | null>(null);
  const [roleAdmin, setRoleAdmin] = useState<`0x${string}` | null>(null);
  const [roleMembership, setRoleMembership] = useState<boolean | null>(null);
  const [indexedGovernanceState, setIndexedGovernanceState] = useState<IndexedRoleGovernanceState | null>(null);
  const [targetRoleSnapshot, setTargetRoleSnapshot] = useState<{
    isAdmin: boolean;
    isPauser: boolean;
    isArbitrator: boolean;
  } | null>(null);
  const syncTracker = useSyncReconciliation(true);

  const selectedRole = ROLE_VALUES[roleChoice];
  const normalizedTargetWallet = useMemo(() => {
    const raw = targetWalletInput.trim();
    if (!isAddress(raw)) return null;
    return getAddress(raw) as `0x${string}`;
  }, [targetWalletInput]);
  const normalizedRoleCheckWallet = useMemo(() => {
    const raw = roleCheckWalletInput.trim();
    if (!isAddress(raw)) return null;
    return getAddress(raw) as `0x${string}`;
  }, [roleCheckWalletInput]);

  const canWrite = Boolean(roles.isContractAdmin && walletClient && publicClient);
  const canRenounce = Boolean(address && walletClient && publicClient);
  const renouncePhrase = "RENOUNCE";

  async function ensureChain(): Promise<boolean> {
    if (!walletClient) return false;
    if (walletClient.chain.id !== canonicalDeployment.chainId) {
      await switchChainAsync({ chainId: canonicalDeployment.chainId });
    }
    return true;
  }

  async function refreshStats(): Promise<void> {
    if (!publicClient) return;
    try {
      const [count, threshold, adminRole] = await Promise.all([
        publicClient.readContract({
          address: canonicalDeployment.contracts.EscrowFlowRegistry,
          abi: escrowRegistryAbi,
          functionName: "arbitratorCount",
          args: [],
        }),
        publicClient.readContract({
          address: canonicalDeployment.contracts.EscrowFlowRegistry,
          abi: escrowRegistryAbi,
          functionName: "arbitratorThreshold",
          args: [],
        }),
        publicClient.readContract({
          address: canonicalDeployment.contracts.EscrowFlowRegistry,
          abi: escrowRegistryAbi,
          functionName: "getRoleAdmin",
          args: [selectedRole],
        }),
      ]);
      setArbitratorCount(typeof count === "bigint" ? count : null);
      setArbitratorThreshold(typeof threshold === "bigint" ? threshold : null);
      setRoleAdmin(typeof adminRole === "string" ? (adminRole as `0x${string}`) : null);
    } catch {
      setArbitratorCount(null);
      setArbitratorThreshold(null);
      setRoleAdmin(null);
    }
  }

  async function refreshRoleCheck(): Promise<void> {
    if (!publicClient || !normalizedRoleCheckWallet) {
      setRoleMembership(null);
      setTargetRoleSnapshot(null);
      return;
    }
    try {
      const [selectedHasRole, isAdmin, isPauser, isArbitrator] = await Promise.all([
        readHasRole({
          publicClient,
          contractAddress: canonicalDeployment.contracts.EscrowFlowRegistry,
          role: selectedRole,
          account: normalizedRoleCheckWallet,
        }),
        readHasRole({
          publicClient,
          contractAddress: canonicalDeployment.contracts.EscrowFlowRegistry,
          role: DEFAULT_ADMIN_ROLE,
          account: normalizedRoleCheckWallet,
        }),
        readHasRole({
          publicClient,
          contractAddress: canonicalDeployment.contracts.EscrowFlowRegistry,
          role: PAUSER_ROLE,
          account: normalizedRoleCheckWallet,
        }),
        readHasRole({
          publicClient,
          contractAddress: canonicalDeployment.contracts.EscrowFlowRegistry,
          role: ARBITRATOR_ROLE,
          account: normalizedRoleCheckWallet,
        }),
      ]);
      setRoleMembership(selectedHasRole);
      setTargetRoleSnapshot({ isAdmin, isPauser, isArbitrator });
    } catch {
      setRoleMembership(null);
      setTargetRoleSnapshot(null);
    }
  }

  async function refreshIndexedGovernanceState(): Promise<void> {
    const res = await fetch("/api/v1/admin/role-governance-state", { credentials: "include" });
    if (!res.ok) {
      throw new Error(`Failed to load indexed governance state (${res.status})`);
    }
    const json = (await res.json()) as IndexedRoleGovernanceState;
    setIndexedGovernanceState(json);
  }

  async function writeRoleAction(action: "grantRole" | "revokeRole"): Promise<void> {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!roles.isContractAdmin) {
      setErrorMessage("DEFAULT_ADMIN_ROLE is required.");
      return;
    }
    if (!walletClient || !publicClient || !normalizedTargetWallet) {
      setErrorMessage("Connect wallet and provide a valid target wallet address.");
      return;
    }
    await ensureChain();
    try {
      setBusy(true);
      const hash = await walletClient.writeContract({
        address: canonicalDeployment.contracts.EscrowFlowRegistry,
        abi: escrowRegistryAbi,
        functionName: action,
        args: [selectedRole, normalizedTargetWallet],
        chain: walletClient.chain,
        account: walletClient.account,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const receipt = await publicClient.getTransactionReceipt({ hash });
      syncTracker.onTxConfirmed(receipt.blockNumber);
      await Promise.all([refreshStats(), refreshRoleCheck()]);
      syncTracker.markUiRefreshed();
      setSuccessMessage(
        action === "grantRole"
          ? `Granted ${roleChoice} to ${normalizedTargetWallet}.`
          : `Revoked ${roleChoice} from ${normalizedTargetWallet}.`,
      );
    } catch (error) {
      setErrorMessage(formatEscrowRegistryWriteError(error, `${action} failed.`));
    } finally {
      setBusy(false);
    }
  }

  async function updateThreshold(): Promise<void> {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!roles.isContractAdmin) {
      setErrorMessage("DEFAULT_ADMIN_ROLE is required.");
      return;
    }
    if (!walletClient || !publicClient) {
      setErrorMessage("Connect a wallet on the contract network first.");
      return;
    }
    if (!/^\d+$/.test(thresholdInput.trim())) {
      setErrorMessage("Enter a valid integer threshold.");
      return;
    }
    await ensureChain();
    try {
      setBusy(true);
      const nextThreshold = BigInt(thresholdInput.trim());
      const hash = await walletClient.writeContract({
        address: canonicalDeployment.contracts.EscrowFlowRegistry,
        abi: escrowRegistryAbi,
        functionName: "setArbitratorThreshold",
        args: [nextThreshold],
        chain: walletClient.chain,
        account: walletClient.account,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const receipt = await publicClient.getTransactionReceipt({ hash });
      syncTracker.onTxConfirmed(receipt.blockNumber);
      await refreshStats();
      syncTracker.markUiRefreshed();
      setSuccessMessage(`Arbitrator threshold updated to ${nextThreshold.toString()}.`);
    } catch (error) {
      setErrorMessage(formatEscrowRegistryWriteError(error, "setArbitratorThreshold failed."));
    } finally {
      setBusy(false);
    }
  }

  async function renounceSelectedRole(): Promise<void> {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!walletClient || !publicClient || !address) {
      setErrorMessage("Connect your wallet first.");
      return;
    }
    if (renounceConfirmInput.trim() !== renouncePhrase) {
      setErrorMessage(`Type ${renouncePhrase} to confirm renounceRole.`);
      return;
    }
    await ensureChain();
    try {
      setBusy(true);
      const hash = await walletClient.writeContract({
        address: canonicalDeployment.contracts.EscrowFlowRegistry,
        abi: escrowRegistryAbi,
        functionName: "renounceRole",
        args: [selectedRole, getAddress(address)],
        chain: walletClient.chain,
        account: walletClient.account,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const receipt = await publicClient.getTransactionReceipt({ hash });
      syncTracker.onTxConfirmed(receipt.blockNumber);
      setRenounceConfirmInput("");
      await Promise.all([refreshStats(), refreshRoleCheck()]);
      syncTracker.markUiRefreshed();
      setSuccessMessage(`Renounced ${roleChoice} from connected wallet.`);
    } catch (error) {
      setErrorMessage(formatEscrowRegistryWriteError(error, "renounceRole failed."));
    } finally {
      setBusy(false);
    }
  }

  const roleSeparationWarning =
    targetRoleSnapshot?.isArbitrator && (targetRoleSnapshot.isAdmin || targetRoleSnapshot.isPauser)
      ? "Role separation warning: admin/pauser wallets should not hold ARBITRATOR_ROLE."
      : null;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>On-chain role governance</CardTitle>
        <CardDescription>
          Manage role assignments and arbitrator threshold from DEFAULT_ADMIN_ROLE wallet.
        </CardDescription>
      </CardHeader>
      <div className="space-y-4 px-4 pb-4 sm:px-6 sm:pb-6">
        {!roles.isContractAdmin ? (
          <FieldError message="DEFAULT_ADMIN_ROLE wallet required for governance writes." />
        ) : null}

        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">
            Role + arbitrator state
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-zinc-300 sm:grid-cols-2">
            <p>Arbitrator count: {arbitratorCount === null ? "unknown" : arbitratorCount.toString()}</p>
            <p>Arbitrator threshold: {arbitratorThreshold === null ? "unknown" : arbitratorThreshold.toString()}</p>
            <p className="sm:col-span-2">Selected role admin: {roleAdmin ?? "unknown"}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2 w-full sm:w-auto"
            disabled={!publicClient || busy}
            onClick={() => void refreshStats()}
          >
            Refresh on-chain state
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2 w-full sm:w-auto sm:ml-2"
            disabled={busy}
            onClick={() => void refreshIndexedGovernanceState()}
          >
            Refresh indexed governance state
          </Button>
          {indexedGovernanceState ? (
            <div className="mt-2 text-xs text-zinc-400">
              <p>
                Indexed memberships: admin {indexedGovernanceState.memberships.DEFAULT_ADMIN_ROLE.length},
                pauser {indexedGovernanceState.memberships.PAUSER_ROLE.length}, arbitrator{" "}
                {indexedGovernanceState.memberships.ARBITRATOR_ROLE.length}
              </p>
              <p>
                Indexed threshold: {indexedGovernanceState.arbitrator.threshold ?? "unknown"} (history:{" "}
                {indexedGovernanceState.thresholdHistory.length})
              </p>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Grant/revoke role</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
              value={roleChoice}
              onChange={(event) => setRoleChoice(event.target.value as RoleChoice)}
            >
              <option value="DEFAULT_ADMIN_ROLE">DEFAULT_ADMIN_ROLE</option>
              <option value="PAUSER_ROLE">PAUSER_ROLE</option>
              <option value="ARBITRATOR_ROLE">ARBITRATOR_ROLE</option>
            </select>
            <Input
              placeholder="Target wallet (0x...)"
              value={targetWalletInput}
              onChange={(event) => setTargetWalletInput(event.target.value)}
            />
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            <Button
              type="button"
              size="sm"
              disabled={!canWrite || !normalizedTargetWallet || busy}
              onClick={() => void writeRoleAction("grantRole")}
            >
              Grant role
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!canWrite || !normalizedTargetWallet || busy}
              onClick={() => void writeRoleAction("revokeRole")}
            >
              Revoke role
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">setArbitratorThreshold</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            <Input
              className="sm:max-w-xs"
              placeholder="New threshold (integer)"
              value={thresholdInput}
              onChange={(event) => setThresholdInput(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={!canWrite || !thresholdInput.trim() || busy}
              onClick={() => void updateThreshold()}
            >
              Update threshold
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">hasRole check</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              placeholder="Wallet to check (0x...)"
              value={roleCheckWalletInput}
              onChange={(event) => setRoleCheckWalletInput(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!normalizedRoleCheckWallet || !publicClient || busy}
              onClick={() => void refreshRoleCheck()}
            >
              Check selected role membership
            </Button>
          </div>
          <p className="mt-2 text-xs text-zinc-300">
            hasRole({roleChoice}):{" "}
            {roleMembership === null ? "unknown" : roleMembership ? "yes" : "no"}
          </p>
          {targetRoleSnapshot ? (
            <p className="mt-1 text-xs text-zinc-400">
              Wallet snapshot: admin {targetRoleSnapshot.isAdmin ? "yes" : "no"}, pauser{" "}
              {targetRoleSnapshot.isPauser ? "yes" : "no"}, arbitrator{" "}
              {targetRoleSnapshot.isArbitrator ? "yes" : "no"}
            </p>
          ) : null}
          {roleSeparationWarning ? <FieldError className="mt-2 text-xs" message={roleSeparationWarning} /> : null}
        </div>

        <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-100">
            Optional renounceRole (current wallet)
          </p>
          <p className="mt-1 text-xs text-amber-100/90">
            Irreversible action. Type {renouncePhrase} to confirm before renouncing selected role.
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            <Input
              className="sm:max-w-xs"
              placeholder={`Type ${renouncePhrase}`}
              value={renounceConfirmInput}
              onChange={(event) => setRenounceConfirmInput(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!canRenounce || busy}
              onClick={() => void renounceSelectedRole()}
            >
              Renounce selected role
            </Button>
          </div>
        </div>

        {roles.warnings.map((warning) => (
          <FieldError key={warning} message={warning} />
        ))}
        <SyncStatusNotice
          stage={syncTracker.stage}
          syncStatus={syncTracker.syncStatus}
          syncStatusError={syncTracker.syncStatusError}
          onRefresh={() => {
            void refreshStats();
            void refreshRoleCheck();
            void refreshIndexedGovernanceState();
            void syncTracker.refetchSyncStatus();
          }}
        />
        {errorMessage ? <FieldError message={errorMessage} /> : null}
        {successMessage ? <p className="text-xs text-emerald-300">{successMessage}</p> : null}

        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={() => router.push("/dashboard")}
          >
            Back to dashboard
          </Button>
        </div>
      </div>
    </Card>
  );
}
