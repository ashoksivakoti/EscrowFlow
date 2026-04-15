import Link from "next/link";

import { BrandMark } from "@escrowflow/ui";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-10 overflow-x-hidden px-4 py-12 sm:gap-12 sm:px-6 sm:py-16 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
        <BrandMark />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            EscrowFlow
          </p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white sm:text-3xl">
            Milestone escrow for freelancers and clients
          </h1>
        </div>
      </header>
      <p className="max-w-2xl text-pretty text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
        Fund milestones in stablecoins, ship deliverables with IPFS-backed
        evidence, and resolve disputes with a clear audit trail — all tied to
        on-chain escrow you can trust.
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
    </main>
  );
}
