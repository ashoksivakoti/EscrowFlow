"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import type { CreateSubmissionResponse } from "@escrowflow/types";

import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { useMeQuery } from "@/hooks/use-me-query";
import { useProjectDetailQuery } from "@/hooks/use-project-detail-query";
import { useSessionQuery } from "@/hooks/use-session-query";
import { needsOnboarding } from "@/lib/auth/client-guards";

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

  const [note, setNote] = useState("");
  const [externalLink, setExternalLink] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgressPct, setUploadProgressPct] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successResponse, setSuccessResponse] = useState<CreateSubmissionResponse | null>(null);

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

  async function onSubmit() {
    if (!projectId || !milestoneId) {
      return;
    }
    setErrorMessage(null);
    setSuccessResponse(null);

    if (!files.length) {
      setErrorMessage("Please select at least one deliverable file.");
      return;
    }
    if (!isFreelancerOwner) {
      setErrorMessage("Only the assigned freelancer can submit work for this milestone.");
      return;
    }
    if (!milestone || !canSubmitMilestone(milestone.status)) {
      setErrorMessage("This milestone is not currently open for submissions.");
      return;
    }

    setSubmitting(true);
    setUploadProgressPct(0);
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

      const response = await postSubmissionWithProgress(
        `/api/v1/projects/${projectId}/milestones/${milestoneId}/submissions`,
        payload,
        setUploadProgressPct,
      );

      setSuccessResponse(response);
      setNote("");
      setExternalLink("");
      setFiles([]);
      setUploadProgressPct(100);
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Submission failed");
      setUploadProgressPct(0);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Submit milestone work"
      subtitle="Upload deliverables, add context, and publish submission metadata to IPFS."
      className="overflow-x-hidden"
      containerClassName="max-w-3xl sm:max-w-3xl"
    >
      {loading || !project || !milestone || !me ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <Spinner />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Preparing submission form…</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg sm:text-xl">{milestone.title}</CardTitle>
              <CardDescription>
                Project: {project.title} · Status: {prettyStatus(milestone.status)}
              </CardDescription>
            </CardHeader>
            <div className="space-y-3">
              <div className="rounded-xl border border-zinc-200 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                Files are stored on IPFS and referenced by immutable content IDs. Submission
                metadata is also pinned to IPFS for transparent auditability.
              </div>

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
                  {files.length === 0 ? (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">No files selected yet.</p>
                  ) : (
                    files.map((file) => (
                      <div
                        key={`${file.name}-${file.size}`}
                        className="flex flex-col gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <p className="break-all text-zinc-700 dark:text-zinc-300">{file.name}</p>
                        <p className="text-zinc-500 dark:text-zinc-400">{formatFileSize(file.size)}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {submitting ? (
                <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
                  <p className="text-xs font-medium text-indigo-800 dark:text-indigo-300">
                    Uploading submission… {uploadProgressPct}%
                  </p>
                  <div className="h-2 rounded-full bg-indigo-100 dark:bg-indigo-900/60">
                    <div
                      className="h-2 rounded-full bg-indigo-600 transition-all"
                      style={{ width: `${uploadProgressPct}%` }}
                    />
                  </div>
                </div>
              ) : null}

              <FieldError message={errorMessage ?? undefined} />

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => router.push(`/projects/${project.id}`)}
                >
                  Back to project
                </Button>
                <Button type="button" disabled={submitting} onClick={() => void onSubmit()}>
                  {submitting ? "Submitting…" : "Submit milestone work"}
                </Button>
              </div>
            </div>
          </Card>

          {successResponse ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Submission created</CardTitle>
                <CardDescription>
                  Latest submission data has been saved and is ready for client review.
                </CardDescription>
              </CardHeader>
              <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
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
