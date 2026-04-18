import { z } from "zod";

const schema = z
  .object({
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
    AUTH_SIWE_DOMAIN: z
      .string()
      .min(1)
      .regex(/^[^/]+$/, "AUTH_SIWE_DOMAIN should be host[:port] without protocol"),
    AUTH_SIWE_URI: z.string().url(),
    AUTH_ALLOWED_CHAIN_IDS: z
      .string()
      .default("1")
      .transform((s) =>
        s
          .split(",")
          .map((x) => Number.parseInt(x.trim(), 10))
          .filter((n) => !Number.isNaN(n)),
      )
      .pipe(z.array(z.number().int().positive()).min(1)),
    AUTH_SESSION_MAX_AGE_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .default(60 * 60 * 24 * 7),
    AUTH_NONCE_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    AUTH_ADMIN_WALLETS: z
      .string()
      .optional()
      .transform((s) =>
        s
          ? s
              .split(",")
              .map((x) => x.trim().toLowerCase())
              .filter(Boolean)
          : [],
      ),
  })
  .superRefine((value, ctx) => {
    if (process.env.NODE_ENV === "production") {
      try {
        const url = new URL(value.AUTH_SIWE_URI);
        if (url.protocol !== "https:") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "AUTH_SIWE_URI must use https:// in production",
            path: ["AUTH_SIWE_URI"],
          });
        }
      } catch {
        // URL validity is already enforced.
      }
    }
  });

export type AuthEnv = z.infer<typeof schema>;

let cached: AuthEnv | null = null;

export function getAuthEnv(): AuthEnv {
  if (cached) {
    return cached;
  }
  cached = schema.parse({
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_SIWE_DOMAIN: process.env.AUTH_SIWE_DOMAIN,
    AUTH_SIWE_URI: process.env.AUTH_SIWE_URI,
    AUTH_ALLOWED_CHAIN_IDS: process.env.AUTH_ALLOWED_CHAIN_IDS,
    AUTH_SESSION_MAX_AGE_SECONDS: process.env.AUTH_SESSION_MAX_AGE_SECONDS,
    AUTH_NONCE_TTL_SECONDS: process.env.AUTH_NONCE_TTL_SECONDS,
    AUTH_ADMIN_WALLETS: process.env.AUTH_ADMIN_WALLETS,
  });
  return cached;
}

export function resetAuthEnvCacheForTests(): void {
  cached = null;
}
