"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { SignInPanel } from "@/components/auth/sign-in-panel";
import { AuthShell } from "@/components/layout/auth-shell";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { needsOnboarding } from "@/lib/auth/client-guards";
import { useMeQuery } from "@/hooks/use-me-query";
import { useSessionQuery } from "@/hooks/use-session-query";

export default function LoginPage() {
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
    router.replace("/dashboard");
  }, [session, sessionLoading, me, meFetched, router]);

  const showSpinner =
    sessionLoading || (meEnabled && meLoading && !meFetched);

  return (
    <AuthShell
      title="Sign in"
      subtitle="Connect your wallet and sign a message. No gas fees — just verify you control the address."
    >
      <Card className="w-full max-w-full">
        {showSpinner ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <Spinner />
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Checking your session…
            </p>
          </div>
        ) : (
          <SignInPanel />
        )}
      </Card>
    </AuthShell>
  );
}
