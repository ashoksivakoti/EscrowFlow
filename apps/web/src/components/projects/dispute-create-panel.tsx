"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function DisputeCreatePanel(props: {
  projectId: string;
  milestoneId: string;
  relatedSubmissionId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function onSubmitDispute(): Promise<void> {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (reason.trim().length < 10) {
      setErrorMessage("Please provide at least 10 characters in dispute reason.");
      return;
    }
    if (files.length === 0) {
      setErrorMessage("Please upload at least one evidence file.");
      return;
    }

    setSubmitting(true);
    try {
      const encodedFiles = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileBase64: await fileToBase64(file),
        })),
      );

      const response = await fetch(
        `/api/v1/projects/${props.projectId}/milestones/${props.milestoneId}/disputes`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: reason.trim(),
            files: encodedFiles,
            relatedSubmissionId: props.relatedSubmissionId ?? null,
          }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? "Could not raise dispute");
      }

      setSuccessMessage(
        "Dispute submitted. This milestone is now frozen while admin/arbitrator review is pending.",
      );
      setReason("");
      setFiles([]);
      await queryClient.invalidateQueries({ queryKey: ["project", props.projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not raise dispute");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
        Raise dispute
      </p>
      <p className="mt-2 text-xs text-amber-900/90 dark:text-amber-200">
        Raising a dispute freezes approval/release actions for this milestone until review is
        resolved. Attach evidence files to support your claim.
      </p>

      <div className="mt-3 space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Reason
          </label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe why this milestone requires dispute review"
            maxLength={5000}
            className="min-h-[110px]"
            disabled={submitting}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Evidence files
          </label>
          <Input
            type="file"
            multiple
            disabled={submitting}
            onChange={(event) => {
              const selected = event.target.files ? Array.from(event.target.files) : [];
              setFiles(selected);
            }}
          />
          {files.length ? (
            <div className="rounded-lg border border-zinc-200 bg-white p-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              {files.map((file) => (
                <p key={`${file.name}-${file.size}`} className="break-all">
                  {file.name} ({formatFileSize(file.size)})
                </p>
              ))}
            </div>
          ) : null}
        </div>

        {successMessage ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            {successMessage}
          </div>
        ) : null}

        <FieldError message={errorMessage ?? undefined} className="text-xs" />

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" size="sm" disabled={submitting} onClick={() => void onSubmitDispute()}>
            {submitting ? "Submitting dispute…" : "Submit dispute"}
          </Button>
        </div>
      </div>
    </div>
  );
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
