"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PROJECT_STATUSES,
  type ListProjectsQuery,
  type ProjectStatus,
} from "@escrowflow/types";

import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { needsOnboarding } from "@/lib/auth/client-guards";
import { useMeQuery } from "@/hooks/use-me-query";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import { useSessionQuery } from "@/hooks/use-session-query";

type SortOption = {
  id: string;
  label: string;
  sortBy: NonNullable<ListProjectsQuery["sortBy"]>;
  sortOrder: NonNullable<ListProjectsQuery["sortOrder"]>;
};

const SORT_OPTIONS: SortOption[] = [
  { id: "updated_desc", label: "Recently updated", sortBy: "updatedAt", sortOrder: "desc" },
  { id: "updated_asc", label: "Oldest updated", sortBy: "updatedAt", sortOrder: "asc" },
  { id: "created_desc", label: "Newest created", sortBy: "createdAt", sortOrder: "desc" },
  { id: "created_asc", label: "Oldest created", sortBy: "createdAt", sortOrder: "asc" },
  { id: "amount_desc", label: "Highest amount", sortBy: "amountWei", sortOrder: "desc" },
  { id: "amount_asc", label: "Lowest amount", sortBy: "amountWei", sortOrder: "asc" },
  { id: "deadline_asc", label: "Nearest deadline", sortBy: "deadline", sortOrder: "asc" },
  { id: "deadline_desc", label: "Farthest deadline", sortBy: "deadline", sortOrder: "desc" },
];

