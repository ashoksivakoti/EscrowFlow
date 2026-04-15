import type { ReactNode } from "react";

import { BrandMark } from "@escrowflow/ui";

import { cn } from "@/lib/cn";

export function AuthShell({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-h-dvh w-full overflow-x-hidden bg-gradient-to-b from-zinc-50 via-white to-zinc-100 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-900",
        className,
      )}
    >
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 py-10 sm:max-w-xl sm:px-6 sm:py-16">
        <header className="mb-8 flex flex-col items-center gap-3 text-center sm:mb-10">
          <BrandMark />
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              EscrowFlow
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white sm:text-3xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="max-w-md text-pretty text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {subtitle}
              </p>
            ) : null}
          </div>
        </header>
        <main className="flex w-full min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
