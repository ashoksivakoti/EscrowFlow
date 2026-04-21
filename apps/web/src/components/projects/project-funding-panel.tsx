"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
} from "wagmi";

import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi";
import { estimateCappedWriteGas } from "@/lib/contracts/safe-write-gas";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";

type FundingPanelProps = {
  projectId: string;
  chainId: number;
  escrowContractAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  onChainProjectId: string;
  totalValueWei: string;
  projectTitle: string;
};

type FundingPhase =
  | "idle"
  | "approve_signing"
  | "approve_pending"
  | "approve_success"
  | "fund_signing"
  | "fund_pending"
  | "fund_success"
  | "failure";

type OnChainFundingState = {
  decimals: number;
  fundedWei: bigint;
  totalWei: bigint;
  allowanceWei: bigint;
  balanceWei: bigint;
};

function clampPositiveDecimal(input: string): string {
  return input.trim();
}

function formatReadContractError(error: unknown): string {
  if (error instanceof Error) {
    const m = error.message;
    if (/failed to fetch|networkerror|load failed/i.test(m)) {
      return `${m} If you use a local node, start it (e.g. Hardhat on http://127.0.0.1:8545) and ensure your wallet uses the same chain.`;
    }
    return m;
  }
  return "Unknown error reading chain state.";
}

/** Human-readable hint when chain reads are unavailable (assumes 18 decimals). */
function formatTotalWeiHint(wei: string): string | null {
  const w = wei.trim();
  if (!/^\d+$/.test(w)) {
    return null;
  }
  try {
    return `${formatUnits(BigInt(w), 18)} tokens (off-chain total; shown with 18 decimals until chain loads)`;
  } catch {
    return null;
  }
}

