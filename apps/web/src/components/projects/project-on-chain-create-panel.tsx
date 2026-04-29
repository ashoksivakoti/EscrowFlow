"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getAddress, parseEventLogs } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
} from "wagmi";

import type { ProjectDetail } from "@escrowflow/types";

import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";
import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";
import { formatEscrowRegistryWriteError } from "@/lib/contracts/decode-error";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";

const MAX_METADATA_URI_BYTES = 2048;

function metadataUriForContract(agreementIpfsUri: string | null): string {
  const raw = agreementIpfsUri ?? "";
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes <= MAX_METADATA_URI_BYTES) {
    return raw;
  }
  return "";
}

function milestoneInputsFromProject(project: ProjectDetail): { amount: bigint; deadline: bigint }[] {
  const sorted = [...project.milestones].sort((a, b) => a.sortOrder - b.sortOrder);
  return sorted.map((m) => {
    if (!m.dueAt) {
      throw new Error(`Milestone "${m.title}" is missing a due date.`);
    }
    const sec = Math.floor(new Date(m.dueAt).getTime() / 1000);
    if (!Number.isFinite(sec) || sec <= 0) {
      throw new Error(`Milestone "${m.title}" has an invalid due date.`);
    }
    if (sec > Number.MAX_SAFE_INTEGER) {
      throw new Error(`Milestone "${m.title}" due date is out of range.`);
    }
    let amount: bigint;
    try {
      amount = BigInt(m.amountWei);
    } catch {
      throw new Error(`Milestone "${m.title}" has an invalid amountWei.`);
    }
    if (amount <= 0n) {
      throw new Error(`Milestone "${m.title}" amount must be greater than zero.`);
    }
    return { amount, deadline: BigInt(sec) };
  });
}

type Phase = "idle" | "signing" | "pending" | "confirming" | "success" | "failure";

type Props = {
  project: ProjectDetail;
};

export function ProjectOnChainCreatePanel({ project }: Props) {
  const queryClient = useQueryClient();
  const walletChainId = useChainId();
  const { address } = useAccount();
  const targetChainId = project.chainId!;
  const publicClient = usePublicClient({ chainId: targetChainId });
  const { data: walletClient } = useWalletClient({ chainId: targetChainId });
  const { switchChainAsync } = useSwitchChain();

  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const registry = project.escrowContractAddress as `0x${string}`;
  const token = project.paymentTokenAddress as `0x${string}`;
  const freelancerWallet = project.freelancer?.walletAddress;

  const isBusy = phase === "signing" || phase === "pending" || phase === "confirming";

  async function createOnChainProject(): Promise<void> {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!freelancerWallet) {
      setErrorMessage("This project does not have an assigned freelancer yet.");
      setPhase("failure");
      return;
    }
    if (!publicClient || !walletClient || !address) {
      setErrorMessage("Connect your wallet on the correct network to create the on-chain project.");
      setPhase("failure");
      return;
    }
    if (address.toLowerCase() !== project.client.walletAddress.toLowerCase()) {
      setErrorMessage("Connect the client wallet that owns this project (the marketplace poster).");
      setPhase("failure");
      return;
    }

    let milestoneInputs: { amount: bigint; deadline: bigint }[];
    let metadataURI: string;
    try {
      milestoneInputs = milestoneInputsFromProject(project);
      metadataURI = metadataUriForContract(project.agreementIpfsUri);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Invalid milestone data.");
      setPhase("failure");
      return;
    }

    if (walletChainId !== targetChainId) {
      try {
        await switchChainAsync({ chainId: targetChainId });
      } catch {
        setErrorMessage(`Switch your wallet to chain ${targetChainId} and try again.`);
        setPhase("failure");
        return;
      }
    }

    try {
      setPhase("signing");
      const freelancerAddr = getAddress(freelancerWallet);
      const tokenAddr = getAddress(token);

      const hash = await walletClient.writeContract({
        address: registry,
        abi: escrowRegistryAbi,
        functionName: "createProject",
        args: [freelancerAddr, tokenAddr, metadataURI, milestoneInputs],
        chain: walletClient.chain,
        account: walletClient.account,
      });

      setPhase("pending");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      const parsed = parseEventLogs({
        abi: escrowRegistryAbi,
        eventName: "ProjectCreated",
        logs: receipt.logs,
      });
      const first = parsed[0];
      if (!first || first.args.projectId === undefined) {
        throw new Error("Transaction succeeded but no ProjectCreated event was found in the receipt.");
      }
      const newProjectId = first.args.projectId.toString();

      setPhase("confirming");
      const res = await fetch(`/api/v1/projects/${project.id}/on-chain-binding`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onChainProjectId: newProjectId }),
      });
      const raw = await readJsonOrEmpty(res);
      if (!res.ok) {
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }

      await queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setPhase("success");
      setSuccessMessage(
        `On-chain project #${newProjectId} created and linked. You can fund escrow on this page.`,
      );
    } catch (error) {
      setPhase("failure");
      if (error instanceof ApiRequestError) {
        setErrorMessage(error.message);
        return;
      }
      setErrorMessage(formatEscrowRegistryWriteError(error, "Transaction failed."));
    }
  }

  const statusMessage = (() => {
    if (phase === "signing") {
      return "Waiting for wallet signature to create the on-chain escrow project…";
    }
    if (phase === "pending") {
      return "Transaction submitted. Waiting for confirmation…";
    }
    if (phase === "confirming") {
      return "Saving on-chain project id to EscrowFlow…";
    }
    if (phase === "success") {
      return successMessage ?? "Linked.";
    }
    if (phase === "failure") {
      return errorMessage ?? "Could not create or link the on-chain project.";
    }
    return null;
  })();

  return (
    <Card className="w-full max-w-full overflow-hidden">
      <CardHeader>
        <CardTitle>Create on-chain escrow project</CardTitle>
        <CardDescription>
          Your milestones and token settings are already saved. This step runs{" "}
          <span className="font-medium">EscrowFlowRegistry.createProject</span> with your connected
          client wallet, then stores the returned id so funding can proceed.
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-6 sm:px-6">
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 px-3 py-3 sm:px-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Escrow binding flow</p>
          <p className="mt-1 text-xs text-zinc-400">
            Create project on-chain, capture emitted id, then bind it to this app project.
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/60 p-4 text-sm text-zinc-300">
          <p>
            <span className="font-medium text-zinc-100">Freelancer:</span>{" "}
            <span className="break-all">{freelancerWallet}</span>
          </p>
          <p className="mt-2">
            <span className="font-medium text-zinc-100">Milestones:</span>{" "}
            {project.milestones.length}
          </p>
          <p className="mt-2 break-all">
            <span className="font-medium text-zinc-100">Registry:</span> {registry}
          </p>
        </div>

        {statusMessage ? (
          <p
            className={`rounded-xl border px-3 py-2 text-sm ${
              phase === "failure"
                ? "border-red-300/35 bg-red-300/10 text-red-100"
                : phase === "success"
                  ? "border-emerald-300/35 bg-emerald-300/10 text-emerald-100"
                  : "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
            }`}
          >
            {statusMessage}
          </p>
        ) : null}

        <FieldError message={phase === "failure" ? (errorMessage ?? undefined) : undefined} />

        <Button type="button" className="w-full sm:w-auto" disabled={isBusy} onClick={() => void createOnChainProject()}>
          {isBusy ? "Working…" : "Create & link on-chain project"}
        </Button>

        {phase === "success" ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Refresh if the funding panel does not appear automatically.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
