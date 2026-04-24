"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { DashboardActionItem, DashboardRecentTransaction } from "@escrowflow/types";
import { useAccount, useBalance, useChainId } from "wagmi";
import { arbitrumSepolia, baseSepolia, hardhat, mainnet, sepolia } from "wagmi/chains";

import { AuthShell } from "@/components/layout/auth-shell";
import { IdentityCard as DashboardIdentityCard, type IdentityRole } from "@/components/dashboard/identity-card";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { needsOnboarding } from "@/lib/auth/client-guards";
import { useClientDashboardQuery } from "@/hooks/use-client-dashboard-query";
import { useFreelancerDashboardQuery } from "@/hooks/use-freelancer-dashboard-query";
import { useMeQuery } from "@/hooks/use-me-query";
import { useSessionQuery } from "@/hooks/use-session-query";
import { getExplorerTxUrl } from "@/lib/chains/explorer";

type DashboardLens = "CLIENT" | "FREELANCER" | "ADMIN" | null;
type DashboardMe = NonNullable<ReturnType<typeof useMeQuery>["data"]>;
type ClientDashboardData = NonNullable<ReturnType<typeof useClientDashboardQuery>["data"]>;
type FreelancerDashboardData = NonNullable<ReturnType<typeof useFreelancerDashboardQuery>["data"]>;

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const walletChainId = useChainId();
  const { address: walletAddress } = useAccount();
  const { data: walletNativeBalance, isLoading: walletBalanceLoading } = useBalance({
    address: walletAddress,
    chainId: walletChainId,
    query: {
      enabled: Boolean(walletAddress && walletChainId),
    },
  });
  const { data: session, isPending: sessionLoading } = useSessionQuery();
  const meEnabled = Boolean(session?.authenticated);
  const { data: me, isPending: meLoading, isFetched: meFetched } =
    useMeQuery(meEnabled);
  const dashboardLens: DashboardLens = me?.roles.includes("CLIENT")
    ? "CLIENT"
    : me?.roles.includes("FREELANCER")
      ? "FREELANCER"
      : me?.roles.includes("ADMIN")
        ? "ADMIN"
      : null;
  const { data: clientDashboard, isPending: clientDashboardLoading } =
    useClientDashboardQuery(dashboardLens === "CLIENT");
  const { data: freelancerDashboard, isPending: freelancerDashboardLoading } =
    useFreelancerDashboardQuery(dashboardLens === "FREELANCER");

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
    setSigningOut(true);
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      await queryClient.invalidateQueries();
      router.replace("/login");
    } catch {
      setSigningOut(false);
    }
  }

  const loading =
    signingOut ||
    sessionLoading ||
    (meEnabled && meLoading && !meFetched) ||
    (dashboardLens === "CLIENT" && clientDashboardLoading && !clientDashboard) ||
    (dashboardLens === "FREELANCER" && freelancerDashboardLoading && !freelancerDashboard);
  const title = signingOut
    ? "Signing out"
    : dashboardLens === "ADMIN"
      ? "Admin dashboard"
      : dashboardLens === "FREELANCER"
        ? "Freelancer dashboard"
        : dashboardLens === "CLIENT"
          ? "Client dashboard"
          : "Dashboard";
  const subtitle = signingOut
    ? "Redirecting to sign in…"
    : dashboardLens === "ADMIN"
      ? "Resolve disputes and keep escrow workflows safe."
      : dashboardLens === "FREELANCER"
        ? "Track deliveries, reviews, payouts, and disputes."
        : dashboardLens === "CLIENT"
          ? "Track escrow health, pending reviews, and recent project activity."
          : "Loading your workspace…";

  const identityRole: IdentityRole | null = me
    ? dashboardLens ?? resolveIdentityRole(me.roles)
    : null;
  const identityBalance = walletBalanceLoading
    ? "Loading..."
    : formatNativeBalance(walletNativeBalance?.formatted, walletNativeBalance?.symbol);
  const identityCompanyName = "EscrowFlow";
  const identityNetwork = resolveNetworkName(walletChainId);
  const rightPane = me && identityRole ? (
    <div>
      <DashboardIdentityCard
        companyName={identityCompanyName}
        userName={me.displayName ?? "EscrowFlow user"}
        walletAddress={me.walletAddress}
        role={identityRole}
        balance={identityBalance}
        network={identityNetwork}
        logoSrc="/images/escrow_icon.png"
      />
    </div>
  ) : null;

  let content: ReactNode;
  if (loading || !me) {
    content = (
      <div className="flex w-full flex-col gap-4">
        <DashboardSkeleton />
      </div>
    );
  } else if (dashboardLens === "CLIENT" && clientDashboard) {
    content = (
      <DashboardRoleLayout
        topLeft={
          <ClientDashboardTopCard
            me={me}
            onBrowseProjects={() => router.push("/projects")}
            onCreateProject={() => router.push("/projects/new")}
          />
        }
        topRight={rightPane}
        below={
          <ClientDashboardSections
            dashboard={clientDashboard}
            onCreateProject={() => router.push("/projects/new")}
            onOpenProject={(id) => router.push(`/projects/${id}`)}
            onAction={(item) => router.push(item.href)}
          />
        }
      />
    );
  } else if (dashboardLens === "FREELANCER" && freelancerDashboard) {
    content = (
      <DashboardRoleLayout
        topLeft={
          <FreelancerDashboardTopCard
            onBrowseDiscover={() => router.push("/discover")}
            onViewProjects={() => router.push("/projects")}
          />
        }
        topRight={rightPane}
        below={
          <FreelancerDashboardSections
            dashboard={freelancerDashboard}
            onOpenProject={(id) => router.push(`/projects/${id}`)}
            onAction={(item) => router.push(item.href)}
          />
        }
      />
    );
  } else if (dashboardLens === "ADMIN") {
    content = (
      <DashboardRoleLayout
        topLeft={<AdminDashboardTopCard onOpenDisputes={() => router.push("/admin/disputes")} />}
        topRight={rightPane}
        below={<AdminDashboardSections onOpenDisputes={() => router.push("/admin/disputes")} />}
      />
    );
  } else if (!me.roles.some((r) => r === "CLIENT" || r === "FREELANCER" || r === "ADMIN")) {
    content = (
      <RoleDashboardLayout
        right={rightPane}
        left={
          <Card className="w-full max-w-full">
            <CardHeader>
              <CardTitle>Dashboard is not available for this role</CardTitle>
              <CardDescription>
                Complete onboarding with a client or freelancer role to access dashboard tools.
              </CardDescription>
            </CardHeader>
          </Card>
        }
      />
    );
  } else {
    content = (
      <RoleDashboardLayout
        right={rightPane}
        left={
          <Card className="w-full max-w-full">
            <CardHeader>
              <CardTitle>No dashboard lens available</CardTitle>
              <CardDescription>
                We could not resolve a dashboard role for your account yet.
              </CardDescription>
            </CardHeader>
          </Card>
        }
      />
    );
  }

  return (
    <AuthShell
      title={title}
      subtitle={subtitle}
      className="overflow-x-hidden"
      containerClassName="max-w-6xl sm:max-w-6xl"
      iconBrandOnly
      headerActions={
        me ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="min-h-10 px-3"
            onClick={() => void signOut()}
            disabled={signingOut}
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            {signingOut ? "Signing out..." : "Sign out"}
          </Button>
        ) : null
      }
    >
      {content}
    </AuthShell>
  );
}

