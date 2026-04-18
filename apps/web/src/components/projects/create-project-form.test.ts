// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";

import { CreateProjectForm } from "@/components/projects/create-project-form";

const replaceMock = vi.fn();
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
  }),
}));

describe("CreateProjectForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows validation errors for invalid required fields", async () => {
    render(createElement(CreateProjectForm));

    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByText("Use at least 3 characters")).toBeInTheDocument();
    expect(await screen.findByText("Enter a valid EVM wallet address")).toBeInTheDocument();
  });

  it("submits valid payload and redirects to funding page", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ project: { id: "project_123" } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(createElement(CreateProjectForm));

    fireEvent.change(screen.getByLabelText("Project title"), {
      target: { value: "Escrow website redesign" },
    });
    fireEvent.change(screen.getByLabelText("Freelancer wallet"), {
      target: { value: "0x1111111111111111111111111111111111111111" },
    });
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Milestone A" },
    });
    fireEvent.change(screen.getByLabelText("Amount (smallest token units)"), {
      target: { value: "1000" },
    });
    fireEvent.change(screen.getByLabelText("Deadline"), {
      target: { value: "2030-01-01T10:00" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
    });
    expect(await screen.findByText("Project created successfully.")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(replaceMock).toHaveBeenCalledWith("/projects/project_123/funding");
      },
      { timeout: 1500 },
    );
  });
});
