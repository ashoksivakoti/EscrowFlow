"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { AuthShell } from "@/components/layout/auth-shell";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { needsOnboarding } from "@/lib/auth/client-guards";
import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";
import { useMeQuery } from "@/hooks/use-me-query";
import { useProjectApplicationsQuery } from "@/hooks/use-project-applications-query";
import { useSessionQuery } from "@/hooks/use-session-query";

export default function ProjectApplicationsPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? null;
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: session, isPending: sessionLoading } = useSessionQuery();
  const meEnabled = Boolean(session?.authenticated);
  const { data: me, isPending: meLoading, isFetched: meFetched } = useMeQuery(meEnabled);
  const enabled = Boolean(projectId) && Boolean(me?.roles.includes("CLIENT"));
  const { data, isPending, refetch } = useProjectApplicationsQuery(projectId ?? undefined, enabled);

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

  const acceptMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      const res = await fetch(
        `/api/v1/projects/${projectId}/applications/${applicationId}/accept`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) {
        const raw = await readJsonOrEmpty(res);
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project-applications", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.replace(`/projects/${projectId}`);
    },
    onError: (e) => {
      if (e instanceof ApiRequestError) {
        setActionError(e.message);
        return;
      }
      setActionError("Could not accept application.");
    },
  });

  const declineMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      const res = await fetch(
        `/api/v1/projects/${projectId}/applications/${applicationId}/decline`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) {
        const raw = await readJsonOrEmpty(res);
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }
    },
    onSuccess: async () => {
      setActionError(null);
      await refetch();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError) {
        setActionError(e.message);
        return;
      }
      setActionError("Could not decline application.");
    },
  });

  const loading = !projectId || sessionLoading || (meEnabled && meLoading && !meFetched);

  return (
    <AuthShell
      title="Applications"
      subtitle="Review freelancers who applied to this marketplace posting."
      className="overflow-x-hidden"
      containerClassName="max-w-4xl sm:max-w-4xl"
    >
      {loading || !me ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <Spinner />
        </div>
      ) : !me.roles.includes("CLIENT") ? (
        <Card>
          <CardHeader>
            <CardTitle>Client access only</CardTitle>
            <CardDescription>Only the project client can manage applications.</CardDescription>
          </CardHeader>
        </Card>
      ) : isPending ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <div className="flex w-full max-w-full flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href={`/projects/${projectId}`}
              className={buttonClassName({ variant: "secondary", className: "w-full sm:w-auto" })}
            >
              Back to project
            </Link>
          </div>
          {actionError ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {actionError}
            </p>
          ) : null}
          {!data?.applications.length ? (
            <Card>
              <CardHeader>
                <CardTitle>No applications yet</CardTitle>
                <CardDescription>Share the listing with freelancers you trust.</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              {data.applications.map((app) => (
                <Card key={app.id} className="w-full max-w-full overflow-hidden">
                  <CardHeader className="min-w-0">
                    <CardTitle className="text-base">
                      {app.freelancer.displayName ?? "Freelancer"}
                    </CardTitle>
                    <CardDescription className="break-all font-mono text-xs">
                      {app.freelancer.walletAddress}
                    </CardDescription>
                  </CardHeader>
                  <div className="space-y-2 border-t border-zinc-800/90 px-4 py-3 text-sm sm:px-6">
                    <p className="inline-flex w-fit rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-200">
                      {app.status}
                    </p>
                    <p className="whitespace-pre-wrap text-zinc-100">{app.coverLetter}</p>
                    {app.portfolioLink ? (
                      <a
                        href={app.portfolioLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-8 items-center break-all rounded-md px-1.5 text-cyan-300 transition-colors hover:bg-cyan-300/10 hover:text-cyan-200"
                      >
                        Portfolio
                      </a>
                    ) : null}
                    {app.proposedTimeline ? (
                      <p className="break-words text-xs text-zinc-600 dark:text-zinc-400">
                        {app.proposedTimeline}
                      </p>
                    ) : null}
                  </div>
                  {app.status === "PENDING" ? (
                    <div className="flex flex-col gap-2 border-t border-zinc-800/90 px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full sm:w-auto"
                        disabled={declineMutation.isPending || acceptMutation.isPending}
                        onClick={() => declineMutation.mutate(app.id)}
                      >
                        Decline
                      </Button>
                      <Button
                        type="button"
                        className="w-full sm:w-auto"
                        disabled={acceptMutation.isPending || declineMutation.isPending}
                        onClick={() => acceptMutation.mutate(app.id)}
                      >
                        Accept
                      </Button>
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </AuthShell>
  );
}
