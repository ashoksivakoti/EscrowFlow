"use client";

import Image from "next/image";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";

import { buttonClassName } from "@/components/ui/button";

export function LandingNavbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  function closeMobileMenu() {
    setIsMobileMenuOpen(false);
  }

  return (
    <header className="sticky top-0 z-30 px-4 pt-3 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <nav className="relative overflow-hidden rounded-2xl border border-zinc-700/70 bg-gradient-to-b from-zinc-900/75 to-zinc-950/75 backdrop-blur-xl before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-cyan-300/40 before:to-transparent">
          <div className="relative z-10 flex items-center justify-between px-3 py-3 sm:px-4">
            <Link href="/" aria-label="EscrowFlow home" className="inline-flex items-center gap-1">
              <Image
                src="/images/escrow_icon.png"
                alt="EscrowFlow logo"
                width={1254}
                height={1254}
                priority
                className="h-10 w-10 object-contain sm:h-11 sm:w-11"
              />
              <span className="bg-gradient-to-b from-zinc-100 via-zinc-300 to-cyan-200 bg-clip-text text-base font-semibold uppercase tracking-[0.16em] text-transparent drop-shadow-[0_0_12px_rgba(34,211,238,0.28)] sm:text-[1.02rem]">
                EscrowFlow
              </span>
            </Link>

            <button
              type="button"
              aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={isMobileMenuOpen}
              aria-controls="landing-mobile-menu"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-700/85 bg-zinc-900/70 text-zinc-200 transition-colors hover:border-cyan-300/45 hover:text-cyan-100 sm:hidden"
              onClick={() => setIsMobileMenuOpen((open) => !open)}
            >
              {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>

            <div className="hidden sm:flex sm:w-auto sm:flex-wrap sm:justify-end sm:gap-2">
              <Link
                href="/dashboard"
                className={buttonClassName({
                  variant: "secondary",
                  size: "sm",
                  className:
                    "w-full sm:w-auto border-zinc-600/80 bg-zinc-900/70 hover:border-cyan-300/35",
                })}
              >
                Explore dashboard
              </Link>
              <Link
                href="/login"
                className={buttonClassName({
                  variant: "primary",
                  size: "sm",
                  className:
                    "w-full sm:w-auto shadow-[0_1px_0_rgba(255,255,255,0.45)_inset,0_14px_28px_-16px_rgba(34,211,238,0.9)]",
                })}
              >
                Sign in with wallet
              </Link>
            </div>
          </div>

          <div
            id="landing-mobile-menu"
            className={
              isMobileMenuOpen
                ? "border-t border-zinc-800/85 px-3 pb-3 pt-2 sm:hidden"
                : "hidden"
            }
          >
            <div className="grid grid-cols-1 gap-2">
              <Link
                href="/dashboard"
                onClick={closeMobileMenu}
                className={buttonClassName({
                  variant: "secondary",
                  size: "sm",
                  className:
                    "w-full border-zinc-600/80 bg-zinc-900/70 hover:border-cyan-300/35",
                })}
              >
                Explore dashboard
              </Link>
              <Link
                href="/login"
                onClick={closeMobileMenu}
                className={buttonClassName({
                  variant: "primary",
                  size: "sm",
                  className:
                    "w-full shadow-[0_1px_0_rgba(255,255,255,0.45)_inset,0_14px_28px_-16px_rgba(34,211,238,0.9)]",
                })}
              >
                Sign in with wallet
              </Link>
            </div>
          </div>
        </nav>
      </div>
    </header>
  );
}
