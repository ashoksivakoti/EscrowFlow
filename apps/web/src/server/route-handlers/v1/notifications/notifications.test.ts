import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors/app-error";

vi.mock("@/server/guards/auth-guard", () => ({
  requireAuthenticated: vi.fn(),
}));

vi.mock("@/server/services/notification-service", () => ({
  listNotificationsForUser: vi.fn(),
  markNotificationReadForUser: vi.fn(),
  markAllNotificationsReadForUser: vi.fn(),
}));

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { handleListNotifications } from "@/server/route-handlers/v1/notifications/list";
import {
  handleMarkAllNotificationsRead,
  handleMarkNotificationRead,
} from "@/server/route-handlers/v1/notifications/read";
import {
  listNotificationsForUser,
  markAllNotificationsReadForUser,
  markNotificationReadForUser,
} from "@/server/services/notification-service";

afterEach(() => {
  vi.clearAllMocks();
});

describe("notifications handlers", () => {
  it("lists notifications with unread count", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "user_1",
      session: {
        id: "user_1",
        walletAddress: "0x1111111111111111111111111111111111111111",
        roles: ["CLIENT"],
        profile: null,
        lastLoginAt: null,
      },
    });
    vi.mocked(listNotificationsForUser).mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
      unreadCount: 0,
    });

    const response = await handleListNotifications(
      new Request("http://localhost/api/v1/notifications?limit=8"),
    );
    expect(response.status).toBe(200);
    expect(listNotificationsForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_1", limit: 8 }),
    );
  });

  it("marks one notification as read", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "user_1",
      session: {
        id: "user_1",
        walletAddress: "0x1111111111111111111111111111111111111111",
        roles: ["CLIENT"],
        profile: null,
        lastLoginAt: null,
      },
    });
    vi.mocked(markNotificationReadForUser).mockResolvedValue({
      notification: {
        id: "n1",
        type: "SYSTEM",
        title: "Hello",
        body: "Body",
        readAt: new Date().toISOString(),
        projectId: null,
        milestoneId: null,
        data: null,
        createdAt: new Date().toISOString(),
      },
    });

    const response = await handleMarkNotificationRead(
      new Request("http://localhost/api/v1/notifications/n1/read", { method: "POST" }),
      "n1",
    );
    expect(response.status).toBe(200);
    expect(markNotificationReadForUser).toHaveBeenCalledWith("user_1", "n1");
  });

  it("marks all notifications as read", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "user_1",
      session: {
        id: "user_1",
        walletAddress: "0x1111111111111111111111111111111111111111",
        roles: ["CLIENT"],
        profile: null,
        lastLoginAt: null,
      },
    });
    vi.mocked(markAllNotificationsReadForUser).mockResolvedValue({ updatedCount: 4 });

    const response = await handleMarkAllNotificationsRead(
      new Request("http://localhost/api/v1/notifications/read-all", { method: "POST" }),
    );
    expect(response.status).toBe(200);
    expect(markAllNotificationsReadForUser).toHaveBeenCalledWith("user_1");
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuthenticated).mockRejectedValue(AppError.unauthenticated());
    const response = await handleListNotifications(
      new Request("http://localhost/api/v1/notifications"),
    );
    expect(response.status).toBe(401);
  });
});
