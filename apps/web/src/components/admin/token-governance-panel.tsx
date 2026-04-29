"use client";

import { useCallback, useMemo, useState } from "react";
import { getAddress, isAddress } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { canonicalDeployment } from "@/lib/contracts/contract-addresses";
import { formatEscrowRegistryWriteError } from "@/lib/contracts/decode-error";
import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";
import { useContractRoles } from "@/lib/contracts/roles";
import { SyncStatusNotice } from "@/components/sync/sync-status-notice";
import { useSyncReconciliation } from "@/hooks/use-sync-reconciliation";

type IndexedTokenGovernanceState = {
  token: `0x${string}`;
  reviewed: boolean;
  allowed: boolean;
  reviewedBy: `0x${string}` | null;
  lastUpdatedTxHash: `0x${string}` | null;
  lastUpdatedBlock: string | null;
};

export function TokenGovernancePanel() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: canonicalDeployment.chainId });
  const { data: walletClient } = useWalletClient({ chainId: canonicalDeployment.chainId });
  const { switchChainAsync } = useSwitchChain();
  const roles = useContractRoles({
    chainId: canonicalDeployment.chainId,
    contractAddress: canonicalDeployment.contracts.EscrowFlowRegistry,
  });

  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowedState, setAllowedState] = useState<boolean | null>(null);
  const [attestedThisSession, setAttestedThisSession] = useState(false);
  const [indexedState, setIndexedState] = useState<IndexedTokenGovernanceState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const syncTracker = useSyncReconciliation(true);

  const normalizedToken = useMemo(() => {
    const raw = tokenInput.trim();
    if (!isAddress(raw)) return null;
    return getAddress(raw) as `0x${string}`;
  }, [tokenInput]);

  const canAdmin = roles.isContractAdmin;
  const canInteract =
    canAdmin && Boolean(walletClient && publicClient && address && normalizedToken);

  const refreshAllowedState = useCallback(async () => {
    if (!publicClient || !normalizedToken) {
      setAllowedState(null);
      return;
    }
    try {
      const next = await publicClient.readContract({
        address: canonicalDeployment.contracts.EscrowFlowRegistry,
        abi: escrowRegistryAbi,
        functionName: "isAllowedToken",
        args: [normalizedToken],
      });
      setAllowedState(Boolean(next));
    } catch {
      setAllowedState(null);
    }
  }, [normalizedToken, publicClient]);

  const refreshIndexedState = useCallback(async () => {
    if (!normalizedToken) {
      setIndexedState(null);
      return;
    }
    const res = await fetch(`/api/v1/admin/token-governance-state?token=${normalizedToken}`, {
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error(`Failed to load indexed token state (${res.status})`);
    }
    const json = (await res.json()) as IndexedTokenGovernanceState;
    setIndexedState(json);
  }, [normalizedToken]);

  async function attestToken(): Promise<void> {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!canAdmin) {
      setErrorMessage("DEFAULT_ADMIN_ROLE is required.");
      return;
    }
    if (!walletClient || !publicClient || !normalizedToken) {
      setErrorMessage("Enter a valid token and connect an admin wallet first.");
      return;
    }
    if (walletClient.chain.id !== canonicalDeployment.chainId) {
      await switchChainAsync({ chainId: canonicalDeployment.chainId });
    }

    try {
      setBusy(true);
      const hash = await walletClient.writeContract({
        address: canonicalDeployment.contracts.EscrowFlowRegistry,
        abi: escrowRegistryAbi,
        functionName: "attestTokenReviewForAllowlist",
        args: [normalizedToken],
        chain: walletClient.chain,
        account: walletClient.account,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const receipt = await publicClient.getTransactionReceipt({ hash });
      syncTracker.onTxConfirmed(receipt.blockNumber);
      setAttestedThisSession(true);
      await refreshIndexedState();
      syncTracker.markUiRefreshed();
      setSuccessMessage("Token review attested. You can now allowlist this token.");
    } catch (error) {
      setErrorMessage(formatEscrowRegistryWriteError(error, "Token attestation failed."));
    } finally {
      setBusy(false);
    }
  }

  async function setAllowed(allowed: boolean): Promise<void> {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!canAdmin) {
      setErrorMessage("DEFAULT_ADMIN_ROLE is required.");
      return;
    }
    if (!walletClient || !publicClient || !normalizedToken) {
      setErrorMessage("Enter a valid token and connect an admin wallet first.");
      return;
    }
    if (walletClient.chain.id !== canonicalDeployment.chainId) {
      await switchChainAsync({ chainId: canonicalDeployment.chainId });
    }

    try {
      setBusy(true);
      const hash = await walletClient.writeContract({
        address: canonicalDeployment.contracts.EscrowFlowRegistry,
        abi: escrowRegistryAbi,
        functionName: "setAllowedToken",
        args: [normalizedToken, allowed],
        chain: walletClient.chain,
        account: walletClient.account,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const receipt = await publicClient.getTransactionReceipt({ hash });
      syncTracker.onTxConfirmed(receipt.blockNumber);
      await refreshAllowedState();
      await refreshIndexedState();
      syncTracker.markUiRefreshed();
      setSuccessMessage(allowed ? "Token allowlisted." : "Token removed from allowlist.");
    } catch (error) {
      setErrorMessage(formatEscrowRegistryWriteError(error, "Allowlist update failed."));
    } finally {
      setBusy(false);
    }
  }

  if (!canAdmin) return null;

  return (
    <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/50 p-3 sm:p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">
        Token governance
      </p>
      <p className="mt-1 text-xs text-zinc-300">
        Step 1 attest token review, then Step 2 allowlist or remove from allowlist.
      </p>

      <div className="mt-3 space-y-2">
        <label className="text-xs font-medium text-zinc-200" htmlFor="token-governance-address">
          Token address
        </label>
        <input
          id="token-governance-address"
          className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-offset-zinc-950 placeholder:text-zinc-500 focus-visible:ring-2 focus-visible:ring-cyan-300/50"
          placeholder="0x..."
          value={tokenInput}
          onChange={(e) => {
            setTokenInput(e.target.value);
            setAttestedThisSession(false);
            setAllowedState(null);
            setIndexedState(null);
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="w-full sm:w-auto"
          disabled={!normalizedToken || busy}
          onClick={() => void refreshAllowedState()}
        >
          Check isAllowedToken
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="w-full sm:w-auto"
          disabled={!normalizedToken || busy}
          onClick={() => void refreshIndexedState()}
        >
          Check indexed governance state
        </Button>
        <p className="text-xs text-zinc-400">
          Current allowlist state:{" "}
          {allowedState === null ? "unknown (run check)" : allowedState ? "allowed" : "not allowed"}
        </p>
        <p className="text-xs text-zinc-400">
          Indexed state:{" "}
          {indexedState
            ? `reviewed=${indexedState.reviewed ? "yes" : "no"}, allowed=${indexedState.allowed ? "yes" : "no"}`
            : "unknown (run indexed check)"}
        </p>
        {indexedState?.reviewedBy ? (
          <p className="text-xs text-zinc-500">Reviewed by: {indexedState.reviewedBy}</p>
        ) : null}
        {attestedThisSession ? (
          <p className="text-xs text-emerald-300">Review attested in this session.</p>
        ) : null}
      </div>

      <div className="mt-3 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-100">
        <p className="font-medium">Exact-transfer compatibility warning</p>
        <p className="mt-1">
          Avoid fee-on-transfer, rebasing, blacklistable, or balance-manipulating tokens. Exact
          transfer checks can fail and block funding/payout flows.
        </p>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        <Button
          type="button"
          size="sm"
          className="w-full sm:w-auto"
          disabled={!canInteract || busy}
          onClick={() => void attestToken()}
        >
          Step 1: attestTokenReviewForAllowlist
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="w-full sm:w-auto"
          disabled={!canInteract || busy}
          onClick={() => void setAllowed(true)}
        >
          Step 2: setAllowedToken(true)
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="w-full sm:w-auto"
          disabled={!canInteract || busy}
          onClick={() => void setAllowed(false)}
        >
          setAllowedToken(false)
        </Button>
      </div>
      <div className="mt-2">
        <SyncStatusNotice
          stage={syncTracker.stage}
          syncStatus={syncTracker.syncStatus}
          syncStatusError={syncTracker.syncStatusError}
          onRefresh={() => {
            void refreshAllowedState();
            void refreshIndexedState();
            void syncTracker.refetchSyncStatus();
          }}
        />
      </div>

      {errorMessage ? <FieldError message={errorMessage} className="mt-2 text-xs" /> : null}
      {successMessage ? <p className="mt-2 text-xs text-emerald-300">{successMessage}</p> : null}
    </div>
  );
}
