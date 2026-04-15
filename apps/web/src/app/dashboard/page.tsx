"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { needsOnboarding } from "@/lib/auth/client-guards";
import { useClientDashboardQuery } from "@/hooks/use-client-dashboard-query";
import { useMeQuery } from "@/hooks/use-me-query";
import { useSessionQuery } from "@/hooks/use-session-query";

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session, isPending: sessionLoading } = useSessionQuery();
  const meEnabled = Boolean(session?.authenticated);
  const { data: me, isPending: meLoading, isFetched: meFetched } =
    useMeQuery(meEnabled);
  const clientDashboardEnabled = Boolean(meEnabled && me?.roles.includes("CLIENT"));
  const { data: dashboard, isPending: dashboardLoading } =
    useClientDashboardQuery(clientDashboardEnabled);

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

  const loading =
    sessionLoading ||
    (meEnabled && meLoading && !meFetched) ||
    (clientDashboardEnabled && dashboardLoading && !dashboard);
  const pendingReviewItems =
    dashboard?.actions.filter((item) => item.kind === "MILESTONE_CLIENT_REVIEW") ?? [];
  const recentTransactions = dashboard?.recentTransactions ?? [];
  const recentNotifications = dashboard?.notifications ?? [];

  return (
    <AuthShell
      title="Client dashboard"
      subtitle="Track escrow health, pending reviews, and recent project activity."
      className="overflow-x-hidden"
      containerClassName="max-w-6xl sm:max-w-6xl"
    >
      {loading || !me ? (
        <div className="flex w-full flex-col gap-4">
          <DashboardSkeleton />
        </div>
      ) : !me.roles.includes("CLIENT") ? (
        <Card className="w-full max-w-full">
          <CardHeader>
            <CardTitle>Client dashboard is not available for this role</CardTitle>
            <CardDescription>
              Switch to a client account to manage escrow funding and milestone reviews.
            </CardDescription>
          </CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex w-full max-w-full flex-col gap-5">
          <Card className="w-full max-w-full">
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
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button type="button" onClick={() => router.push("/projects/new")}>
                Create new project
              </Button>
              <Button type="button" variant="secondary" onClick={() => signOut()}>
                Sign out
              </Button>
            </div>
          </Card>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label="Active projects"
              value={String(dashboard?.summary.activeProjectsCount ?? 0)}
              hint="Currently in progress"
            />
            <MetricCard
              label="Total escrow locked"
              value={formatWei(dashboard?.summary.totalEscrowLockedWei ?? "0")}
              hint="Token smallest units"
            />
            <MetricCard
              label="Pending milestone reviews"
              value={String(dashboard?.summary.pendingMilestoneReviewsCount ?? 0)}
              hint="Need client feedback"
            />
            <MetricCard
              label="Open disputes"
              value={String(dashboard?.summary.openDisputesCount ?? 0)}
              hint="Needs resolution"
            />
            <MetricCard
              label="Completed projects"
              value={String(dashboard?.summary.completedProjectsCount ?? 0)}
              hint="Closed successfully"
            />
          </section>

          <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card className="w-full max-w-full">
              <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Recent projects</CardTitle>
                <CardDescription>
                  Your latest projects across funding, active delivery, and completion.
                </CardDescription>
              </CardHeader>
              <div className="space-y-3">
                {(dashboard?.recentProjects ?? []).length === 0 ? (
                  <EmptyState
                    title="No projects yet"
                    description="Create your first escrow project to start tracking milestones."
                    actionLabel="Create project"
                    onAction={() => router.push("/projects/new")}
                  />
                ) : (
                  (dashboard?.recentProjects ?? []).map((project) => (
                    <ListRow
                      key={project.id}
                      title={project.title}
                      subtitle={`Status: ${prettyStatus(project.status)} • Updated ${formatTimeAgo(project.updatedAt)}`}
                      ctaLabel="Open project"
                      onClick={() => router.push(`/projects/${project.id}`)}
                    />
                  ))
                )}
              </div>
            </Card>

            <Card className="w-full max-w-full">
              <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Pending reviews</CardTitle>
                <CardDescription>
                  Milestone submissions waiting for your approval decision.
                </CardDescription>
              </CardHeader>
              <div className="space-y-3">
                {pendingReviewItems.length === 0 ? (
                  <EmptyState
                    title="No pending reviews"
                    description="You're all caught up on milestone reviews."
                  />
                ) : (
                  pendingReviewItems.map((item) => (
                    <ListRow
                      key={`${item.projectId}-${item.milestoneId ?? "none"}`}
                      title={item.title}
                      subtitle={item.dueAt ? `Due ${formatTimeAgo(item.dueAt)}` : "Review ready"}
                      ctaLabel="Review"
                      onClick={() => router.push(item.href)}
                    />
                  ))
                )}
              </div>
            </Card>
          </section>

          <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card className="w-full max-w-full">
              <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Recent transactions</CardTitle>
                <CardDescription>
                  Latest on-chain events synced into your project workspace.
                </CardDescription>
              </CardHeader>
              <div className="space-y-3">
                {recentTransactions.length === 0 ? (
                  <EmptyState
                    title="No synced transactions yet"
                    description="Once projects are funded and milestones move on-chain, activity will appear here."
                  />
                ) : (
                  recentTransactions.slice(0, 6).map((tx) => (
                    <div
                      key={`${tx.txHash}-${tx.logIndex}`}
                      className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                    >
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {tx.eventName}
                      </p>
                      <p className="mt-1 break-all font-mono text-xs text-zinc-600 dark:text-zinc-400">
                        {shortHash(tx.txHash)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                        <span>Block {tx.blockNumber}</span>
                        <span>•</span>
                        <span>{formatTimeAgo(tx.blockTimestamp ?? tx.createdAt)}</span>
                        {tx.projectId ? (
                          <>
                            <span>•</span>
                            <Link
                              href={`/projects/${tx.projectId}`}
                              className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                            >
                              View project
                            </Link>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="w-full max-w-full">
              <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Notifications</CardTitle>
                <CardDescription>
                  Quick preview of recent alerts and project updates.
                </CardDescription>
              </CardHeader>
              <div className="space-y-3">
                {recentNotifications.length === 0 ? (
                  <EmptyState
                    title="No notifications"
                    description="New payment, dispute, and milestone notifications will show up here."
                  />
                ) : (
                  recentNotifications.slice(0, 5).map((note) => (
                    <div
                      key={note.id}
                      className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                    >
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {note.title}
                      </p>
                      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                        {note.body}
                      </p>
                      <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <span>{formatTimeAgo(note.createdAt)}</span>
                        {note.projectId ? (
                          <>
                            <span>•</span>
                            <Link
                              href={`/projects/${note.projectId}`}
                              className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                            >
                              Open project
                            </Link>
                          </>
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

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</p>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{hint}</p>
    </Card>
  );
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-5 text-center dark:border-zinc-700">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</p>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{description}</p>
      {actionLabel && onAction ? (
        <Button className="mt-3" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function ListRow({
  title,
  subtitle,
  ctaLabel,
  onClick,
}: {
  title: string;
  subtitle: string;
  ctaLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </p>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{subtitle}</p>
      </div>
      <Button type="button" size="sm" variant="secondary" onClick={onClick}>
        {ctaLabel}
      </Button>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Card key={index} className="p-4 sm:p-5">
            <div className="h-3 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="mt-3 h-7 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="mt-2 h-3 w-28 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index}>
            <div className="h-6 w-44 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="mt-5 space-y-3">
              {Array.from({ length: 3 }).map((__, rowIdx) => (
                <div
                  key={rowIdx}
                  className="h-16 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900"
                />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function formatWei(raw: string): string {
  try {
    return BigInt(raw).toLocaleString("en-US");
  } catch {
    return raw;
  }
}

function formatTimeAgo(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "just now";
  }
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diffMs / 60_000));
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

function shortHash(txHash: string): string {
  if (txHash.length < 14) {
    return txHash;
  }
  return `${txHash.slice(0, 10)}…${txHash.slice(-6)}`;
}

function prettyStatus(status: string): string {
  return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
