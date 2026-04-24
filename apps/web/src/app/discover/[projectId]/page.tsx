"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { AuthShell } from "@/components/layout/auth-shell";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { needsOnboarding } from "@/lib/auth/client-guards";
import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";
import { useMeQuery } from "@/hooks/use-me-query";
import { usePublicProjectQuery } from "@/hooks/use-public-project-query";
import { useSessionQuery } from "@/hooks/use-session-query";
import { MARKETPLACE_APPLICATION_FIELD_LIMITS } from "@/lib/marketplace/form-limits";

const L = MARKETPLACE_APPLICATION_FIELD_LIMITS;

const applySchema = z.object({
  coverLetter: z
    .string()
    .trim()
    .min(L.coverLetter.min, `Use at least ${L.coverLetter.min} characters`)
    .max(L.coverLetter.max),
  portfolioLink: z
    .string()
    .trim()
    .min(1, "Portfolio link is required")
    .url("Enter a valid URL")
    .max(L.portfolioUrl.max),
  proposedTimeline: z.string().trim().max(L.proposedTimeline.max).optional(),
});

type ApplyForm = z.infer<typeof applySchema>;

export default function DiscoverProjectDetailPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? null;
  const queryClient = useQueryClient();

  const { data: session, isPending: sessionLoading } = useSessionQuery();
  const meEnabled = Boolean(session?.authenticated);
  const { data: me, isPending: meLoading, isFetched: meFetched } = useMeQuery(meEnabled);
  const canLoad = Boolean(projectId) && Boolean(me) && !needsOnboarding(me!);
  const { data, isPending: projectLoading, error } = usePublicProjectQuery(projectId ?? undefined, canLoad);

  const [applyOpen, setApplyOpen] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const form = useForm<ApplyForm>({
    resolver: zodResolver(applySchema),
    defaultValues: { coverLetter: "", portfolioLink: "", proposedTimeline: "" },
  });

  const applyMutation = useMutation({
    mutationFn: async (values: ApplyForm) => {
      const res = await fetch(`/api/v1/projects/${projectId}/applications`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coverLetter: values.coverLetter.trim(),
          portfolioLink: values.portfolioLink.trim(),
          proposedTimeline: values.proposedTimeline?.trim() || null,
        }),
      });
      const raw = await readJsonOrEmpty(res);
      if (!res.ok) {
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }
      return raw;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["public-project", projectId] });
      setApplyOpen(false);
      form.reset();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError) {
        setApplyError(e.message);
        return;
      }
      setApplyError("Could not submit application.");
    },
  });

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
      return;
    }
    if (!me.roles.includes("FREELANCER")) {
      router.replace("/dashboard");
    }
  }, [session, sessionLoading, me, meFetched, router]);

  const loading =
    !projectId || sessionLoading || (meEnabled && meLoading && !meFetched) || (canLoad && projectLoading);

  const myStatus = data?.myApplicationStatus;
  const canApply =
    Boolean(me) &&
    me?.id !== data?.project.client.id &&
    !myStatus &&
    !applyMutation.isSuccess;

  return (
    <AuthShell
      title="Project opportunity"
      subtitle="Review scope and submit a single application for this listing."
      className="overflow-x-hidden"
      containerClassName="max-w-3xl sm:max-w-3xl"
      iconBrandOnly
    >
      {loading ? (
        <DiscoverProjectDetailSkeleton />
      ) : error || !data ? (
        <Card>
          <CardHeader>
            <CardTitle>Not available</CardTitle>
            <CardDescription>
              This listing may have been filled or is no longer public.
            </CardDescription>
          </CardHeader>
          <div className="px-4 pb-4 sm:px-6">
            <Link href="/discover" className={buttonClassName({ variant: "secondary", className: "w-full sm:w-auto" })}>
              Back to discover
            </Link>
          </div>
        </Card>
      ) : (
        <div className="flex w-full max-w-full flex-col gap-5">
          <Card className="w-full max-w-full overflow-hidden">
            <CardHeader>
              <CardTitle className="text-balance text-2xl tracking-tight sm:text-3xl">{data.project.title}</CardTitle>
              <CardDescription className="text-pretty">
                {data.project.description?.trim() || "No description provided."}
              </CardDescription>
            </CardHeader>
            <div className="space-y-2 border-t border-zinc-800/90 px-4 py-4 text-sm sm:px-6">
              <p>
                <span className="font-medium text-zinc-200">Client: </span>
                {data.project.client.displayName ?? "—"}
              </p>
              <p className="break-all text-xs text-zinc-400">
                {data.project.client.walletAddress}
              </p>
              <p>
                <span className="font-medium text-zinc-200">Milestones: </span>
                {data.project.milestones.length}
              </p>
            </div>
            <div className="flex flex-col gap-2 border-t border-zinc-800/90 px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:px-6">
              <Link href="/discover" className={buttonClassName({ variant: "secondary", className: "w-full sm:w-auto" })}>
                Back
              </Link>
              {me?.id === data.project.client.id ? (
                <p className="break-words text-sm text-zinc-400">You posted this project.</p>
              ) : myStatus ? (
                <p className="break-words text-sm text-zinc-400">
                  Your application status: <span className="font-medium">{myStatus}</span>
                </p>
              ) : canApply ? (
                <Button type="button" className="w-full sm:w-auto" onClick={() => setApplyOpen((v) => !v)}>
                  {applyOpen ? "Close form" : "Apply to project"}
                </Button>
              ) : null}
            </div>
          </Card>

          {applyOpen && canApply ? (
            <Card className="w-full max-w-full overflow-hidden">
              <CardHeader>
                <CardTitle className="text-lg">Application</CardTitle>
                <CardDescription>
                  One application per account. Be specific about fit and delivery.
                </CardDescription>
              </CardHeader>
              <form
                className="flex flex-col gap-4 px-4 pb-6 sm:gap-5 sm:px-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  setApplyError(null);
                  void form.handleSubmit((vals) => applyMutation.mutate(vals))();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="coverLetter">Cover letter</Label>
                  <Textarea id="coverLetter" rows={6} {...form.register("coverLetter")} />
                  <FieldError message={form.formState.errors.coverLetter?.message} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="portfolioLink">Portfolio link</Label>
                  <Input id="portfolioLink" type="url" placeholder="https://..." {...form.register("portfolioLink")} />
                  <FieldError message={form.formState.errors.portfolioLink?.message} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="proposedTimeline">Proposed timeline (optional)</Label>
                  <Textarea id="proposedTimeline" rows={3} {...form.register("proposedTimeline")} />
                  <FieldError message={form.formState.errors.proposedTimeline?.message} />
                </div>
                <FieldError message={applyError ?? undefined} />
                <Button type="submit" className="w-full sm:w-auto" disabled={applyMutation.isPending}>
                  {applyMutation.isPending ? "Submitting…" : "Submit application"}
                </Button>
              </form>
            </Card>
          ) : null}
        </div>
      )}
    </AuthShell>
  );
}

