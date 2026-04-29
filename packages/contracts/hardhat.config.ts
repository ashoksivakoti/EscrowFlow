import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, ".env") });

/** Optimizer runs for deployment size vs runtime gas tradeoff (override via CONTRACTS_OPTIMIZER_RUNS). */
const OPTIMIZER_RUNS = Number.parseInt(
  process.env.CONTRACTS_OPTIMIZER_RUNS ?? "1",
  10,
);

function deployerPrivateKeys(): string[] {
  const raw = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!raw) {
    return [];
  }
  return [raw.startsWith("0x") ? raw : `0x${raw}`];
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      // Low runs + IR + stripped metadata minimize deployed runtime bytecode (EIP-170).
      optimizer: { enabled: true, runs: OPTIMIZER_RUNS },
      viaIR: true,
      metadata: { bytecodeHash: "none" },
    },
  },
  networks: {
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      chainId: 11155111,
      accounts: deployerPrivateKeys(),
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "",
      chainId: 84532,
      accounts: deployerPrivateKeys(),
    },
    arbitrumSepolia: {
      url: process.env.ARBITRUM_SEPOLIA_RPC_URL || "",
      chainId: 421614,
      accounts: deployerPrivateKeys(),
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    forbidOnly: true,
    forbidPending: true,
  },
};

export default config;
