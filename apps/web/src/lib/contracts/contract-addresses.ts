import { isAddress } from "viem";

import deploymentMetadata from "../../../config/deployment-metadata.json";

type ContractMetadata = {
  chainId: number;
  network: string;
  contracts: {
    EscrowFlowRegistry: `0x${string}`;
  };
  deploymentBlock: number;
  abi: {
    source: string;
    version: string;
    hash: string | null;
  };
};

function assertMetadataShape(input: unknown): asserts input is ContractMetadata {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid deployment metadata: expected object");
  }
  const m = input as Partial<ContractMetadata>;
  if (!Number.isInteger(m.chainId) || (m.chainId ?? 0) <= 0) {
    throw new Error("Invalid deployment metadata: chainId");
  }
  if (!m.network || typeof m.network !== "string") {
    throw new Error("Invalid deployment metadata: network");
  }
  const address = m.contracts?.EscrowFlowRegistry;
  if (!address || !isAddress(address)) {
    throw new Error("Invalid deployment metadata: contracts.EscrowFlowRegistry");
  }
  if (!Number.isInteger(m.deploymentBlock) || (m.deploymentBlock ?? -1) < 0) {
    throw new Error("Invalid deployment metadata: deploymentBlock");
  }
}

assertMetadataShape(deploymentMetadata);

const canonicalRegistryAddress = deploymentMetadata.contracts.EscrowFlowRegistry.toLowerCase() as `0x${string}`;

export const canonicalDeployment = {
  chainId: deploymentMetadata.chainId,
  network: deploymentMetadata.network,
  deploymentBlock: deploymentMetadata.deploymentBlock,
  abi: deploymentMetadata.abi,
  contracts: {
    EscrowFlowRegistry: canonicalRegistryAddress,
  },
} as const;

export function getEscrowRegistryAddressFromEnv(
  value: string | undefined,
): `0x${string}` {
  const candidate = value?.trim();
  if (candidate && isAddress(candidate)) {
    return candidate.toLowerCase() as `0x${string}`;
  }
  return canonicalDeployment.contracts.EscrowFlowRegistry;
}

export function getChainIdFromEnv(value: string | number | undefined): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return canonicalDeployment.chainId;
}

export function getDeploymentStartBlockFromEnv(
  value: string | number | undefined,
): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return canonicalDeployment.deploymentBlock;
}
