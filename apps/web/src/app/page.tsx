import Link from "next/link";

import { BrandMark } from "@escrowflow/ui";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-10 overflow-x-hidden px-4 py-10 sm:gap-12 sm:px-6 sm:py-14 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
        <BrandMark />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
            EscrowFlow
          </p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white sm:text-3xl">
            Milestone-based crypto escrow built for modern freelance teams
          </h1>
        </div>
      </header>

      <p className="max-w-3xl text-pretty text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
        Clients fund milestones in stablecoins, freelancers submit verifiable
        work packages, and both sides keep a transparent on-chain + IPFS audit
        trail from kickoff to payout.
      </p>

      <div className="flex w-full max-w-full flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link
          href="/login"
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-indigo-600 px-5 text-center text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 active:bg-indigo-700"
        >
          Sign in with wallet
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex min-h-12 items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 text-center text-sm font-medium text-zinc-900 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
        >
          Open dashboard
        </Link>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FeatureCard
          title="Secure milestone funding"
          description="Escrow deposits and releases are tracked on-chain, reducing payment ambiguity."
        />
        <FeatureCard
          title="IPFS-backed submissions"
          description="Deliverables and evidence use immutable content addressing for durable auditability."
        />
        <FeatureCard
          title="Dispute-ready workflow"
          description="Structured dispute handling with arbitrator/admin resolution and synced history."
        />
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/50 sm:p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
          Typical flow
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Connect wallet → complete onboarding → create project + milestones →
          fund escrow → submit work → approve and release.
        </p>
      </section>
    </main>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
    </div>
  );
}
