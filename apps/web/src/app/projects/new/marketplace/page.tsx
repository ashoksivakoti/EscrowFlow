"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { CreateMarketplaceProjectForm } from "@/components/projects/create-marketplace-project-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { needsOnboarding } from "@/lib/auth/client-guards";
import { useMeQuery } from "@/hooks/use-me-query";
import { useSessionQuery } from "@/hooks/use-session-query";

export default function NewMarketplaceProjectPage() {
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = useSessionQuery();
  const meEnabled = Boolean(session?.authenticated);
  const { data: me, isPending: meLoading, isFetched: meFetched } = useMeQuery(meEnabled);

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

  const loading = sessionLoading || (meEnabled && meLoading && !meFetched);

  return (
    <AuthShell
      title="Post to marketplace"
      subtitle="Create milestones without a freelancer wallet. Freelancers apply; you accept one to start escrow."
      className="overflow-x-hidden"
      containerClassName="max-w-3xl sm:max-w-3xl"
    >
      {loading || !me ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <Spinner />
        </div>
      ) : !me.roles.includes("CLIENT") ? (
        <Card>
          <CardHeader>
            <CardTitle>Clients only</CardTitle>
            <CardDescription>Complete onboarding as a client to post marketplace projects.</CardDescription>
          </CardHeader>
          <div className="px-4 pb-4 sm:px-6">
            <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => router.push("/projects/new")}>
              Direct invite flow
            </Button>
          </div>
        </Card>
      ) : (
        <CreateMarketplaceProjectForm />
      )}
    </AuthShell>
  );
}
