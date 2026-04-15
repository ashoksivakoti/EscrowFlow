import { isAddress } from "viem";
import { z } from "zod";

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

const milestoneInputSchema = z.object({
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
    .regex(/^[A-Za-z0-9+/=]+$/, "fileBase64 must be base64 content"),
});

export const createProjectBodySchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(10_000).nullable().optional(),
  freelancerWalletAddress: z
    .string()
    .trim()
    .refine((v) => isAddress(v), "freelancerWalletAddress is not a valid wallet"),
  milestones: z.array(milestoneInputSchema).min(1).max(50),
  agreement: z
    .union([agreementMetadataUploadSchema, agreementFileUploadSchema])
    .optional()
    .nullable(),
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
