"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
} from "wagmi";

import type { CreateSubmissionResponse, ProjectDetail } from "@escrowflow/types";

import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMeQuery } from "@/hooks/use-me-query";
import { useProjectDetailQuery } from "@/hooks/use-project-detail-query";
import { useSessionQuery } from "@/hooks/use-session-query";
import { needsOnboarding } from "@/lib/auth/client-guards";
import { writeSubmitMilestoneTx } from "@/lib/contracts/write-submit-milestone";

const ON_CHAIN_URI_MAX_BYTES = 2048;

export default function MilestoneSubmissionPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useParams<{ projectId: string; milestoneId: string }>();
  const projectId = params?.projectId ?? null;
  const milestoneId = params?.milestoneId ?? null;

  const { data: session, isPending: sessionLoading } = useSessionQuery();
  const meEnabled = Boolean(session?.authenticated);
  const { data: me, isPending: meLoading, isFetched: meFetched } = useMeQuery(meEnabled);
  const { data: project, isPending: projectLoading } = useProjectDetailQuery(projectId, meEnabled);

  const escrowChainId = project?.chainId ?? undefined;
  const activeChainId = useChainId();
  const publicClient = usePublicClient({ chainId: escrowChainId });
  const { data: walletClient } = useWalletClient({ chainId: escrowChainId });
  const { switchChainAsync } = useSwitchChain();

  const [note, setNote] = useState("");
  const [externalLink, setExternalLink] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgressPct, setUploadProgressPct] = useState(0);
  const [submitPhase, setSubmitPhase] = useState<"upload" | "chain">("upload");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successResponse, setSuccessResponse] = useState<CreateSubmissionResponse | null>(null);
  const [pendingChainAfterApi, setPendingChainAfterApi] =
    useState<CreateSubmissionResponse | null>(null);

  const loading = sessionLoading || (meEnabled && meLoading && !meFetched) || projectLoading;

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
    if (me && needsOnboarding(me)) {
      router.replace("/onboarding");
    }
  }, [session, sessionLoading, me, meFetched, router]);

  const milestone = useMemo(
    () => project?.milestones.find((m) => m.id === milestoneId) ?? null,
    [project, milestoneId],
  );
  const isFreelancerOwner = Boolean(
    me &&
    project &&
    me.roles.includes("FREELANCER") &&
    project.freelancer &&
    project.freelancer.id === me.id,
  );

  const chainMismatch = Boolean(
    project &&
    projectHasEscrowBinding(project) &&
    project.chainId != null &&
    activeChainId !== project.chainId,
  );

  async function confirmSubmitMilestoneOnChain(
    response: CreateSubmissionResponse,
    projectDetail: ProjectDetail,
    milestoneSortOrder: number,
  ): Promise<void> {
    if (!projectHasEscrowBinding(projectDetail)) {
      return;
    }
    const submissionUri =
      response.submission.deliverablesIpfsUri || response.submission.metadataIpfsUri;
    if (!submissionUri) {
      throw new Error("Submission is missing an IPFS metadata URI for on-chain registration.");
    }
    if (new TextEncoder().encode(submissionUri).length > ON_CHAIN_URI_MAX_BYTES) {
      throw new Error(
        `Submission metadata URI exceeds the on-chain limit (${ON_CHAIN_URI_MAX_BYTES} bytes). Try a shorter external link or note.`,
      );
    }
    if (!publicClient || !walletClient) {
      throw new Error("Connect your wallet on the project network to register this milestone on-chain.");
    }
    if (projectDetail.chainId != null && activeChainId !== projectDetail.chainId) {
      throw new Error(
        `Switch your wallet to chain ${projectDetail.chainId} before confirming the on-chain milestone submit.`,
      );
    }

    setSubmitPhase("chain");
    const hash = await writeSubmitMilestoneTx({
      publicClient,
      walletClient,
      escrowContractAddress: projectDetail.escrowContractAddress as `0x${string}`,
      onChainProjectId: projectDetail.onChainProjectId as string,
      milestoneIndex: milestoneSortOrder,
      submissionUri,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  async function onSubmit() {
    if (!projectId || !milestoneId || !project || !milestone) {
      return;
    }
    setErrorMessage(null);
    setSuccessResponse(null);
    setPendingChainAfterApi(null);

    if (!files.length) {
      setErrorMessage("Please select at least one deliverable file.");
      return;
    }
    if (!isFreelancerOwner) {
      setErrorMessage("Only the assigned freelancer can submit work for this milestone.");
      return;
    }
    if (!canSubmitMilestone(milestone.status)) {
      setErrorMessage("This milestone is not currently open for submissions.");
      return;
    }

    setSubmitting(true);
    setSubmitPhase("upload");
    setUploadProgressPct(0);
    let apiResponse: CreateSubmissionResponse | null = null;
    try {
      const encodedFiles = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileBase64: await fileToBase64(file),
        })),
      );

      const payload = {
        note: note.trim() ? note.trim() : null,
        externalLink: externalLink.trim() ? externalLink.trim() : null,
        files: encodedFiles,
      };

      apiResponse = await postSubmissionWithProgress(
        `/api/v1/projects/${projectId}/milestones/${milestoneId}/submissions`,
        payload,
        setUploadProgressPct,
      );

      if (projectHasEscrowBinding(project)) {
        await confirmSubmitMilestoneOnChain(apiResponse, project, milestone.sortOrder);
      }

      setSuccessResponse(apiResponse);
      setNote("");
      setExternalLink("");
      setFiles([]);
      setUploadProgressPct(100);
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    } catch (error) {
      if (apiResponse && projectHasEscrowBinding(project)) {
        setPendingChainAfterApi(apiResponse);
        setErrorMessage(
          error instanceof Error
            ? `${error.message} Your submission is saved in the app; use “Retry on-chain submit” after fixing the issue (e.g. network, funding, or wallet chain).`
            : "On-chain registration failed. Your submission is saved in the app; you can retry below.",
        );
      } else {
        setErrorMessage(error instanceof Error ? error.message : "Submission failed");
      }
      setUploadProgressPct(0);
    } finally {
      setSubmitting(false);
      setSubmitPhase("upload");
    }
  }

  async function retryOnChainSubmit(): Promise<void> {
    if (!pendingChainAfterApi || !project || !milestone) {
      return;
    }
    setErrorMessage(null);
    setSubmitting(true);
    try {
      await confirmSubmitMilestoneOnChain(pendingChainAfterApi, project, milestone.sortOrder);
      setSuccessResponse(pendingChainAfterApi);
      setPendingChainAfterApi(null);
      setNote("");
      setExternalLink("");
      setFiles([]);
      setUploadProgressPct(100);
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "On-chain submit failed");
    } finally {
      setSubmitting(false);
      setSubmitPhase("upload");
    }
  }

  return (
    <AuthShell
      title="Submit milestone work"
      subtitle="Upload deliverables, add context, and publish signed submission metadata to IPFS."
      className="overflow-x-hidden"
      containerClassName="max-w-3xl sm:max-w-3xl"
      iconBrandOnly
    >
      {loading || !project || !milestone || !me ? (
        <MilestoneSubmissionSkeleton />
      ) : (
        <div className="flex flex-col gap-5">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="break-words text-lg sm:text-xl">{milestone.title}</CardTitle>
              <CardDescription>
                Project: {project.title} · Status: {prettyStatus(milestone.status)}
              </CardDescription>
            </CardHeader>
            <div className="space-y-3 px-4 pb-6 sm:px-6">
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 px-3 py-3 sm:px-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Submission flow</p>
                <p className="mt-1 text-xs text-zinc-400">
                  Upload deliverables, attach context, then optionally confirm on-chain submission.
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/60 p-3 text-xs text-zinc-300">
                Files are stored on IPFS and referenced by immutable content IDs. Submission
                metadata is also pinned to IPFS for transparent auditability.
                {projectHasEscrowBinding(project) ? (
                  <>
                    {" "}
                    This project is bound to escrow on chain {project.chainId}: after upload you
                    will be asked to sign one transaction so the registry records the milestone as
                    submitted (required before the client can approve payout).
                  </>
                ) : null}
              </div>

              {chainMismatch ? (
                <div className="rounded-xl border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                  <p>Switch your wallet to chain {project.chainId} before submitting.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="mt-2 w-full sm:w-auto"
                    onClick={() => {
                      void switchChainAsync({ chainId: project.chainId! });
                    }}
                  >
                    Switch network
                  </Button>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="submission-note">Delivery note</Label>
                <Textarea
                  id="submission-note"
                  placeholder="Summarize what was delivered and any important context."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={5000}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="submission-link">External link (optional)</Label>
                <Input
                  id="submission-link"
                  placeholder="https://example.com/demo"
                  value={externalLink}
                  onChange={(e) => setExternalLink(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="submission-files">Deliverable files</Label>
                <Input
                  id="submission-files"
                  type="file"
                  multiple
                  onChange={(e) => {
                    const nextFiles = Array.from(e.target.files ?? []);
                    setFiles(nextFiles);
                  }}
                />
                <div className="space-y-1">
                  <p className="text-xs text-zinc-400">
                    Up to 5 files are accepted per submission.
                  </p>
                  {files.length === 0 ? (
                    <p className="text-xs text-zinc-400">No files selected yet.</p>
                  ) : (
                    files.map((file) => (
                      <div
                        key={`${file.name}-${file.size}`}
                        className="flex flex-col gap-1 rounded-lg border border-zinc-800/90 bg-zinc-950/70 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                      >
                        <p className="break-all text-zinc-300">{file.name}</p>
                        <p className="text-zinc-500">{formatFileSize(file.size)}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {submitting ? (
                <div className="space-y-2 rounded-xl border border-cyan-300/30 bg-cyan-300/10 p-3">
                  <p className="text-xs font-medium text-cyan-100">
                    {submitPhase === "chain"
                      ? "Confirm on-chain milestone submit in your wallet…"
                      : `Uploading submission… ${uploadProgressPct}%`}
                  </p>
                  {submitPhase === "upload" ? (
                    <div className="h-2 rounded-full bg-zinc-800">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-cyan-400 to-cyan-300 transition-all"
                        style={{ width: `${uploadProgressPct}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <FieldError message={errorMessage ?? undefined} />

              {pendingChainAfterApi ? (
                <div className="rounded-xl border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                  <p className="font-medium">On-chain step incomplete</p>
                  <p className="mt-1 text-amber-100/90">
                    Attempt #{pendingChainAfterApi.submission.attemptNumber} is stored in the app,
                    but the escrow contract still needs your{" "}
                    <code className="rounded bg-amber-200/25 px-1 py-0.5">
                      submitMilestone
                    </code>{" "}
                    transaction.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-2 w-full sm:w-auto"
                    disabled={submitting || chainMismatch}
                    onClick={() => void retryOnChainSubmit()}
                  >
                    {submitting ? "Working…" : "Retry on-chain submit"}
                  </Button>
                </div>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => router.push(`/projects/${project.id}`)}
                >
                  Back to project
                </Button>
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  disabled={submitting || Boolean(pendingChainAfterApi) || chainMismatch}
                  onClick={() => void onSubmit()}
                >
                  {submitting ? "Submitting…" : "Submit milestone work"}
                </Button>
              </div>
            </div>
          </Card>

          {successResponse && project ? (
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Submission created</CardTitle>
                <CardDescription>
                  {projectHasEscrowBinding(project) ? (
                    <>
                      Submission metadata is on IPFS and the escrow registry records this milestone
                      as submitted on-chain, so the client can approve and release payout.
                    </>
                  ) : (
                    <>
                      Latest submission data has been saved and is ready for client review.
                    </>
                  )}
                </CardDescription>
              </CardHeader>
              <div className="space-y-2 px-4 pb-6 text-sm text-zinc-300 sm:px-6">
                <p>
                  Attempt #{successResponse.submission.attemptNumber} · Status:{" "}
                  {prettyStatus(successResponse.submission.status)}
                </p>
                <p className="break-all">
                  Metadata URI: {successResponse.submission.metadataIpfsUri ?? "Not available"}
                </p>
                <p className="break-words">
                  Note: {successResponse.submission.note ?? "No note provided"}
                </p>
              </div>
            </Card>
          ) : null}
        </div>
      )}
    </AuthShell>
  );
}

function MilestoneSubmissionSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="space-y-3 p-4 sm:p-6">
        <div className="h-6 w-56 animate-pulse rounded bg-zinc-800" />
        <div className="h-3 w-full animate-pulse rounded bg-zinc-900/80" />
      </div>
      <div className="space-y-3 px-4 pb-6 sm:px-6">
        <div className="h-16 animate-pulse rounded-xl bg-zinc-900/80" />
        <div className="h-16 animate-pulse rounded-xl bg-zinc-900/80" />
        <div className="h-24 animate-pulse rounded-xl bg-zinc-900/80" />
        <div className="h-12 animate-pulse rounded-xl bg-zinc-900/80" />
        <div className="h-24 animate-pulse rounded-xl bg-zinc-900/80" />
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <div className="h-10 w-full animate-pulse rounded-xl bg-zinc-900/80 sm:w-36" />
          <div className="h-10 w-full animate-pulse rounded-xl bg-zinc-900/80 sm:w-44" />
        </div>
      </div>
    </Card>
  );
}

function projectHasEscrowBinding(project: ProjectDetail): boolean {
  return Boolean(
    project.onChainProjectId && project.escrowContractAddress && project.chainId != null,
  );
}

function canSubmitMilestone(status: string): boolean {
  return ["FUNDED", "IN_PROGRESS", "REJECTED"].includes(status);
}

function prettyStatus(status: string): string {
  return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not encode file"));
        return;
      }
      const base64 = result.split(",")[1];
      if (!base64) {
        reject(new Error("Could not encode file"));
        return;
      }
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

function postSubmissionWithProgress(
  url: string,
  payload: unknown,
  onProgress: (pct: number) => void,
): Promise<CreateSubmissionResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/json");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }
      const pct = Math.min(100, Math.round((event.loaded / event.total) * 100));
      onProgress(pct);
    };

    xhr.onerror = () => reject(new Error("Network error while uploading submission"));
    xhr.onload = () => {
      let parsed: unknown = {};
      try {
        parsed = xhr.responseText ? (JSON.parse(xhr.responseText) as unknown) : {};
      } catch {
        parsed = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as CreateSubmissionResponse);
        return;
      }
      const message =
        typeof parsed === "object" &&
          parsed &&
          "error" in parsed &&
          typeof (parsed as { error?: { message?: unknown } }).error?.message === "string"
          ? (parsed as { error: { message: string } }).error.message
          : `Submission failed (${xhr.status})`;
      reject(new Error(message));
    };

    xhr.send(JSON.stringify(payload));
  });
}
