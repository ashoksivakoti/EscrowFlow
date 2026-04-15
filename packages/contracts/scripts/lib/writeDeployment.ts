import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Versioned schema for apps (`apps/web`, indexers, CI). */
export type DeploymentArtifactV1 = {
  schemaVersion: 1;
  network: string;
  chainId: number;
  deployedAt: string;
  deployer: string;
  contracts: Record<string, string>;
  roles?: {
    defaultAdmin?: string;
    pauser?: string;
    arbitratorGranted?: string;
  };
  notes?: string;
};

/**
 * Writes `deployments/<network>-<chainId>.json` under the contracts package root.
 * @returns Absolute path written.
 */
export function writeDeploymentArtifact(
  contractsPackageRoot: string,
  artifact: DeploymentArtifactV1,
): string {
  const dir = join(contractsPackageRoot, "deployments");
  mkdirSync(dir, { recursive: true });
  const filename = `${artifact.network}-${artifact.chainId}.json`;
  const filepath = join(dir, filename);
  writeFileSync(filepath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return filepath;
}
