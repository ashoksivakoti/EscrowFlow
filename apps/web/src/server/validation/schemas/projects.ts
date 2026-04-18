import { isAddress } from "viem";
import { z } from "zod";

import { PROJECT_STATUSES } from "@escrowflow/types";

const weiAmountSchema = z
  .string()
  .regex(/^\d+$/, "amountWei must be a positive integer string")
  .refine((v) => {
    try {
      return BigInt(v) > 0n;
    } catch {
      return false;
    }
  }, "amountWei must be greater than zero");

export const projectMilestoneInputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(5_000).nullable().optional(),
  amountWei: weiAmountSchema,
  dueAt: z.string().datetime(),
});

const agreementMetadataUploadSchema = z.object({
  mode: z.literal("metadata"),
  metadata: z.record(z.string(), z.unknown()),
});

const agreementFileUploadSchema = z.object({
  mode: z.literal("file"),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  // Base64 payload sent in JSON body.
  fileBase64: z
    .string()
    .trim()
    .min(1)
    .max(35_000_000, "fileBase64 payload is too large")
    .regex(/^[A-Za-z0-9+/=]+$/, "fileBase64 must be base64 content"),
});

export const projectAgreementSchema = z
  .union([agreementMetadataUploadSchema, agreementFileUploadSchema])
  .optional()
  .nullable();

export const createProjectBodySchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(10_000).nullable().optional(),
  freelancerWalletAddress: z
    .string()
    .trim()
    .refine((v) => isAddress(v), "freelancerWalletAddress is not a valid wallet"),
  milestones: z.array(projectMilestoneInputSchema).min(1).max(50),
  agreement: projectAgreementSchema,
  chainId: z.number().int().positive().nullable().optional(),
  escrowContractAddress: z
    .string()
    .trim()
    .refine((v) => isAddress(v), "escrowContractAddress is not a valid wallet")
    .nullable()
    .optional(),
  onChainProjectId: z
    .string()
    .trim()
    .regex(/^\d+$/, "onChainProjectId must be a uint256 decimal string")
    .nullable()
    .optional(),
  paymentTokenAddress: z
    .string()
    .trim()
    .refine((v) => isAddress(v), "paymentTokenAddress is not a valid wallet")
    .nullable()
    .optional(),
});

export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

const listProjectsSortBySchema = z.enum([
  "updatedAt",
  "createdAt",
  "amountWei",
  "deadline",
]);

export const listProjectsQuerySchema = z.object({
  query: z.string().trim().max(120).optional(),
  participation: z.enum(["client", "freelancer", "any"]).optional(),
  status: z
    .union([
      z.enum(PROJECT_STATUSES),
      z.array(z.enum(PROJECT_STATUSES)).min(1),
      z.string(),
      z.array(z.string()).min(1),
    ])
    .optional()
    .transform((raw) => {
      if (!raw) {
        return undefined;
      }
      const values = Array.isArray(raw) ? raw : [raw];
      const expanded = values.flatMap((value) => value.split(","));
      const cleaned = expanded
        .map((item) => item.trim())
        .filter((item): item is (typeof PROJECT_STATUSES)[number] =>
          PROJECT_STATUSES.includes(item as (typeof PROJECT_STATUSES)[number]),
        );
      return cleaned.length > 0 ? Array.from(new Set(cleaned)) : undefined;
    }),
  sortBy: listProjectsSortBySchema.optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
