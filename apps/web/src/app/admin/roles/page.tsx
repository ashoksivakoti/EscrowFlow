"use client";

import { useRouter } from "next/navigation";

import { AuthShell } from "@/components/layout/auth-shell";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMeQuery } from "@/hooks/use-me-query";
import { useSessionQuery } from "@/hooks/use-session-query";
import { RoleGovernancePanel } from "@/components/admin/role-governance-panel";

export default function AdminRolesPage() {
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = useSessionQuery();
  const meEnabled = Boolean(session?.authenticated);
  const { data: me, isPending: meLoading } = useMeQuery(meEnabled);

  if (sessionLoading || (meEnabled && meLoading)) {
    return (
      <AuthShell title="Role governance" subtitle="Loading admin role controls..." iconBrandOnly>
        <Card>
          <CardHeader>
            <CardTitle>Loading</CardTitle>
            <CardDescription>Preparing on-chain governance controls.</CardDescription>
          </CardHeader>
        </Card>
      </AuthShell>
    );
  }

  if (!session?.authenticated) {
    router.replace("/login");
    return null;
  }

  if (!me?.roles.includes("ADMIN")) {
    return (
      <AuthShell
        title="Role governance"
        subtitle="This page is restricted to app admin accounts."
        iconBrandOnly
      >
        <Card>
          <CardHeader>
            <CardTitle>Admin role required</CardTitle>
            <CardDescription>
              You need app ADMIN role before using on-chain role governance tools.
            </CardDescription>
          </CardHeader>
          <div className="flex justify-end px-4 pb-4 sm:px-6">
            <Button type="button" variant="secondary" onClick={() => router.push("/dashboard")}>
              Back to dashboard
            </Button>
          </div>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Role governance"
      subtitle="Manage on-chain role assignments and arbitrator threshold safely."
      className="overflow-x-hidden"
      containerClassName="max-w-5xl sm:max-w-5xl"
      iconBrandOnly
    >
      <RoleGovernancePanel />
    </AuthShell>
  );
}
