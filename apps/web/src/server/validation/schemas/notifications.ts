import { z } from "zod";

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  unreadOnly: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((value) => (value ? value === "true" : undefined)),
});

export type ListNotificationsQueryInput = z.infer<typeof listNotificationsQuerySchema>;