export default function ProjectsPage() {
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = useSessionQuery();
  const meEnabled = Boolean(session?.authenticated);
  const { data: me, isPending: meLoading, isFetched: meFetched } = useMeQuery(meEnabled);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ProjectStatus>("all");
  const [participation, setParticipation] = useState<"any" | "client" | "freelancer">("any");
  const [sortOptionId, setSortOptionId] = useState("updated_desc");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput.trim());
    }, 250);
    return () => clearTimeout(timeout);
  }, [searchInput]);

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

  const selectedSort = SORT_OPTIONS.find((option) => option.id === sortOptionId) ?? SORT_OPTIONS[0]!;
  const query = useMemo<ListProjectsQuery>(
    () => ({
      query: search || undefined,
      participation,
      status: statusFilter === "all" ? undefined : [statusFilter],
      sortBy: selectedSort.sortBy,
      sortOrder: selectedSort.sortOrder,
      limit: 30,
    }),
    [search, participation, statusFilter, selectedSort],
  );

  const { data, isPending: projectsLoading } = useProjectsQuery(Boolean(me), query);
  const loading = sessionLoading || (meEnabled && meLoading && !meFetched);
  const items = data?.items ?? [];

  return (
    <AuthShell
      title="Projects"
      subtitle="Browse and manage escrow projects with role-aware filters."
      className="overflow-x-hidden"
      containerClassName="max-w-6xl sm:max-w-6xl"
    >
      {loading || !me ? (
        <ProjectsSkeleton />
      ) : (
        <div className="flex w-full flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg sm:text-xl">Project browser</CardTitle>
              <CardDescription>
                Search by title or wallet, filter by role and status, then drill into project details.
              </CardDescription>
            </CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="secondary"
                className="sm:hidden"
                onClick={() => setFiltersOpen((prev) => !prev)}
              >
                {filtersOpen ? "Hide filters" : "Show filters"}
              </Button>
              <div className="hidden sm:block text-xs text-zinc-500 dark:text-zinc-400">
                {items.length} project{items.length === 1 ? "" : "s"} shown
              </div>
              {me.roles.includes("CLIENT") ? (
                <Button type="button" onClick={() => router.push("/projects/new")}>
                  Create project
                </Button>
              ) : null}
            </div>

            <div className={`${filtersOpen ? "block" : "hidden"} mt-4 space-y-4 sm:block`}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="project-search">Search</Label>
                  <Input
                    id="project-search"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Title, description, or wallet"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-role-filter">Role scope</Label>
                  <select
                    id="project-role-filter"
                    className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                    value={participation}
                    onChange={(e) =>
                      setParticipation(e.target.value as "any" | "client" | "freelancer")
                    }
                  >
                    <option value="any">Any role</option>
                    {me.roles.includes("CLIENT") ? <option value="client">As client</option> : null}
                    {me.roles.includes("FREELANCER") ? (
                      <option value="freelancer">As freelancer</option>
                    ) : null}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-status-filter">Status</Label>
                  <select
                    id="project-status-filter"
                    className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as "all" | ProjectStatus)}
                  >
                    <option value="all">All statuses</option>
                    {PROJECT_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {prettyStatus(status)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-sort">Sort by</Label>
                  <select
                    id="project-sort"
                    className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                    value={sortOptionId}
                    onChange={(e) => setSortOptionId(e.target.value)}
                  >
                    {SORT_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </Card>

          <section className="space-y-3">
            {projectsLoading ? (
              <ProjectsListSkeleton />
            ) : items.length === 0 ? (
              <Card>
                <EmptyState
                  title="No projects match these filters"
                  description="Try widening the role, status, or search filters to discover more projects."
                />
              </Card>
            ) : (
              items.map((project) => {
                const released = project.milestonesReleasedCount ?? 0;
                const total = project.milestoneCount || 0;
                const progress = total > 0 ? Math.round((released / total) * 100) : 0;
                return (
                  <Card key={project.id} className="p-4 sm:p-5">
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">
                              {project.title}
                            </h2>
                            <StatusBadge label={prettyStatus(project.status)} />
                          </div>
                          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                            Client: {project.client.displayName ?? shortWallet(project.client.walletAddress)} · Freelancer:{" "}
                            {project.freelancer
                              ? project.freelancer.displayName ?? shortWallet(project.freelancer.walletAddress)
                              : "Unassigned"}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => router.push(`/projects/${project.id}`)}
                        >
                          Open details
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 gap-3 text-xs text-zinc-600 dark:text-zinc-400 sm:grid-cols-2 lg:grid-cols-4">
                        <Info label="Total amount" value={formatWei(project.totalValueWei ?? "0")} />
                        <Info label="Milestones" value={`${released}/${project.milestoneCount} released`} />
                        <Info
                          label="Next deadline"
                          value={
                            project.nextMilestoneDueAt
                              ? formatDate(project.nextMilestoneDueAt)
                              : "No deadline set"
                          }
                        />
                        <Info label="Updated" value={formatTimeAgo(project.updatedAt)} />
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                          <span>Milestone progress</span>
                          <span>{progress}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800">
                          <div
                            className="h-2 rounded-full bg-indigo-600 transition-all"
                            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })
            )}
          </section>
        </div>
      )}
    </AuthShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <p className="text-[10px] uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">{value}</p>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center dark:border-zinc-700">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</p>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{description}</p>
    </div>
  );
}

function StatusBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
      {label}
    </span>
  );
}

function ProjectsSkeleton() {
  return (
    <div className="space-y-4">
      <Card>
        <div className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      </Card>
      <ProjectsListSkeleton />
    </div>
  );
}

function ProjectsListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <Card key={index} className="p-4 sm:p-5">
          <div className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
        </Card>
      ))}
    </div>
  );
}

function prettyStatus(status: string): string {
  return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function formatWei(raw: string): string {
  try {
    return `${BigInt(raw).toLocaleString("en-US")} wei`;
  } catch {
    return raw;
  }
}

function formatDate(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleDateString();
}

function formatTimeAgo(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  const diffMs = Date.now() - date.getTime();
  const mins = Math.max(1, Math.floor(diffMs / 60_000));
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function shortWallet(address: string): string {
  if (address.length < 12) {
    return address;
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
