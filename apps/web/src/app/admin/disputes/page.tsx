"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";

import type { AdminDisputeDetail } from "@escrowflow/types";

import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/ui/field-error";
import { Spinner } from "@/components/ui/spinner";
import { useAdminDisputesQuery } from "@/hooks/use-admin-disputes-query";
import { useMeQuery } from "@/hooks/use-me-query";
import { useSessionQuery } from "@/hooks/use-session-query";
import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi";
import { getExplorerTxUrl } from "@/lib/chains/explorer";

type ResolutionKind = "PAYOUT_TO_FREELANCER" | "REFUND_TO_CLIENT" | "SPLIT";

type Phase =
  | "idle"
  | "signing"
  | "pending"
  | "syncing"
  | "success"
  | "failure";

export default function AdminDisputesPage() {
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = useSessionQuery();
  const meEnabled = Boolean(session?.authenticated);
  const { data: me, isPending: meLoading } = useMeQuery(meEnabled);
  const canLoad = Boolean(me?.roles.includes("ADMIN"));

  const [statusFilter, setStatusFilter] = useState<"open" | "resolved" | "all">("open");
  const { data: disputes, isPending: disputesLoading } = useAdminDisputesQuery(canLoad, {
    status: statusFilter,
    limit: 30,
  });

  if (sessionLoading || (meEnabled && meLoading)) {
    return (
      <AuthShell title="Admin disputes" subtitle="Loading dispute management workspace...">
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      </AuthShell>
    );
  }

  if (!session?.authenticated) {
    router.replace("/login");
    return null;
  }
  if (!me?.roles.includes("ADMIN")) {
    return (
      <AuthShell
        title="Admin disputes"
        subtitle="This workspace is restricted to admin/arbitrator accounts."
      >
        <Card>
          <CardHeader>
            <CardTitle>Admin role required</CardTitle>
            <CardDescription>
              You need ADMIN role to access dispute resolution workflows.
            </CardDescription>
          </CardHeader>
          <div className="flex justify-end px-4 pb-4 sm:px-6">
            <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => router.push("/dashboard")}>
              Back to dashboard
            </Button>
          </div>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Dispute management"
      subtitle="Review evidence, validate payout math, and resolve disputes through on-chain or admin signer flows."
      className="overflow-x-hidden"
      containerClassName="max-w-6xl sm:max-w-6xl"
    >
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Admin dispute queue</CardTitle>
          <CardDescription>
            Choose a filter and resolve each dispute with a clear audit trail.
          </CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-3 border-t border-zinc-800/90 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
          <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap">
            {(["open", "resolved", "all"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                variant={statusFilter === value ? "primary" : "secondary"}
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => setStatusFilter(value)}
              >
                {capitalize(value)}
              </Button>
            ))}
          </div>
          <Button type="button" variant="secondary" size="sm" className="w-full sm:w-auto" onClick={() => router.push("/dashboard")}>
            Back to dashboard
          </Button>
        </div>
      </Card>

      <section className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <AdminMetric label="Queue scope" value={capitalize(statusFilter)} hint="Active filter" />
        <AdminMetric
          label="Visible disputes"
          value={String(disputes?.length ?? 0)}
          hint="Current result set"
        />
        <AdminMetric label="Resolution mode" value="On-chain + sync" hint="Contract + API reconciliation" />
      </section>

      <div className="mt-5 space-y-4">
        {disputesLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : disputes && disputes.length > 0 ? (
          disputes.map((dispute) => <DisputeCard key={dispute.id} dispute={dispute} />)
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>No disputes found</CardTitle>
              <CardDescription>
                No disputes match this filter right now.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </AuthShell>
  );
}

function DisputeCard({ dispute }: { dispute: AdminDisputeDetail }) {
  const queryClient = useQueryClient();
  const activeChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({
    chainId: dispute.project.chainId ?? undefined,
  });
  const { data: walletClient } = useWalletClient({
    chainId: dispute.project.chainId ?? undefined,
  });

  const [kind, setKind] = useState<ResolutionKind>("PAYOUT_TO_FREELANCER");
  const [freelancerAmountWei, setFreelancerAmountWei] = useState(dispute.milestone.amountWei);
  const [clientAmountWei, setClientAmountWei] = useState("0");
  const [resolutionNote, setResolutionNote] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const canResolve = ["OPEN", "AWAITING_RESPONSE", "UNDER_ADMIN_REVIEW"].includes(dispute.status);
  const hasOnchainContext = Boolean(
    dispute.project.chainId &&
      dispute.project.escrowContractAddress &&
      dispute.project.onChainProjectId,
  );
  const chainMismatch =
    hasOnchainContext &&
    dispute.project.chainId !== null &&
    activeChainId !== dispute.project.chainId;

  const validationError = useMemo(
    () =>
      validateResolution({
        kind,
        milestoneAmountWei: dispute.milestone.amountWei,
        freelancerAmountWei,
        clientAmountWei,
      }),
    [kind, dispute.milestone.amountWei, freelancerAmountWei, clientAmountWei],
  );

  async function submitResolution(): Promise<void> {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    if (!canResolve) {
      setErrorMessage("This dispute is already resolved.");
      return;
    }

    try {
      let resolutionTxHash: `0x${string}` | null = null;
      if (hasOnchainContext) {
        if (!walletClient || !publicClient) {
          throw new Error("Wallet client not ready for on-chain resolution.");
        }
        if (chainMismatch) {
          throw new Error(`Switch your wallet to chain ${dispute.project.chainId} first.`);
        }

        setPhase("signing");
        resolutionTxHash = await walletClient.writeContract({
          address: dispute.project.escrowContractAddress as `0x${string}`,
          abi: escrowRegistryAbi,
          functionName: "resolveDispute",
          args: [
            BigInt(dispute.project.onChainProjectId!),
            BigInt(dispute.milestone.sortOrder),
            kindToContractCode(kind),
            BigInt(freelancerAmountWei),
            BigInt(clientAmountWei),
          ],
          chain: walletClient.chain,
          account: walletClient.account,
        });
        setPhase("pending");
        await publicClient.waitForTransactionReceipt({ hash: resolutionTxHash });
      }

      setPhase("syncing");
      const response = await fetch(`/api/v1/admin/disputes/${dispute.id}/resolve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          freelancerAmountWei,
          clientAmountWei,
          resolutionNote: resolutionNote.trim() ? resolutionNote.trim() : null,
          chainId: hasOnchainContext ? dispute.project.chainId : undefined,
          escrowContractAddress: hasOnchainContext ? dispute.project.escrowContractAddress : undefined,
          onChainProjectId: hasOnchainContext ? dispute.project.onChainProjectId : undefined,
          milestoneIndex: dispute.milestone.sortOrder,
          resolutionTxHash,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? "Failed to persist dispute resolution");
      }

      await queryClient.invalidateQueries({ queryKey: ["admin-disputes"] });
      await queryClient.invalidateQueries({ queryKey: ["project", dispute.project.id] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setPhase("success");
      setSuccessMessage("Dispute resolved and synced successfully.");
    } catch (error) {
      setPhase("failure");
      setErrorMessage(error instanceof Error ? error.message : "Resolution failed");
    }
  }

  return (
    <Card className="overflow-hidden transition-all duration-200 hover:-translate-y-0.5">
      <CardHeader>
          <CardTitle className="break-words text-base sm:text-lg">
          {dispute.project.title} · M{dispute.milestone.sortOrder + 1} {dispute.milestone.title}
        </CardTitle>
        <CardDescription>
          Dispute {dispute.id.slice(0, 10)}... · Status {prettyStatus(dispute.status)} · Opened{" "}
          {formatTimeAgo(dispute.createdAt)}
        </CardDescription>
      </CardHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-zinc-800/90 bg-zinc-950/55 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
            Context
          </p>
          <p className="text-sm text-zinc-200">{dispute.description}</p>
          <p className="text-xs text-zinc-400">
            Project status: {prettyStatus(dispute.project.status)} · Milestone status:{" "}
            {prettyStatus(dispute.milestone.status)}
          </p>
          <p className="text-xs text-zinc-400">
            Client: {truncateWallet(dispute.participants.client.walletAddress)}
          </p>
          <p className="text-xs text-zinc-400">
            Freelancer:{" "}
            {dispute.participants.freelancer
              ? truncateWallet(dispute.participants.freelancer.walletAddress)
              : "Unassigned"}
          </p>
          {dispute.relatedSubmission ? (
            <p className="text-xs text-zinc-400">
              Related submission: {dispute.relatedSubmission.id.slice(0, 10)}... (
              {prettyStatus(dispute.relatedSubmission.status)})
            </p>
          ) : null}
        </div>

        <div className="space-y-3 rounded-xl border border-zinc-800/90 bg-zinc-950/55 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
            Evidence links
          </p>
          <div className="space-y-1">
            {dispute.evidenceLinks.map((link) => (
              <a
                key={link}
                href={toGatewayUrl(link)}
                target="_blank"
                rel="noreferrer"
                  className="inline-flex min-h-8 items-center break-all rounded-md px-1.5 text-xs text-cyan-300 transition-colors hover:bg-cyan-300/10 hover:text-cyan-200"
              >
                {link}
              </a>
            ))}
          </div>
          <p className="text-xs text-zinc-500">
            Ensure evidence consistency before final resolution.
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-zinc-800/90 bg-zinc-950/55 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
          Recent transactions
        </p>
        <div className="mt-2 space-y-2">
          {dispute.recentTransactions.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">No transactions yet.</p>
          ) : (
            dispute.recentTransactions.slice(0, 5).map((tx) => (
              <div
                key={`${tx.txHash}-${tx.logIndex}`}
                className="rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-2 text-xs"
              >
                <p className="font-medium text-zinc-100">{tx.eventName}</p>
                <p className="break-all text-zinc-400">{tx.txHash}</p>
                {getExplorerTxUrl(tx.chainId ?? dispute.project.chainId, tx.txHash) ? (
                  <a
                    href={getExplorerTxUrl(tx.chainId ?? dispute.project.chainId, tx.txHash)!}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex min-h-8 items-center rounded-md px-1.5 font-medium text-cyan-300 transition-colors hover:bg-cyan-300/10 hover:text-cyan-200"
                  >
                    View on explorer
                  </a>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

      {canResolve ? (
        <div className="mt-4 rounded-xl border border-cyan-300/30 bg-cyan-300/10 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">
            Resolve dispute
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            {(
              [
                ["PAYOUT_TO_FREELANCER", "Payout to freelancer"],
                ["REFUND_TO_CLIENT", "Refund to client"],
                ["SPLIT", "Split"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={kind === value ? "primary" : "secondary"}
                className="w-full sm:w-auto"
                onClick={() => {
                  setKind(value);
                  if (value === "PAYOUT_TO_FREELANCER") {
                    setFreelancerAmountWei(dispute.milestone.amountWei);
                    setClientAmountWei("0");
                  } else if (value === "REFUND_TO_CLIENT") {
                    setFreelancerAmountWei("0");
                    setClientAmountWei(dispute.milestone.amountWei);
                  }
                }}
              >
                {label}
              </Button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Freelancer amount (wei)
              </label>
              <Input
                value={freelancerAmountWei}
                onChange={(e) => setFreelancerAmountWei(e.target.value.trim())}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Client amount (wei)
              </label>
              <Input value={clientAmountWei} onChange={(e) => setClientAmountWei(e.target.value.trim())} />
            </div>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Milestone amount: {dispute.milestone.amountWei} wei
          </p>

          <div className="mt-3 space-y-1">
            <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Resolution note (persisted)
            </label>
            <Textarea
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              className="min-h-[90px]"
              maxLength={5000}
              placeholder="Explain why this resolution is fair and compliant."
            />
          </div>

          {hasOnchainContext ? (
            <div className="mt-3 rounded-lg border border-zinc-800/90 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-300">
              <p>On-chain resolution enabled.</p>
              <p>Chain: {dispute.project.chainId}</p>
              {chainMismatch ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="mt-2 w-full sm:w-auto"
                  onClick={() => {
                    if (dispute.project.chainId) {
                      void switchChainAsync({ chainId: dispute.project.chainId });
                    }
                  }}
                >
                  Switch network
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              Missing on-chain linkage for this project. Resolution will be persisted via admin signer
              flow only.
            </div>
          )}

          {validationError ? <FieldError message={validationError} className="mt-2 text-xs" /> : null}
          {errorMessage ? <FieldError message={errorMessage} className="mt-2 text-xs" /> : null}
          {successMessage ? (
            <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">{successMessage}</p>
          ) : null}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              size="sm"
              className="w-full sm:w-auto"
              disabled={Boolean(validationError) || phase === "signing" || phase === "pending" || phase === "syncing"}
              onClick={() => void submitResolution()}
            >
              {phase === "signing"
                ? "Waiting signature..."
                : phase === "pending"
                  ? "Waiting confirmation..."
                  : phase === "syncing"
                    ? "Persisting..."
                    : "Resolve dispute"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          This dispute is already resolved.
        </div>
      )}
    </Card>
  );
}

function validateResolution(input: {
  kind: ResolutionKind;
  milestoneAmountWei: string;
  freelancerAmountWei: string;
  clientAmountWei: string;
}): string | null {
  if (!/^\d+$/.test(input.freelancerAmountWei) || !/^\d+$/.test(input.clientAmountWei)) {
    return "Amounts must be integer wei strings.";
  }
  const total = BigInt(input.milestoneAmountWei);
  const freelancer = BigInt(input.freelancerAmountWei);
  const client = BigInt(input.clientAmountWei);
  if (input.kind === "PAYOUT_TO_FREELANCER") {
    if (freelancer !== total || client !== 0n) {
      return "Payout resolution must send full milestone amount to freelancer and 0 to client.";
    }
    return null;
  }
  if (input.kind === "REFUND_TO_CLIENT") {
    if (client !== total || freelancer !== 0n) {
      return "Refund resolution must send full milestone amount to client and 0 to freelancer.";
    }
    return null;
  }
  if (freelancer <= 0n || client <= 0n) {
    return "Split requires both amounts greater than zero.";
  }
  if (freelancer + client !== total) {
    return "Split amounts must sum exactly to the milestone amount.";
  }
  return null;
}

function kindToContractCode(kind: ResolutionKind): number {
  if (kind === "PAYOUT_TO_FREELANCER") {
    return 0;
  }
  if (kind === "REFUND_TO_CLIENT") {
    return 1;
  }
  return 2;
}

function prettyStatus(status: string): string {
  return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function truncateWallet(address: string): string {
  if (address.length < 12) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTimeAgo(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "just now";
  }
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diff / 60_000));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function toGatewayUrl(uri: string): string {
  if (!uri.startsWith("ipfs://")) {
    return uri;
  }
  const value = uri.replace("ipfs://", "");
  return `https://gateway.pinata.cloud/ipfs/${value}`;
}

function capitalize(value: string): string {
  return value.length ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function AdminMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card className="p-4 transition-all duration-200 hover:-translate-y-0.5 sm:p-5">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">{label}</p>
      <p className="mt-2 break-words text-lg font-semibold text-zinc-100">{value}</p>
      <p className="mt-1 text-xs text-zinc-400">{hint}</p>
    </Card>
  );
}