export function ProjectFundingPanel(props: FundingPanelProps) {
  const queryClient = useQueryClient();
  const chainId = useChainId();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: props.chainId });
  const { data: walletClient } = useWalletClient({ chainId: props.chainId });
  const { switchChainAsync } = useSwitchChain();

  const [phase, setPhase] = useState<FundingPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [onChain, setOnChain] = useState<OnChainFundingState | null>(null);
  const [onChainReadError, setOnChainReadError] = useState<string | null>(null);

  const chainMismatch = chainId !== props.chainId;
  const onChainProjectId = BigInt(props.onChainProjectId);

  async function refreshOnChainState(): Promise<void> {
    if (!publicClient || !address) {
      setOnChain(null);
      setOnChainReadError(null);
      return;
    }
    try {
      const [projectTuple, decimals, allowance, balance] = await Promise.all([
        publicClient.readContract({
          address: props.escrowContractAddress,
          abi: escrowRegistryAbi,
          functionName: "getProject",
          args: [onChainProjectId],
        }),
        publicClient.readContract({
          address: props.tokenAddress,
          abi: erc20Abi,
          functionName: "decimals",
        }),
        publicClient.readContract({
          address: props.tokenAddress,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, props.escrowContractAddress],
        }),
        publicClient.readContract({
          address: props.tokenAddress,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
      ]);

      const totalWei = BigInt(projectTuple.totalAmount);
      const fundedWei = BigInt(projectTuple.fundedAmount);

      setOnChain({
        decimals: Number(decimals),
        totalWei,
        fundedWei,
        allowanceWei: BigInt(allowance),
        balanceWei: BigInt(balance),
      });
      setOnChainReadError(null);
    } catch (error) {
      setOnChain(null);
      setOnChainReadError(formatReadContractError(error));
    }
  }

  useEffect(() => {
    void refreshOnChainState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, props.chainId, props.escrowContractAddress, props.tokenAddress, props.onChainProjectId]);

  const derived = useMemo(() => {
    if (!onChain) {
      return {
        remainingWei: 0n,
        amountWei: 0n,
        allowanceEnough: false,
        parseError: null as string | null,
      };
    }
    const remainingWei =
      onChain.totalWei > onChain.fundedWei ? onChain.totalWei - onChain.fundedWei : 0n;
    const normalized = clampPositiveDecimal(amountInput);
    if (!normalized) {
      return {
        remainingWei,
        amountWei: 0n,
        allowanceEnough: false,
        parseError: null,
      };
    }
    try {
      const amountWei = parseUnits(normalized, onChain.decimals);
      const allowanceEnough = onChain.allowanceWei >= amountWei;
      return { remainingWei, amountWei, allowanceEnough, parseError: null };
    } catch {
      return {
        remainingWei,
        amountWei: 0n,
        allowanceEnough: false,
        parseError: "Enter a valid number for token amount",
      };
    }
  }, [amountInput, onChain]);

  const isBusy =
    phase === "approve_signing" ||
    phase === "approve_pending" ||
    phase === "fund_signing" ||
    phase === "fund_pending";

  async function ensureAllowanceAndFund(): Promise<void> {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!publicClient || !address) {
      setErrorMessage("Connect your wallet on the correct network to fund this project.");
      return;
    }
    if (!onChain || !walletClient) {
      setErrorMessage(
        onChainReadError ??
          "On-chain data is still loading. Wait for balances to appear, or fix the RPC connection.",
      );
      return;
    }
    if (chainMismatch) {
      setErrorMessage(`Switch your wallet network to chain ${props.chainId} first.`);
      return;
    }
    if (derived.parseError) {
      setErrorMessage(derived.parseError);
      return;
    }
    if (derived.amountWei <= 0n) {
      setErrorMessage("Enter an amount greater than zero.");
      return;
    }
    if (derived.amountWei > derived.remainingWei) {
      setErrorMessage("Amount exceeds remaining project funding.");
      return;
    }
    if (derived.amountWei > onChain.balanceWei) {
      setErrorMessage("Your token balance is lower than this funding amount.");
      return;
    }

    try {
      const account = walletClient.account.address;

      if (!derived.allowanceEnough) {
        setPhase("approve_signing");
        const approveArgs = [props.escrowContractAddress, derived.amountWei] as const;
        const approveGas = await estimateCappedWriteGas({
          publicClient,
          account,
          address: props.tokenAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: approveArgs,
        });
        const approveHash = await walletClient.writeContract({
          address: props.tokenAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: approveArgs,
          gas: approveGas,
          chain: walletClient.chain,
          account: walletClient.account,
        });
        setPhase("approve_pending");
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        setPhase("approve_success");
      }

      setPhase("fund_signing");
      const fundArgs = [onChainProjectId, derived.amountWei] as const;
      const fundGas = await estimateCappedWriteGas({
        publicClient,
        account,
        address: props.escrowContractAddress,
        abi: escrowRegistryAbi,
        functionName: "fundProject",
        args: fundArgs,
      });
      const fundHash = await walletClient.writeContract({
        address: props.escrowContractAddress,
        abi: escrowRegistryAbi,
        functionName: "fundProject",
        args: fundArgs,
        gas: fundGas,
        chain: walletClient.chain,
        account: walletClient.account,
      });
      setPhase("fund_pending");
      await publicClient.waitForTransactionReceipt({ hash: fundHash });
      const fundedSnapshot = await publicClient.readContract({
        address: props.escrowContractAddress,
        abi: escrowRegistryAbi,
        functionName: "getProject",
        args: [onChainProjectId],
      });
      const fundedAfter = BigInt(fundedSnapshot.fundedAmount);

      const reconcileRes = await fetch(`/api/v1/projects/${props.projectId}/funding`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: fundHash,
          chainId: props.chainId,
          fundedAmountWei: fundedAfter.toString(),
          escrowContractAddress: props.escrowContractAddress,
          onChainProjectId: props.onChainProjectId,
        }),
      });
      if (!reconcileRes.ok) {
        throw new Error("Funding confirmed, but app sync failed. Please refresh.");
      }

      await queryClient.invalidateQueries({ queryKey: ["project", props.projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setPhase("fund_success");
      setSuccessMessage("Funding confirmed on-chain and synced in app state.");
      setAmountInput("");
      await refreshOnChainState();
    } catch (error) {
      setPhase("failure");
      setErrorMessage(
        error instanceof Error ? error.message : "Funding transaction failed",
      );
    }
  }

  const statusMessage = (() => {
    if (phase === "approve_signing") {
      return "Waiting for wallet signature for token approval...";
    }
    if (phase === "approve_pending") {
      return "Token approval transaction submitted. Waiting for confirmation...";
    }
    if (phase === "approve_success") {
      return "Token approval confirmed.";
    }
    if (phase === "fund_signing") {
      return "Waiting for wallet signature for project funding...";
    }
    if (phase === "fund_pending") {
      return "Funding transaction submitted. Waiting for confirmation...";
    }
    if (phase === "fund_success") {
      return successMessage ?? "Funding successful.";
    }
    if (phase === "failure") {
      return errorMessage ?? "Funding failed.";
    }
    return null;
  })();

  return (
    <Card className="w-full max-w-full overflow-hidden">
      <CardHeader>
        <CardTitle>Fund escrow project</CardTitle>
        <CardDescription>
          Approve token spending once, then fund this project escrow with a clear
          on-chain transaction trail.
        </CardDescription>
      </CardHeader>

      <div className="flex flex-col gap-5 px-4 pb-6 sm:px-6">
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 px-3 py-3 sm:px-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Funding workspace</p>
          <p className="mt-1 text-xs text-zinc-400">
            Approve token allowance if needed, then fund the remaining escrow amount.
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/60 p-4">
          <p className="break-words text-sm font-semibold tracking-tight text-zinc-100">
            {props.projectTitle}
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-zinc-300 sm:grid-cols-2">
            <p>
              <span className="font-medium">Chain:</span> {props.chainId}
            </p>
            <p>
              <span className="font-medium">On-chain project id:</span>{" "}
              {props.onChainProjectId}
            </p>
            <p className="break-all">
              <span className="font-medium">Escrow contract:</span>{" "}
              {props.escrowContractAddress}
            </p>
            <p className="break-all">
              <span className="font-medium">Token:</span> {props.tokenAddress}
            </p>
          </div>
        </div>

        {!address ? (
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-300">
            <p className="font-medium text-zinc-100">Wallet not connected</p>
            <p className="mt-1 text-xs text-zinc-400">
              Connect the client wallet to load live balances, allowance, and on-chain funding status.
            </p>
          </div>
        ) : null}

        {onChainReadError ? (
          <div className="rounded-xl border border-amber-300/35 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            <p className="font-medium">Could not read on-chain data</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-xs">{onChainReadError}</p>
          </div>
        ) : null}

        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <InfoMetric
            label="Target amount"
            value={
              onChain
                ? `${formatUnits(onChain.totalWei, onChain.decimals)} tokens`
                : formatTotalWeiHint(props.totalValueWei) ??
                  `${props.totalValueWei} wei (smallest units)`
            }
          />
          <InfoMetric
            label="Funded amount"
            value={
              onChain
                ? `${formatUnits(onChain.fundedWei, onChain.decimals)} tokens`
                : onChainReadError
                  ? "—"
                  : "Loading…"
            }
          />
          <InfoMetric
            label="Remaining amount"
            value={
              onChain
                ? `${formatUnits(
                    onChain.totalWei > onChain.fundedWei
                      ? onChain.totalWei - onChain.fundedWei
                      : 0n,
                    onChain.decimals,
                  )} tokens`
                : onChainReadError
                  ? "—"
                  : "Loading…"
            }
          />
        </div>

        {chainMismatch ? (
          <div className="rounded-xl border border-amber-300/35 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            <p>Wallet network mismatch. Switch to chain {props.chainId} to continue.</p>
            <Button
              type="button"
              variant="secondary"
              className="mt-3 w-full sm:w-auto"
              onClick={() => {
                void switchChainAsync({ chainId: props.chainId });
              }}
            >
              Switch network
            </Button>
          </div>
        ) : null}

        <div className="space-y-2">
          <label
            htmlFor="fund-amount"
            className="text-sm font-medium text-zinc-200"
          >
            Funding amount (human token units)
          </label>
          <Input
            id="fund-amount"
            placeholder="e.g. 1500.25"
            inputMode="decimal"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            disabled={isBusy}
          />
          <p className="text-xs leading-relaxed text-zinc-400">
            Enter the amount in normal token units. We convert decimals correctly
            before sending to chain.
          </p>
        </div>

        {statusMessage ? (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              phase === "failure"
                ? "border-red-300/35 bg-red-300/10 text-red-100"
                : "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
            }`}
            role="status"
          >
            {statusMessage}
          </div>
        ) : null}

        <FieldError message={errorMessage ?? undefined} />

        <Button
          type="button"
          className="w-full"
          disabled={isBusy || !onChain}
          onClick={() => {
            void ensureAllowanceAndFund();
          }}
        >
          {isBusy
            ? "Processing…"
            : derived.allowanceEnough
              ? "Fund project"
              : "Approve token and fund"}
        </Button>
      </div>
    </Card>
  );
}

function InfoMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-800/90 bg-zinc-950/65 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-1 break-words text-xs font-semibold leading-snug text-zinc-100 sm:text-sm">
        {value}
      </p>
    </div>
  );
}
