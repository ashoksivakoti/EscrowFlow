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
    <div className="mt-3 rounded-xl border border-amber-300/35 bg-amber-300/10 p-3 sm:p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-200">
        Raise dispute
      </p>
      <p className="mt-2 text-xs leading-relaxed text-amber-100/85">
        Raising a dispute freezes approval/release actions for this milestone until review is
        resolved. Attach evidence files to support your claim (up to 5 files).
      </p>

      <div className="mt-3 space-y-3">
        <div className="space-y-1">
          <label
            htmlFor="dispute-reason"
            className="text-xs font-medium text-zinc-200"
          >
            Reason
          </label>
          <Textarea
            id="dispute-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe why this milestone requires dispute review"
            maxLength={5000}
            className="min-h-[110px]"
            disabled={submitting}
          />
        </div>

        <div className="space-y-1">
          <label
            htmlFor="dispute-evidence-files"
            className="text-xs font-medium text-zinc-200"
          >
            Evidence files
          </label>
          <Input
            id="dispute-evidence-files"
            type="file"
            multiple
            disabled={submitting}
            onChange={(event) => {
              const selected = event.target.files ? Array.from(event.target.files) : [];
              setFiles(selected);
            }}
          />
          {files.length ? (
            <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-2 text-xs text-zinc-300">
              {files.map((file) => (
                <p key={`${file.name}-${file.size}`} className="break-all">
                  {file.name} ({formatFileSize(file.size)})
                </p>
              ))}
            </div>
          ) : null}
        </div>

        {successMessage ? (
          <div className="rounded-xl border border-emerald-300/35 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100">
            {successMessage}
          </div>
        ) : null}

        <FieldError message={errorMessage ?? undefined} className="text-xs" />

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" size="sm" className="w-full sm:w-auto" disabled={submitting} onClick={() => void onSubmitDispute()}>
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
