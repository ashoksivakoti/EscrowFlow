// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { NotificationBell } from "@/components/notifications/notification-bell";

const sessionState = vi.hoisted(() => ({
  authenticated: true,
}));
const notificationsState = vi.hoisted(() => ({
  data: {
    unreadCount: 2,
    items: [
      {
        id: "n1",
        title: "Milestone submitted",
        body: "Review requested.",
        createdAt: new Date().toISOString(),
        readAt: null,
        projectId: "project_1",
      },
    ],
  },
  isPending: false,
}));

vi.mock("@/hooks/use-session-query", () => ({
  useSessionQuery: () => ({
    data: { authenticated: sessionState.authenticated },
  }),
}));

vi.mock("@/hooks/use-notifications-query", () => ({
  useNotificationsQuery: () => notificationsState,
}));

function renderWithQueryClient(node: ReactNode) {
  const queryClient = new QueryClient();
  return render(createElement(QueryClientProvider, { client: queryClient }, node));
}

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    sessionState.authenticated = true;
  });

  it("does not render for unauthenticated sessions", () => {
    sessionState.authenticated = false;
    renderWithQueryClient(createElement(NotificationBell));
    expect(screen.queryByLabelText("Open notifications")).not.toBeInTheDocument();
  });

  it("opens dropdown and marks all as read", async () => {
    renderWithQueryClient(createElement(NotificationBell));

    fireEvent.click(screen.getByLabelText("Open notifications"));
    expect(await screen.findByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("Milestone submitted")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/v1/notifications/read-all", expect.any(Object));
    });
  });
});
