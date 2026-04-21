import { cn } from "@/lib/cn";

export function FieldError({
  message,
  className,
}: {
  message?: string;
  className?: string;
}) {
  if (!message) {
    return null;
  }
  return (
    <p
      role="alert"
      className={cn(
        "mt-1.5 inline-flex items-start gap-1.5 rounded-lg border border-red-400/30 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium leading-relaxed text-red-200",
        className,
      )}
    >
      <span aria-hidden="true" className="mt-[1px] text-red-300">
        !
      </span>
      {message}
    </p>
  );
}
