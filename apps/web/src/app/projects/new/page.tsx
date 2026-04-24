"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { CreateProjectForm } from "@/components/projects/create-project-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { Button, buttonClassName } from "@/components/ui/button";
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
      subtitle="Define milestones, link optional on-chain context, and invite the freelancer wallet."
      className="overflow-x-hidden"
      iconBrandOnly
    >
      {loading || !me ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <Spinner />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Preparing project workspace...
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
          <div className="flex flex-col gap-3 px-4 pb-4 sm:flex-row sm:px-6 sm:pb-6">
            <Button className="w-full sm:w-auto" onClick={() => router.push("/onboarding")}>
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
        <div className="flex w-full max-w-full flex-col gap-5">
          <Card className="w-full max-w-full border-cyan-300/30 bg-gradient-to-r from-cyan-400/12 via-cyan-300/8 to-transparent">
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Hiring via marketplace?</CardTitle>
              <CardDescription>
                Post a public OPEN project so freelancers can apply. You pick one, then fund escrow.
              </CardDescription>
            </CardHeader>
            <div className="border-t border-zinc-800/80 px-4 py-4 sm:px-6 sm:py-5">
              <Link
                href="/projects/new/marketplace"
                className={buttonClassName({ variant: "secondary", className: "w-full sm:w-auto" })}
              >
                Post to marketplace
              </Link>
            </div>
          </Card>
          <CreateProjectForm />
        </div>
      )}
    </AuthShell>
  );
}
