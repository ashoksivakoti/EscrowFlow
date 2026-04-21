import { cn } from "@/lib/cn";

export function Spinner({ className }: { className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-label="Loading" className={cn("relative h-9 w-9", className)}>
      <div className="absolute inset-0 animate-spin rounded-full border-2 border-zinc-800 border-t-cyan-300 shadow-[0_0_14px_-6px_rgba(34,211,238,0.75)]" />
      <div className="absolute inset-[7px] rounded-full bg-cyan-300/20" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
