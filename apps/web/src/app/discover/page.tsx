"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AuthShell } from "@/components/layout/auth-shell";
import { buttonClassName } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { needsOnboarding } from "@/lib/auth/client-guards";
import { useMeQuery } from "@/hooks/use-me-query";
import { usePublicProjectsQuery } from "@/hooks/use-public-projects-query";
import { useSessionQuery } from "@/hooks/use-session-query";

export default function DiscoverProjectsPage() {
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = useSessionQuery();
  const meEnabled = Boolean(session?.authenticated);
  const { data: me, isPending: meLoading, isFetched: meFetched } = useMeQuery(meEnabled);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(
    () => ({
      query: debounced || undefined,
      sortBy: "updatedAt" as const,
      sortOrder: "desc" as const,
      limit: 24,
    }),
    [debounced],
  );

  const canQuery =
    Boolean(session?.authenticated) && Boolean(me) && !needsOnboarding(me!);
  const { data, isPending: listLoading } = usePublicProjectsQuery(canQuery, query);

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
      return;
    }
    if (!me.roles.includes("FREELANCER")) {
      router.replace("/dashboard");
    }
  }, [session, sessionLoading, me, meFetched, router]);

  const loading = sessionLoading || (meEnabled && meLoading && !meFetched);
  const items = data?.items ?? [];

  return (
    <AuthShell
      title="Discover projects"
      subtitle="Browse public OPEN roles. Apply before the client assigns someone."
      className="overflow-x-hidden"
      containerClassName="max-w-5xl sm:max-w-5xl"
    >
      {loading || !me ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <Spinner />
        </div>
      ) : (
        <div className="flex w-full max-w-full flex-col gap-5">
          <Card className="w-full max-w-full">
            <CardHeader>
              <CardTitle className="text-lg sm:text-xl">Search</CardTitle>
              <CardDescription>Filter by title or description keywords.</CardDescription>
            </CardHeader>
            <div className="px-4 pb-4 sm:px-6">
              <Label htmlFor="discover-search" className="sr-only">
                Search
              </Label>
              <Input
                id="discover-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="e.g. dashboard, API, design"
              />
            </div>
          </Card>

          {listLoading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <Card className="w-full max-w-full">
              <CardHeader>
                <CardTitle>No projects yet</CardTitle>
                <CardDescription>
                  Nothing matches your filters, or no clients have posted public roles.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {items.map((p) => (
                <Card key={p.id} className="flex w-full max-w-full flex-col overflow-hidden">
                  <CardHeader className="min-w-0">
                    <CardTitle className="line-clamp-2 text-base sm:text-lg">{p.title}</CardTitle>
                    <CardDescription className="line-clamp-3">
                      {p.description?.trim() ? p.description : "No description."}
                    </CardDescription>
                  </CardHeader>
                  <div className="mt-auto flex flex-col gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {p.milestoneCount} milestone{p.milestoneCount === 1 ? "" : "s"}
                    </p>
                    <Link
                      href={`/discover/${p.id}`}
                      className={buttonClassName({ variant: "primary", size: "sm" })}
                    >
                      View and apply
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </AuthShell>
  );
}
