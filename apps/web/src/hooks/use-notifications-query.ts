"use client";

import { useQuery } from "@tanstack/react-query";

import type { ListNotificationsResponse, NotificationListItem } from "@escrowflow/types";

import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";

export function useNotificationsQuery(enabled: boolean, limit = 12) {
  return useQuery({
    queryKey: ["notifications", limit],
    enabled,
    queryFn: async (): Promise<{ items: NotificationListItem[]; unreadCount: number }> => {
      const res = await fetch(`/api/v1/notifications?limit=${limit}`, {
        credentials: "include",
      });
      const raw = await readJsonOrEmpty(res);
      if (!res.ok) {
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }
      const payload = raw as ListNotificationsResponse & { unreadCount?: number };
      return {
        items: payload.items,
        unreadCount: payload.unreadCount ?? payload.items.filter((item) => !item.readAt).length,
      };
    },
  });
}
