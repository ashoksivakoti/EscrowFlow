import { z } from "zod";

import { MARKETPLACE_APPLICATION_FIELD_LIMITS } from "@/lib/marketplace/form-limits";

const L = MARKETPLACE_APPLICATION_FIELD_LIMITS;

export const createProjectApplicationBodySchema = z.object({
  coverLetter: z.string().trim().min(L.coverLetter.min).max(L.coverLetter.max),
  portfolioLink: z
    .string()
    .trim()
    .min(1, "Portfolio link is required")
    .url("Enter a valid URL")
    .max(L.portfolioUrl.max),
  proposedTimeline: z
    .string()
    .trim()
    .max(L.proposedTimeline.max)
    .nullable()
    .optional(),
});

export type CreateProjectApplicationBody = z.infer<typeof createProjectApplicationBodySchema>;
