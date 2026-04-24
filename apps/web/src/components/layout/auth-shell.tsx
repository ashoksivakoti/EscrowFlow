import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { NotificationBell } from "@/components/notifications/notification-bell";

export function AuthShell({
  title,
  subtitle,
  children,
  className,
  containerClassName,
  showNotifications = true,
  iconBrandOnly = false,
  headerActions,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  containerClassName?: string;
  showNotifications?: boolean;
  iconBrandOnly?: boolean;
  headerActions?: ReactNode;
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
            "relative mb-7 flex w-full flex-col items-center px-5 text-center sm:mb-9 sm:px-10",
            iconBrandOnly ? "gap-4" : "gap-4",
            showNotifications || headerActions ? "px-14 sm:px-16 md:px-40" : undefined,
          )}
        >
          {showNotifications || headerActions ? (
            <div className="absolute -top-1 right-0 z-20 flex items-center gap-2 sm:top-0 sm:right-1">
              {showNotifications ? <NotificationBell /> : null}
              {headerActions ? <div className="flex items-center gap-2">{headerActions}</div> : null}
            </div>
          ) : null}
          <Link
            href="/"
            aria-label="EscrowFlow home"
            className={cn(
              "inline-flex max-w-full items-center justify-center transition-colors",
              iconBrandOnly
                ? "flex-col gap-0.5 px-2 py-1"
                : "rounded-xl border border-zinc-800/90 bg-zinc-900/65 px-3 py-2 shadow-[0_10px_20px_-14px_rgba(0,0,0,0.95)] hover:border-cyan-300/35",
            )}
          >
            {iconBrandOnly ? (
              <>
                <Image
                  src="/images/escrow_icon.png"
                  alt="EscrowFlow logo"
                  width={1254}
                  height={1254}
                  className="h-20 w-20 object-contain sm:h-24 sm:w-24"
                  priority
                />
                <span className="bg-gradient-to-b from-zinc-100 via-zinc-300 to-cyan-200 bg-clip-text text-xs font-semibold uppercase tracking-[0.2em] text-transparent drop-shadow-[0_0_10px_rgba(34,211,238,0.2)] sm:text-sm">
                  EscrowFlow
                </span>
              </>
            ) : (
              <>
                <Image
                  src="/images/escrow_icon.png"
                  alt="EscrowFlow logo"
                  width={1254}
                  height={1254}
                  className="h-7 w-7 object-contain sm:hidden"
                  priority
                />
                <Image
                  src="/images/escrow_logo.png"
                  alt="EscrowFlow logo"
                  width={1536}
                  height={1024}
                  className="hidden h-auto w-[132px] max-w-full object-contain sm:block md:w-[156px]"
                  priority
                />
              </>
            )}
          </Link>
          <div className={cn(iconBrandOnly ? "space-y-1.5" : "space-y-1.5")}>
            {iconBrandOnly ? null : (
              <p className="bg-gradient-to-b from-zinc-100 via-zinc-300 to-cyan-200 bg-clip-text text-[10px] font-semibold uppercase tracking-[0.18em] text-transparent drop-shadow-[0_0_10px_rgba(34,211,238,0.2)]">
                EscrowFlow
              </p>
            )}
            <h1 className="text-balance text-[1.65rem] font-semibold tracking-tight text-white sm:text-3xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="max-w-xl text-pretty text-sm leading-relaxed text-zinc-300/95">
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
