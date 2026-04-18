// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { DisputeCreatePanel } from "@/components/projects/dispute-create-panel";

function renderWithQueryClient(node: ReactNode) {
  const queryClient = new QueryClient();
  return render(createElement(QueryClientProvider, { client: queryClient }, node));
}

describe("DisputeCreatePanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows validation error when reason is too short", async () => {
    renderWithQueryClient(
      createElement(DisputeCreatePanel, { projectId: "project_1", milestoneId: "milestone_1" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit dispute" }));

    expect(
      await screen.findByText("Please provide at least 10 characters in dispute reason."),
    ).toBeInTheDocument();
  });

  it("submits dispute and shows success state", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    renderWithQueryClient(
      createElement(DisputeCreatePanel, { projectId: "project_1", milestoneId: "milestone_1" }),
    );

    fireEvent.change(
      screen.getByPlaceholderText("Describe why this milestone requires dispute review"),
      {
      target: { value: "Client says delivery does not match acceptance criteria." },
      },
    );
    const file = new File(["evidence"], "evidence.txt", { type: "text/plain" });
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit dispute" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
    expect(await screen.findByText(/Dispute submitted\./)).toBeInTheDocument();
  });
});
