"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { needsOnboarding } from "@/lib/auth/client-guards";
import { useMeQuery } from "@/hooks/use-me-query";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import { useSessionQuery } from "@/hooks/use-session-query";

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session, isPending: sessionLoading } = useSessionQuery();
  const meEnabled = Boolean(session?.authenticated);
  const { data: me, isPending: meLoading, isFetched: meFetched } =
    useMeQuery(meEnabled);
  const { data: projects, isPending: projectsLoading } = useProjectsQuery(meEnabled);

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
    if (!me) {
      router.replace("/login");
      return;
    }
    if (needsOnboarding(me)) {
      router.replace("/onboarding");
    }
  }, [session, sessionLoading, me, meFetched, router]);

  async function signOut() {
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    await queryClient.invalidateQueries();
    router.replace("/login");
  }

  const loading = sessionLoading || (meEnabled && meLoading && !meFetched);

  return (
    <AuthShell
      title="Dashboard"
      subtitle="Your escrow workspace. Project lists and chain actions will land here next."
    >
      {loading || !me ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <Spinner />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Loading your workspace…
          </p>
        </div>
      ) : (
        <div className="flex w-full flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Hello, {me.displayName}</CardTitle>
              <CardDescription>
                Signed in as{" "}
                <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                  {me.walletAddress}
                </span>
                . Roles: {me.roles.length ? me.roles.join(", ") : "—"}
              </CardDescription>
            </CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row">
              {me.roles.includes("CLIENT") ? (
                <Button type="button" onClick={() => router.push("/projects/new")}>
                  Create project
                </Button>
              ) : null}
              <Button type="button" variant="secondary" onClick={() => signOut()}>
                Sign out
              </Button>
            </div>
          </Card>

          {me.roles.includes("CLIENT") ? (
            <Card>
              <CardHeader>
                <CardTitle>Funding queue</CardTitle>
                <CardDescription>
                  Projects waiting for escrow funding before work begins.
                </CardDescription>
              </CardHeader>
              {projectsLoading ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading projects…</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {(projects?.items ?? [])
                    .filter((p) => p.status === "AWAITING_ESCROW")
                    .slice(0, 5)
                    .map((p) => (
                      <div
                        key={p.id}
                        className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {p.title}
                          </p>
                          <p className="text-xs text-zinc-600 dark:text-zinc-400">
                            Total: {p.totalValueWei ?? "—"} (smallest units)
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => router.push(`/projects/${p.id}/funding`)}
                        >
                          Open funding
                        </Button>
                      </div>
                    ))}
                  {(projects?.items ?? []).filter((p) => p.status === "AWAITING_ESCROW")
                    .length === 0 ? (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      No projects waiting for funding.
                    </p>
                  ) : null}
                </div>
              )}
            </Card>
          ) : null}
        </div>
      )}
    </AuthShell>
  );
}