function RoleDashboardLayout({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
      <div className="min-w-0">{left}</div>
      <div className="min-w-0">{right}</div>
    </div>
  );
}

function resolveIdentityRole(roles: string[]): IdentityRole | null {
  if (roles.includes("CLIENT")) {
    return "CLIENT";
  }
  if (roles.includes("FREELANCER")) {
    return "FREELANCER";
  }
  if (roles.includes("ADMIN")) {
    return "ADMIN";
  }
  return null;
}

function DashboardRoleLayout({
  topLeft,
  topRight,
  below,
}: {
  topLeft: ReactNode;
  topRight: ReactNode;
  below: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-5">
      <section className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 md:[&>*]:h-full">{topLeft}</div>
        <div className="min-w-0 md:[&>*]:h-full">{topRight}</div>
      </section>
      <div className="w-full min-w-0">{below}</div>
    </div>
  );
}

function ClientDashboardTopCard({
  me,
  onBrowseProjects,
  onCreateProject,
}: {
  me: DashboardMe;
  onBrowseProjects: () => void;
  onCreateProject: () => void;
}) {
  return (
    <Card className="w-full max-w-full overflow-hidden">
      <CardHeader>
        <CardTitle className="text-2xl sm:text-3xl">Hello, {me.displayName}</CardTitle>
        <CardDescription>
          Client workspace for projects, funding checkpoints, and milestone approvals.
        </CardDescription>
      </CardHeader>
      <div className="grid grid-cols-1 gap-2 border-t border-zinc-800/90 bg-gradient-to-r from-zinc-950/35 via-zinc-900/25 to-zinc-950/35 px-4 py-4 sm:flex sm:flex-row sm:flex-wrap sm:justify-end sm:px-6 sm:py-5">
        <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={onBrowseProjects}>
          Browse projects
        </Button>
        <Button type="button" className="w-full sm:w-auto" onClick={onCreateProject}>
          Create new project
        </Button>
      </div>
    </Card>
  );
}

