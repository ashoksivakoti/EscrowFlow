import { z } from "zod";

export const confirmProjectOnChainBindingBodySchema = z.object({
  onChainProjectId: z
    .string()
    .trim()
    .regex(/^\d+$/, "onChainProjectId must be a uint256 decimal string"),
});

export type ConfirmProjectOnChainBindingBody = z.infer<
  typeof confirmProjectOnChainBindingBodySchema
>;
