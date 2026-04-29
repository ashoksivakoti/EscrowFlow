"use client";

import { useEffect, useMemo, useState } from "react";
import { getAddress, isAddress } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";
import { formatEscrowRegistryWriteError } from "@/lib/contracts/decode-error";

type RecipientState = {
  pendingRecipient: `0x${string}` | null;
  executableAfter: string | null;
  activeExecutedRecipient: `0x${string}` | null;
  partyAuthorizedRecipient: `0x${string}` | null;
};

export function AlternativeRecipientPanel(props: {
  projectId: string;
  milestoneDbId: string;
  chainId: number | null;
  escrowContractAddress: string | null;
  onChainProjectId: string | null;
  milestoneIndex: number;
  isFreelancerSide: boolean;
  partyWalletAddress: string | null;
  title: string;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: props.chainId ?? undefined });
  const { data: walletClient } = useWalletClient({ chainId: props.chainId ?? undefined });
  const { switchChainAsync } = useSwitchChain();
  const [directRecipientInput, setDirectRecipientInput] = useState("");
  const [sigOriginalParty, setSigOriginalParty] = useState("");
  const [sigNewRecipient, setSigNewRecipient] = useState("");
  const [sigNonce, setSigNonce] = useState("");
  const [sigDeadline, setSigDeadline] = useState("");
  const [sigHex, setSigHex] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [nowUnixSeconds, setNowUnixSeconds] = useState<number>(() =>
    Math.floor(Date.now() / 1000),
  );

  const canUsePanel =
    props.chainId != null &&
    Boolean(props.escrowContractAddress) &&
    Boolean(props.onChainProjectId) &&
    Boolean(props.partyWalletAddress);
  const isPartyWallet =
    Boolean(address && props.partyWalletAddress) &&
    address!.toLowerCase() === props.partyWalletAddress!.toLowerCase();
  const chainMismatch = Boolean(
    walletClient?.chain?.id &&
      props.chainId != null &&
      walletClient.chain.id !== props.chainId,
  );

  const recipientStateQuery = useQuery({
    queryKey: [
      "alternative-recipient-state",
      props.projectId,
      props.milestoneDbId,
      props.onChainProjectId,
      props.milestoneIndex,
      props.isFreelancerSide,
    ],
    enabled:
      canUsePanel &&
      Boolean(props.projectId) &&
      Boolean(props.milestoneDbId) &&
      Boolean(props.onChainProjectId),
    queryFn: async (): Promise<RecipientState> => {
      const qs = new URLSearchParams({
        onChainProjectId: props.onChainProjectId!,
        milestoneIndex: String(props.milestoneIndex),
        isFreelancer: props.isFreelancerSide ? "true" : "false",
      });
      const res = await fetch(
        `/api/v1/projects/${props.projectId}/milestones/${props.milestoneDbId}/alternative-recipient-state?${qs}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        throw new Error(`Failed to load alternative recipient state (${res.status})`);
      }
      return (await res.json()) as RecipientState;
    },
  });

  const recipientState = recipientStateQuery.data;
  const pendingRecipient = recipientState?.pendingRecipient ?? null;
  const executableAfter = recipientState?.executableAfter
    ? BigInt(recipientState.executableAfter)
    : null;
  const activeExecutedRecipient = recipientState?.activeExecutedRecipient ?? null;
  const partyAuthorizedRecipient = recipientState?.partyAuthorizedRecipient ?? null;

  const executableAfterDate =
    executableAfter != null ? new Date(Number(executableAfter) * 1000) : null;

  const secondsUntilExecutable =
    executableAfter != null ? Math.max(0, Number(executableAfter) - nowUnixSeconds) : 0;
  const canExecute =
    Boolean(pendingRecipient && executableAfter != null && secondsUntilExecutable === 0);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowUnixSeconds(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const commonArgs = useMemo(
    () =>
      props.onChainProjectId
        ? ([BigInt(props.onChainProjectId), BigInt(props.milestoneIndex), props.isFreelancerSide] as const)
        : null,
    [props.isFreelancerSide, props.milestoneIndex, props.onChainProjectId],
  );

  async function executeAlternativeRecipient(): Promise<void> {
    if (!walletClient || !canUsePanel || !commonArgs) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!isPartyWallet) {
      setErrorMessage("Only the relevant project party can execute a pending recipient.");
      return;
    }
    if (chainMismatch && props.chainId != null) {
      await switchChainAsync({ chainId: props.chainId });
      return;
    }
    if (!canExecute) {
      setErrorMessage("Alternative recipient is not executable yet.");
      return;
    }
    try {
      setIsBusy(true);
      const hash = await walletClient.writeContract({
        address: props.escrowContractAddress as `0x${string}`,
        abi: escrowRegistryAbi,
        functionName: "executeAlternativeRecipient",
        args: commonArgs,
        chain: walletClient.chain,
        account: walletClient.account,
      });
      await publicClient!.waitForTransactionReceipt({ hash });
      await recipientStateQuery.refetch();
      setSuccessMessage("Alternative recipient executed successfully.");
    } catch (e) {
      setErrorMessage(formatEscrowRegistryWriteError(e, "Could not execute alternative recipient."));
    } finally {
      setIsBusy(false);
    }
  }

  async function setDirectPartyRecipient(): Promise<void> {
    if (!walletClient || !canUsePanel || !commonArgs) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!isPartyWallet) {
      setErrorMessage("Direct party recipient update requires the relevant party wallet.");
      return;
    }
    if (!isAddress(directRecipientInput)) {
      setErrorMessage("Enter a valid recipient address.");
      return;
    }
    if (chainMismatch && props.chainId != null) {
      await switchChainAsync({ chainId: props.chainId });
      return;
    }
    try {
      setIsBusy(true);
      const hash = await walletClient.writeContract({
        address: props.escrowContractAddress as `0x${string}`,
        abi: escrowRegistryAbi,
        functionName: "setPartyAuthorizedRecipient",
        args: [...commonArgs, getAddress(directRecipientInput)] as const,
        chain: walletClient.chain,
        account: walletClient.account,
      });
      await publicClient!.waitForTransactionReceipt({ hash });
      await recipientStateQuery.refetch();
      setSuccessMessage("Direct recipient authorization updated.");
    } catch (e) {
      setErrorMessage(formatEscrowRegistryWriteError(e, "Could not update party recipient."));
    } finally {
      setIsBusy(false);
    }
  }

  async function setRecipientBySignature(): Promise<void> {
    if (!walletClient || !canUsePanel || !commonArgs) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!isAddress(sigOriginalParty) || !isAddress(sigNewRecipient)) {
      setErrorMessage("Enter valid original party and new recipient addresses.");
      return;
    }
    if (!/^\d+$/.test(sigNonce) || !/^\d+$/.test(sigDeadline)) {
      setErrorMessage("Nonce and deadline must be integer values.");
      return;
    }
    if (!/^0x[0-9a-fA-F]+$/.test(sigHex)) {
      setErrorMessage("Signature must be a valid hex string.");
      return;
    }
    if (chainMismatch && props.chainId != null) {
      await switchChainAsync({ chainId: props.chainId });
      return;
    }
    try {
      setIsBusy(true);
      const hash = await walletClient.writeContract({
        address: props.escrowContractAddress as `0x${string}`,
        abi: escrowRegistryAbi,
        functionName: "setPartyAuthorizedRecipientBySig",
        args: [
          commonArgs[0],
          commonArgs[1],
          commonArgs[2],
          getAddress(sigOriginalParty),
          getAddress(sigNewRecipient),
          BigInt(sigNonce),
          BigInt(sigDeadline),
          sigHex as `0x${string}`,
        ],
        chain: walletClient.chain,
        account: walletClient.account,
      });
      await publicClient!.waitForTransactionReceipt({ hash });
      await recipientStateQuery.refetch();
      setSuccessMessage("Signature-based recipient authorization submitted.");
    } catch (e) {
      setErrorMessage(
        formatEscrowRegistryWriteError(e, "Could not submit signature-based recipient update."),
      );
    } finally {
      setIsBusy(false);
    }
  }

  if (!canUsePanel) {
    return null;
  }

  return (
    <div className="mt-3 rounded-xl border border-zinc-800/90 bg-zinc-950/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">
        {props.title}
      </p>
      <p className="mt-1 text-xs text-zinc-400">
        Pending recipient is not active until executed by the relevant party.
      </p>
      <p className="mt-2 text-xs text-zinc-300">
        Active executed recipient: {activeExecutedRecipient ?? "None"}
      </p>
      <p className="mt-1 text-xs text-zinc-300">
        Pending recipient: {pendingRecipient ?? "None pending"}
      </p>
      <p className="mt-1 text-xs text-zinc-300">
        Executable after:{" "}
        {executableAfterDate ? executableAfterDate.toLocaleString() : "N/A"}
        {pendingRecipient && executableAfter != null
          ? secondsUntilExecutable > 0
            ? ` (${secondsUntilExecutable}s remaining)`
            : " (ready)"
          : ""}
      </p>
      <p className="mt-1 text-xs text-zinc-300">
        Party-authorized recipient: {partyAuthorizedRecipient ?? "None"}
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          size="sm"
          className="w-full sm:w-auto"
          disabled={isBusy || !pendingRecipient || !isPartyWallet || !canExecute}
          onClick={() => void executeAlternativeRecipient()}
        >
          Execute pending recipient
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        <Input
          placeholder="Direct recipient (0x...)"
          value={directRecipientInput}
          onChange={(e) => setDirectRecipientInput(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="w-full sm:w-auto"
          disabled={isBusy || !isPartyWallet}
          onClick={() => void setDirectPartyRecipient()}
        >
          Set party authorized recipient
        </Button>
      </div>

      <details className="mt-3 rounded-lg border border-zinc-800/90 p-2">
        <summary className="cursor-pointer text-xs text-zinc-300">
          Optional: set party recipient by signature
        </summary>
        <div className="mt-2 space-y-2">
          <Input
            placeholder="Original party (0x...)"
            value={sigOriginalParty}
            onChange={(e) => setSigOriginalParty(e.target.value)}
          />
          <Input
            placeholder="New recipient (0x...)"
            value={sigNewRecipient}
            onChange={(e) => setSigNewRecipient(e.target.value)}
          />
          <Input
            placeholder="Nonce"
            value={sigNonce}
            onChange={(e) => setSigNonce(e.target.value)}
          />
          <Input
            placeholder="Deadline (unix seconds)"
            value={sigDeadline}
            onChange={(e) => setSigDeadline(e.target.value)}
          />
          <Input
            placeholder="Signature (0x...)"
            value={sigHex}
            onChange={(e) => setSigHex(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full sm:w-auto"
            disabled={isBusy}
            onClick={() => void setRecipientBySignature()}
          >
            Submit signed recipient update
          </Button>
        </div>
      </details>

      {errorMessage ? <FieldError message={errorMessage} className="mt-2 text-xs" /> : null}
      {successMessage ? (
        <p className="mt-2 text-xs text-emerald-300">{successMessage}</p>
      ) : null}
    </div>
  );
}
