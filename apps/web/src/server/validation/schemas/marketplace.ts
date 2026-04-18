import { isAddress } from "viem";
import { z } from "zod";

import {
  projectAgreementSchema,
  projectMilestoneInputSchema,
} from "@/server/validation/schemas/projects";

export const createMarketplaceProjectBodySchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(10_000).nullable().optional(),
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

export type CreateMarketplaceProjectBody = z.infer<typeof createMarketplaceProjectBodySchema>;

export const listPublicProjectsQuerySchema = z.object({
  query: z.string().trim().max(120).optional(),
  sortBy: z.enum(["updatedAt", "createdAt"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().optional(),
});

export type ListPublicProjectsQuery = z.infer<typeof listPublicProjectsQuerySchema>;
