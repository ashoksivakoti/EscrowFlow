"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { needsOnboarding } from "@/lib/auth/client-guards";
import { useMeQuery } from "@/hooks/use-me-query";
import { useProjectDetailQuery } from "@/hooks/use-project-detail-query";
import { useSessionQuery } from "@/hooks/use-session-query";

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

  return (
    <AuthShell
      title="Project details"
      subtitle="Project shell for milestone timeline, submissions, and disputes."
      className="overflow-x-hidden"
      containerClassName="max-w-5xl sm:max-w-5xl"
    >
      {loading || !project ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <Spinner />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading project…</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>{project.title}</CardTitle>
              <CardDescription>
                Status: {project.status.replaceAll("_", " ").toLowerCase()} · Milestones:{" "}
                {project.milestoneCount}
              </CardDescription>
            </CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
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
        </div>
      )}
    </AuthShell>
  );
}
