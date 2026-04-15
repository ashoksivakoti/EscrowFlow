"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useNotificationsQuery } from "@/hooks/use-notifications-query";
import { useSessionQuery } from "@/hooks/use-session-query";
import { Button } from "@/components/ui/button";

export function NotificationBell() {
  const queryClient = useQueryClient();
  const { data: session } = useSessionQuery();
  const enabled = Boolean(session?.authenticated);
  const { data, isPending } = useNotificationsQuery(enabled, 10);
  const [open, setOpen] = useState(false);
  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  async function markRead(notificationId: string): Promise<void> {
    await fetch(`/api/v1/notifications/${notificationId}/read`, {
      method: "POST",
      credentials: "include",
    });
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  async function markAllRead(): Promise<void> {
    await fetch("/api/v1/notifications/read-all", {
      method: "POST",
      credentials: "include",
    });
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  if (!enabled) {
    return null;
  }

  return (
    <div className="relative z-20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        aria-label="Open notifications"
      >
        <span aria-hidden>🔔</span>
      </button>
      {unreadCount > 0 ? (
        <span className="absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-semibold text-white">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}

      {open ? (
        <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Notifications</p>
            <Button type="button" size="sm" variant="secondary" onClick={() => void markAllRead()}>
              Mark all read
            </Button>
          </div>

          {isPending ? (
            <p className="py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">Loading…</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
              No notifications yet.
            </p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-lg border p-2 ${
                    item.readAt
                      ? "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50"
                      : "border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{item.title}</p>
                    {!item.readAt ? (
                      <button
                        type="button"
                        onClick={() => void markRead(item.id)}
                        className="text-[10px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        Mark read
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{item.body}</p>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                    <span>{formatTimeAgo(item.createdAt)}</span>
                    {item.projectId ? (
                      <Link
                        href={`/projects/${item.projectId}`}
                        onClick={() => setOpen(false)}
                        className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        Open
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function formatTimeAgo(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "just now";
  }
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diffMs / 60_000));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
