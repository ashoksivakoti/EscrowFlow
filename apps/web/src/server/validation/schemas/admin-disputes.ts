import { isAddress } from "viem";
import { z } from "zod";

export const adminDisputeStatusFilterSchema = z
  .enum(["open", "resolved", "all"])
  .default("open");

export const listAdminDisputesQuerySchema = z.object({
  status: adminDisputeStatusFilterSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const resolveDisputeBodySchema = z.object({
  kind: z.enum(["PAYOUT_TO_FREELANCER", "REFUND_TO_CLIENT", "SPLIT"]),
  freelancerAmountWei: z
    .string()
    .trim()
    .regex(/^\d+$/, "freelancerAmountWei must be uint256 decimal string"),
  clientAmountWei: z
    .string()
    .trim()
    .regex(/^\d+$/, "clientAmountWei must be uint256 decimal string"),
  resolutionNote: z.string().trim().max(5000).nullable().optional(),
  chainId: z.number().int().positive().optional(),
  escrowContractAddress: z
    .string()
    .trim()
    .refine((v) => isAddress(v), "escrowContractAddress is not a valid address")
    .optional(),
  onChainProjectId: z.string().trim().regex(/^\d+$/, "onChainProjectId must be uint256").optional(),
  milestoneIndex: z.number().int().nonnegative().optional(),
  resolutionTxHash: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{64}$/, "resolutionTxHash must be 0x-prefixed 32-byte hash")
    .nullable()
    .optional(),
});

export type ListAdminDisputesQueryInput = z.infer<typeof listAdminDisputesQuerySchema>;
export type ResolveDisputeBody = z.infer<typeof resolveDisputeBodySchema>;
