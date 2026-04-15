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
      className={cn("text-sm font-medium text-red-600 dark:text-red-400", className)}
    >
      {message}
    </p>
  );
}
