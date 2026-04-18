"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import { AuthShell } from "@/components/layout/auth-shell";
import { DisputeCreatePanel } from "@/components/projects/dispute-create-panel";
import { MilestoneApprovalPanel } from "@/components/projects/milestone-approval-panel";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { needsOnboarding } from "@/lib/auth/client-guards";
import { useMeQuery } from "@/hooks/use-me-query";
import { useProjectDetailQuery } from "@/hooks/use-project-detail-query";
import { useSessionQuery } from "@/hooks/use-session-query";
import { getExplorerTxUrl } from "@/lib/chains/explorer";

export default function ProjectDetailShellPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? null;

  const { data: session, isPending: sessionLoading } = useSessionQuery();
  const meEnabled = Boolean(session?.authenticated);
  const { data: me, isPending: meLoading, isFetched: meFetched } = useMeQuery(meEnabled);
  const { data: project, isPending: projectLoading } = useProjectDetailQuery(projectId, meEnabled);

  useEffect(() => {
    if (sessionLoading) {
      return;
    }
    if (!session?.authenticated) {
      router.replace("/login");
      return;
    }
    if (!meFetched) {
      return;
    }
    if (!me || needsOnboarding(me)) {
      router.replace("/onboarding");
    }
  }, [session, sessionLoading, me, meFetched, router]);

  const loading = !projectId || sessionLoading || (meEnabled && meLoading && !meFetched) || projectLoading;
  const isAssignedFreelancer = Boolean(
    me?.roles.includes("FREELANCER") &&
      project &&
      project.freelancer &&
      me.id === project.freelancer.id,
  );
  const isProjectClient = Boolean(me?.roles.includes("CLIENT") && me?.id === project?.client.id);

  return (
    <AuthShell
      title="Project details"
      subtitle="Track funding, milestones, submissions, disputes, and transaction history in one place."
      className="overflow-x-hidden"
      containerClassName="max-w-5xl sm:max-w-5xl"
    >
      {loading || !project ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <Spinner />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading project...</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>{project.title}</CardTitle>
              <CardDescription>
                {project.description?.trim() ? project.description : "No description provided yet."}
              </CardDescription>
            </CardHeader>
            {isProjectClient && project.status === "OPEN" ? (
              <div className="mx-4 mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 dark:border-indigo-900 dark:bg-indigo-950/40 sm:mx-6">
                <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100">
                  This project is on the marketplace.
                </p>
                <p className="mt-1 text-xs text-indigo-800 dark:text-indigo-200">
                  Review freelancer applications, then accept one to assign and start escrow.
                </p>
                <Link
                  href={`/projects/${project.id}/applications`}
                  className={buttonClassName({
                    variant: "primary",
                    size: "sm",
                    className: "mt-3 w-full sm:w-auto",
                  })}
                >
                  Manage applications
                </Link>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 text-xs text-zinc-600 dark:text-zinc-400 sm:grid-cols-2 lg:grid-cols-3">
              <Info label="Status" value={prettyStatus(project.status)} />
              <Info label="Total amount" value={formatWei(project.totalValueWei ?? "0")} />
              <Info label="Funded amount" value={formatWei(project.fundedAmountWei)} />
              <Info label="Released amount" value={formatWei(project.releasedAmountWei)} />
              <Info
                label="Client wallet"
                value={truncateWallet(project.client.walletAddress)}
                fullValue={project.client.walletAddress}
              />
              <Info
                label="Freelancer wallet"
                value={
                  project.freelancer
                    ? truncateWallet(project.freelancer.walletAddress)
                    : "Unassigned"
                }
                fullValue={project.freelancer?.walletAddress ?? undefined}
              />
            </div>

            {project.agreementLinks.length > 0 ? (
              <div className="mt-4 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Agreement links
                </p>
                <div className="mt-2 flex flex-col gap-1">
                  {project.agreementLinks.map((link) => (
                    <a
                      key={link}
                      href={toGatewayUrl(link)}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-sm text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {link}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => router.push("/projects")}>
                Back to projects
              </Button>
              {project.status === "AWAITING_ESCROW" ? (
                <Button onClick={() => router.push(`/projects/${project.id}/funding`)}>
                  Open funding
                </Button>
              ) : null}
            </div>
          </Card>

          {project.openDispute ? (
            <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30">
              <CardHeader>
                <CardTitle className="text-lg">Dispute requires attention</CardTitle>
                <CardDescription>
                  {project.openDispute.title ?? "Open dispute"} · {prettyStatus(project.openDispute.status)}
                </CardDescription>
              </CardHeader>
              <p className="break-words text-sm text-amber-900 dark:text-amber-200">
                {project.openDispute.description}
              </p>
              <a
                href={toGatewayUrl(project.openDispute.evidenceIpfsUri)}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block break-all text-xs text-amber-900 underline dark:text-amber-200"
              >
                Evidence package: {project.openDispute.evidenceIpfsUri}
              </a>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg sm:text-xl">Milestones</CardTitle>
              <CardDescription>
                Delivery progress, latest submission snapshot, and dispute state per milestone.
              </CardDescription>
            </CardHeader>
            <div className="space-y-3">
              {project.milestones.length === 0 ? (
                <EmptyState
                  title="No milestones yet"
                  description="Milestones will appear here once the project is structured."
                />
              ) : (
                project.milestones.map((milestone) => (
                  <div key={milestone.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {milestone.sortOrder + 1}. {milestone.title}
                        </p>
                        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                          Amount: {formatWei(milestone.amountWei)} · Status: {prettyStatus(milestone.status)}
                        </p>
                      </div>
                      <StatusBadge label={prettyStatus(milestone.status)} />
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-zinc-600 dark:text-zinc-400 sm:grid-cols-2">
                      <p>Due: {milestone.dueAt ? formatDateTime(milestone.dueAt) : "No due date"}</p>
                      <p>
                        Latest submission:{" "}
                        {milestone.latestSubmissionId ? truncateId(milestone.latestSubmissionId) : "None yet"}
                      </p>
                      <p>
                        Open dispute:{" "}
                        {milestone.openDisputeId ? truncateId(milestone.openDisputeId) : "No"}
                      </p>
                      <p>
                        Released at:{" "}
                        {milestone.releasedAt ? formatDateTime(milestone.releasedAt) : "Not released"}
                      </p>
                    </div>
                    {isMilestoneFrozen(project.status, milestone.openDisputeId) ? (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                        Milestone actions are frozen while a dispute is active.
                      </div>
                    ) : null}
                    {isAssignedFreelancer ? (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                        {canSubmitMilestone(project.status, milestone.status, milestone.openDisputeId) ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() =>
                              router.push(
                                `/projects/${project.id}/milestones/${milestone.id}/submit`,
                              )
                            }
                          >
                            Submit work
                          </Button>
                        ) : (
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Submission is unavailable while disputed or until this milestone is
                            funded and in progress.
                          </p>
                        )}
                      </div>
                    ) : null}
                    {isProjectClient &&
                    project.latestSubmission &&
                    project.latestSubmission.milestoneId === milestone.id &&
                    canClientApprovePayout(project, milestone.status, milestone.openDisputeId) ? (
                      <MilestoneApprovalPanel
                        projectId={project.id}
                        milestoneId={milestone.id}
                        milestoneIndex={milestone.sortOrder}
                        submissionId={project.latestSubmission.id}
                        chainId={project.chainId!}
                        onChainProjectId={project.onChainProjectId!}
                        escrowContractAddress={project.escrowContractAddress as `0x${string}`}
                        releasedAmountWei={milestone.amountWei}
                      />
                    ) : null}
                    {canRaiseDispute({
                      projectStatus: project.status,
                      milestoneStatus: milestone.status,
                      milestoneOpenDisputeId: milestone.openDisputeId,
                      isParticipant: isProjectClient || isAssignedFreelancer,
                    }) ? (
                      <DisputeCreatePanel
                        projectId={project.id}
                        milestoneId={milestone.id}
                        relatedSubmissionId={
                          project.latestSubmission?.milestoneId === milestone.id
                            ? project.latestSubmission.id
                            : null
                        }
                      />
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </Card>

          <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Latest submission</CardTitle>
                <CardDescription>
                  Most recent submission activity across milestones.
                </CardDescription>
              </CardHeader>
              {project.latestSubmission ? (
                <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Status: {prettyStatus(project.latestSubmission.status)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    Milestone: {truncateId(project.latestSubmission.milestoneId)}
                  </p>
                  <p className="mt-2 break-words text-sm text-zinc-700 dark:text-zinc-300">
                    {project.latestSubmission.summary ?? "No submission summary text."}
                  </p>
                  <p className="mt-2 break-words text-sm text-zinc-700 dark:text-zinc-300">
                    Note: {project.latestSubmission.note ?? "No delivery note provided."}
                  </p>
                  {project.latestSubmission.externalLink ? (
                    <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                      External link:{" "}
                      <a
                        href={project.latestSubmission.externalLink}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {project.latestSubmission.externalLink}
                      </a>
                    </p>
                  ) : null}
                  {project.latestSubmission.metadataIpfsUri ? (
                    <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                      Metadata:{" "}
                      <a
                        href={toGatewayUrl(project.latestSubmission.metadataIpfsUri)}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {project.latestSubmission.metadataIpfsUri}
                      </a>
                    </p>
                  ) : null}
                  {project.latestSubmission.deliverableFiles &&
                  project.latestSubmission.deliverableFiles.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                        Deliverable files
                      </p>
                      {project.latestSubmission.deliverableFiles.map((file) => (
                        <a
                          key={`${file.cid}-${file.fileName}`}
                          href={toGatewayUrl(file.uri)}
                          target="_blank"
                          rel="noreferrer"
                          className="block break-all text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          {file.fileName} ({formatFileSize(file.sizeBytes)})
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {project.latestSubmission.reviewNote ? (
                    <p className="mt-2 break-words text-xs text-zinc-600 dark:text-zinc-400">
                      Client review note: {project.latestSubmission.reviewNote}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    Submitted:{" "}
                    {project.latestSubmission.submittedAt
                      ? formatDateTime(project.latestSubmission.submittedAt)
                      : "Draft or unsent"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Reviewed:{" "}
                    {project.latestSubmission.decidedAt
                      ? formatDateTime(project.latestSubmission.decidedAt)
                      : "Not reviewed yet"}
                  </p>
                </div>
              ) : (
                <EmptyState
                  title="No submissions yet"
                  description="Submission details will show here once freelancer work is submitted."
                />
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Recent transactions</CardTitle>
                <CardDescription>
                  Synced blockchain events for this project.
                </CardDescription>
              </CardHeader>
              <div className="space-y-3">
                {project.recentTransactions.length === 0 ? (
                  <EmptyState
                    title="No on-chain transactions yet"
                    description="Funding and release events will appear as activity progresses."
                  />
                ) : (
                  project.recentTransactions.map((tx) => (
                    <div
                      key={`${tx.txHash}-${tx.logIndex}`}
                      className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                    >
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {tx.eventName}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Block {tx.blockNumber}
                        </p>
                      </div>
                      <p className="mt-1 break-all font-mono text-xs text-zinc-600 dark:text-zinc-400">
                        {tx.txHash}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                        <span>{formatTimeAgo(tx.blockTimestamp ?? tx.createdAt)}</span>
                        {tx.amountWei ? <span>• Amount {formatWei(tx.amountWei)}</span> : null}
                        {getExplorerTxUrl(tx.chainId ?? project.chainId, tx.txHash) ? (
                          <a
                            href={getExplorerTxUrl(tx.chainId ?? project.chainId, tx.txHash)!}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            • View on explorer
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </section>
        </div>
      )}
    </AuthShell>
  );
}

function Info({
  label,
  value,
  fullValue,
}: {
  label: string;
  value: string;
  fullValue?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <p className="text-[10px] uppercase tracking-wide">{label}</p>
      <p className="mt-1 break-all text-sm font-medium text-zinc-800 dark:text-zinc-200" title={fullValue}>
        {value}
      </p>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-5 text-center dark:border-zinc-700">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</p>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{description}</p>
    </div>
  );
}

function StatusBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
      {label}
    </span>
  );
}

function prettyStatus(status: string): string {
  return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function truncateWallet(address: string): string {
  if (address.length < 12) {
    return address;
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function truncateId(value: string): string {
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatWei(raw: string): string {
  try {
    return `${BigInt(raw).toLocaleString("en-US")} wei`;
  } catch {
    return raw;
  }
}

function formatDateTime(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  return date.toLocaleString();
}

function formatTimeAgo(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
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

function canSubmitMilestone(
  projectStatus: string,
  milestoneStatus: string,
  openDisputeId: string | null,
): boolean {
  if (isMilestoneFrozen(projectStatus, openDisputeId)) {
    return false;
  }
  return ["FUNDED", "IN_PROGRESS", "REJECTED"].includes(milestoneStatus);
}

function canClientApprovePayout(
  project: {
    status?: string;
    chainId: number | null;
    onChainProjectId: string | null;
    escrowContractAddress: string | null;
  },
  milestoneStatus: string,
  openDisputeId: string | null,
): boolean {
  if (isMilestoneFrozen(project.status ?? "ACTIVE", openDisputeId)) {
    return false;
  }
  if (!project.chainId || !project.onChainProjectId || !project.escrowContractAddress) {
    return false;
  }
  return ["SUBMITTED", "CLIENT_REVIEW", "APPROVED"].includes(milestoneStatus);
}

function canRaiseDispute(input: {
  projectStatus: string;
  milestoneStatus: string;
  milestoneOpenDisputeId: string | null;
  isParticipant: boolean;
}): boolean {
  if (!input.isParticipant) {
    return false;
  }
  if (input.milestoneOpenDisputeId) {
    return false;
  }
  if (!["ACTIVE", "DISPUTED"].includes(input.projectStatus)) {
    return false;
  }
  return ["SUBMITTED", "APPROVED"].includes(input.milestoneStatus);
}

function isMilestoneFrozen(projectStatus: string, openDisputeId: string | null): boolean {
  return Boolean(openDisputeId) || projectStatus === "DISPUTED";
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
