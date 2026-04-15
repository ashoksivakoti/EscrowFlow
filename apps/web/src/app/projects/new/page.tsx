"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { CreateProjectForm } from "@/components/projects/create-project-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { needsOnboarding } from "@/lib/auth/client-guards";
import { useMeQuery } from "@/hooks/use-me-query";
import { useSessionQuery } from "@/hooks/use-session-query";

export default function CreateProjectPage() {
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = useSessionQuery();
  const meEnabled = Boolean(session?.authenticated);
  const { data: me, isPending: meLoading, isFetched: meFetched } =
    useMeQuery(meEnabled);

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
  }, [session, sessionLoading, me, meFetched, router]);

  const loading = sessionLoading || (meEnabled && meLoading && !meFetched);

  return (
    <AuthShell
      title="Create project"
      subtitle="Set up a milestone escrow plan and invite your freelancer wallet."
      className="overflow-x-hidden"
    >
      {loading || !me ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <Spinner />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Preparing project workspace…
          </p>
        </div>
      ) : !me.roles.includes("CLIENT") ? (
        <Card className="w-full max-w-full">
          <CardHeader>
            <CardTitle>Client role required</CardTitle>
            <CardDescription>
              Project creation is available to client accounts. Update your role
              in onboarding first.
            </CardDescription>
          </CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={() => router.push("/onboarding")}>
              Go to onboarding
            </Button>
            <Button
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => router.push("/dashboard")}
            >
              Back to dashboard
            </Button>
          </div>
        </Card>
      ) : (
        <CreateProjectForm />
      )}
    </AuthShell>
  );
}
