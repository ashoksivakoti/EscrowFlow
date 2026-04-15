"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { Spinner } from "@/components/ui/spinner";
import { needsOnboarding } from "@/lib/auth/client-guards";
import { useMeQuery } from "@/hooks/use-me-query";

export default function OnboardingPage() {
  const router = useRouter();
  const { data: me, isPending, isFetched } = useMeQuery(true);

  useEffect(() => {
    if (!isFetched) {
      return;
    }
    if (!me) {
      router.replace("/login");
      return;
    }
    if (!needsOnboarding(me)) {
      router.replace("/dashboard");
    }
  }, [me, isFetched, router]);

  return (
    <AuthShell
      title="Welcome aboard"
      subtitle="Finish your profile to unlock projects, milestones, and escrow workflows."
    >
      {isPending || !isFetched ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <Spinner />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Loading your account…
          </p>
        </div>
      ) : me && needsOnboarding(me) ? (
        <OnboardingForm />
      ) : null}
    </AuthShell>
  );
}
