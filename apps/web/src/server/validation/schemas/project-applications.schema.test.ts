import { describe, expect, it } from "vitest";

import { MARKETPLACE_APPLICATION_FIELD_LIMITS } from "@/lib/marketplace/form-limits";
import { createProjectApplicationBodySchema } from "@/server/validation/schemas/project-applications";

const validCover = "x".repeat(MARKETPLACE_APPLICATION_FIELD_LIMITS.coverLetter.min);
const validPortfolio = "https://example.com/portfolio";

describe("createProjectApplicationBodySchema", () => {
  it("accepts minimal valid payload", () => {
    const out = createProjectApplicationBodySchema.parse({
      coverLetter: validCover,
      portfolioLink: validPortfolio,
    });
    expect(out.portfolioLink).toBe(validPortfolio);
  });

  it("rejects cover letter shorter than minimum", () => {
    expect(() =>
      createProjectApplicationBodySchema.parse({
        coverLetter: "short",
        portfolioLink: validPortfolio,
      }),
    ).toThrow();
  });

  it("rejects cover letter over maximum", () => {
    expect(() =>
      createProjectApplicationBodySchema.parse({
        coverLetter: "x".repeat(MARKETPLACE_APPLICATION_FIELD_LIMITS.coverLetter.max + 1),
        portfolioLink: validPortfolio,
      }),
    ).toThrow();
  });

  it("rejects empty portfolio link", () => {
    expect(() =>
      createProjectApplicationBodySchema.parse({
        coverLetter: validCover,
        portfolioLink: "",
      }),
    ).toThrow();
  });

  it("rejects whitespace-only portfolio link", () => {
    expect(() =>
      createProjectApplicationBodySchema.parse({
        coverLetter: validCover,
        portfolioLink: "   ",
      }),
    ).toThrow();
  });

  it("rejects invalid portfolio URL", () => {
    expect(() =>
      createProjectApplicationBodySchema.parse({
        coverLetter: validCover,
        portfolioLink: "not-a-url",
      }),
    ).toThrow();
  });

  it("accepts valid https portfolio URL", () => {
    const out = createProjectApplicationBodySchema.parse({
      coverLetter: validCover,
      portfolioLink: "https://example.com/portfolio",
    });
    expect(out.portfolioLink).toBe("https://example.com/portfolio");
  });

  it("rejects proposed timeline over max length", () => {
    expect(() =>
      createProjectApplicationBodySchema.parse({
        coverLetter: validCover,
        portfolioLink: validPortfolio,
        proposedTimeline: "y".repeat(MARKETPLACE_APPLICATION_FIELD_LIMITS.proposedTimeline.max + 1),
      }),
    ).toThrow();
  });
});
