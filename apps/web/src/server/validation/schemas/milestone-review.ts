import { isAddress } from "viem";
import { z } from "zod";

export const approveAndPayoutBodySchema = z.object({
  submissionId: z.string().trim().min(1),
  reviewNote: z.string().trim().max(5_000).nullable().optional(),
  chainId: z.number().int().positive(),
  escrowContractAddress: z
    .string()
    .trim()
    .refine((v) => isAddress(v), "escrowContractAddress is not a valid address"),
  onChainProjectId: z.string().trim().regex(/^\d+$/, "onChainProjectId must be uint256"),
  milestoneIndex: z.number().int().nonnegative(),
  approveTxHash: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{64}$/, "approveTxHash must be 0x-prefixed 32-byte hash"),
  releaseTxHash: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{64}$/, "releaseTxHash must be 0x-prefixed 32-byte hash"),
  releasedAmountWei: z
    .string()
    .trim()
    .regex(/^\d+$/, "releasedAmountWei must be uint256 decimal string"),
});

export type ApproveAndPayoutBody = z.infer<typeof approveAndPayoutBodySchema>;
