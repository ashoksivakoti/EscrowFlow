import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors/app-error";

vi.mock("@/server/services/auth-service", () => ({
  issueSiweNoncePayload: vi.fn(),
  verifySiweAndBuildSession: vi.fn(),
  getSessionResponse: vi.fn(),
  buildLogoutResponse: vi.fn(),
}));

import { handleGetSiweNonce } from "@/server/route-handlers/v1/auth/nonce";
import { handlePostSiweVerify } from "@/server/route-handlers/v1/auth/verify";
import { handleGetSession } from "@/server/route-handlers/v1/auth/session";
import { handlePostLogout } from "@/server/route-handlers/v1/auth/logout";
import {
  buildLogoutResponse,
  getSessionResponse,
  issueSiweNoncePayload,
  verifySiweAndBuildSession,
} from "@/server/services/auth-service";

afterEach(() => {
  vi.clearAllMocks();
});

describe("auth route handlers", () => {
  it("returns SIWE nonce payload", async () => {
    vi.mocked(issueSiweNoncePayload).mockResolvedValue({
      nonce: "nonce-123",
      siwe: {
        domain: "localhost",
        uri: "http://localhost:3000",
        chainId: 31337,
        chainIdsAllowed: [31337],
        statement: "Sign in",
        expirationMinutes: 10,
      },
    });

    const response = await handleGetSiweNonce(
      new Request("http://localhost/api/v1/auth/siwe/nonce"),
    );
    expect(response.status).toBe(200);
  });

  it("verifies SIWE and returns session with cookie", async () => {
    vi.mocked(verifySiweAndBuildSession).mockResolvedValue({
      payload: {
        user: {
          id: "u1",
          walletAddress: "0x1111111111111111111111111111111111111111",
          roles: ["CLIENT"],
          profile: null,
          lastLoginAt: null,
        },
        expiresAt: new Date().toISOString(),
        isNewUser: false,
      },
      setCookie: "escrowflow_session=abc; Path=/; HttpOnly",
    });

    const response = await handlePostSiweVerify(
      new Request("http://localhost/api/v1/auth/siwe/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "siwe-message",
          signature:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("escrowflow_session=");
  });

  it("returns validation failure for malformed SIWE verify body", async () => {
    const response = await handlePostSiweVerify(
      new Request("http://localhost/api/v1/auth/siwe/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "x", signature: "bad" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(verifySiweAndBuildSession).not.toHaveBeenCalled();
  });

  it("returns session payload", async () => {
    vi.mocked(getSessionResponse).mockResolvedValue({
      authenticated: true,
      user: {
        id: "u1",
        walletAddress: "0x1111111111111111111111111111111111111111",
        roles: ["CLIENT"],
        profile: null,
        lastLoginAt: null,
      },
    });

    const response = await handleGetSession(
      new Request("http://localhost/api/v1/auth/session"),
    );
    expect(response.status).toBe(200);
  });

  it("returns logout payload and clear cookie", async () => {
    vi.mocked(buildLogoutResponse).mockReturnValue({
      payload: { ok: true },
      setCookie: "escrowflow_session=; Max-Age=0; Path=/",
    });
    const response = await handlePostLogout(
      new Request("http://localhost/api/v1/auth/logout", { method: "POST" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("maps service auth error to response", async () => {
    vi.mocked(issueSiweNoncePayload).mockRejectedValue(
      new AppError("AUTH_FAILED", "Could not issue nonce", 503),
    );
    const response = await handleGetSiweNonce(
      new Request("http://localhost/api/v1/auth/siwe/nonce"),
    );
    expect(response.status).toBe(503);
  });
});
