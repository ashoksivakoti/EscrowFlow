import { expect } from "chai";
import fs from "node:fs";
import path from "node:path";

const EIP170_LIMIT = 24576;
/** Headroom for metadata / future patches (non-fatal if exceeded). */
const WARN_LIMIT = 23500;

function deployedRuntimeSizeBytes(): number {
  const artifactPath = path.join(
    __dirname,
    "../artifacts/contracts/EscrowFlowRegistry.sol/EscrowFlowRegistry.json",
  );
  const j = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as {
    deployedBytecode: string;
  };
  const hex = j.deployedBytecode;
  if (typeof hex !== "string" || !hex.startsWith("0x")) {
    throw new Error("EscrowFlowRegistry artifact missing deployedBytecode; run hardhat compile");
  }
  return (hex.length - 2) / 2;
}

describe("EscrowFlowRegistry bytecode (EIP-170)", function () {
  it("deployed runtime bytecode is under the contract size limit", function () {
    const size = deployedRuntimeSizeBytes();
    const margin = EIP170_LIMIT - size;
    console.log(
      `EscrowFlowRegistry deployed runtime bytecode: ${size} bytes (${margin} bytes under ${EIP170_LIMIT} limit)`,
    );
    expect(size).to.be.lessThan(EIP170_LIMIT);
  });

  it("deployed runtime bytecode stays below the warning threshold when possible", function () {
    const size = deployedRuntimeSizeBytes();
    const margin = WARN_LIMIT - size;
    console.log(
      `EscrowFlowRegistry vs warn threshold ${WARN_LIMIT}: ${size} bytes (${margin} bytes margin)`,
    );
    expect(size).to.be.lessThan(WARN_LIMIT);
  });
});
