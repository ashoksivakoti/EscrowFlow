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
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-700/90 bg-gradient-to-b from-zinc-900 to-zinc-950 text-zinc-200 shadow-[0_10px_24px_-14px_rgba(0,0,0,0.95)] transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-300/35 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        aria-label="Open notifications"
        aria-expanded={open}
      >
        <span aria-hidden>🔔</span>
      </button>
      {unreadCount > 0 ? (
        <span className="absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full border border-cyan-200/40 bg-cyan-400 px-1 text-[10px] font-semibold text-zinc-950">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}

      {open ? (
        <div className="absolute right-0 mt-2 w-[min(23rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-zinc-800/90 bg-gradient-to-b from-zinc-900/95 to-zinc-950/95 p-3 shadow-[0_26px_48px_-24px_rgba(0,0,0,0.95)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/45 to-transparent"
          />
          <div className="mb-2 flex flex-col gap-2 border-b border-zinc-800/80 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold tracking-tight text-zinc-100">
                Notifications
              </p>
              {unreadCount > 0 ? (
                <p className="text-[10px] text-zinc-400">
                  {unreadCount} unread
                </p>
              ) : null}
            </div>
            <Button type="button" size="sm" variant="secondary" className="w-full sm:w-auto" onClick={() => void markAllRead()}>
              Mark all read
            </Button>
          </div>

          {isPending ? (
            <p className="py-7 text-center text-xs text-zinc-400">Loading notifications…</p>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-700/80 bg-zinc-950/60 px-3 py-6 text-center">
              <p className="text-xs font-medium text-zinc-200">No notifications yet</p>
              <p className="mt-1 text-xs text-zinc-400">
                Project and milestone updates will appear here.
              </p>
            </div>
          ) : (
            <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-lg border p-2 ${
                    item.readAt
                      ? "border-zinc-800/90 bg-zinc-950/70 hover:border-zinc-700/90"
                      : "border-cyan-300/30 bg-cyan-300/10 hover:border-cyan-300/45"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-zinc-100">{item.title}</p>
                    {!item.readAt ? (
                      <button
                        type="button"
                        onClick={() => void markRead(item.id)}
                        className="inline-flex min-h-9 items-center rounded-md px-2 text-[10px] font-medium text-cyan-300 transition-colors hover:bg-cyan-300/10 hover:text-cyan-200"
                      >
                        Mark read
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1 break-words text-xs text-zinc-300">{item.body}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-400">
                    <span>{formatTimeAgo(item.createdAt)}</span>
                    {item.projectId ? (
                      <Link
                        href={`/projects/${item.projectId}`}
                        onClick={() => setOpen(false)}
                        className="inline-flex min-h-9 items-center rounded-md px-2 font-medium text-cyan-300 transition-colors hover:bg-cyan-300/10 hover:text-cyan-200"
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