function DiscoverProjectDetailSkeleton() {
  return (
    <div className="flex w-full max-w-full flex-col gap-5">
      <Card className="w-full max-w-full overflow-hidden">
        <div className="space-y-3 p-4 sm:p-6">
          <div className="h-8 w-3/4 animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-full animate-pulse rounded bg-zinc-900/80" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-900/80" />
        </div>
        <div className="space-y-2 border-t border-zinc-800/90 px-4 py-4 sm:px-6">
          <div className="h-3 w-1/3 animate-pulse rounded bg-zinc-800/90" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-900/80" />
          <div className="h-3 w-1/4 animate-pulse rounded bg-zinc-800/90" />
        </div>
      </Card>
      <Card className="w-full max-w-full overflow-hidden">
        <div className="space-y-3 p-4 sm:p-6">
          <div className="h-5 w-40 animate-pulse rounded bg-zinc-800" />
          <div className="h-24 animate-pulse rounded-xl bg-zinc-900/80" />
          <div className="h-12 animate-pulse rounded-xl bg-zinc-900/80" />
          <div className="h-24 animate-pulse rounded-xl bg-zinc-900/80" />
          <div className="h-10 w-full animate-pulse rounded-xl bg-zinc-900/80 sm:w-44" />
        </div>
      </Card>
    </div>
  );
}