function ClientDashboardSections({
  dashboard,
  onCreateProject,
  onOpenProject,
  onAction,
}: {
  dashboard: ClientDashboardData;
  onCreateProject: () => void;
  onOpenProject: (projectId: string) => void;
  onAction: (item: DashboardActionItem) => void;
}) {
  return (
    <div className="flex w-full max-w-full flex-col gap-5">

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Active projects"
          value={String(dashboard.summary.activeProjectsCount ?? 0)}
          hint="Currently in progress"
        />
        <MetricCard
          label="Total escrow locked"
          value={formatWei(dashboard.summary.totalEscrowLockedWei ?? "0")}
          hint="Smallest token units"
        />
        <MetricCard
          label="Pending milestone reviews"
          value={String(dashboard.summary.pendingMilestoneReviewsCount ?? 0)}
          hint="Need client feedback"
        />
        <MetricCard
          label="Open disputes"
          value={String(dashboard.summary.openDisputesCount ?? 0)}
          hint="Needs resolution"
        />
        <MetricCard
          label="Completed projects"
          value={String(dashboard.summary.completedProjectsCount ?? 0)}
          hint="Closed successfully"
        />
      </section>

      <section>
        <SectionHeader title="Execution overview" subtitle="Projects and reviews that currently need your attention." />
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
            {dashboard.recentProjects.length === 0 ? (
              <EmptyState
                title="No projects yet"
                description="Create your first escrow project to start tracking milestones."
                actionLabel="Create project"
                onAction={onCreateProject}
              />
            ) : (
              dashboard.recentProjects.map((project) => (
                <ListRow
                  key={project.id}
                  title={project.title}
                  subtitle={`Status: ${prettyStatus(project.status)} • Updated ${formatTimeAgo(project.updatedAt)}`}
                  badgeLabel={prettyStatus(project.status)}
                  ctaLabel="Open project"
                  onClick={() => onOpenProject(project.id)}
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
          <ActionList
            emptyTitle="No pending reviews"
            emptyDescription="You're all caught up on milestone reviews."
            items={dashboard.actions.filter((item) => item.kind === "MILESTONE_CLIENT_REVIEW")}
            ctaLabel="Review"
            onAction={onAction}
          />
        </Card>
      </section>

      <section>
        <SectionHeader title="Activity feed" subtitle="Recent on-chain and in-app signals for this account." />
      </section>
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="w-full max-w-full">
          <CardHeader>
            <CardTitle className="text-lg sm:text-xl">Recent transactions</CardTitle>
            <CardDescription>
              Latest on-chain events synced into your project workspace.
            </CardDescription>
          </CardHeader>
          <TransactionList items={dashboard.recentTransactions} />
        </Card>

        <Card className="w-full max-w-full">
          <CardHeader>
            <CardTitle className="text-lg sm:text-xl">Notifications</CardTitle>
            <CardDescription>
              Quick preview of recent alerts and project updates.
            </CardDescription>
          </CardHeader>
          <NotificationList items={dashboard.notifications} />
        </Card>
      </section>
    </div>
  );
}

function FreelancerDashboardTopCard({
  onBrowseDiscover,
  onViewProjects,
}: {
  onBrowseDiscover: () => void;
  onViewProjects: () => void;
}) {
  return (
    <Card className="w-full max-w-full overflow-hidden">
      <CardHeader>
        <CardTitle className="text-2xl sm:text-3xl">Freelancer workspace</CardTitle>
        <CardDescription>
          Track submissions, payout progress, deadlines, and active milestone delivery.
        </CardDescription>
      </CardHeader>
      <div className="grid grid-cols-1 gap-2 border-t border-zinc-800/90 bg-gradient-to-r from-zinc-950/35 via-zinc-900/25 to-zinc-950/35 px-4 py-4 sm:flex sm:flex-row sm:flex-wrap sm:justify-end sm:px-6 sm:py-5">
        <Link
          href="/discover"
          className={buttonClassName({ variant: "secondary", className: "w-full sm:w-auto" })}
          onClick={(event) => {
            event.preventDefault();
            onBrowseDiscover();
          }}
        >
          Discover projects
        </Link>
        <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={onViewProjects}>
          View assigned projects
        </Button>
      </div>
    </Card>
  );
}

function FreelancerDashboardSections({
  dashboard,
  onOpenProject,
  onAction,
}: {
  dashboard: FreelancerDashboardData;
  onOpenProject: (projectId: string) => void;
  onAction: (item: DashboardActionItem) => void;
}) {
  return (
    <div className="flex w-full max-w-full flex-col gap-5">

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Active contracts"
          value={String(dashboard.summary.activeProjectsCount ?? 0)}
          hint="Live client engagements"
        />
        <MetricCard
          label="Pending submissions"
          value={String(dashboard.summary.pendingSubmissionsCount ?? 0)}
          hint="Work items to submit"
        />
        <MetricCard
          label="Pending reviews"
          value={String(dashboard.summary.pendingReviewsCount ?? 0)}
          hint="Submitted, waiting client response"
        />
        <MetricCard
          label="Released earnings"
          value={formatWei(dashboard.summary.releasedEarningsWei ?? "0")}
          hint="Token smallest units"
        />
        <MetricCard
          label="Disputes"
          value={String(dashboard.summary.openDisputesCount ?? 0)}
          hint="Open items to resolve"
        />
      </section>

      <section>
        <SectionHeader title="Delivery workspace" subtitle="Live contracts and deadlines across your milestones." />
      </section>
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="w-full max-w-full">
          <CardHeader>
            <CardTitle className="text-lg sm:text-xl">Assigned projects</CardTitle>
            <CardDescription>
              Current contracts where you are the assigned freelancer.
            </CardDescription>
          </CardHeader>
          <div className="space-y-3">
            {dashboard.activeProjects.length === 0 ? (
              <EmptyState
                title="No active contracts"
                description="You will see assigned projects here once clients fund escrow."
              />
            ) : (
              dashboard.activeProjects.map((project) => (
                <ListRow
                  key={project.id}
                  title={project.title}
                  subtitle={`Status: ${prettyStatus(project.status)} • Updated ${formatTimeAgo(project.updatedAt)}`}
                  badgeLabel={prettyStatus(project.status)}
                  ctaLabel="Open project"
                  onClick={() => onOpenProject(project.id)}
                />
              ))
            )}
          </div>
        </Card>

        <Card className="w-full max-w-full">
          <CardHeader>
            <CardTitle className="text-lg sm:text-xl">Upcoming deadlines</CardTitle>
            <CardDescription>
              Prioritized milestones requiring submission or resubmission.
            </CardDescription>
          </CardHeader>
          <ActionList
            emptyTitle="No deadlines pending"
            emptyDescription="You're clear on upcoming milestone submissions."
            items={dashboard.milestonesToDeliver}
            ctaLabel="Submit work"
            onAction={onAction}
          />
        </Card>
      </section>

      <section>
        <SectionHeader title="Payout and alerts" subtitle="Track releases and recent account-level notifications." />
      </section>
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="w-full max-w-full">
          <CardHeader>
            <CardTitle className="text-lg sm:text-xl">Recent payouts</CardTitle>
            <CardDescription>
              Latest payout-related on-chain events for your freelancer account.
            </CardDescription>
          </CardHeader>
          <TransactionList
            items={dashboard.recentTransactions.filter((tx) =>
              ["MilestoneFundsReleased", "DisputeResolved"].includes(tx.eventName),
            )}
            emptyTitle="No payouts yet"
            emptyDescription="Payout events will appear once milestones are released."
            showAmount
          />
        </Card>

        <Card className="w-full max-w-full">
          <CardHeader>
            <CardTitle className="text-lg sm:text-xl">Notifications</CardTitle>
            <CardDescription>Recent project, payment, and review alerts.</CardDescription>
          </CardHeader>
          <NotificationList items={dashboard.notifications} />
        </Card>
      </section>
    </div>
  );
}

function AdminDashboardTopCard({ onOpenDisputes }: { onOpenDisputes: () => void }) {
  return (
    <Card className="w-full max-w-full overflow-hidden">
      <CardHeader>
        <CardTitle className="text-2xl sm:text-3xl">Admin operations</CardTitle>
        <CardDescription>
          Resolve disputes, enforce payout safety, and monitor escrow workflow integrity.
        </CardDescription>
      </CardHeader>
      <div className="grid grid-cols-1 gap-2 border-t border-zinc-800/90 bg-gradient-to-r from-zinc-950/35 via-zinc-900/25 to-zinc-950/35 px-4 py-4 sm:flex sm:flex-row sm:flex-wrap sm:justify-end sm:px-6 sm:py-5">
        <Button type="button" className="w-full sm:w-auto" onClick={onOpenDisputes}>
          Open dispute management
        </Button>
      </div>
    </Card>
  );
}

function AdminDashboardSections({ onOpenDisputes }: { onOpenDisputes: () => void }) {
  return (
    <div className="flex w-full max-w-full flex-col gap-5">

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Dispute lane" value="Active" hint="Manual arbitration controls" />
        <MetricCard label="System view" value="Escrow-wide" hint="Cross-project risk posture" />
        <MetricCard label="Action mode" value="Resolve + sync" hint="On-chain and API reconciliation" />
      </section>

      <section>
        <SectionHeader
          title="Administrative focus"
          subtitle="Prioritize active disputes and keep milestone payout outcomes consistent."
        />
      </section>
      <Card className="w-full max-w-full">
        <CardHeader>
          <CardTitle className="text-lg sm:text-xl">Dispute actions</CardTitle>
          <CardDescription>
            Jump into the admin queue to review evidence and finalize resolutions.
          </CardDescription>
        </CardHeader>
        <div className="px-4 pb-4 sm:px-6 sm:pb-6">
          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={onOpenDisputes}>
            Review active disputes
          </Button>
        </div>
      </Card>
    </div>
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
    <Card className="p-4 transition-all duration-200 hover:-translate-y-0.5 sm:p-5">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
        {label}
      </p>
      <p className="mt-2 break-words text-lg font-semibold tracking-tight text-zinc-100 sm:text-xl">{value}</p>
      <p className="mt-1 text-xs text-zinc-400">{hint}</p>
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
    <div className="rounded-xl border border-dashed border-zinc-700/80 bg-zinc-950/45 px-4 py-5 text-center">
      <p className="text-sm font-medium text-zinc-100">{title}</p>
      <p className="mt-1 text-xs text-zinc-400">{description}</p>
      {actionLabel && onAction ? (
        <Button className="mt-3 w-full sm:w-auto" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function ListRow({
  title,
  subtitle,
  badgeLabel,
  ctaLabel,
  onClick,
}: {
  title: string;
  subtitle: string;
  badgeLabel?: string;
  ctaLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-800/90 bg-zinc-950/45 p-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="break-words text-sm font-semibold text-zinc-100">
          {title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="break-words text-xs text-zinc-600 dark:text-zinc-400">{subtitle}</p>
          {badgeLabel ? <StatusBadge label={badgeLabel} /> : null}
        </div>
      </div>
      <Button type="button" size="sm" variant="secondary" className="w-full sm:w-auto" onClick={onClick}>
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
            <div className="h-3 w-24 animate-pulse rounded bg-zinc-800" />
            <div className="mt-3 h-7 w-20 animate-pulse rounded bg-zinc-800" />
            <div className="mt-2 h-3 w-28 animate-pulse rounded bg-zinc-800" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index}>
            <div className="h-6 w-44 animate-pulse rounded bg-zinc-800" />
            <div className="mt-5 space-y-3">
              {Array.from({ length: 3 }).map((__, rowIdx) => (
                <div
                  key={rowIdx}
                  className="h-16 animate-pulse rounded-xl bg-zinc-900/80"
                />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function ActionList({
  items,
  emptyTitle,
  emptyDescription,
  ctaLabel,
  onAction,
}: {
  items: DashboardActionItem[];
  emptyTitle: string;
  emptyDescription: string;
  ctaLabel: string;
  onAction: (item: DashboardActionItem) => void;
}) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="space-y-3">
      {items.slice(0, 8).map((item) => (
        <ListRow
          key={`${item.kind}-${item.projectId}-${item.milestoneId ?? "none"}`}
          title={item.title}
          subtitle={item.dueAt ? `Due ${formatTimeAgo(item.dueAt)}` : "Action needed"}
          badgeLabel={item.priority ? `${item.priority} priority` : undefined}
          ctaLabel={ctaLabel}
          onClick={() => onAction(item)}
        />
      ))}
    </div>
  );
}

function TransactionList({
  items,
  emptyTitle = "No synced transactions yet",
  emptyDescription = "Once projects are funded and milestones move on-chain, activity will appear here.",
  showAmount = false,
}: {
  items: DashboardRecentTransaction[];
  emptyTitle?: string;
  emptyDescription?: string;
  showAmount?: boolean;
}) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="space-y-3">
      {items.slice(0, 6).map((tx) => (
        <div
          key={`${tx.txHash}-${tx.logIndex}`}
          className="rounded-xl border border-zinc-800/90 p-3.5"
        >
          <p className="text-sm font-semibold text-zinc-100">{tx.eventName}</p>
          <p className="mt-1 break-all font-mono text-xs text-zinc-600 dark:text-zinc-400">
            {shortHash(tx.txHash)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs leading-relaxed text-zinc-400">
            <span>Block {tx.blockNumber}</span>
            <span>•</span>
            <span>{formatTimeAgo(tx.blockTimestamp ?? tx.createdAt)}</span>
            {showAmount && tx.amountWei ? (
              <>
                <span>•</span>
                <span>{formatWei(tx.amountWei)} units</span>
              </>
            ) : null}
            {tx.projectId ? (
              <>
                <span>•</span>
                <Link
                  href={`/projects/${tx.projectId}`}
                  className="inline-flex min-h-8 items-center rounded-md px-1.5 font-medium text-cyan-300 transition-colors hover:bg-cyan-300/10 hover:text-cyan-200"
                >
                  View project
                </Link>
              </>
            ) : null}
            {getExplorerTxUrl(tx.chainId, tx.txHash) ? (
              <>
                <span>•</span>
                <a
                  href={getExplorerTxUrl(tx.chainId, tx.txHash)!}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-8 items-center rounded-md px-1.5 font-medium text-cyan-300 transition-colors hover:bg-cyan-300/10 hover:text-cyan-200"
                >
                  Explorer
                </a>
              </>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function NotificationList({
  items,
}: {
  items: Array<{
    id: string;
    title: string;
    body: string;
    createdAt: string;
    projectId: string | null;
  }>;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No notifications"
        description="New payment, dispute, and milestone notifications will show up here."
      />
    );
  }

  return (
    <div className="space-y-3">
      {items.slice(0, 5).map((note) => (
        <div
          key={note.id}
          className="rounded-xl border border-zinc-800/90 p-3.5"
        >
          <p className="text-sm font-semibold text-zinc-100">{note.title}</p>
          <p className="mt-1 break-words text-xs text-zinc-600 dark:text-zinc-400">{note.body}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{formatTimeAgo(note.createdAt)}</span>
            {note.projectId ? (
              <>
                <span>•</span>
                <Link
                  href={`/projects/${note.projectId}`}
                  className="inline-flex min-h-8 items-center rounded-md px-1.5 font-medium text-cyan-300 transition-colors hover:bg-cyan-300/10 hover:text-cyan-200"
                >
                  Open project
                </Link>
              </>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-200">
      {label}
    </span>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-gradient-to-r from-zinc-950/55 via-zinc-900/45 to-zinc-950/55 px-4 py-3 sm:px-5">
      <p className="text-sm font-semibold tracking-tight text-zinc-100">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-400">{subtitle}</p>
    </div>
  );
}

function formatWei(raw: string): string {
  try {
    return BigInt(raw).toLocaleString("en-US");
  } catch {
    return raw;
  }
}

function formatNativeBalance(formatted?: string, symbol?: string): string {
  if (!formatted || !symbol) {
    return "--";
  }
  const parsed = Number.parseFloat(formatted);
  if (Number.isNaN(parsed)) {
    return `-- ${symbol}`;
  }
  return `${parsed.toFixed(4)} ${symbol}`;
}

function resolveNetworkName(chainId: number): string {
  if (chainId === arbitrumSepolia.id) {
    return arbitrumSepolia.name;
  }
  if (chainId === baseSepolia.id) {
    return baseSepolia.name;
  }
  if (chainId === sepolia.id) {
    return sepolia.name;
  }
  if (chainId === hardhat.id) {
    return "Hardhat Local";
  }
  if (chainId === mainnet.id) {
    return mainnet.name;
  }
  return `Chain ${chainId}`;
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
