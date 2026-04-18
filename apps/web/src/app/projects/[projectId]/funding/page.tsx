"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { isAddress } from "viem";

import { AuthShell } from "@/components/layout/auth-shell";
import { ProjectFundingPanel } from "@/components/projects/project-funding-panel";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { needsOnboarding } from "@/lib/auth/client-guards";
import { useMeQuery } from "@/hooks/use-me-query";
import { useProjectDetailQuery } from "@/hooks/use-project-detail-query";
import { useSessionQuery } from "@/hooks/use-session-query";

export default function ProjectFundingPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? null;

  const { data: session, isPending: sessionLoading } = useSessionQuery();
  const meEnabled = Boolean(session?.authenticated);
  const { data: me, isPending: meLoading, isFetched: meFetched } = useMeQuery(meEnabled);
  const { data: project, isPending: projectLoading, isFetched: projectFetched } =
    useProjectDetailQuery(projectId, meEnabled);

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

  const loading =
    !projectId ||
    sessionLoading ||
    (meEnabled && meLoading && !meFetched) ||
    projectLoading;

  const hasFundingBinding =
    Boolean(project?.chainId) &&
    Boolean(project?.escrowContractAddress && isAddress(project.escrowContractAddress)) &&
    Boolean(project?.paymentTokenAddress && isAddress(project.paymentTokenAddress)) &&
    Boolean(project?.onChainProjectId) &&
    Boolean(project?.totalValueWei);

  return (
    <AuthShell
      title="Project funding"
      subtitle="Approve token allowance and fund escrow with clear transaction status updates."
      className="overflow-x-hidden"
    >
      {loading || !me || !projectFetched || !project ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <Spinner />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading funding panel...</p>
        </div>
      ) : !me.roles.includes("CLIENT") || project.client.id !== me.id ? (
        <Card>
          <CardHeader>
            <CardTitle>Client access required</CardTitle>
            <CardDescription>
              Only the project owner can approve token allowance and fund escrow.
            </CardDescription>
          </CardHeader>
          <Button onClick={() => router.push("/dashboard")}>Back to dashboard</Button>
        </Card>
      ) : !hasFundingBinding ? (
        <Card>
          <CardHeader>
            <CardTitle>Project not linked on-chain yet</CardTitle>
            <CardDescription>
              Add chain ID, escrow contract, token address, and on-chain project ID
              during setup before funding can start.
            </CardDescription>
          </CardHeader>
          <Button onClick={() => router.push("/projects/new")}>Create linked project</Button>
        </Card>
      ) : (
        <ProjectFundingPanel
          projectId={project.id}
          projectTitle={project.title}
          chainId={project.chainId!}
          escrowContractAddress={project.escrowContractAddress as `0x${string}`}
          tokenAddress={project.paymentTokenAddress as `0x${string}`}
          onChainProjectId={project.onChainProjectId!}
          totalValueWei={project.totalValueWei!}
        />
      )}
    </AuthShell>
  );
}
