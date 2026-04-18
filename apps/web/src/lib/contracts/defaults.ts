import "server-only";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isAddress } from "viem";
import { z } from "zod";

const schema = z.object({
  CONTRACTS_DEFAULT_CHAIN_ID: z.coerce.number().int().positive().optional(),
  CONTRACTS_ESCROW_REGISTRY_ADDRESS: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isAddress(v), "CONTRACTS_ESCROW_REGISTRY_ADDRESS is invalid")
    .transform((v) => (v ? v.toLowerCase() : undefined)),
  CONTRACTS_PAYMENT_TOKEN_ADDRESS: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isAddress(v), "CONTRACTS_PAYMENT_TOKEN_ADDRESS is invalid")
    .transform((v) => (v ? v.toLowerCase() : undefined)),
  CONTRACTS_DEPLOYMENT_PATH: z.string().trim().optional(),
});

type ContractsDefaultsEnv = z.infer<typeof schema>;

export type ContractRuntimeDefaults = {
  chainId: number | null;
  escrowContractAddress: string | null;
  paymentTokenAddress: string | null;
};

let cachedEnv: ContractsDefaultsEnv | null = null;
let cachedDefaults: ContractRuntimeDefaults | null = null;

export function getContractRuntimeDefaults(): ContractRuntimeDefaults {
  if (cachedDefaults) {
    return cachedDefaults;
  }

  const env = getEnv();
  const fromArtifact = readDeploymentArtifact(env.CONTRACTS_DEPLOYMENT_PATH);

  cachedDefaults = {
    chainId: env.CONTRACTS_DEFAULT_CHAIN_ID ?? fromArtifact?.chainId ?? null,
    escrowContractAddress:
      env.CONTRACTS_ESCROW_REGISTRY_ADDRESS ??
      fromArtifact?.contracts?.EscrowFlowRegistry?.toLowerCase() ??
      null,
    paymentTokenAddress:
      env.CONTRACTS_PAYMENT_TOKEN_ADDRESS ??
      fromArtifact?.contracts?.MockERC20Stablecoin?.toLowerCase() ??
      null,
  };
  return cachedDefaults;
}

function getEnv(): ContractsDefaultsEnv {
  if (cachedEnv) {
    return cachedEnv;
  }
  cachedEnv = schema.parse({
    CONTRACTS_DEFAULT_CHAIN_ID: process.env.CONTRACTS_DEFAULT_CHAIN_ID,
    CONTRACTS_ESCROW_REGISTRY_ADDRESS: process.env.CONTRACTS_ESCROW_REGISTRY_ADDRESS,
    CONTRACTS_PAYMENT_TOKEN_ADDRESS: process.env.CONTRACTS_PAYMENT_TOKEN_ADDRESS,
    CONTRACTS_DEPLOYMENT_PATH: process.env.CONTRACTS_DEPLOYMENT_PATH,
  });
  return cachedEnv;
}

type DeploymentArtifact = {
  chainId?: number;
  contracts?: {
    EscrowFlowRegistry?: string;
    MockERC20Stablecoin?: string;
  };
};

function readDeploymentArtifact(rawPath?: string): DeploymentArtifact | null {
  if (!rawPath) {
    return null;
  }

  const resolvedPath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(process.cwd(), rawPath);
  if (!existsSync(resolvedPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(resolvedPath, "utf8")) as DeploymentArtifact;
    if (typeof parsed !== "object" || !parsed) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function resetContractDefaultsCacheForTests(): void {
  cachedEnv = null;
  cachedDefaults = null;
}
