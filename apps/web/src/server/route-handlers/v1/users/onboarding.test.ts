import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors/app-error";

vi.mock("@/server/guards/auth-guard", () => ({
  requireAuthenticated: vi.fn(),
}));

vi.mock("@/server/services/user-service", () => ({
  completeOnboarding: vi.fn(),
}));

import { handlePostOnboarding } from "@/server/route-handlers/v1/users/onboarding";
import { requireAuthenticated } from "@/server/guards/auth-guard";
import { completeOnboarding } from "@/server/services/user-service";

afterEach(() => {
  vi.clearAllMocks();
});

describe("handlePostOnboarding", () => {
  it("completes onboarding for authenticated user", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "user_1",
      session: {
        id: "user_1",
        walletAddress: "0x1111111111111111111111111111111111111111",
        roles: [],
        profile: null,
        lastLoginAt: null,
      },
    });
    vi.mocked(completeOnboarding).mockResolvedValue({
      id: "user_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      displayName: "Ashok",
      avatarUrl: null,
      bio: "Builder",
      timezone: null,
      email: null,
      emailVerifiedAt: null,
      roles: ["CLIENT"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const response = await handlePostOnboarding(
      new Request("http://localhost/api/v1/users/me/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "Ashok",
          role: "CLIENT",
          bio: "Builder",
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(completeOnboarding).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({ role: "CLIENT" }),
    );
  });

  it("returns validation error for malformed body", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "user_1",
      session: {
        id: "user_1",
        walletAddress: "0x1111111111111111111111111111111111111111",
        roles: [],
        profile: null,
        lastLoginAt: null,
      },
    });

    const response = await handlePostOnboarding(
      new Request("http://localhost/api/v1/users/me/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "A",
          role: "INVALID",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(completeOnboarding).not.toHaveBeenCalled();
  });

  it("returns 401 for unauthenticated request", async () => {
    vi.mocked(requireAuthenticated).mockRejectedValue(AppError.unauthenticated());
    const response = await handlePostOnboarding(
      new Request("http://localhost/api/v1/users/me/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(401);
  });
});
