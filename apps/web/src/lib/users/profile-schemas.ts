import { z } from "zod";

export const patchProfileBodySchema = z
  .object({
    displayName: z.string().min(2).max(40).trim().optional(),
    bio: z.string().max(500).nullable().optional(),
    avatarUrl: z.string().url().max(2048).nullable().optional(),
    timezone: z.string().max(64).nullable().optional(),
    email: z
      .union([z.string().email(), z.literal("")])
      .optional()
      .transform((v) => (v === "" ? null : v)),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Provide at least one field to update",
  });

export const completeOnboardingBodySchema = z.object({
  displayName: z.string().min(2).max(40).trim(),
  email: z
    .union([z.string().email(), z.literal("")])
    .optional()
    .transform((v) => (v === "" ? null : v)),
  bio: z.string().max(500).optional().nullable(),
  avatarUrl: z.string().url().max(2048).nullable().optional(),
  role: z.enum(["CLIENT", "FREELANCER"]),
});
