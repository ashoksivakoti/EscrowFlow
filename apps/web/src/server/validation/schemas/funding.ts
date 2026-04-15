import { isAddress } from "viem";
import { z } from "zod";

export const reconcileFundingBodySchema = z.object({
  txHash: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{64}$/, "txHash must be a 0x-prefixed 32-byte hash"),
  chainId: z.number().int().positive(),
  fundedAmountWei: z
    .string()
    .regex(/^\d+$/, "fundedAmountWei must be a uint256 decimal string"),
  escrowContractAddress: z
    .string()
    .trim()
    .refine((v) => isAddress(v), "escrowContractAddress is not a valid address"),
  onChainProjectId: z
    .string()
    .trim()
    .regex(/^\d+$/, "onChainProjectId must be a uint256 decimal string"),
});

export type ReconcileFundingBody = z.infer<typeof reconcileFundingBodySchema>;
