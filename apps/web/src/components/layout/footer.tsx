import Link from "next/link";
import { Briefcase, Code2, UserRound } from "lucide-react";

export function Footer() {
  return (
    <footer className="relative mt-auto bg-zinc-950/70 backdrop-blur-sm before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-cyan-200/45 before:to-transparent">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-3 text-center sm:flex-row sm:gap-2.5 sm:px-6 sm:py-4 sm:text-left lg:px-8">
        <p className="text-xs text-zinc-400 sm:text-sm">
          © 2026 EscrowFlow. All rights reserved.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2.5 text-xs text-zinc-400 sm:justify-end sm:text-sm">
          <span className="inline-flex items-center gap-1.5">
            <UserRound
              aria-hidden="true"
              className="h-3.5 w-3.5 text-zinc-400 sm:h-4 sm:w-4"
              strokeWidth={1.9}
            />
            Built by:
          </span>
          <Link
            href="https://github.com/your-handle"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-zinc-300 transition-colors hover:text-cyan-300"
          >
            Ashok Sivakoti
          </Link>
          <Link
            href="https://github.com/your-handle"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="inline-flex items-center gap-1 rounded-md p-1 text-zinc-400 transition-colors hover:text-cyan-300"
          >
            <Code2 aria-hidden="true" className="h-3.5 w-3.5 sm:h-4 sm:w-4" strokeWidth={1.9} />
            <span className="sr-only sm:not-sr-only">GitHub</span>
          </Link>
          <Link
            href="https://linkedin.com/in/your-handle"
            target="_blank"
            rel="noreferrer"
            aria-label="LinkedIn"
            className="inline-flex items-center gap-1 rounded-md p-1 text-zinc-400 transition-colors hover:text-cyan-300"
          >
            <Briefcase aria-hidden="true" className="h-3.5 w-3.5 sm:h-4 sm:w-4" strokeWidth={1.9} />
            <span className="sr-only sm:not-sr-only">LinkedIn</span>
          </Link>
        </div>
      </div>
    </footer>
  );
}
