"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { isAddress } from "viem";

import { AuthShell } from "@/components/layout/auth-shell";
import { ProjectFundingPanel } from "@/components/projects/project-funding-panel";
import { ProjectOnChainCreatePanel } from "@/components/projects/project-on-chain-create-panel";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  const hasOnChainTargets =
    Boolean(project?.chainId) &&
    Boolean(project?.escrowContractAddress && isAddress(project.escrowContractAddress)) &&
    Boolean(project?.paymentTokenAddress && isAddress(project.paymentTokenAddress)) &&
    Boolean(project?.totalValueWei);

  const canCreateOnChainEscrow = Boolean(
    project &&
    hasOnChainTargets &&
    !project.onChainProjectId &&
    project.status === "AWAITING_ESCROW" &&
    project.freelancer &&
    project.milestones.length > 0,
  );

  return (
    <AuthShell
      title="Project funding"
      subtitle="Approve token allowance and fund escrow with clear transaction status updates."
      className="overflow-x-hidden"
      iconBrandOnly
    >
      {loading || !me || !projectFetched || !project ? (
        <ProjectFundingSkeleton />
      ) : !me.roles.includes("CLIENT") || project.client.id !== me.id ? (
        <Card>
          <CardHeader>
            <CardTitle>Client access required</CardTitle>
            <CardDescription>
              Only the project owner can approve token allowance and fund escrow.
            </CardDescription>
          </CardHeader>
          <div className="px-4 pb-4 sm:px-6">
            <Button className="w-full sm:w-auto" onClick={() => router.push("/dashboard")}>
              Back to dashboard
            </Button>
          </div>
        </Card>
      ) : !hasFundingBinding ? (
        canCreateOnChainEscrow ? (
          <ProjectOnChainCreatePanel project={project} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Project not linked on-chain yet</CardTitle>
              <CardDescription>
                {!hasOnChainTargets
                  ? "Add chain ID, escrow contract, token address, and milestones with totals before funding can start. You can set these when posting to the marketplace or on the direct create flow."
                  : project.status === "OPEN" || !project.freelancer
                    ? "Escrow is created on-chain only after a freelancer is assigned. Accept an applicant from the project page, then return here to create the registry project with your wallet."
                    : "On-chain registry details are incomplete, or the project is not in the awaiting-escrow state. Check project settings or create a new linked listing."}
              </CardDescription>
            </CardHeader>
            <div className="flex flex-col gap-2 px-4 pb-6 sm:flex-row sm:flex-wrap sm:px-6">
              <Button type="button" className="w-full sm:w-auto" onClick={() => router.push(`/projects/${project.id}`)}>
                Back to project
              </Button>
              <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => router.push("/projects/new")}>
                Create linked project
              </Button>
            </div>
          </Card>
        )
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

function ProjectFundingSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="space-y-3 p-4 sm:p-6">
        <div className="h-6 w-44 animate-pulse rounded bg-zinc-800" />
        <div className="h-3 w-full animate-pulse rounded bg-zinc-900/80" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-900/80" />
      </div>
      <div className="space-y-3 border-t border-zinc-800/90 px-4 py-4 sm:px-6 sm:py-5">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div key={idx} className="h-12 animate-pulse rounded-xl bg-zinc-900/80" />
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-zinc-800/90 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
        <div className="h-10 w-full animate-pulse rounded-xl bg-zinc-900/80 sm:w-32" />
        <div className="h-10 w-full animate-pulse rounded-xl bg-zinc-900/80 sm:w-40" />
      </div>
    </Card>
  );
}
