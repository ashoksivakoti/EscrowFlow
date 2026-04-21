import type { ReactNode } from "react";

import { BrandMark } from "@escrowflow/ui";

import { cn } from "@/lib/cn";
import { NotificationBell } from "@/components/notifications/notification-bell";

export function AuthShell({
  title,
  subtitle,
  children,
  className,
  containerClassName,
  showNotifications = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  containerClassName?: string;
  showNotifications?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative min-h-dvh w-full overflow-x-hidden bg-[radial-gradient(120%_80%_at_50%_0%,rgba(6,182,212,0.14)_0%,rgba(2,6,23,0)_55%)] bg-zinc-950",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(circle_at_center,black,transparent_82%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 top-20 h-72 w-72 rounded-full bg-cyan-300/10 blur-[100px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 top-16 h-64 w-64 rounded-full bg-cyan-400/10 blur-[100px]"
      />
      <div
        className={cn(
          "relative z-10 mx-auto flex min-h-dvh w-full max-w-lg flex-col px-3.5 py-6 pb-10 sm:max-w-xl sm:px-5 sm:py-10 sm:pb-12 md:px-6 lg:py-14",
          containerClassName,
        )}
      >
        <header
          className={cn(
            "relative mb-6 flex flex-col items-center gap-3 px-5 text-center sm:mb-8 sm:px-10",
            showNotifications ? "pr-14 sm:pr-16" : undefined,
          )}
        >
          {showNotifications ? (
            <div className="absolute -top-1 right-0 sm:top-0 sm:right-1">
              <NotificationBell />
            </div>
          ) : null}
          <BrandMark />
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-300">
              EscrowFlow
            </p>
            <h1 className="text-[1.65rem] font-semibold tracking-tight text-white sm:text-3xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="max-w-md text-pretty text-sm leading-relaxed text-zinc-300/95">
                {subtitle}
              </p>
            ) : null}
          </div>
        </header>
        <main className="flex w-full min-w-0 flex-1 flex-col gap-4">{children}</main>
      </div>
    </div>
  );
}
