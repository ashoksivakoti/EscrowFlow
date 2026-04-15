import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/** Default 5s interactive tx timeout is tight on cold pools or remote Postgres. */
export const prismaInteractiveTransactionOptions = {
  maxWait: 10_000,
  timeout: 15_000,
} as const;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
