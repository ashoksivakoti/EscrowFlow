import { z } from "zod";

export const siweVerifyBodySchema = z.object({
  message: z.string().min(1, "message is required"),
  signature: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/, "signature must be a 0x-prefixed hex string"),
});

export type SiweVerifyBody = z.infer<typeof siweVerifyBodySchema>;
