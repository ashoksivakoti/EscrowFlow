import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import type { Signer } from "ethers";
import { ethers } from "hardhat";

import type { EscrowFlowRegistry } from "../typechain-types/contracts/EscrowFlowRegistry";
import type { MockERC20Stablecoin } from "../typechain-types/contracts/mocks/MockERC20Stablecoin";

async function deployRegistry(admin: Signer): Promise<EscrowFlowRegistry> {
  const Factory = await ethers.getContractFactory("EscrowFlowRegistry");
  const deployed = await Factory.connect(admin).deploy(await admin.getAddress());
  await deployed.waitForDeployment();
  return deployed as unknown as EscrowFlowRegistry;
}

async function deployMock(owner: Signer): Promise<MockERC20Stablecoin> {
  const Mock = await ethers.getContractFactory("MockERC20Stablecoin");
  const deployed = await Mock.connect(owner).deploy(await owner.getAddress());
  await deployed.waitForDeployment();
  return deployed as unknown as MockERC20Stablecoin;
}

async function deployAndAllowMock(
  registry: EscrowFlowRegistry,
  admin: Signer,
  owner: Signer,
): Promise<MockERC20Stablecoin> {
  const token = await deployMock(owner);
  await registry
    .connect(admin)
    .attestTokenReviewForAllowlist(await token.getAddress());
  await registry
    .connect(admin)
    .setAllowedToken(await token.getAddress(), true);
  return token;
}

function milestone(
  amount: bigint,
  deadline: bigint,
): { amount: bigint; deadline: bigint } {
  return { amount, deadline };
}

async function signSetAlternativeRecipient(
  signer: Signer,
  registry: EscrowFlowRegistry,
  payload: {
    projectId: bigint;
    milestoneIndex: bigint;
    isFreelancer: boolean;
    originalParty: string;
    newRecipient: string;
    nonce: bigint;
    deadline: bigint;
  },
): Promise<string> {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const domain = {
    name: "EscrowFlowRegistry",
    version: "1",
    chainId,
    verifyingContract: await registry.getAddress(),
  };
  const types = {
    SetAlternativeRecipient: [
      { name: "projectId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
      { name: "isFreelancer", type: "bool" },
      { name: "originalParty", type: "address" },
      { name: "newRecipient", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  return (signer as any).signTypedData(domain, types, payload);
}

async function hashSetAlternativeRecipientDigest(
  registry: EscrowFlowRegistry,
  payload: {
    projectId: bigint;
    milestoneIndex: bigint;
    isFreelancer: boolean;
    originalParty: string;
    newRecipient: string;
    nonce: bigint;
    deadline: bigint;
  },
): Promise<string> {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const domain = {
    name: "EscrowFlowRegistry",
    version: "1",
    chainId,
    verifyingContract: await registry.getAddress(),
  };
  const types = {
    SetAlternativeRecipient: [
      { name: "projectId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
      { name: "isFreelancer", type: "bool" },
      { name: "originalParty", type: "address" },
      { name: "newRecipient", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  return ethers.TypedDataEncoder.hash(domain, types, payload);
}

const SECP256K1N = BigInt(
  "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141",
);

function malleateToHighS(signature: string): string {
  const bytes = ethers.getBytes(signature);
  const r = bytes.slice(0, 32);
  const s = BigInt(ethers.hexlify(bytes.slice(32, 64)));
  const v = bytes[64];
  const highS = SECP256K1N - s;
  const normalizedV = v < 27 ? v + 27 : v;
  const flippedV = normalizedV === 27 ? 28 : 27;
  return ethers.hexlify(
    ethers.concat([
      r,
      ethers.getBytes(ethers.toBeHex(highS, 32)),
      ethers.getBytes(ethers.toBeHex(flippedV, 1)),
    ]),
  );
}

/** Sum of `(funded - released - refunded)` for every project using `tokenAddress` (matches `_tokenOutstanding`). */
async function sumLiabilityForToken(
  registry: EscrowFlowRegistry,
  tokenAddress: string,
  lastProjectId: bigint,
): Promise<bigint> {
  let sum = 0n;
  const target = tokenAddress.toLowerCase();
  for (let pid = 1n; pid <= lastProjectId; pid++) {
    const p = await registry.getProject(pid);
    if (p.token.toLowerCase() !== target) continue;
    sum += p.fundedAmount - p.releasedAmount - p.refundedAmount;
  }
  return sum;
}

async function assertProjectCoreInvariants(
  registry: EscrowFlowRegistry,
  projectId: bigint,
): Promise<void> {
  const p = await registry.getProject(projectId);
  expect(p.releasedAmount + p.refundedAmount).to.be.lte(p.fundedAmount);
  const available = p.fundedAmount - p.releasedAmount - p.refundedAmount;
  expect(p.reservedAmount).to.be.lte(available);
  expect(p.settledMilestoneCount).to.be.lte(p.milestoneCount);
}

async function assertTokenLiabilityInvariant(
  registry: EscrowFlowRegistry,
  token: MockERC20Stablecoin,
  lastProjectId: bigint,
): Promise<void> {
  const tokenAddr = await token.getAddress();
  const regAddr = await registry.getAddress();
  const liability = await sumLiabilityForToken(registry, tokenAddr, lastProjectId);
  const untracked = await registry.untrackedTokenBalance(tokenAddr);
  const balance = await token.balanceOf(regAddr);
  expect(balance).to.be.gte(liability);
  expect(balance - untracked).to.equal(liability);
}

async function findProjectsMappingSlot(
  registry: EscrowFlowRegistry,
  projectId: bigint,
): Promise<bigint> {
  const registryAddress = await registry.getAddress();
  const sentinel = 0xdeadbeefn;
  const coder = ethers.AbiCoder.defaultAbiCoder();

  for (let slot = 0n; slot < 4096n; slot++) {
    const base = BigInt(
      ethers.keccak256(coder.encode(["uint256", "uint256"], [projectId, slot])),
    );
    // Project.reservedAmount lives at struct offset 7.
    const reservedSlot = base + 7n;
    const reservedSlotKey = ethers.toBeHex(reservedSlot, 32);
    const original = await ethers.provider.send("eth_getStorageAt", [
      registryAddress,
      reservedSlotKey,
      "latest",
    ]);

    await ethers.provider.send("hardhat_setStorageAt", [
      registryAddress,
      reservedSlotKey,
      ethers.toBeHex(sentinel, 32),
    ]);
    const probe = await registry.getProject(projectId);
    await ethers.provider.send("hardhat_setStorageAt", [
      registryAddress,
      reservedSlotKey,
      original,
    ]);

    if (probe.reservedAmount === sentinel) return slot;
  }

  throw new Error("unable to locate _projects mapping slot");
}

async function setProjectReservedAmountForTest(
  registry: EscrowFlowRegistry,
  projectId: bigint,
  reservedAmount: bigint,
): Promise<void> {
  const mappingSlot = await findProjectsMappingSlot(registry, projectId);
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const base = BigInt(
    ethers.keccak256(
      coder.encode(["uint256", "uint256"], [projectId, mappingSlot]),
    ),
  );
  const reservedSlot = base + 7n;
  await ethers.provider.send("hardhat_setStorageAt", [
    await registry.getAddress(),
    ethers.toBeHex(reservedSlot, 32),
    ethers.toBeHex(reservedAmount, 32),
  ]);
}

async function setProjectFundedAmountForTest(
  registry: EscrowFlowRegistry,
  projectId: bigint,
  fundedAmount: bigint,
): Promise<void> {
  const mappingSlot = await findProjectsMappingSlot(registry, projectId);
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const base = BigInt(
    ethers.keccak256(
      coder.encode(["uint256", "uint256"], [projectId, mappingSlot]),
    ),
  );
  // Project.fundedAmount lives at struct offset 4.
  const fundedSlot = base + 4n;
  await ethers.provider.send("hardhat_setStorageAt", [
    await registry.getAddress(),
    ethers.toBeHex(fundedSlot, 32),
    ethers.toBeHex(fundedAmount, 32),
  ]);
}

async function setMilestoneSubmittedForTest(
  registry: EscrowFlowRegistry,
  projectId: bigint,
  milestoneIndex: bigint,
  reviewEnteredAt: bigint,
): Promise<void> {
  const milestonesSlot = await findMilestonesMappingSlot(
    registry,
    projectId,
    milestoneIndex,
  );
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const projectMilestonesBase = BigInt(
    ethers.keccak256(
      coder.encode(["uint256", "uint256"], [projectId, milestonesSlot]),
    ),
  );
  const milestoneBase = BigInt(
    ethers.keccak256(
      coder.encode(["uint256", "uint256"], [milestoneIndex, projectMilestonesBase]),
    ),
  );

  const packedSlot = milestoneBase + 1n;
  const packed = BigInt(
    await ethers.provider.send("eth_getStorageAt", [
      await registry.getAddress(),
      ethers.toBeHex(packedSlot, 32),
      "latest",
    ]),
  );
  const deadlineMask = (1n << 64n) - 1n;
  const deadline = packed & deadlineMask;
  const statusSubmitted = 1n;
  const nextPacked =
    deadline + (reviewEnteredAt << 64n) + (statusSubmitted << 128n);

  await ethers.provider.send("hardhat_setStorageAt", [
    await registry.getAddress(),
    ethers.toBeHex(packedSlot, 32),
    ethers.toBeHex(nextPacked, 32),
  ]);
}

async function getPendingAlternativeRecipientForTest(
  registry: EscrowFlowRegistry,
  projectId: bigint,
  milestoneIndex: bigint,
  mappingSlot: bigint,
): Promise<string> {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const level1 = BigInt(
    ethers.keccak256(
      coder.encode(["uint256", "uint256"], [projectId, mappingSlot]),
    ),
  );
  const structBase = BigInt(
    ethers.keccak256(
      coder.encode(["uint256", "uint256"], [milestoneIndex, level1]),
    ),
  );
  const raw = await ethers.provider.send("eth_getStorageAt", [
    await registry.getAddress(),
    ethers.toBeHex(structBase, 32),
    "latest",
  ]);
  return ethers.getAddress(`0x${raw.slice(26)}`);
}

async function findPendingAlternativeMappingSlot(
  registry: EscrowFlowRegistry,
  projectId: bigint,
  milestoneIndex: bigint,
  expectedRecipient: string,
): Promise<bigint> {
  for (let slot = 0n; slot < 512n; slot++) {
    const recipient = await getPendingAlternativeRecipientForTest(
      registry,
      projectId,
      milestoneIndex,
      slot,
    );
    if (recipient.toLowerCase() === expectedRecipient.toLowerCase()) {
      return slot;
    }
  }
  throw new Error("unable to locate pending alternative recipient mapping slot");
}

async function findMilestonesMappingSlot(
  registry: EscrowFlowRegistry,
  projectId: bigint,
  milestoneIndex: bigint,
): Promise<bigint> {
  const registryAddress = await registry.getAddress();
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const amountSentinel = 0x00abcdef12345n;

  for (let slot = 0n; slot < 4096n; slot++) {
    const projectMilestonesBase = BigInt(
      ethers.keccak256(coder.encode(["uint256", "uint256"], [projectId, slot])),
    );
    const milestoneBase = BigInt(
      ethers.keccak256(
        coder.encode(["uint256", "uint256"], [milestoneIndex, projectMilestonesBase]),
      ),
    );
    const amountSlotKey = ethers.toBeHex(milestoneBase, 32);
    const originalHex = await ethers.provider.send("eth_getStorageAt", [
      registryAddress,
      amountSlotKey,
      "latest",
    ]);

    await ethers.provider.send("hardhat_setStorageAt", [
      registryAddress,
      amountSlotKey,
      ethers.toBeHex(amountSentinel, 32),
    ]);
    const probe = await registry.getMilestone(projectId, milestoneIndex);
    await ethers.provider.send("hardhat_setStorageAt", [
      registryAddress,
      amountSlotKey,
      originalHex,
    ]);

    if (probe.amount === amountSentinel) {
      return slot;
    }
  }

  throw new Error("unable to locate _milestones mapping slot");
}

describe("EscrowFlowRegistry", function () {
  describe("urgent security regressions", function () {
    const Resolution = {
      ReleaseToFreelancer: 0,
      RefundToClient: 1,
    } as const;

    async function setupDisputedSingleMilestone(
      admin: Signer,
      client: Signer,
      freelancer: Signer,
    ) {
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 400n;
      await token.connect(admin).mint(await client.getAddress(), amount * 3n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://dispute");
      return { registry, token, amount };
    }

    it("revoked arbitrator votes must not count toward execution", async function () {
      const [admin, a, b, c, client, freelancer] = await ethers.getSigners();
      const { registry, token, amount } = await setupDisputedSingleMilestone(
        admin,
        client,
        freelancer,
      );
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await a.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await b.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await c.getAddress());
      await registry.connect(admin).setArbitratorThreshold(2n);

      await registry
        .connect(a)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      await registry.connect(admin).revokeRole(ARBITRATOR_ROLE, await a.getAddress());
      await registry
        .connect(b)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);

      expect((await registry.getDispute(1n, 0n)).active).to.equal(true);

      await registry
        .connect(c)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      expect((await registry.getDispute(1n, 0n)).active).to.equal(false);
      await assertProjectCoreInvariants(registry, 1n);
      await assertTokenLiabilityInvariant(registry, token, 1n);
    });

    it("threshold changes invalidate old confirmations", async function () {
      const [admin, a, b, c, client, freelancer] = await ethers.getSigners();
      const { registry, token, amount } = await setupDisputedSingleMilestone(
        admin,
        client,
        freelancer,
      );
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await a.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await b.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await c.getAddress());
      await registry.connect(admin).setArbitratorThreshold(2n);

      await registry
        .connect(a)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      await registry.connect(admin).setArbitratorThreshold(3n);
      await registry
        .connect(b)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);

      expect((await registry.getDispute(1n, 0n)).active).to.equal(true);

      await registry
        .connect(c)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      expect((await registry.getDispute(1n, 0n)).active).to.equal(true);
      await registry
        .connect(a)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      expect((await registry.getDispute(1n, 0n)).active).to.equal(false);
      await assertProjectCoreInvariants(registry, 1n);
      await assertTokenLiabilityInvariant(registry, token, 1n);
    });

    it("adding arbitrator invalidates old confirmations via config nonce", async function () {
      const [admin, a, b, c, client, freelancer] = await ethers.getSigners();
      const { registry, token, amount } = await setupDisputedSingleMilestone(
        admin,
        client,
        freelancer,
      );
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await a.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await b.getAddress());
      await registry.connect(admin).setArbitratorThreshold(2n);

      await registry
        .connect(a)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await c.getAddress());
      await registry
        .connect(b)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);

      expect((await registry.getDispute(1n, 0n)).active).to.equal(true);

      await registry
        .connect(c)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      expect((await registry.getDispute(1n, 0n)).active).to.equal(false);
      await assertProjectCoreInvariants(registry, 1n);
      await assertTokenLiabilityInvariant(registry, token, 1n);
    });

    it("cancelProject does not refund submitted milestone amount to client", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 250n;
      await token.connect(admin).mint(await client.getAddress(), amount * 3n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      const clientBefore = await token.balanceOf(await client.getAddress());
      const freelancerBefore = await token.balanceOf(await freelancer.getAddress());

      await ethers.provider.send("evm_increaseTime", [14 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      const tx = registry.connect(client).cancelProject(1n);
      try {
        await tx;
      } catch {
        await expect(tx).to.be.revertedWithCustomError(
          registry,
          "CannotCancelWithInReviewMilestone",
        );
      }

      const ms = await registry.getMilestone(1n, 0n);
      const clientAfter = await token.balanceOf(await client.getAddress());
      const freelancerAfter = await token.balanceOf(await freelancer.getAddress());

      expect(clientAfter).to.equal(clientBefore);
      if (ms.status === 3n) {
        expect(freelancerAfter).to.equal(freelancerBefore + amount);
      } else {
        expect(ms.status).to.equal(1n);
        expect(freelancerAfter).to.equal(freelancerBefore);
      }
      await assertProjectCoreInvariants(registry, 1n);
      await assertTokenLiabilityInvariant(registry, token, 1n);
    });

    it("emergencyAdminCancel cannot refund submitted work to client", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 260n;
      await token.connect(admin).mint(await client.getAddress(), amount * 3n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      const clientBefore = await token.balanceOf(await client.getAddress());

      await expect(
        registry.connect(admin).emergencyAdminCancel(1n),
      ).to.be.revertedWithCustomError(registry, "CannotCancelApprovedMilestone");
      expect(await token.balanceOf(await client.getAddress())).to.equal(clientBefore);
      expect((await registry.getMilestone(1n, 0n)).status).to.equal(1n);
      await assertProjectCoreInvariants(registry, 1n);
      await assertTokenLiabilityInvariant(registry, token, 1n);
    });

    it("emergency dispute resolution ignores unexecuted pending alt recipients and still settles safely", async function () {
      const [admin, arb, client, freelancer, altFreelancer] = await ethers.getSigners();
      const { registry, token, amount } = await setupDisputedSingleMilestone(
        admin,
        client,
        freelancer,
      );
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());

      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());
      const pendingSlot = await findPendingAlternativeMappingSlot(
        registry,
        1n,
        0n,
        await altFreelancer.getAddress(),
      );
      await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60 + 2]);
      await ethers.provider.send("evm_mine", []);

      await registry.connect(admin).proposeEmergencyResolveDispute(
        1n,
        0n,
        Resolution.ReleaseToFreelancer,
        amount,
        0n,
      );
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 2]);
      await ethers.provider.send("evm_mine", []);
      await expect(
        registry.connect(admin).emergencyResolveDispute(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          amount,
          0n,
        ),
      ).to.not.emit(registry, "AlternativeRecipientExecuted");
      expect(await token.balanceOf(await freelancer.getAddress())).to.equal(amount);
      expect(await token.balanceOf(await altFreelancer.getAddress())).to.equal(0n);
      expect(await getPendingAlternativeRecipientForTest(registry, 1n, 0n, pendingSlot)).to.equal(
        ethers.ZeroAddress,
      );
      await assertProjectCoreInvariants(registry, 1n);
      await assertTokenLiabilityInvariant(registry, token, 1n);
    });

    it("stale timeout does not auto-execute unrelated freelancer pending recipient", async function () {
      const [admin, arb, client, freelancer, altFreelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const amount = 240n;
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const pastDeadline = BigInt(now - 10);
      await token.connect(admin).mint(await client.getAddress(), amount * 3n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount, pastDeadline),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://late");
      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());
      const mappingSlot = await findPendingAlternativeMappingSlot(
        registry,
        1n,
        0n,
        await altFreelancer.getAddress(),
      );

      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 2]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n),
      ).to.not.emit(registry, "AlternativeRecipientExecuted");

      expect(
        await getPendingAlternativeRecipientForTest(registry, 1n, 0n, mappingSlot),
      ).to.equal(ethers.ZeroAddress);
      await assertProjectCoreInvariants(registry, 1n);
      await assertTokenLiabilityInvariant(registry, token, 1n);
    });

    it("token allowlist requires attestation for allow=true and not for allow=false", async function () {
      const [admin] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployMock(admin);
      const tokenAddr = await token.getAddress();

      await expect(
        registry.connect(admin).setAllowedToken(tokenAddr, true),
      ).to.be.revertedWithCustomError(registry, "TokenReviewNotAttested");

      await registry.connect(admin).attestTokenReviewForAllowlist(tokenAddr);
      await expect(registry.connect(admin).setAllowedToken(tokenAddr, true))
        .to.emit(registry, "AllowedTokenUpdated")
        .withArgs(tokenAddr, true);

      await expect(registry.connect(admin).setAllowedToken(tokenAddr, false))
        .to.emit(registry, "AllowedTokenUpdated")
        .withArgs(tokenAddr, false);
    });

    it("settlement functions never emit AlternativeRecipientExecuted", async function () {
      const [admin, arb, client, freelancer, altFreelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const token = await deployAndAllowMock(registry, admin, admin);

      const amount1 = 210n;
      await token.connect(admin).mint(await client.getAddress(), amount1 * 3n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount1, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount1);
      await registry.connect(client).fundProject(1n, amount1);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work1");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d1");
      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());
      const altDelay = await registry.ALTERNATIVE_RECIPIENT_DELAY();
      await ethers.provider.send("evm_increaseTime", [Number(altDelay) + 1]);
      await ethers.provider.send("evm_mine", []);
      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount1, 0n),
      ).to.not.emit(registry, "AlternativeRecipientExecuted");

      const amount2 = 220n;
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      await token.connect(admin).mint(await client.getAddress(), amount2 * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount2, BigInt(now - 10)),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount2);
      await registry.connect(client).fundProject(2n, amount2);
      await registry.connect(client).raiseDispute(2n, 0n, "ipfs://d2");
      await registry
        .connect(arb)
        .setAlternativeRecipient(2n, 0n, true, await altFreelancer.getAddress());
      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);
      await expect(
        registry.connect(client).resolveStaleDisputeByTimeout(2n, 0n),
      ).to.not.emit(registry, "AlternativeRecipientExecuted");

      const amount3 = 230n;
      await token.connect(admin).mint(await client.getAddress(), amount3 * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount3, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount3);
      await registry.connect(client).fundProject(3n, amount3);
      await registry.connect(freelancer).submitMilestone(3n, 0n, "ipfs://work3");
      await registry.connect(client).raiseDispute(3n, 0n, "ipfs://d3");
      await registry
        .connect(arb)
        .setAlternativeRecipient(3n, 0n, true, await altFreelancer.getAddress());
      await registry.connect(admin).proposeEmergencyResolveDispute(
        3n,
        0n,
        Resolution.ReleaseToFreelancer,
        amount3,
        0n,
      );
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);
      await expect(
        registry
          .connect(admin)
          .emergencyResolveDispute(3n, 0n, Resolution.ReleaseToFreelancer, amount3, 0n),
      ).to.not.emit(registry, "AlternativeRecipientExecuted");
    });
  });

  describe("party-authorized recipients", function () {
    const PROJECT_SCOPE = (1n << 256n) - 1n;

    it("EOA client can set and clear project-wide client recipient directly", async function () {
      const [admin, client, freelancer, altClient] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount1 = 300n;
      const amount2 = 280n;

      await token.connect(admin).mint(await client.getAddress(), (amount1 + amount2) * 3n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta1", [
          milestone(amount1, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount1 + amount2);
      await registry.connect(client).fundProject(1n, amount1);
      await registry
        .connect(client)
        .setPartyAuthorizedRecipient(1n, PROJECT_SCOPE, false, await altClient.getAddress());
      await registry.connect(client).cancelProject(1n);
      expect(await token.balanceOf(await altClient.getAddress())).to.equal(amount1);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta2", [
          milestone(amount2, 1n),
        ]);
      await registry.connect(client).fundProject(2n, amount2);
      await registry.connect(client).setPartyAuthorizedRecipient(2n, PROJECT_SCOPE, false, ethers.ZeroAddress);
      const clientBefore = await token.balanceOf(await client.getAddress());
      await registry.connect(client).cancelProject(2n);
      expect(await token.balanceOf(await client.getAddress())).to.equal(clientBefore + amount2);
    });

    it("cancelProject aggregate refund uses project-wide client recipient, not milestone-specific party client", async function () {
      const [admin, client, freelancer, altWide, altMilestone] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const m0 = 200n;
      const m1 = 150n;
      const total = m0 + m1;
      await token.connect(admin).mint(await client.getAddress(), total * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(m0, 1n),
          milestone(m1, 2n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, total);

      await registry
        .connect(client)
        .setPartyAuthorizedRecipient(1n, 0n, false, await altMilestone.getAddress());
      await registry
        .connect(client)
        .setPartyAuthorizedRecipient(1n, PROJECT_SCOPE, false, await altWide.getAddress());

      await registry.connect(client).cancelProject(1n);
      expect(await token.balanceOf(await altWide.getAddress())).to.equal(total);
      expect(await token.balanceOf(await altMilestone.getAddress())).to.equal(0n);
    });

    it("emergencyAdminCancel sends final refund to project-wide party-authorized client", async function () {
      const [admin, client, freelancer, altClient] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 420n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry
        .connect(client)
        .setPartyAuthorizedRecipient(1n, PROJECT_SCOPE, false, await altClient.getAddress());

      await expect(registry.connect(admin).emergencyAdminCancel(1n))
        .to.emit(registry, "ProjectEmergencyCancelled")
        .withArgs(1n, await admin.getAddress(), await token.getAddress(), amount);

      expect(await token.balanceOf(await altClient.getAddress())).to.equal(amount);
    });

    it("clearing project-wide client recipient restores emergencyAdminCancel refunds to original client", async function () {
      const [admin, client, freelancer, altClient] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 430n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry
        .connect(client)
        .setPartyAuthorizedRecipient(1n, PROJECT_SCOPE, false, await altClient.getAddress());
      await registry
        .connect(client)
        .setPartyAuthorizedRecipient(1n, PROJECT_SCOPE, false, ethers.ZeroAddress);

      const clientBefore = await token.balanceOf(await client.getAddress());
      await registry.connect(admin).emergencyAdminCancel(1n);
      expect(await token.balanceOf(await client.getAddress())).to.equal(clientBefore + amount);
      expect(await token.balanceOf(await altClient.getAddress())).to.equal(0n);
    });

    it("EOA freelancer can set and clear freelancer recipient directly", async function () {
      const [admin, client, freelancer, altFreelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount1 = 220n;
      const amount2 = 240n;
      await token.connect(admin).mint(await client.getAddress(), (amount1 + amount2) * 3n);
      await token.connect(client).approve(await registry.getAddress(), amount1 + amount2);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta1", [
          milestone(amount1, 1n),
        ]);
      await registry.connect(client).fundProject(1n, amount1);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w1");
      await registry.connect(client).approveMilestone(1n, 0n);
      await registry
        .connect(freelancer)
        .setPartyAuthorizedRecipient(1n, 0n, true, await altFreelancer.getAddress());
      await registry.connect(client).releaseMilestone(1n, 0n);
      expect(await token.balanceOf(await altFreelancer.getAddress())).to.equal(amount1);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta2", [
          milestone(amount2, 1n),
        ]);
      await registry.connect(client).fundProject(2n, amount2);
      await registry.connect(freelancer).submitMilestone(2n, 0n, "ipfs://w2");
      await registry.connect(client).approveMilestone(2n, 0n);
      await registry.connect(freelancer).setPartyAuthorizedRecipient(2n, 0n, true, ethers.ZeroAddress);
      const freelancerBefore = await token.balanceOf(await freelancer.getAddress());
      await registry.connect(client).releaseMilestone(2n, 0n);
      expect(await token.balanceOf(await freelancer.getAddress())).to.equal(
        freelancerBefore + amount2,
      );
    });

    it("contract wallet client can set client recipient directly", async function () {
      const [admin, freelancer, altClient] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const Wallet = await ethers.getContractFactory("PartyWalletMock");
      const walletClient = await Wallet.connect(admin).deploy();
      await walletClient.waitForDeployment();
      const amount = 260n;
      await token.connect(admin).mint(await walletClient.getAddress(), amount * 2n);

      const tokenIface = token.interface;
      const regIface = registry.interface;
      await walletClient.execute(
        await token.getAddress(),
        tokenIface.encodeFunctionData("approve", [await registry.getAddress(), amount]),
      );
      await walletClient.execute(
        await registry.getAddress(),
        regIface.encodeFunctionData("createProject", [
          await freelancer.getAddress(),
          await token.getAddress(),
          "meta",
          [{ amount, deadline: 1n }],
        ]),
      );
      await walletClient.execute(
        await registry.getAddress(),
        regIface.encodeFunctionData("fundProject", [1n, amount]),
      );
      await walletClient.execute(
        await registry.getAddress(),
        regIface.encodeFunctionData("setPartyAuthorizedRecipient", [
          1n,
          PROJECT_SCOPE,
          false,
          await altClient.getAddress(),
        ]),
      );
      await walletClient.execute(
        await registry.getAddress(),
        regIface.encodeFunctionData("cancelProject", [1n]),
      );
      expect(await token.balanceOf(await altClient.getAddress())).to.equal(amount);
    });

    it("contract wallet freelancer can set freelancer recipient directly", async function () {
      const [admin, client, altFreelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const Wallet = await ethers.getContractFactory("PartyWalletMock");
      const walletFreelancer = await Wallet.connect(admin).deploy();
      await walletFreelancer.waitForDeployment();
      const amount = 270n;

      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await walletFreelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);

      const regIface = registry.interface;
      await walletFreelancer.execute(
        await registry.getAddress(),
        regIface.encodeFunctionData("submitMilestone", [1n, 0n, "ipfs://w"]),
      );
      await walletFreelancer.execute(
        await registry.getAddress(),
        regIface.encodeFunctionData("setPartyAuthorizedRecipient", [
          1n,
          0n,
          true,
          await altFreelancer.getAddress(),
        ]),
      );
      await registry.connect(client).approveMilestone(1n, 0n);
      await registry.connect(client).releaseMilestone(1n, 0n);
      expect(await token.balanceOf(await altFreelancer.getAddress())).to.equal(amount);
    });

    it("direct setter rejects non-party callers", async function () {
      const [admin, client, freelancer, outsider] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(1n, 1n),
        ]);

      await expect(
        registry.connect(outsider).setPartyAuthorizedRecipient(1n, 0n, false, outsider.address),
      ).to.be.revertedWithCustomError(registry, "NotProjectParty");
    });

    it("direct setter rejects address(this) and out-of-range milestone index, accepts project-wide scope", async function () {
      const [admin, client, freelancer, altClient] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(1n, 1n),
        ]);

      await expect(
        registry
          .connect(client)
          .setPartyAuthorizedRecipient(1n, 0n, false, await registry.getAddress()),
      ).to.be.revertedWithCustomError(registry, "InvalidRecipient");

      await expect(
        registry.connect(client).setPartyAuthorizedRecipient(1n, 99n, false, altClient.address),
      ).to.be.revertedWithCustomError(registry, "MilestoneIndexOutOfRange");

      await expect(
        registry
          .connect(client)
          .setPartyAuthorizedRecipient(1n, PROJECT_SCOPE, false, altClient.address),
      )
        .to.emit(registry, "AlternativeRecipientSet")
        .withArgs(1n, PROJECT_SCOPE, false, altClient.address, 0n, client.address);
    });

    it("valid freelancer signature updates release recipient and pays alternative address", async function () {
      const [admin, client, freelancer, altFreelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 700n;

      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      await registry.connect(client).approveMilestone(1n, 0n);

      const nonce = 0n;
      const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
      const signature = await signSetAlternativeRecipient(freelancer, registry, {
        projectId: 1n,
        milestoneIndex: 0n,
        isFreelancer: true,
        originalParty: await freelancer.getAddress(),
        newRecipient: await altFreelancer.getAddress(),
        nonce,
        deadline,
      });

      await registry.connect(client).setPartyAuthorizedRecipientBySig(
        1n,
        0n,
        true,
        await freelancer.getAddress(),
        await altFreelancer.getAddress(),
        nonce,
        deadline,
        signature,
      );

      await expect(registry.connect(client).releaseMilestone(1n, 0n))
        .to.emit(registry, "MilestoneFundsReleased")
        .withArgs(
          1n,
          0n,
          await altFreelancer.getAddress(),
          await freelancer.getAddress(),
          await token.getAddress(),
          amount,
          amount,
        );
      expect(await token.balanceOf(await altFreelancer.getAddress())).to.equal(amount);
      expect(await token.balanceOf(await freelancer.getAddress())).to.equal(0n);
    });

    it("valid client signature updates cancelProject refund recipient", async function () {
      const [admin, client, freelancer, altClient] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 500n;

      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);

      const nonce = 0n;
      const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
      const signature = await signSetAlternativeRecipient(client, registry, {
        projectId: 1n,
        milestoneIndex: PROJECT_SCOPE,
        isFreelancer: false,
        originalParty: await client.getAddress(),
        newRecipient: await altClient.getAddress(),
        nonce,
        deadline,
      });

      await registry.connect(freelancer).setPartyAuthorizedRecipientBySig(
        1n,
        PROJECT_SCOPE,
        false,
        await client.getAddress(),
        await altClient.getAddress(),
        nonce,
        deadline,
        signature,
      );

      await registry.connect(client).cancelProject(1n);
      expect(await token.balanceOf(await altClient.getAddress())).to.equal(amount);
      expect(await token.balanceOf(await client.getAddress())).to.equal(amount);
    });

    it("valid client signature for milestone 0 succeeds", async function () {
      const [admin, arb, client, freelancer, altClient] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 320n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(admin)
        .grantRole(await registry.ARBITRATOR_ROLE(), await arb.getAddress());

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      const nonce = 0n;
      const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
      const signature = await signSetAlternativeRecipient(client, registry, {
        projectId: 1n,
        milestoneIndex: 0n,
        isFreelancer: false,
        originalParty: await client.getAddress(),
        newRecipient: await altClient.getAddress(),
        nonce,
        deadline,
      });
      await registry.connect(freelancer).setPartyAuthorizedRecipientBySig(
        1n,
        0n,
        false,
        await client.getAddress(),
        await altClient.getAddress(),
        nonce,
        deadline,
        signature,
      );

      await registry
        .connect(arb)
        .resolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount);
      expect(await token.balanceOf(await altClient.getAddress())).to.equal(amount);
    });

    it("reverts on invalid signer", async function () {
      const [admin, client, freelancer, altFreelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(1n, 1n),
        ]);

      const nonce = 0n;
      const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
      const signature = await signSetAlternativeRecipient(client, registry, {
        projectId: 1n,
        milestoneIndex: 0n,
        isFreelancer: true,
        originalParty: await freelancer.getAddress(),
        newRecipient: await altFreelancer.getAddress(),
        nonce,
        deadline,
      });

      await expect(
        registry.connect(client).setPartyAuthorizedRecipientBySig(
          1n,
          0n,
          true,
          await freelancer.getAddress(),
          await altFreelancer.getAddress(),
          nonce,
          deadline,
          signature,
        ),
      ).to.be.revertedWithCustomError(registry, "InvalidSignature");
    });

    it("reverts on expired signature", async function () {
      const [admin, client, freelancer, altFreelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(1n, 1n),
        ]);

      const nonce = 0n;
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const deadline = BigInt(now - 1);
      const signature = await signSetAlternativeRecipient(freelancer, registry, {
        projectId: 1n,
        milestoneIndex: 0n,
        isFreelancer: true,
        originalParty: await freelancer.getAddress(),
        newRecipient: await altFreelancer.getAddress(),
        nonce,
        deadline,
      });

      await expect(
        registry.connect(client).setPartyAuthorizedRecipientBySig(
          1n,
          0n,
          true,
          await freelancer.getAddress(),
          await altFreelancer.getAddress(),
          nonce,
          deadline,
          signature,
        ),
      ).to.be.revertedWithCustomError(registry, "SignatureExpired");
    });

    it("reverts on replayed signature", async function () {
      const [admin, client, freelancer, altFreelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(1n, 1n),
        ]);

      const nonce = 0n;
      const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
      const signature = await signSetAlternativeRecipient(freelancer, registry, {
        projectId: 1n,
        milestoneIndex: 0n,
        isFreelancer: true,
        originalParty: await freelancer.getAddress(),
        newRecipient: await altFreelancer.getAddress(),
        nonce,
        deadline,
      });

      await registry.connect(client).setPartyAuthorizedRecipientBySig(
        1n,
        0n,
        true,
        await freelancer.getAddress(),
        await altFreelancer.getAddress(),
        nonce,
        deadline,
        signature,
      );

      await expect(
        registry.connect(client).setPartyAuthorizedRecipientBySig(
          1n,
          0n,
          true,
          await freelancer.getAddress(),
          await altFreelancer.getAddress(),
          nonce,
          deadline,
          signature,
        ),
      ).to.be.revertedWithCustomError(registry, "InvalidAuthorizationNonce");
    });

    it("reverts on high-s malleated signature", async function () {
      const [admin, client, freelancer, altFreelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(1n, 1n),
        ]);

      const nonce = 0n;
      const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
      const lowSSignature = await signSetAlternativeRecipient(freelancer, registry, {
        projectId: 1n,
        milestoneIndex: 0n,
        isFreelancer: true,
        originalParty: await freelancer.getAddress(),
        newRecipient: await altFreelancer.getAddress(),
        nonce,
        deadline,
      });
      const highSSignature = malleateToHighS(lowSSignature);

      await expect(
        registry.connect(client).setPartyAuthorizedRecipientBySig(
          1n,
          0n,
          true,
          await freelancer.getAddress(),
          await altFreelancer.getAddress(),
          nonce,
          deadline,
          highSSignature,
        ),
      ).to.be.revertedWithCustomError(registry, "InvalidSignature");
    });

    it("reverts on invalid v", async function () {
      const [admin, client, freelancer, altFreelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(1n, 1n),
        ]);

      const nonce = 0n;
      const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
      const signature = await signSetAlternativeRecipient(freelancer, registry, {
        projectId: 1n,
        milestoneIndex: 0n,
        isFreelancer: true,
        originalParty: await freelancer.getAddress(),
        newRecipient: await altFreelancer.getAddress(),
        nonce,
        deadline,
      });
      const sigBytes = ethers.getBytes(signature);
      sigBytes[64] = 29; // Invalid v after normalization check.
      const invalidVSignature = ethers.hexlify(sigBytes);

      await expect(
        registry.connect(client).setPartyAuthorizedRecipientBySig(
          1n,
          0n,
          true,
          await freelancer.getAddress(),
          await altFreelancer.getAddress(),
          nonce,
          deadline,
          invalidVSignature,
        ),
      ).to.be.revertedWithCustomError(registry, "InvalidSignature");
    });

    it("reverts on invalid signature length", async function () {
      const [admin, client, freelancer, altFreelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(1n, 1n),
        ]);

      const nonce = 0n;
      const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);

      await expect(
        registry.connect(client).setPartyAuthorizedRecipientBySig(
          1n,
          0n,
          true,
          await freelancer.getAddress(),
          await altFreelancer.getAddress(),
          nonce,
          deadline,
          "0x1234",
        ),
      ).to.be.revertedWithCustomError(registry, "InvalidSignature");
    });

    it("reverts bySig on out-of-range milestone index", async function () {
      const [admin, client, freelancer, altFreelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(1n, 1n),
        ]);

      const nonce = 0n;
      const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
      const signature = await signSetAlternativeRecipient(freelancer, registry, {
        projectId: 1n,
        milestoneIndex: 99n,
        isFreelancer: true,
        originalParty: await freelancer.getAddress(),
        newRecipient: await altFreelancer.getAddress(),
        nonce,
        deadline,
      });

      await expect(
        registry.connect(client).setPartyAuthorizedRecipientBySig(
          1n,
          99n,
          true,
          await freelancer.getAddress(),
          await altFreelancer.getAddress(),
          nonce,
          deadline,
          signature,
        ),
      ).to.be.revertedWithCustomError(registry, "MilestoneIndexOutOfRange");
    });

    it("bySig supports clearing recipient with address(0)", async function () {
      const [admin, client, freelancer, altFreelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 210n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      await registry.connect(client).approveMilestone(1n, 0n);

      const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
      const sigSet = await signSetAlternativeRecipient(freelancer, registry, {
        projectId: 1n,
        milestoneIndex: 0n,
        isFreelancer: true,
        originalParty: await freelancer.getAddress(),
        newRecipient: await altFreelancer.getAddress(),
        nonce: 0n,
        deadline,
      });
      await registry.connect(client).setPartyAuthorizedRecipientBySig(
        1n,
        0n,
        true,
        await freelancer.getAddress(),
        await altFreelancer.getAddress(),
        0n,
        deadline,
        sigSet,
      );

      const sigClear = await signSetAlternativeRecipient(freelancer, registry, {
        projectId: 1n,
        milestoneIndex: 0n,
        isFreelancer: true,
        originalParty: await freelancer.getAddress(),
        newRecipient: ethers.ZeroAddress,
        nonce: 1n,
        deadline,
      });
      await registry.connect(client).setPartyAuthorizedRecipientBySig(
        1n,
        0n,
        true,
        await freelancer.getAddress(),
        ethers.ZeroAddress,
        1n,
        deadline,
        sigClear,
      );

      await registry.connect(client).releaseMilestone(1n, 0n);
      expect(await token.balanceOf(await freelancer.getAddress())).to.equal(amount);
      expect(await token.balanceOf(await altFreelancer.getAddress())).to.equal(0n);
    });

    it("reverts bySig when recipient is address(this)", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(1n, 1n),
        ]);

      const nonce = 0n;
      const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
      const signature = await signSetAlternativeRecipient(freelancer, registry, {
        projectId: 1n,
        milestoneIndex: 0n,
        isFreelancer: true,
        originalParty: await freelancer.getAddress(),
        newRecipient: await registry.getAddress(),
        nonce,
        deadline,
      });

      await expect(
        registry.connect(client).setPartyAuthorizedRecipientBySig(
          1n,
          0n,
          true,
          await freelancer.getAddress(),
          await registry.getAddress(),
          nonce,
          deadline,
          signature,
        ),
      ).to.be.revertedWithCustomError(registry, "InvalidRecipient");
    });

    it("EIP-1271 client wallet authorizes cancel refund recipient via bySig", async function () {
      const [admin, freelancer, altClient] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const Wallet = await ethers.getContractFactory("EIP1271PartyWalletMock");
      const walletClient = await Wallet.connect(admin).deploy();
      await walletClient.waitForDeployment();
      const amount = 410n;
      await token.connect(admin).mint(await walletClient.getAddress(), amount * 2n);

      const tokenIface = token.interface;
      const regIface = registry.interface;
      await walletClient.execute(
        await token.getAddress(),
        tokenIface.encodeFunctionData("approve", [await registry.getAddress(), amount]),
      );
      await walletClient.execute(
        await registry.getAddress(),
        regIface.encodeFunctionData("createProject", [
          await freelancer.getAddress(),
          await token.getAddress(),
          "meta",
          [{ amount, deadline: 1n }],
        ]),
      );
      await walletClient.execute(
        await registry.getAddress(),
        regIface.encodeFunctionData("fundProject", [1n, amount]),
      );

      const nonce = 0n;
      const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
      const digest = await hashSetAlternativeRecipientDigest(registry, {
        projectId: 1n,
        milestoneIndex: PROJECT_SCOPE,
        isFreelancer: false,
        originalParty: await walletClient.getAddress(),
        newRecipient: await altClient.getAddress(),
        nonce,
        deadline,
      });
      await walletClient.setAcceptedDigest(digest);
      await walletClient.setMode(0n); // MatchDigest

      await registry.connect(freelancer).setPartyAuthorizedRecipientBySig(
        1n,
        PROJECT_SCOPE,
        false,
        await walletClient.getAddress(),
        await altClient.getAddress(),
        nonce,
        deadline,
        "0x",
      );

      await walletClient.execute(
        await registry.getAddress(),
        regIface.encodeFunctionData("cancelProject", [1n]),
      );
      expect(await token.balanceOf(await altClient.getAddress())).to.equal(amount);
    });

    it("EIP-1271 wrong magic then valid call keeps nonce (same nonce succeeds)", async function () {
      const [admin, freelancer, altClient] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const Wallet = await ethers.getContractFactory("EIP1271PartyWalletMock");
      const walletClient = await Wallet.connect(admin).deploy();
      await walletClient.waitForDeployment();
      await token.connect(admin).mint(await walletClient.getAddress(), 100n);

      const tokenIface = token.interface;
      const regIface = registry.interface;
      await walletClient.execute(
        await token.getAddress(),
        tokenIface.encodeFunctionData("approve", [await registry.getAddress(), 100n]),
      );
      await walletClient.execute(
        await registry.getAddress(),
        regIface.encodeFunctionData("createProject", [
          await freelancer.getAddress(),
          await token.getAddress(),
          "meta",
          [{ amount: 100n, deadline: 1n }],
        ]),
      );
      await walletClient.execute(
        await registry.getAddress(),
        regIface.encodeFunctionData("fundProject", [1n, 100n]),
      );

      const nonce = 0n;
      const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
      const digest = await hashSetAlternativeRecipientDigest(registry, {
        projectId: 1n,
        milestoneIndex: PROJECT_SCOPE,
        isFreelancer: false,
        originalParty: await walletClient.getAddress(),
        newRecipient: await altClient.getAddress(),
        nonce,
        deadline,
      });
      await walletClient.setAcceptedDigest(digest);

      await walletClient.setMode(1n); // WrongMagic
      await expect(
        registry.connect(freelancer).setPartyAuthorizedRecipientBySig(
          1n,
          PROJECT_SCOPE,
          false,
          await walletClient.getAddress(),
          await altClient.getAddress(),
          nonce,
          deadline,
          "0x",
        ),
      ).to.be.revertedWithCustomError(registry, "InvalidSignature");

      await walletClient.setMode(0n);
      await registry.connect(freelancer).setPartyAuthorizedRecipientBySig(
        1n,
        PROJECT_SCOPE,
        false,
        await walletClient.getAddress(),
        await altClient.getAddress(),
        nonce,
        deadline,
        "0x",
      );
    });

    it("EIP-1271 isValidSignature revert then valid call keeps nonce", async function () {
      const [admin, freelancer, altClient] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const Wallet = await ethers.getContractFactory("EIP1271PartyWalletMock");
      const walletClient = await Wallet.connect(admin).deploy();
      await walletClient.waitForDeployment();
      await token.connect(admin).mint(await walletClient.getAddress(), 100n);

      const tokenIface = token.interface;
      const regIface = registry.interface;
      await walletClient.execute(
        await token.getAddress(),
        tokenIface.encodeFunctionData("approve", [await registry.getAddress(), 100n]),
      );
      await walletClient.execute(
        await registry.getAddress(),
        regIface.encodeFunctionData("createProject", [
          await freelancer.getAddress(),
          await token.getAddress(),
          "meta",
          [{ amount: 100n, deadline: 1n }],
        ]),
      );
      await walletClient.execute(
        await registry.getAddress(),
        regIface.encodeFunctionData("fundProject", [1n, 100n]),
      );

      const nonce = 0n;
      const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
      const digest = await hashSetAlternativeRecipientDigest(registry, {
        projectId: 1n,
        milestoneIndex: PROJECT_SCOPE,
        isFreelancer: false,
        originalParty: await walletClient.getAddress(),
        newRecipient: await altClient.getAddress(),
        nonce,
        deadline,
      });
      await walletClient.setAcceptedDigest(digest);

      await walletClient.setMode(2n); // RevertCall
      await expect(
        registry.connect(freelancer).setPartyAuthorizedRecipientBySig(
          1n,
          PROJECT_SCOPE,
          false,
          await walletClient.getAddress(),
          await altClient.getAddress(),
          nonce,
          deadline,
          "0x",
        ),
      ).to.be.revertedWithCustomError(registry, "InvalidSignature");

      await walletClient.setMode(0n);
      await registry.connect(freelancer).setPartyAuthorizedRecipientBySig(
        1n,
        PROJECT_SCOPE,
        false,
        await walletClient.getAddress(),
        await altClient.getAddress(),
        nonce,
        deadline,
        "0x",
      );
    });
  });

  describe("createProject", function () {
    it("creates a valid project with milestones and emits ProjectCreated", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, client);

      const d1 = BigInt(Math.floor(Date.now() / 1000) + 86_400);
      const d2 = d1 + 86_400n;
      const m1 = 500_000n;
      const m2 = 300_000n;
      const total = m1 + m2;

      await expect(
        registry
          .connect(client)
          .createProject(freelancer.address, await token.getAddress(), "ipfs://proj", [
            milestone(m1, d1),
            milestone(m2, d2),
          ]),
      )
        .to.emit(registry, "ProjectCreated")
        .withArgs(
          1n,
          client.address,
          freelancer.address,
          await token.getAddress(),
          total,
          "ipfs://proj",
          2n,
        );

      expect(await registry.projectCount()).to.equal(1n);
      const p = await registry.getProject(1n);
      expect(p.client).to.equal(client.address);
      expect(p.freelancer).to.equal(freelancer.address);
      expect(p.token).to.equal(await token.getAddress());
      expect(p.totalAmount).to.equal(total);
      expect(p.fundedAmount).to.equal(0n);
      expect(p.releasedAmount).to.equal(0n);
      expect(p.refundedAmount).to.equal(0n);
      expect(p.metadataURI).to.equal("ipfs://proj");
      expect(p.status).to.equal(0); // Active
      expect(p.milestoneCount).to.equal(2n);

      const ms0 = await registry.getMilestone(1n, 0n);
      expect(ms0.amount).to.equal(m1);
      expect(ms0.deadline).to.equal(d1);
      expect(ms0.status).to.equal(0); // Pending
      expect(ms0.submissionURI).to.equal("");

      const ms1 = await registry.getMilestone(1n, 1n);
      expect(ms1.amount).to.equal(m2);
    });

    it("reverts on zero freelancer", async function () {
      const [admin, client] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, client);

      await expect(
        registry
          .connect(client)
          .createProject(ethers.ZeroAddress, await token.getAddress(), "", [
            milestone(1n, 1n),
          ]),
      )
        .to.be.revertedWithCustomError(registry, "ZeroAddress")
        .withArgs();
    });

    it("reverts when client equals freelancer", async function () {
      const [admin, client] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, client);

      await expect(
        registry
          .connect(client)
          .createProject(client.address, await token.getAddress(), "", [
            milestone(1n, 1n),
          ]),
      ).to.be.revertedWithCustomError(registry, "ClientEqualsFreelancer");
    });

    it("reverts on zero token", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);

      await expect(
        registry
          .connect(client)
          .createProject(freelancer.address, ethers.ZeroAddress, "", [
            milestone(1n, 1n),
          ]),
      )
        .to.be.revertedWithCustomError(registry, "ZeroAddress")
        .withArgs();
    });

    it("reverts on empty milestone list", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, client);

      await expect(
        registry
          .connect(client)
          .createProject(freelancer.address, await token.getAddress(), "", []),
      ).to.be.revertedWithCustomError(registry, "InvalidMilestoneCount");
    });

    it("reverts when a milestone amount is zero (malformed totals path)", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, client);

      await expect(
        registry
          .connect(client)
          .createProject(freelancer.address, await token.getAddress(), "", [
            milestone(0n, 1n),
            milestone(100n, 2n),
          ]),
      ).to.be.revertedWithCustomError(registry, "ZeroMilestoneAmount");
    });

    it("reverts when a milestone deadline is zero", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, client);

      await expect(
        registry
          .connect(client)
          .createProject(freelancer.address, await token.getAddress(), "", [
            milestone(100n, 0n),
          ]),
      ).to.be.revertedWithCustomError(registry, "ZeroMilestoneDeadline");
    });

    it("reverts when token has no contract code", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const eoaToken = ethers.Wallet.createRandom().address;

      await expect(
        registry
          .connect(client)
          .createProject(await freelancer.getAddress(), eoaToken, "", [
            milestone(1n, 1n),
          ]),
      ).to.be.revertedWithCustomError(registry, "InvalidToken");
    });

    it("reverts when token is not allowlisted", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployMock(client);

      await expect(
        registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(1n, 1n),
          ]),
      ).to.be.revertedWithCustomError(registry, "TokenNotAllowed");
    });

    it("reverts allowlisting token before review attestation", async function () {
      const [admin] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployMock(admin);

      await expect(
        registry.connect(admin).setAllowedToken(await token.getAddress(), true),
      ).to.be.revertedWithCustomError(registry, "TokenReviewNotAttested");
    });

    it("allows allowlisting token after review attestation", async function () {
      const [admin] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployMock(admin);

      await expect(
        registry
          .connect(admin)
          .attestTokenReviewForAllowlist(await token.getAddress()),
      )
        .to.emit(registry, "TokenReviewAttested")
        .withArgs(await token.getAddress(), await admin.getAddress());

      await expect(
        registry.connect(admin).setAllowedToken(await token.getAddress(), true),
      )
        .to.emit(registry, "AllowedTokenUpdated")
        .withArgs(await token.getAddress(), true);
    });

    it("allows disallowing token without review attestation", async function () {
      const [admin] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployMock(admin);

      await expect(
        registry.connect(admin).setAllowedToken(await token.getAddress(), false),
      )
        .to.emit(registry, "AllowedTokenUpdated")
        .withArgs(await token.getAddress(), false);
    });

    it("reverts when metadata URI exceeds MAX_URI_BYTES", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, client);
      const longUri = "a".repeat(2049);

      await expect(
        registry
          .connect(client)
          .createProject(
            await freelancer.getAddress(),
            await token.getAddress(),
            longUri,
            [milestone(1n, 1n)],
          ),
      ).to.be.revertedWithCustomError(registry, "URITooLong");
    });

    it("reverts when milestone count exceeds MAX_MILESTONES", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, client);

      const inputs = Array.from({ length: 51 }, (_, i) => milestone(1n, BigInt(i + 1)));

      await expect(
        registry
          .connect(client)
          .createProject(freelancer.address, await token.getAddress(), "", inputs),
      ).to.be.revertedWithCustomError(registry, "InvalidMilestoneCount");
    });

    it("reverts with explicit error when totalAmount overflows", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, client);
      const huge = (1n << 256n) - 1n;

      await expect(
        registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(huge, 1n),
            milestone(1n, 2n),
          ]),
      ).to.be.revertedWithCustomError(registry, "TotalAmountOverflow");
    });
  });

  describe("fundProject", function () {
    it("funds the project when client approves and emits ProjectFunded", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);

      const amount = 1_000_000n;
      await token.connect(admin).mint(client.address, amount * 10n);

      await registry
        .connect(client)
        .createProject(freelancer.address, await token.getAddress(), "meta", [
          milestone(amount, 1n),
        ]);

      await token.connect(client).approve(await registry.getAddress(), amount);

      await expect(registry.connect(client).fundProject(1n, amount))
        .to.emit(registry, "ProjectFunded")
        .withArgs(
          1n,
          client.address,
          await token.getAddress(),
          amount,
          amount,
        );

      const p = await registry.getProject(1n);
      expect(p.fundedAmount).to.equal(amount);
      expect(await token.balanceOf(await registry.getAddress())).to.equal(amount);
    });

    it("reverts when a non-client tries to fund", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);

      const amount = 100n;
      await token.connect(admin).mint(client.address, amount * 100n);

      await registry
        .connect(client)
        .createProject(freelancer.address, await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);

      await token.connect(client).approve(await registry.getAddress(), amount);

      await expect(
        registry.connect(freelancer).fundProject(1n, amount),
      ).to.be.revertedWithCustomError(registry, "NotProjectClient");
    });

    it("reverts when cumulative funding exceeds totalAmount", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);

      const total = 1_000_000n;
      await token.connect(admin).mint(client.address, total * 2n);

      await registry
        .connect(client)
        .createProject(freelancer.address, await token.getAddress(), "", [
          milestone(total, 1n),
        ]);

      await token.connect(client).approve(await registry.getAddress(), total * 2n);

      await registry.connect(client).fundProject(1n, total - 1n);
      await expect(
        registry.connect(client).fundProject(1n, 2n),
      ).to.be.revertedWithCustomError(registry, "FundingExceedsTotal");
    });

    it("reverts funding for fee-on-transfer tokens", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const Fee = await ethers.getContractFactory("FeeOnTransferToken");
      const feeToken = await Fee.connect(admin).deploy(await admin.getAddress());
      await feeToken.waitForDeployment();
      await registry
        .connect(admin)
        .attestTokenReviewForAllowlist(await feeToken.getAddress());
      await registry
        .connect(admin)
        .setAllowedToken(await feeToken.getAddress(), true);

      const amount = 1_000_000n;
      await feeToken.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await feeToken.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await feeToken.connect(client).approve(await registry.getAddress(), amount);

      await expect(
        registry.connect(client).fundProject(1n, amount),
      ).to.be.revertedWithCustomError(registry, "InvalidFundingTransfer");
    });

    it("registry token balance equals summed liability plus untracked (invariant check)", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const tokenAddr = await token.getAddress();
      const regAddr = await registry.getAddress();

      const a = 400_000n;
      const b = 600_000n;
      await token.connect(admin).mint(await client.getAddress(), (a + b) * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), tokenAddr, "", [milestone(a, 1n)]);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), tokenAddr, "", [milestone(b, 1n)]);
      await token.connect(client).approve(regAddr, a + b);
      await registry.connect(client).fundProject(1n, a);
      await registry.connect(client).fundProject(2n, b);

      const liq = await sumLiabilityForToken(registry, tokenAddr, 2n);
      const untracked = await registry.untrackedTokenBalance(tokenAddr);
      const bal = await token.balanceOf(regAddr);
      expect(liq).to.equal(a + b);
      expect(bal).to.equal(liq + untracked);

      const extra = 25_000n;
      await token.connect(client).transfer(regAddr, extra);
      expect(await registry.untrackedTokenBalance(tokenAddr)).to.equal(extra);
      expect(await token.balanceOf(regAddr)).to.equal(liq + extra);
    });
  });

  describe("security invariants", function () {
    async function expectProjectInvariants(
      registry: EscrowFlowRegistry,
      projectId: bigint,
    ): Promise<void> {
      const p = await registry.getProject(projectId);
      const settled = p.releasedAmount + p.refundedAmount;
      const free = p.fundedAmount - settled;
      expect(settled).to.be.lte(p.fundedAmount);
      expect(p.reservedAmount).to.be.lte(free);
    }

    async function expectTokenInvariants(
      registry: EscrowFlowRegistry,
      token: MockERC20Stablecoin,
      lastProjectId: bigint,
    ): Promise<void> {
      const tokenAddr = await token.getAddress();
      const regAddr = await registry.getAddress();
      const liability = await sumLiabilityForToken(registry, tokenAddr, lastProjectId);
      const untracked = await registry.untrackedTokenBalance(tokenAddr);
      const balance = await token.balanceOf(regAddr);

      // Invariant 3: contract token balance must cover liabilities.
      expect(balance).to.be.gte(liability);
      // Invariant 4: outstanding liability equals aggregate unsettled project liability.
      expect(balance - untracked).to.equal(liability);
    }

    async function assertGlobalInvariants(
      registry: EscrowFlowRegistry,
      token: MockERC20Stablecoin,
      lastProjectId: bigint,
    ): Promise<void> {
      for (let pid = 1n; pid <= lastProjectId; pid++) {
        await expectProjectInvariants(registry, pid);
      }
      await expectTokenInvariants(registry, token, lastProjectId);
    }

    it("prevents project A from consuming project B funds under partial-funding dispute stress", async function () {
      const [admin, arb, client, freelancerA, freelancerB] =
        await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const token = await deployAndAllowMock(registry, admin, admin);
      const tokenAddr = await token.getAddress();

      // Project A: total 900 (400 + 500), but funded only 700.
      // Project B: total/funded 1000.
      const a0 = 400n;
      const a1 = 500n;
      const aFunded = 700n;
      const b0 = 1_000n;
      const mintTotal = aFunded + b0;
      await token.connect(admin).mint(await client.getAddress(), mintTotal * 3n);

      await registry
        .connect(client)
        .createProject(await freelancerA.getAddress(), tokenAddr, "", [
          milestone(a0, 1n),
          milestone(a1, 2n),
        ]);
      await registry
        .connect(client)
        .createProject(await freelancerB.getAddress(), tokenAddr, "", [
          milestone(b0, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), mintTotal);
      await registry.connect(client).fundProject(1n, aFunded); // Project A partial
      await registry.connect(client).fundProject(2n, b0); // Project B full

      // Step 1: approve/release earlier milestone on A.
      await registry.connect(freelancerA).submitMilestone(1n, 0n, "ipfs://a0");
      await registry.connect(client).approveMilestone(1n, 0n);
      await registry.connect(client).releaseMilestone(1n, 0n);

      // Step 2 exploit attempt: reserve later milestone via dispute on A.
      await expect(
        registry.connect(client).raiseDispute(1n, 1n, "ipfs://a1"),
      ).to.be.revertedWithCustomError(registry, "InsufficientFundingForMilestone");

      // Step 3 exploit attempt: stale resolve later dispute should fail (no active dispute).
      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);
      await expect(
        registry.connect(client).resolveStaleDisputeByTimeout(1n, 1n),
      ).to.be.revertedWithCustomError(registry, "DisputeNotActive");

      const projectA = await registry.getProject(1n);
      const projectB = await registry.getProject(2n);
      expect(projectA.releasedAmount + projectA.refundedAmount).to.be.lte(
        projectA.fundedAmount,
      );
      expect(projectB.releasedAmount + projectB.refundedAmount).to.equal(0n);
      expect(projectB.fundedAmount).to.equal(b0);

      await assertGlobalInvariants(registry, token, 2n);
    });

    it("randomized operation sequence preserves project and token solvency invariants", async function () {
      const [admin, arb, client, f1, f2] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const token = await deployAndAllowMock(registry, admin, admin);
      const tokenAddr = await token.getAddress();

      // Two projects sharing one token.
      await token.connect(admin).mint(await client.getAddress(), 20_000n);
      await registry
        .connect(client)
        .createProject(await f1.getAddress(), tokenAddr, "", [
          milestone(300n, 1n),
          milestone(400n, 2n),
          milestone(500n, 3n),
        ]);
      await registry
        .connect(client)
        .createProject(await f2.getAddress(), tokenAddr, "", [
          milestone(350n, 1n),
          milestone(450n, 2n),
          milestone(550n, 3n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), 20_000n);

      const rand = (seed: bigint, mod: bigint): bigint => {
        const n = (seed * 1103515245n + 12345n) & ((1n << 63n) - 1n);
        return n % mod;
      };
      let seed = 42n;

      for (let step = 0; step < 30; step++) {
        seed = rand(seed + BigInt(step + 1), 1n << 62n);
        const op = Number(rand(seed, 9n)); // 0..8
        seed = rand(seed + 99n, 1n << 62n);
        const projectId = Number(rand(seed, 2n)) + 1;
        const pid = BigInt(projectId);
        seed = rand(seed + 7n, 1n << 62n);
        const midx = BigInt(Number(rand(seed, 3n)));
        const project = await registry.getProject(pid);
        const freelancer = projectId === 1 ? f1 : f2;
        const milestoneData = await registry.getMilestone(pid, midx);

        try {
          if (op === 0) {
            const amt = [200n, 300n, 400n][Number(rand(seed + 1n, 3n))];
            await registry.connect(client).fundProject(pid, amt);
          } else if (op === 1) {
            await registry
              .connect(freelancer)
              .submitMilestone(pid, midx, `ipfs://s-${step}-${projectId}-${midx}`);
          } else if (op === 2) {
            await registry.connect(client).approveMilestone(pid, midx);
          } else if (op === 3) {
            await registry.connect(client).releaseMilestone(pid, midx);
          } else if (op === 4) {
            await registry
              .connect(client)
              .raiseDispute(pid, midx, `ipfs://d-${step}-${projectId}-${midx}`);
          } else if (op === 5) {
            const amount = milestoneData.amount;
            const kind = Number(rand(seed + 2n, 3n));
            if (kind === 0) {
              await registry
                .connect(arb)
                .resolveDispute(pid, midx, Resolution.ReleaseToFreelancer, amount, 0n);
            } else if (kind === 1) {
              await registry
                .connect(arb)
                .resolveDispute(pid, midx, Resolution.RefundToClient, 0n, amount);
            } else {
              const left = amount / 2n;
              await registry
                .connect(arb)
                .resolveDispute(pid, midx, Resolution.Split, left, amount - left);
            }
          } else if (op === 6) {
            await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 5]);
            await ethers.provider.send("evm_mine", []);
            await registry.connect(client).resolveStaleDisputeByTimeout(pid, midx);
          } else if (op === 7) {
            await ethers.provider.send("evm_increaseTime", [14 * 24 * 60 * 60 + 5]);
            await ethers.provider.send("evm_mine", []);
            await registry.connect(client).cancelProject(pid);
          } else {
            const amount = milestoneData.amount;
            await registry
              .connect(admin)
              .proposeEmergencyResolveDispute(
                pid,
                midx,
                Resolution.RefundToClient,
                0n,
                amount,
              );
            await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 5]);
            await ethers.provider.send("evm_mine", []);
            await registry
              .connect(admin)
              .emergencyResolveDispute(pid, midx, Resolution.RefundToClient, 0n, amount);
          }
        } catch {
          // Many randomly chosen operations are intentionally invalid in a given state.
          // We only require that any failed call leaves invariants intact.
        }

        await assertGlobalInvariants(registry, token, 2n);
      }
    });
  });

  /** Solidity: Pending=0, Submitted=1, Approved=2, Released=3, Refunded=4 */
  const MS = {
    Pending: 0,
    Submitted: 1,
    Approved: 2,
    Released: 3,
    Refunded: 4,
  } as const;

  /** Matches `EscrowFlowRegistry._PROJECT_WIDE_RECIPIENT_SCOPE` (`type(uint256).max`). */
  const PROJECT_WIDE_RECIPIENT_SCOPE = (1n << 256n) - 1n;

  describe("milestone submit / approve / release", function () {
    async function setupFundedTwoMilestoneProject(
      admin: Signer,
      client: Signer,
      freelancer: Signer,
    ) {
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const m0 = 500_000n;
      const m1 = 300_000n;
      const total = m0 + m1;
      const clientAddr = await client.getAddress();
      const freelancerAddr = await freelancer.getAddress();
      await token.connect(admin).mint(clientAddr, total * 2n);

      await registry
        .connect(client)
        .createProject(freelancerAddr, await token.getAddress(), "meta", [
          milestone(m0, 1n),
          milestone(m1, 2n),
        ]);

      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, total);

      return { registry, token, m0, m1, total };
    }

    it("allows valid submission when cumulative funding covers the milestone", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const { registry, m0 } = await setupFundedTwoMilestoneProject(
        admin,
        client,
        freelancer,
      );

      const uri = "ipfs://deliverable-0";
      await expect(
        registry.connect(freelancer).submitMilestone(1n, 0n, uri),
      )
        .to.emit(registry, "MilestoneSubmitted")
        .withArgs(1n, 0n, freelancer.address, uri);

      const ms = await registry.getMilestone(1n, 0n);
      expect(ms.status).to.equal(MS.Submitted);
      expect(ms.submissionURI).to.equal(uri);
    });

    it("reverts submission from non-freelancer", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const { registry } = await setupFundedTwoMilestoneProject(
        admin,
        client,
        freelancer,
      );

      await expect(
        registry.connect(client).submitMilestone(1n, 0n, "ipfs://x"),
      ).to.be.revertedWithCustomError(registry, "NotProjectFreelancer");
    });

    it("allows client to approve after submission", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const { registry } = await setupFundedTwoMilestoneProject(
        admin,
        client,
        freelancer,
      );

      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://a");

      await expect(registry.connect(client).approveMilestone(1n, 0n))
        .to.emit(registry, "MilestoneApproved")
        .withArgs(1n, 0n, client.address);

      const ms = await registry.getMilestone(1n, 0n);
      expect(ms.status).to.equal(MS.Approved);
    });

    it("reverts approval before submission", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const { registry } = await setupFundedTwoMilestoneProject(
        admin,
        client,
        freelancer,
      );

      await expect(
        registry.connect(client).approveMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(registry, "InvalidMilestoneStatus");
    });

    it("reverts repeat approval after already approved", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const { registry } = await setupFundedTwoMilestoneProject(
        admin,
        client,
        freelancer,
      );

      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://a");
      await registry.connect(client).approveMilestone(1n, 0n);

      await expect(
        registry.connect(client).approveMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(registry, "InvalidMilestoneStatus");
    });

    it("releases funds with correct accounting and milestone status Released", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const { registry, token, m0 } = await setupFundedTwoMilestoneProject(
        admin,
        client,
        freelancer,
      );

      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://a");
      await registry.connect(client).approveMilestone(1n, 0n);

      const before = await token.balanceOf(freelancer.address);

      await expect(registry.connect(client).releaseMilestone(1n, 0n))
        .to.emit(registry, "MilestoneFundsReleased")
        .withArgs(
          1n,
          0n,
          freelancer.address,
          freelancer.address,
          await token.getAddress(),
          m0,
          m0,
        );

      expect(await token.balanceOf(freelancer.address)).to.equal(before + m0);

      const p = await registry.getProject(1n);
      expect(p.releasedAmount).to.equal(m0);

      const ms = await registry.getMilestone(1n, 0n);
      expect(ms.status).to.equal(MS.Released);
    });

    it("reverts release when payout exceeds free liquidity (reserved liquidity guard)", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const m0 = 600n;
      const m1 = 400n;
      const total = m0 + m1;
      await token.connect(admin).mint(await client.getAddress(), total * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(m0, 1n),
          milestone(m1, 2n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, total);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://a");
      await registry.connect(client).approveMilestone(1n, 0n);

      // Test-only storage shaping: force reserved liquidity to equal available liquidity (500),
      // leaving free liquidity below the approved payout (600).
      await setProjectReservedAmountForTest(registry, 1n, 500n);

      await expect(
        registry.connect(client).releaseMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(registry, "InsufficientEscrowLiquidity");
    });

    it("keeps release accounting unchanged when releaseMilestone reverts on liquidity guard", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const m0 = 600n;
      const m1 = 400n;
      const total = m0 + m1;
      await token.connect(admin).mint(await client.getAddress(), total * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(m0, 1n),
          milestone(m1, 2n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, total);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://a");
      await registry.connect(client).approveMilestone(1n, 0n);
      await setProjectReservedAmountForTest(registry, 1n, 500n);

      const projectBefore = await registry.getProject(1n);
      const milestoneBefore = await registry.getMilestone(1n, 0n);
      const untrackedBefore = await registry.untrackedTokenBalance(
        await token.getAddress(),
      );

      await expect(
        registry.connect(client).releaseMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(registry, "InsufficientEscrowLiquidity");

      const projectAfter = await registry.getProject(1n);
      const milestoneAfter = await registry.getMilestone(1n, 0n);
      const untrackedAfter = await registry.untrackedTokenBalance(
        await token.getAddress(),
      );

      expect(projectAfter.releasedAmount).to.equal(projectBefore.releasedAmount);
      expect(projectAfter.settledMilestoneCount).to.equal(
        projectBefore.settledMilestoneCount,
      );
      expect(milestoneAfter.status).to.equal(milestoneBefore.status);
      // Contract token balance is unchanged on revert, so unchanged untracked balance implies
      // `_tokenOutstanding` did not mutate.
      expect(untrackedAfter).to.equal(untrackedBefore);
    });

    it("tracks status transitions Pending → Submitted → Approved → Released", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const { registry } = await setupFundedTwoMilestoneProject(
        admin,
        client,
        freelancer,
      );

      let ms = await registry.getMilestone(1n, 0n);
      expect(ms.status).to.equal(MS.Pending);

      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://x");
      ms = await registry.getMilestone(1n, 0n);
      expect(ms.status).to.equal(MS.Submitted);

      await registry.connect(client).approveMilestone(1n, 0n);
      ms = await registry.getMilestone(1n, 0n);
      expect(ms.status).to.equal(MS.Approved);

      await registry.connect(client).releaseMilestone(1n, 0n);
      ms = await registry.getMilestone(1n, 0n);
      expect(ms.status).to.equal(MS.Released);
    });

    it("reverts second release on the same milestone", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const { registry } = await setupFundedTwoMilestoneProject(
        admin,
        client,
        freelancer,
      );

      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://a");
      await registry.connect(client).approveMilestone(1n, 0n);
      await registry.connect(client).releaseMilestone(1n, 0n);

      await expect(
        registry.connect(client).releaseMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(registry, "InvalidMilestoneStatus");
    });

    it("reverts release before approval", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const { registry } = await setupFundedTwoMilestoneProject(
        admin,
        client,
        freelancer,
      );

      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://a");

      await expect(
        registry.connect(client).releaseMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(registry, "InvalidMilestoneStatus");
    });

    it("reverts double submission on the same milestone", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const { registry } = await setupFundedTwoMilestoneProject(
        admin,
        client,
        freelancer,
      );

      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://a");
      await expect(
        registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://b"),
      ).to.be.revertedWithCustomError(registry, "InvalidMilestoneStatus");
    });

    it("reverts submission when available liquidity is below milestone amount", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const m0 = 500_000n;
      const m1 = 300_000n;
      const total = m0 + m1;
      await token.connect(admin).mint(client.address, total * 2n);

      await registry
        .connect(client)
        .createProject(freelancer.address, await token.getAddress(), "meta", [
          milestone(m0, 1n),
          milestone(m1, 2n),
        ]);

      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, 200_000n);
      await expect(
        registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://no"),
      ).to.be.revertedWithCustomError(registry, "InsufficientFundingForMilestone");
    });

    it("reverts out-of-order submission even with sufficient liquidity", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const m0 = 100n;
      const m1 = 200n;
      const m2 = 300n;
      const total = m0 + m1 + m2;
      await token.connect(admin).mint(await client.getAddress(), total * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(m0, 1n),
          milestone(m1, 2n),
          milestone(m2, 3n),
        ]);

      // Fund less than cumulative-through-index-2 (500 < 600), but enough liquidity for m2 (300)
      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, total);

      await expect(
        registry.connect(freelancer).submitMilestone(1n, 2n, "ipfs://m2"),
      ).to.be.revertedWithCustomError(registry, "PreviousMilestoneNotCompleted");
    });

    it("reverts submission when URI exceeds MAX_URI_BYTES", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const { registry } = await setupFundedTwoMilestoneProject(
        admin,
        client,
        freelancer,
      );
      const longUri = "a".repeat(2049);

      await expect(
        registry.connect(freelancer).submitMilestone(1n, 0n, longUri),
      ).to.be.revertedWithCustomError(registry, "URITooLong");
    });

    it("reverts submit/approve/release while protocol is paused", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const { registry } = await setupFundedTwoMilestoneProject(
        admin,
        client,
        freelancer,
      );
      await registry.connect(admin).pause();

      await expect(
        registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://x"),
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");
      await expect(
        registry.connect(client).approveMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");
      await expect(
        registry.connect(client).releaseMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");
    });

    it("accumulates releasedAmount across milestones", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const { registry, token, m0, m1, total } =
        await setupFundedTwoMilestoneProject(admin, client, freelancer);

      for (const idx of [0n, 1n] as const) {
        await registry
          .connect(freelancer)
          .submitMilestone(1n, idx, `ipfs://m${idx}`);
        await registry.connect(client).approveMilestone(1n, idx);
        await registry.connect(client).releaseMilestone(1n, idx);
      }

      const p = await registry.getProject(1n);
      expect(p.releasedAmount).to.equal(total);
      expect(await token.balanceOf(freelancer.address)).to.equal(total);
    });

    it("releaseMilestone pays project-wide party-authorized freelancer when milestone slot is empty", async function () {
      const [admin, client, freelancer, altFreelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 333n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "m", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).approveMilestone(1n, 0n);

      await registry
        .connect(freelancer)
        .setPartyAuthorizedRecipient(
          1n,
          PROJECT_WIDE_RECIPIENT_SCOPE,
          true,
          await altFreelancer.getAddress(),
        );

      await registry.connect(client).releaseMilestone(1n, 0n);
      expect(await token.balanceOf(await altFreelancer.getAddress())).to.equal(amount);
      expect(await token.balanceOf(await freelancer.getAddress())).to.equal(0n);
    });

    it("releaseMilestone prefers milestone-specific party-authorized freelancer over project-wide", async function () {
      const [admin, client, freelancer, altWide, altSpecific] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 344n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "m", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).approveMilestone(1n, 0n);

      await registry
        .connect(freelancer)
        .setPartyAuthorizedRecipient(
          1n,
          PROJECT_WIDE_RECIPIENT_SCOPE,
          true,
          await altWide.getAddress(),
        );
      await registry
        .connect(freelancer)
        .setPartyAuthorizedRecipient(1n, 0n, true, await altSpecific.getAddress());

      await registry.connect(client).releaseMilestone(1n, 0n);
      expect(await token.balanceOf(await altSpecific.getAddress())).to.equal(amount);
      expect(await token.balanceOf(await altWide.getAddress())).to.equal(0n);
    });
  });

  /** Must match Solidity enum order */
  const Resolution = {
    ReleaseToFreelancer: 0,
    RefundToClient: 1,
    Split: 2,
  } as const;

  describe("disputes", function () {
    async function deployRegistryWithArb(
      admin: Signer,
      arb: Signer,
    ): Promise<EscrowFlowRegistry> {
      const registry = await deployRegistry(admin);
      const role = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(role, await arb.getAddress());
      return registry;
    }

    it("raises a valid dispute and emits DisputeRaised (indexer-friendly)", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 1_000_000n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "m", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");

      const tokenAddr = await token.getAddress();
      await expect(registry.connect(client).raiseDispute(1n, 0n, "ipfs://dispute"))
        .to.emit(registry, "DisputeRaised")
        .withArgs(1n, 0n, await client.getAddress(), tokenAddr, MS.Submitted, "ipfs://dispute");

      const d = await registry.getDispute(1n, 0n);
      expect(d.active).to.equal(true);
      expect(d.raisedBy).to.equal(await client.getAddress());
      expect(d.lastAppendedEvidenceURI).to.equal("");
    });

    it("reverts dispute raise from a non-participant", async function () {
      const [admin, arb, client, freelancer, stranger] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 100n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const futureDeadline = BigInt(now + 3_600);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, futureDeadline),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://x");

      await expect(
        registry.connect(stranger).raiseDispute(1n, 0n, "ipfs://bad"),
      ).to.be.revertedWithCustomError(registry, "NotAuthorizedToRaiseDispute");
    });

    it("reverts dispute raise on completed project", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 100n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      await registry.connect(client).approveMilestone(1n, 0n);
      await registry.connect(client).releaseMilestone(1n, 0n);

      await expect(
        registry.connect(client).raiseDispute(1n, 0n, "ipfs://bad-status"),
      ).to.be.revertedWithCustomError(registry, "ProjectNotActive");
    });

    it("allows dispute on Pending milestone after deadline", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 100n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const pastDeadline = BigInt(now - 5);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, pastDeadline),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);

      await expect(registry.connect(client).raiseDispute(1n, 0n, "ipfs://late"))
        .to.emit(registry, "DisputeRaised")
        .withArgs(1n, 0n, await client.getAddress(), await token.getAddress(), MS.Pending, "ipfs://late");
    });

    it("reverts pending dispute before deadline", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 100n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const futureDeadline = BigInt(now + 86_400);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, futureDeadline),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);

      await expect(
        registry.connect(client).raiseDispute(1n, 0n, "ipfs://too-early"),
      ).to.be.revertedWithCustomError(registry, "MilestoneDeadlineNotReached");
    });

    it("reverts pending dispute after deadline when milestone is not funded", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 100n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const pastDeadline = BigInt(now - 5);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, pastDeadline),
        ]);
      // Intentionally no funding to reproduce zero-liquidity path
      await expect(
        registry.connect(freelancer).raiseDispute(1n, 0n, "ipfs://unfunded"),
      ).to.be.revertedWithCustomError(registry, "InsufficientFundingForMilestone");
    });

    it("allows pending dispute when available liquidity covers milestone after previous milestones are settled", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const m0 = 100n;
      const m1 = 200n;
      const m2 = 300n;
      const total = m0 + m1 + m2;
      await token.connect(admin).mint(await client.getAddress(), total * 2n);

      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const past = BigInt(now - 5);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(m0, past),
          milestone(m1, past),
          milestone(m2, past),
        ]);
      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, total);

      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d0");
      await registry
        .connect(arb)
        .resolveDispute(1n, 0n, Resolution.RefundToClient, 0n, m0);
      await registry.connect(client).raiseDispute(1n, 1n, "ipfs://d1");
      await registry
        .connect(arb)
        .resolveDispute(1n, 1n, Resolution.RefundToClient, 0n, m1);

      await expect(registry.connect(freelancer).raiseDispute(1n, 2n, "ipfs://late-m2"))
        .to.emit(registry, "DisputeRaised")
        .withArgs(1n, 2n, await freelancer.getAddress(), await token.getAddress(), MS.Pending, "ipfs://late-m2");
    });

    it("reverts disputing milestone 1 while milestone 0 is Pending", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const m0 = 100n;
      const m1 = 200n;
      const total = m0 + m1;
      await token.connect(admin).mint(await client.getAddress(), total * 2n);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const past = BigInt(now - 5);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(m0, past),
          milestone(m1, past),
        ]);
      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, total);

      await expect(
        registry.connect(client).raiseDispute(1n, 1n, "ipfs://m1"),
      ).to.be.revertedWithCustomError(registry, "PreviousMilestoneNotCompleted");
    });

    it("reverts disputing milestone 1 while milestone 0 is Submitted", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const m0 = 100n;
      const m1 = 200n;
      const total = m0 + m1;
      await token.connect(admin).mint(await client.getAddress(), total * 2n);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const past = BigInt(now - 5);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(m0, past),
          milestone(m1, past),
        ]);
      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, total);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://m0");

      await expect(
        registry.connect(client).raiseDispute(1n, 1n, "ipfs://m1"),
      ).to.be.revertedWithCustomError(registry, "PreviousMilestoneNotCompleted");
    });

    it("reverts disputing milestone 1 while milestone 0 is Approved", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const m0 = 100n;
      const m1 = 200n;
      const total = m0 + m1;
      await token.connect(admin).mint(await client.getAddress(), total * 2n);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const past = BigInt(now - 5);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(m0, past),
          milestone(m1, past),
        ]);
      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, total);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://m0");
      await registry.connect(client).approveMilestone(1n, 0n);

      await expect(
        registry.connect(client).raiseDispute(1n, 1n, "ipfs://m1"),
      ).to.be.revertedWithCustomError(registry, "PreviousMilestoneNotCompleted");
    });

    it("allows disputing milestone 1 after milestone 0 is Released", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const m0 = 100n;
      const m1 = 200n;
      const total = m0 + m1;
      await token.connect(admin).mint(await client.getAddress(), total * 2n);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const past = BigInt(now - 5);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(m0, past),
          milestone(m1, past),
        ]);
      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, total);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://m0");
      await registry.connect(client).approveMilestone(1n, 0n);
      await registry.connect(client).releaseMilestone(1n, 0n);

      await expect(registry.connect(client).raiseDispute(1n, 1n, "ipfs://m1"))
        .to.emit(registry, "DisputeRaised")
        .withArgs(1n, 1n, await client.getAddress(), await token.getAddress(), MS.Pending, "ipfs://m1");
    });

    it("allows disputing milestone 1 after milestone 0 is Refunded", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const m0 = 100n;
      const m1 = 200n;
      const total = m0 + m1;
      await token.connect(admin).mint(await client.getAddress(), total * 2n);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const past = BigInt(now - 5);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(m0, past),
          milestone(m1, past),
        ]);
      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, total);

      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://m0");
      await registry
        .connect(arb)
        .resolveDispute(1n, 0n, Resolution.RefundToClient, 0n, m0);

      await expect(registry.connect(client).raiseDispute(1n, 1n, "ipfs://m1"))
        .to.emit(registry, "DisputeRaised")
        .withArgs(1n, 1n, await client.getAddress(), await token.getAddress(), MS.Pending, "ipfs://m1");
    });

    it("reverts pending dispute resolution to freelancer", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 100n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const pastDeadline = BigInt(now - 5);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, pastDeadline),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://late");

      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
      ).to.be.revertedWithCustomError(registry, "PendingDisputeMustRefundClient");
    });

    it("reverts dispute raise when reason URI exceeds MAX_URI_BYTES", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 100n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");

      await expect(
        registry.connect(client).raiseDispute(1n, 0n, "a".repeat(2049)),
      ).to.be.revertedWithCustomError(registry, "URITooLong");
    });

    it("blocks approve and release on the disputed milestone", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 200n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://a");

      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await expect(
        registry.connect(client).approveMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(registry, "DisputeActive");

      await expect(
        registry.connect(client).releaseMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(registry, "DisputeActive");
    });

    it("allows the freelancer to raise a dispute on an Approved milestone (FIX N-13 companion)", async function () {
      // Before N-13, this path reverted NotAuthorizedToRaiseDispute. After N-13 closed the
      // cancelProject auto-refund hole on Approved, the freelancer needs a self-help path
      // against a client who approves but refuses to releaseMilestone — raiseDispute is now
      // open to the freelancer for Approved milestones too, symmetric with Submitted.
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 200n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://a");
      await registry.connect(client).approveMilestone(1n, 0n);

      await expect(
        registry.connect(freelancer).raiseDispute(1n, 0n, "ipfs://escalate"),
      )
        .to.emit(registry, "DisputeRaised")
        .withArgs(
          1n,
          0n,
          await freelancer.getAddress(),
          await token.getAddress(),
          2, // MilestoneStatus.Approved
          "ipfs://escalate",
        );

      const d = await registry.getDispute(1n, 0n);
      expect(d.active).to.equal(true);
      expect(d.raisedBy).to.equal(await freelancer.getAddress());
      const p = await registry.getProject(1n);
      expect(p.activeDisputeCount).to.equal(1n);
      expect(p.reservedAmount).to.equal(amount);
    });

    it("reverts submit while a deadline dispute is active on that milestone", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 200n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const pastDeadline = BigInt(now - 5);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, pastDeadline),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);

      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://deadline-dispute");

      await expect(
        registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work"),
      ).to.be.revertedWithCustomError(registry, "DisputeActive");
    });

    it("emits DisputeEvidenceAppended for party during active dispute", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 200n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://a");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      const ev = "ipfs://extra-evidence";
      await expect(registry.connect(freelancer).appendDisputeEvidence(1n, 0n, ev))
        .to.emit(registry, "DisputeEvidenceAppended")
        .withArgs(1n, 0n, await freelancer.getAddress(), ev);

      const d = await registry.getDispute(1n, 0n);
      expect(d.lastAppendedEvidenceURI).to.equal(ev);
    });

    it("reverts appendDisputeEvidence for non-party or without active dispute", async function () {
      const [admin, arb, client, freelancer, stranger] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 200n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://a");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await expect(
        registry.connect(stranger).appendDisputeEvidence(1n, 0n, "ipfs://x"),
      ).to.be.revertedWithCustomError(registry, "NotAuthorizedToRaiseDispute");

      await registry.connect(client).appendDisputeEvidence(1n, 0n, "ipfs://before-resolve");
      expect((await registry.getDispute(1n, 0n)).lastAppendedEvidenceURI).to.equal("ipfs://before-resolve");

      await registry.connect(arb).resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);

      expect((await registry.getDispute(1n, 0n)).lastAppendedEvidenceURI).to.equal("");

      await expect(
        registry.connect(client).appendDisputeEvidence(1n, 0n, "ipfs://late"),
      ).to.be.revertedWithCustomError(registry, "DisputeNotActive");
    });

    it("allows appendDisputeEvidence while protocol is paused", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 200n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://a");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await registry.connect(admin).pause();

      const ev = "ipfs://evidence-while-paused";
      await expect(registry.connect(freelancer).appendDisputeEvidence(1n, 0n, ev))
        .to.emit(registry, "DisputeEvidenceAppended")
        .withArgs(1n, 0n, await freelancer.getAddress(), ev);
    });

    it("resolves with ReleaseToFreelancer and pays the freelancer", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 800_000n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      const before = await token.balanceOf(await freelancer.getAddress());
      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
      )
        .to.emit(registry, "DisputeResolved")
        .withArgs(
          1n,
          0n,
          await arb.getAddress(),
          Resolution.ReleaseToFreelancer,
          amount,
          0n,
        );

      expect(await token.balanceOf(await freelancer.getAddress())).to.equal(
        before + amount,
      );
      const p = await registry.getProject(1n);
      expect(p.releasedAmount).to.equal(amount);
      expect(p.refundedAmount).to.equal(0n);
      const ms = await registry.getMilestone(1n, 0n);
      expect(ms.status).to.equal(MS.Released);
    });

    it("emits effective payout recipients on dispute resolution", async function () {
      const [admin, arb, client, freelancer, altFreelancer] =
        await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const Blacklist = await ethers.getContractFactory("BlacklistStablecoin");
      const token = await Blacklist.connect(admin).deploy(await admin.getAddress());
      await token.waitForDeployment();
      await registry
        .connect(admin)
        .attestTokenReviewForAllowlist(await token.getAddress());
      await registry
        .connect(admin)
        .setAllowedToken(await token.getAddress(), true);
      const amount = 200n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");
      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());
      const delay = await registry.ALTERNATIVE_RECIPIENT_DELAY();
      await ethers.provider.send("evm_increaseTime", [Number(delay) + 1]);
      await ethers.provider.send("evm_mine", []);
      await registry.connect(freelancer).executeAlternativeRecipient(1n, 0n, true);

      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
      )
        .to.emit(registry, "DisputePayoutRecipients")
        .withArgs(1n, 0n, await altFreelancer.getAddress(), client.address);
    });

    it("resolves with RefundToClient and marks milestone Refunded", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 300_000n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(freelancer).raiseDispute(1n, 0n, "ipfs://d");

      const clientAddr = await client.getAddress();
      const before = await token.balanceOf(clientAddr);
      await registry
        .connect(arb)
        .resolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount);

      expect(await token.balanceOf(clientAddr)).to.equal(before + amount);
      const p = await registry.getProject(1n);
      expect(p.refundedAmount).to.equal(amount);
      const ms = await registry.getMilestone(1n, 0n);
      expect(ms.status).to.equal(MS.Refunded);
    });

    it("resolves with Split and updates both accounting legs", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 1_000_000n;
      const toFree = 600_000n;
      const toClient = 400_000n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      const bf = await token.balanceOf(await freelancer.getAddress());
      const bc = await token.balanceOf(await client.getAddress());
      await registry
        .connect(arb)
        .resolveDispute(1n, 0n, Resolution.Split, toFree, toClient);

      expect(await token.balanceOf(await freelancer.getAddress())).to.equal(bf + toFree);
      expect(await token.balanceOf(await client.getAddress())).to.equal(bc + toClient);
      const p = await registry.getProject(1n);
      expect(p.releasedAmount).to.equal(toFree);
      expect(p.refundedAmount).to.equal(toClient);
    });

    it("reverts resolveDispute when project-level accounting would exceed fundedAmount", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 400n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      // Test-only storage shaping: force fundedAmount below outgoing resolution total.
      await setProjectFundedAmountForTest(registry, 1n, amount - 1n);

      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
      ).to.be.revertedWithCustomError(registry, "InsufficientEscrowLiquidity");
    });

    it("keeps dispute active and accounting unchanged when resolveDispute solvency check reverts", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 400n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");
      await setProjectFundedAmountForTest(registry, 1n, amount - 1n);

      const projectBefore = await registry.getProject(1n);
      const disputeBefore = await registry.getDispute(1n, 0n);
      const milestoneBefore = await registry.getMilestone(1n, 0n);
      const untrackedBefore = await registry.untrackedTokenBalance(
        await token.getAddress(),
      );

      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
      ).to.be.revertedWithCustomError(registry, "InsufficientEscrowLiquidity");

      const projectAfter = await registry.getProject(1n);
      const disputeAfter = await registry.getDispute(1n, 0n);
      const milestoneAfter = await registry.getMilestone(1n, 0n);
      const untrackedAfter = await registry.untrackedTokenBalance(
        await token.getAddress(),
      );

      expect(disputeBefore.active).to.equal(true);
      expect(disputeAfter.active).to.equal(true);
      expect(projectAfter.activeDisputeCount).to.equal(projectBefore.activeDisputeCount);
      expect(projectAfter.reservedAmount).to.equal(projectBefore.reservedAmount);
      expect(projectAfter.releasedAmount).to.equal(projectBefore.releasedAmount);
      expect(projectAfter.refundedAmount).to.equal(projectBefore.refundedAmount);
      expect(milestoneAfter.status).to.equal(milestoneBefore.status);
      expect(untrackedAfter).to.equal(untrackedBefore);
    });

    it("allows valid ReleaseToFreelancer resolution under solvency guard", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 450n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
      )
        .to.emit(registry, "DisputeResolved")
        .withArgs(
          1n,
          0n,
          await arb.getAddress(),
          Resolution.ReleaseToFreelancer,
          amount,
          0n,
        );
    });

    it("allows valid RefundToClient resolution under solvency guard", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 350n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount),
      )
        .to.emit(registry, "DisputeResolved")
        .withArgs(
          1n,
          0n,
          await arb.getAddress(),
          Resolution.RefundToClient,
          0n,
          amount,
        );
    });

    it("allows valid Split resolution under solvency guard", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 1_000n;
      const toFreelancer = 700n;
      const toClient = 300n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.Split, toFreelancer, toClient),
      )
        .to.emit(registry, "DisputeResolved")
        .withArgs(
          1n,
          0n,
          await arb.getAddress(),
          Resolution.Split,
          toFreelancer,
          toClient,
        );
    });

    it("reverts resolve with wrong amounts for ReleaseToFreelancer", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 100n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount - 1n, 0n),
      ).to.be.revertedWithCustomError(registry, "InvalidResolutionAmounts");
    });

    it("reverts split when parts do not sum to milestone amount", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 100n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await expect(
        registry.connect(arb).resolveDispute(1n, 0n, Resolution.Split, 40n, 50n),
      ).to.be.revertedWithCustomError(registry, "InvalidSplitAmounts");
    });

    it("reverts split when a leg is zero", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 100n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await expect(
        registry.connect(arb).resolveDispute(1n, 0n, Resolution.Split, amount, 0n),
      ).to.be.revertedWithCustomError(registry, "InvalidSplitAmounts");
    });

    it("reverts second raiseDispute on the same milestone", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 80n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await expect(
        registry.connect(freelancer).raiseDispute(1n, 0n, "ipfs://d2"),
      ).to.be.revertedWithCustomError(registry, "DisputeAlreadyActive");
    });

    it("reverts resolveDispute when no dispute is open", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 60n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");

      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
      ).to.be.revertedWithCustomError(registry, "DisputeNotActive");
    });

    it("reverts resolution from non-arbitrator", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 50n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await expect(
        registry
          .connect(client)
          .resolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("reverts raiseDispute and resolveDispute while paused, then allows resolveDispute after unpause", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 120n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await registry.connect(admin).pause();

      await expect(
        registry.connect(freelancer).raiseDispute(1n, 0n, "ipfs://again"),
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");

      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");

      await registry.connect(admin).unpause();
      await registry
        .connect(arb)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);

      const d = await registry.getDispute(1n, 0n);
      expect(d.active).to.equal(false);
      expect(d.lastAppendedEvidenceURI).to.equal("");
    });

    it("allows client timeout fallback only for stale Pending (deadline) disputes", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 120n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await expect(
        registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n),
      ).to.be.revertedWithCustomError(registry, "DisputeTimeoutNotReached");

      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n))
        .to.emit(registry, "DisputeResolved")
        .withArgs(1n, 0n, await client.getAddress(), Resolution.RefundToClient, 0n, amount);
    });

    it("reverts stale timeout while paused and succeeds after unpause", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 120n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await registry.connect(admin).pause();
      await expect(
        registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n),
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");

      await registry.connect(admin).unpause();
      await expect(registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n))
        .to.emit(registry, "DisputeResolved")
        .withArgs(1n, 0n, await client.getAddress(), Resolution.RefundToClient, 0n, amount);
    });

    it("reverts stale timeout refund when project solvency would exceed fundedAmount", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 120n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      // Test-only storage shaping: force fundedAmount below stale-timeout refund amount.
      await setProjectFundedAmountForTest(registry, 1n, amount - 1n);

      await expect(
        registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n),
      ).to.be.revertedWithCustomError(registry, "InsufficientEscrowLiquidity");
    });

    it("keeps dispute/accounting unchanged when stale timeout refund fails solvency check", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 120n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");
      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);
      await setProjectFundedAmountForTest(registry, 1n, amount - 1n);

      const projectBefore = await registry.getProject(1n);
      const disputeBefore = await registry.getDispute(1n, 0n);
      const milestoneBefore = await registry.getMilestone(1n, 0n);
      const untrackedBefore = await registry.untrackedTokenBalance(
        await token.getAddress(),
      );

      await expect(
        registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n),
      ).to.be.revertedWithCustomError(registry, "InsufficientEscrowLiquidity");

      const projectAfter = await registry.getProject(1n);
      const disputeAfter = await registry.getDispute(1n, 0n);
      const milestoneAfter = await registry.getMilestone(1n, 0n);
      const untrackedAfter = await registry.untrackedTokenBalance(
        await token.getAddress(),
      );

      expect(disputeBefore.active).to.equal(true);
      expect(disputeAfter.active).to.equal(true);
      expect(projectAfter.activeDisputeCount).to.equal(projectBefore.activeDisputeCount);
      expect(projectAfter.reservedAmount).to.equal(projectBefore.reservedAmount);
      expect(projectAfter.refundedAmount).to.equal(projectBefore.refundedAmount);
      expect(projectAfter.releasedAmount).to.equal(projectBefore.releasedAmount);
      expect(milestoneAfter.status).to.equal(milestoneBefore.status);
      expect(untrackedAfter).to.equal(untrackedBefore);
    });

    it("stale timeout on milestone 0 does not block alternative client flow on milestone 1", async function () {
      const [admin, arb, client, freelancer, altClient] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const Blacklist = await ethers.getContractFactory("BlacklistStablecoin");
      const token = await Blacklist.connect(admin).deploy(await admin.getAddress());
      await token.waitForDeployment();
      await registry.connect(admin).attestTokenReviewForAllowlist(await token.getAddress());
      await registry.connect(admin).setAllowedToken(await token.getAddress(), true);

      const m0 = 300n;
      const m1 = 200n;
      const total = m0 + m1;
      await token.connect(admin).mint(await client.getAddress(), total * 2n);

      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const past = BigInt(now - 10);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(m0, past),
          milestone(m1, past),
        ]);
      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, total);

      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d0");
      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);
      await registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n);

      await registry.connect(client).raiseDispute(1n, 1n, "ipfs://d1");
      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 1n, false, await altClient.getAddress());
      const delay = await registry.ALTERNATIVE_RECIPIENT_DELAY();
      await ethers.provider.send("evm_increaseTime", [Number(delay) + 1]);
      await ethers.provider.send("evm_mine", []);
      await registry.connect(client).executeAlternativeRecipient(1n, 1n, false);
      await token.connect(admin).setBlacklisted(await client.getAddress(), true);
      await registry.connect(arb).resolveDispute(1n, 1n, Resolution.RefundToClient, 0n, m1);
      expect(await token.balanceOf(await altClient.getAddress())).to.equal(m1);
    });

    it("stale timeout does not auto-execute matured pending freelancer recipient and clears pending storage after settlement", async function () {
      const [admin, arb, client, freelancer, altFreelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 150n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());
      const freelancerPendingSlot = await findPendingAlternativeMappingSlot(
        registry,
        1n,
        0n,
        await altFreelancer.getAddress(),
      );
      await ethers.provider.send("evm_increaseTime", [48 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      expect(
        await getPendingAlternativeRecipientForTest(
          registry,
          1n,
          0n,
          freelancerPendingSlot,
        ),
      ).to.equal(await altFreelancer.getAddress());

      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n))
        .to.not.emit(registry, "AlternativeRecipientExecuted");

      // Pending alt recipient is cleared on settlement cleanup.
      expect(
        await getPendingAlternativeRecipientForTest(
          registry,
          1n,
          0n,
          freelancerPendingSlot,
        ),
      ).to.equal(ethers.ZeroAddress);
    });

    it("pending client alternative recipient does not block stale timeout and is ignored unless executed", async function () {
      const [admin, arb, client, freelancer, altClient] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 140n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 0n, false, await altClient.getAddress());
      const clientPendingSlot = await findPendingAlternativeMappingSlot(
        registry,
        1n,
        0n,
        await altClient.getAddress(),
      );
      await ethers.provider.send("evm_increaseTime", [48 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);
      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      const clientBefore = await token.balanceOf(await client.getAddress());
      const altBefore = await token.balanceOf(await altClient.getAddress());
      await expect(
        registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n),
      ).to.not.emit(registry, "AlternativeRecipientExecuted");
      expect(await token.balanceOf(await client.getAddress())).to.equal(clientBefore + amount);
      expect(await token.balanceOf(await altClient.getAddress())).to.equal(altBefore);
      expect(
        await getPendingAlternativeRecipientForTest(registry, 1n, 0n, clientPendingSlot),
      ).to.equal(ethers.ZeroAddress);
    });

    describe("regression: resolveStaleDisputeByTimeout cannot freeze on unexecuted pending client alternative recipient", function () {
      // `resolveStaleDisputeByTimeout` pays via `_clientRecipient` and ends with `_clearAlternativeRecipients`;
      // it must not auto-execute pending alts (no `AlternativeRecipientExecuted`) and the codebase must not
      // rely on `_materializeExecutablePendingAlternativeRecipient` (absent from EscrowFlowRegistry).

      const DISPUTE_TIMEOUT_SECONDS = 30 * 24 * 60 * 60;
      const ALT_DELAY_PLUS_BUFFER = 48 * 60 * 60 + 1;

      it("past-deadline Pending dispute: unexecuted pending client alt; after both delays stale timeout refunds client, clears pending, correct accounting, no execute emit", async function () {
        const [admin, arb, client, freelancer, altPending] = await ethers.getSigners();
        const registry = await deployRegistryWithArb(admin, arb);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 821n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        const pastDeadline = BigInt(now - 10);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, pastDeadline),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);

        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");
        await registry
          .connect(arb)
          .setAlternativeRecipient(1n, 0n, false, await altPending.getAddress());
        const clientPendingSlot = await findPendingAlternativeMappingSlot(
          registry,
          1n,
          0n,
          await altPending.getAddress(),
        );

        await ethers.provider.send("evm_increaseTime", [ALT_DELAY_PLUS_BUFFER]);
        await ethers.provider.send("evm_mine", []);
        await ethers.provider.send("evm_increaseTime", [DISPUTE_TIMEOUT_SECONDS + 1]);
        await ethers.provider.send("evm_mine", []);

        const pBefore = await registry.getProject(1n);
        expect(pBefore.activeDisputeCount).to.equal(1n);
        expect(pBefore.reservedAmount).to.equal(amount);
        expect(pBefore.refundedAmount).to.equal(0n);

        const clientBefore = await token.balanceOf(await client.getAddress());
        const altBefore = await token.balanceOf(await altPending.getAddress());

        await expect(registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n))
          .to.emit(registry, "DisputeResolved")
          .withArgs(1n, 0n, await client.getAddress(), Resolution.RefundToClient, 0n, amount)
          .and.to.not.emit(registry, "AlternativeRecipientExecuted");

        expect(await token.balanceOf(await client.getAddress())).to.equal(clientBefore + amount);
        expect(await token.balanceOf(await altPending.getAddress())).to.equal(altBefore);
        expect(
          await getPendingAlternativeRecipientForTest(registry, 1n, 0n, clientPendingSlot),
        ).to.equal(ethers.ZeroAddress);

        const pAfter = await registry.getProject(1n);
        expect(pAfter.activeDisputeCount).to.equal(0n);
        expect(pAfter.reservedAmount).to.equal(0n);
        expect(pAfter.refundedAmount).to.equal(pBefore.refundedAmount + amount);
        expect((await registry.getMilestone(1n, 0n)).status).to.equal(MS.Refunded);

        await assertProjectCoreInvariants(registry, 1n);
        await assertTokenLiabilityInvariant(registry, token, 1n);
      });

      it("stale timeout refund prefers milestone party-authorized client over unexecuted pending arbitrator alt", async function () {
        const [admin, arb, client, freelancer, altParty, altPending] = await ethers.getSigners();
        const registry = await deployRegistryWithArb(admin, arb);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 822n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        const pastDeadline = BigInt(now - 10);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, pastDeadline),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);

        await registry
          .connect(client)
          .setPartyAuthorizedRecipient(1n, 0n, false, await altParty.getAddress());
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");
        await registry
          .connect(arb)
          .setAlternativeRecipient(1n, 0n, false, await altPending.getAddress());

        await ethers.provider.send("evm_increaseTime", [ALT_DELAY_PLUS_BUFFER]);
        await ethers.provider.send("evm_mine", []);
        await ethers.provider.send("evm_increaseTime", [DISPUTE_TIMEOUT_SECONDS + 1]);
        await ethers.provider.send("evm_mine", []);

        await expect(
          registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n),
        ).to.not.emit(registry, "AlternativeRecipientExecuted");

        expect(await token.balanceOf(await altParty.getAddress())).to.equal(amount);
        expect(await token.balanceOf(await altPending.getAddress())).to.equal(0n);
        await assertProjectCoreInvariants(registry, 1n);
        await assertTokenLiabilityInvariant(registry, token, 1n);
      });

      it("stale timeout refund prefers project-wide party-authorized client when milestone party slot empty", async function () {
        const [admin, arb, client, freelancer, altWide, altPending] = await ethers.getSigners();
        const registry = await deployRegistryWithArb(admin, arb);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 823n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        const pastDeadline = BigInt(now - 10);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, pastDeadline),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);

        await registry
          .connect(client)
          .setPartyAuthorizedRecipient(
            1n,
            PROJECT_WIDE_RECIPIENT_SCOPE,
            false,
            await altWide.getAddress(),
          );
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");
        await registry
          .connect(arb)
          .setAlternativeRecipient(1n, 0n, false, await altPending.getAddress());

        await ethers.provider.send("evm_increaseTime", [ALT_DELAY_PLUS_BUFFER]);
        await ethers.provider.send("evm_mine", []);
        await ethers.provider.send("evm_increaseTime", [DISPUTE_TIMEOUT_SECONDS + 1]);
        await ethers.provider.send("evm_mine", []);

        await expect(
          registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n),
        ).to.not.emit(registry, "AlternativeRecipientExecuted");

        expect(await token.balanceOf(await altWide.getAddress())).to.equal(amount);
        expect(await token.balanceOf(await altPending.getAddress())).to.equal(0n);
        await assertProjectCoreInvariants(registry, 1n);
        await assertTokenLiabilityInvariant(registry, token, 1n);
      });

      it("stale timeout refund uses executed arbitrator client recipient when party-authorized unset", async function () {
        const [admin, arb, client, freelancer, altExec] = await ethers.getSigners();
        const registry = await deployRegistryWithArb(admin, arb);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 824n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        const pastDeadline = BigInt(now - 10);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, pastDeadline),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);

        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");
        await registry
          .connect(arb)
          .setAlternativeRecipient(1n, 0n, false, await altExec.getAddress());
        await ethers.provider.send("evm_increaseTime", [ALT_DELAY_PLUS_BUFFER]);
        await ethers.provider.send("evm_mine", []);
        await registry.connect(client).executeAlternativeRecipient(1n, 0n, false);

        await ethers.provider.send("evm_increaseTime", [DISPUTE_TIMEOUT_SECONDS + 1]);
        await ethers.provider.send("evm_mine", []);

        const clientBefore = await token.balanceOf(await client.getAddress());
        await expect(
          registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n),
        ).to.not.emit(registry, "AlternativeRecipientExecuted");

        expect(await token.balanceOf(await altExec.getAddress())).to.equal(amount);
        expect(await token.balanceOf(await client.getAddress())).to.equal(clientBefore);
        await assertProjectCoreInvariants(registry, 1n);
        await assertTokenLiabilityInvariant(registry, token, 1n);
      });
    });

    it("reverts stale timeout when dispute is on Submitted work", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 120n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n),
      ).to.be.revertedWithCustomError(registry, "StaleDisputeTimeoutOnlyForPendingMilestone");
    });

    it("reverts stale timeout when dispute is on Approved milestone", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 120n;
      await token.connect(admin).mint(await client.getAddress(), amount * 10n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).approveMilestone(1n, 0n);
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n),
      ).to.be.revertedWithCustomError(registry, "StaleDisputeTimeoutOnlyForPendingMilestone");
    });

    it("still allows further funding while a milestone is disputed", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const m0 = 400_000n;
      const m1 = 600_000n;
      const total = m0 + m1;
      await token.connect(admin).mint(await client.getAddress(), total * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(m0, 1n),
          milestone(m1, 2n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, m0);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://a");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await registry.connect(client).fundProject(1n, m1);
      expect(await registry.getProject(1n).then((p) => p.fundedAmount)).to.equal(total);
    });

    it("reverts submit on later milestone while previous is unresolved", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const m0 = 400_000n;
      const m1 = 600_000n;
      const total = m0 + m1;
      await token.connect(admin).mint(await client.getAddress(), total * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(m0, 1n),
          milestone(m1, 2n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, total);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://a");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await expect(
        registry.connect(freelancer).submitMilestone(1n, 1n, "ipfs://b"),
      ).to.be.revertedWithCustomError(registry, "PreviousMilestoneNotCompleted");
    });

    it("tracks project status through disputed -> active -> completed", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistryWithArb(admin, arb);
      const token = await deployAndAllowMock(registry, admin, admin);
      const m0 = 300n;
      const m1 = 700n;
      const total = m0 + m1;
      await token.connect(admin).mint(await client.getAddress(), total * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(m0, 1n),
          milestone(m1, 2n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, total);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://m0");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d0");

      expect((await registry.getProject(1n)).status).to.equal(1); // Disputed

      await registry
        .connect(arb)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, m0, 0n);
      expect((await registry.getProject(1n)).status).to.equal(0); // Active

      await registry.connect(freelancer).submitMilestone(1n, 1n, "ipfs://m1");
      await registry.connect(client).approveMilestone(1n, 1n);
      await registry.connect(client).releaseMilestone(1n, 1n);
      expect((await registry.getProject(1n)).status).to.equal(2); // Completed
    });

    it("enforces role separation between admin/pauser and arbitrator", async function () {
      const [admin, arb] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await expect(
        registry.connect(admin).grantRole(ARBITRATOR_ROLE, await admin.getAddress()),
      ).to.be.revertedWithCustomError(registry, "RoleSeparationViolation");

      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const PAUSER_ROLE = await registry.PAUSER_ROLE();
      await expect(
        registry
          .connect(admin)
          .grantRole(PAUSER_ROLE, await arb.getAddress()),
      ).to.be.revertedWithCustomError(registry, "RoleSeparationViolation");
    });

    it("allows revokeRole on arbitrator and enforces invariant after renounceRole", async function () {
      const [admin, arb, other] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      const PAUSER_ROLE = await registry.PAUSER_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      await registry.connect(admin).revokeRole(ARBITRATOR_ROLE, await arb.getAddress());
      expect(await registry.hasRole(ARBITRATOR_ROLE, await arb.getAddress())).to.equal(false);

      await registry.connect(admin).grantRole(PAUSER_ROLE, await other.getAddress());
      await registry.connect(admin).renounceRole(PAUSER_ROLE, await admin.getAddress());
      expect(await registry.hasRole(PAUSER_ROLE, await admin.getAddress())).to.equal(false);
      const defaultAdminRole = await registry.DEFAULT_ADMIN_ROLE();
      expect(await registry.hasRole(defaultAdminRole, await admin.getAddress())).to.equal(true);
    });

    it("clamps threshold when revoking from 2 arbitrators at threshold 2", async function () {
      const [admin, arb1, arb2] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb1.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb2.getAddress());
      await registry.connect(admin).setArbitratorThreshold(2n);

      await expect(
        registry.connect(admin).revokeRole(ARBITRATOR_ROLE, await arb2.getAddress()),
      )
        .to.emit(registry, "ArbitratorThresholdUpdated")
        .withArgs(2n, 1n, await admin.getAddress());

      expect(await registry.arbitratorCount()).to.equal(1n);
      expect(await registry.arbitratorThreshold()).to.equal(1n);
      expect(await registry.hasRole(ARBITRATOR_ROLE, await arb2.getAddress())).to.equal(false);
    });

    it("keeps threshold at 1 when revoking last arbitrator", async function () {
      const [admin, arb] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      expect(await registry.arbitratorCount()).to.equal(1n);
      expect(await registry.arbitratorThreshold()).to.equal(1n);

      await registry.connect(admin).revokeRole(ARBITRATOR_ROLE, await arb.getAddress());

      expect(await registry.arbitratorCount()).to.equal(0n);
      expect(await registry.arbitratorThreshold()).to.equal(1n);
      expect(await registry.hasRole(ARBITRATOR_ROLE, await arb.getAddress())).to.equal(false);
    });

    it("revoking a non-arbitrator does not change arbitrator count or threshold", async function () {
      const [admin, arb, nonArb] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());

      const countBefore = await registry.arbitratorCount();
      const thresholdBefore = await registry.arbitratorThreshold();
      await registry.connect(admin).revokeRole(ARBITRATOR_ROLE, await nonArb.getAddress());

      expect(await registry.arbitratorCount()).to.equal(countBefore);
      expect(await registry.arbitratorThreshold()).to.equal(thresholdBefore);
      expect(await registry.hasRole(ARBITRATOR_ROLE, await nonArb.getAddress())).to.equal(false);
    });

    it("requires M-of-N arbitrator confirmations to resolve dispute when threshold is raised", async function () {
      const [admin, arb1, arb2, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb1.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb2.getAddress());
      await registry.connect(admin).setArbitratorThreshold(2n);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 200n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await registry
        .connect(arb1)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      const stillActive = await registry.getDispute(1n, 0n);
      expect(stillActive.active).to.equal(true);

      await expect(
        registry
          .connect(arb2)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
      )
        .to.emit(registry, "DisputeResolved")
        .withArgs(
          1n,
          0n,
          await arb2.getAddress(),
          Resolution.ReleaseToFreelancer,
          amount,
          0n,
        );
    });

    it("invalidates prior approval when threshold changes before second vote", async function () {
      const [admin, arb1, arb2, arb3, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb1.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb2.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb3.getAddress());
      await registry.connect(admin).setArbitratorThreshold(2n);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 220n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      // First approval recorded under 2-of-2, action not yet executed.
      await registry
        .connect(arb1)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      let d = await registry.getDispute(1n, 0n);
      expect(d.active).to.equal(true);

      // Change threshold (config nonce bump): previous approval must be invalidated.
      await registry.connect(admin).setArbitratorThreshold(3n);

      // arb2 vote is first vote in the new domain, so action stays unresolved.
      await registry
        .connect(arb2)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      d = await registry.getDispute(1n, 0n);
      expect(d.active).to.equal(true);
    });

    it("invalidates prior approval when an arbitrator is revoked before second vote", async function () {
      const [admin, arb1, arb2, arb3, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb1.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb2.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb3.getAddress());
      await registry.connect(admin).setArbitratorThreshold(2n);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 210n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await registry
        .connect(arb1)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      await registry.connect(admin).revokeRole(ARBITRATOR_ROLE, await arb1.getAddress());
      await registry
        .connect(arb2)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);

      const d = await registry.getDispute(1n, 0n);
      expect(d.active).to.equal(true);
    });

    it("invalidates prior approval when a new arbitrator is added before second vote", async function () {
      const [admin, arb1, arb2, arb3, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb1.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb2.getAddress());
      await registry.connect(admin).setArbitratorThreshold(2n);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 230n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await registry
        .connect(arb1)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb3.getAddress());
      await registry
        .connect(arb2)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);

      const d = await registry.getDispute(1n, 0n);
      expect(d.active).to.equal(true);
    });

    it("invalidates prior approval when an arbitrator renounces before second vote", async function () {
      const [admin, arb1, arb2, arb3, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb1.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb2.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb3.getAddress());
      await registry.connect(admin).setArbitratorThreshold(2n);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 240n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await registry
        .connect(arb1)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      await registry
        .connect(arb1)
        .renounceRole(ARBITRATOR_ROLE, await arb1.getAddress());
      await registry
        .connect(arb2)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);

      const d = await registry.getDispute(1n, 0n);
      expect(d.active).to.equal(true);
    });

    describe("project-wide party-authorized recipient precedence", function () {
      it("resolveDispute ReleaseToFreelancer prefers project-wide party-authorized over executed arbitrator alt", async function () {
        const [admin, arb, client, freelancer, altArb, altParty] = await ethers.getSigners();
        const registry = await deployRegistryWithArb(admin, arb);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 501n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        await registry
          .connect(arb)
          .setAlternativeRecipient(1n, 0n, true, await altArb.getAddress());
        const delay = await registry.ALTERNATIVE_RECIPIENT_DELAY();
        await ethers.provider.send("evm_increaseTime", [Number(delay) + 1]);
        await ethers.provider.send("evm_mine", []);
        await registry.connect(freelancer).executeAlternativeRecipient(1n, 0n, true);

        await registry
          .connect(freelancer)
          .setPartyAuthorizedRecipient(
            1n,
            PROJECT_WIDE_RECIPIENT_SCOPE,
            true,
            await altParty.getAddress(),
          );

        await expect(
          registry
            .connect(arb)
            .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
        )
          .to.emit(registry, "DisputePayoutRecipients")
          .withArgs(1n, 0n, await altParty.getAddress(), await client.getAddress());

        expect(await token.balanceOf(await altParty.getAddress())).to.equal(amount);
        expect(await token.balanceOf(await altArb.getAddress())).to.equal(0n);
      });

      it("resolveDispute RefundToClient prefers project-wide party-authorized over executed arbitrator alt", async function () {
        const [admin, arb, client, freelancer, altArb, altParty] = await ethers.getSigners();
        const registry = await deployRegistryWithArb(admin, arb);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 502n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).raiseDispute(1n, 0n, "ipfs://d");

        await registry
          .connect(arb)
          .setAlternativeRecipient(1n, 0n, false, await altArb.getAddress());
        const delay = await registry.ALTERNATIVE_RECIPIENT_DELAY();
        await ethers.provider.send("evm_increaseTime", [Number(delay) + 1]);
        await ethers.provider.send("evm_mine", []);
        await registry.connect(client).executeAlternativeRecipient(1n, 0n, false);

        await registry
          .connect(client)
          .setPartyAuthorizedRecipient(
            1n,
            PROJECT_WIDE_RECIPIENT_SCOPE,
            false,
            await altParty.getAddress(),
          );

        await registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount);

        expect(await token.balanceOf(await altParty.getAddress())).to.equal(amount);
        expect(await token.balanceOf(await altArb.getAddress())).to.equal(0n);
      });

      it("resolveStaleDisputeByTimeout refunds to project-wide party-authorized client", async function () {
        const [admin, arb, client, freelancer, altClient] = await ethers.getSigners();
        const registry = await deployRegistryWithArb(admin, arb);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 503n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry
          .connect(client)
          .setPartyAuthorizedRecipient(
            1n,
            PROJECT_WIDE_RECIPIENT_SCOPE,
            false,
            await altClient.getAddress(),
          );
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
        await ethers.provider.send("evm_mine", []);

        await registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n);
        expect(await token.balanceOf(await altClient.getAddress())).to.equal(amount);
      });

      it("resolveDispute Split uses project-wide party-authorized recipients for both legs", async function () {
        const [admin, arb, client, freelancer, altF, altC] = await ethers.getSigners();
        const registry = await deployRegistryWithArb(admin, arb);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 1_000n;
        const toFree = 610n;
        const toClient = 390n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        await registry
          .connect(freelancer)
          .setPartyAuthorizedRecipient(
            1n,
            PROJECT_WIDE_RECIPIENT_SCOPE,
            true,
            await altF.getAddress(),
          );
        await registry
          .connect(client)
          .setPartyAuthorizedRecipient(
            1n,
            PROJECT_WIDE_RECIPIENT_SCOPE,
            false,
            await altC.getAddress(),
          );

        await registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.Split, toFree, toClient);

        expect(await token.balanceOf(await altF.getAddress())).to.equal(toFree);
        expect(await token.balanceOf(await altC.getAddress())).to.equal(toClient);
      });

      it("resolveDispute RefundToClient prefers milestone-specific party-authorized client over project-wide", async function () {
        const [admin, arb, client, freelancer, altWide, altMilestone] = await ethers.getSigners();
        const registry = await deployRegistryWithArb(admin, arb);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 504n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).raiseDispute(1n, 0n, "ipfs://d");

        await registry
          .connect(client)
          .setPartyAuthorizedRecipient(
            1n,
            PROJECT_WIDE_RECIPIENT_SCOPE,
            false,
            await altWide.getAddress(),
          );
        await registry
          .connect(client)
          .setPartyAuthorizedRecipient(1n, 0n, false, await altMilestone.getAddress());

        await registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount);

        expect(await token.balanceOf(await altMilestone.getAddress())).to.equal(amount);
        expect(await token.balanceOf(await altWide.getAddress())).to.equal(0n);
      });

      it("emergencyResolveDispute ReleaseToFreelancer pays project-wide party-authorized freelancer", async function () {
        const [admin, arb, client, freelancer, altF] = await ethers.getSigners();
        const registry = await deployRegistryWithArb(admin, arb);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 505n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        await registry
          .connect(freelancer)
          .setPartyAuthorizedRecipient(
            1n,
            PROJECT_WIDE_RECIPIENT_SCOPE,
            true,
            await altF.getAddress(),
          );

        await registry
          .connect(admin)
          .proposeEmergencyResolveDispute(
            1n,
            0n,
            Resolution.ReleaseToFreelancer,
            amount,
            0n,
          );
        await ethers.provider.send("evm_increaseTime", [86400 + 1]);
        await ethers.provider.send("evm_mine", []);

        await registry
          .connect(admin)
          .emergencyResolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);

        expect(await token.balanceOf(await altF.getAddress())).to.equal(amount);
      });

      it("cancelProject stale Submitted auto-release pays project-wide party-authorized freelancer", async function () {
        const [admin, client, freelancer, altF] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 606n;
        const cancelTimeout = 14 * 24 * 60 * 60;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry
          .connect(freelancer)
          .setPartyAuthorizedRecipient(
            1n,
            PROJECT_WIDE_RECIPIENT_SCOPE,
            true,
            await altF.getAddress(),
          );
        await ethers.provider.send("evm_increaseTime", [cancelTimeout + 1]);
        await ethers.provider.send("evm_mine", []);
        await registry.connect(client).cancelProject(1n);
        expect(await token.balanceOf(await altF.getAddress())).to.equal(amount);
      });
    });
  });

  describe("admin hardening", function () {
    it("sweeps only untracked token balance and never project liabilities", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const escrowAmount = 1_000n;
      const accidentalAmount = 300n;

      await token.connect(admin).mint(await client.getAddress(), escrowAmount * 2n);
      await token.connect(admin).mint(await admin.getAddress(), accidentalAmount);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(escrowAmount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), escrowAmount);
      await registry.connect(client).fundProject(1n, escrowAmount);

      await token
        .connect(admin)
        .transfer(await registry.getAddress(), accidentalAmount);

      expect(await registry.untrackedTokenBalance(await token.getAddress())).to.equal(
        accidentalAmount,
      );

      await registry
        .connect(admin)
        .sweepUntrackedToken(await token.getAddress(), await admin.getAddress(), 200n);
      expect(await registry.untrackedTokenBalance(await token.getAddress())).to.equal(100n);

      await expect(
        registry
          .connect(admin)
          .sweepUntrackedToken(await token.getAddress(), await admin.getAddress(), 101n),
      ).to.be.revertedWithCustomError(registry, "InsufficientUntrackedBalance");
    });

    it("tracks untracked balance correctly across multiple projects for same token", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const p1 = 700n;
      const p2 = 500n;
      const accidental = 80n;

      await token.connect(admin).mint(await client.getAddress(), (p1 + p2) * 2n);
      await token.connect(admin).mint(await admin.getAddress(), accidental);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(p1, 1n),
        ]);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(p2, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), p1 + p2);
      await registry.connect(client).fundProject(1n, p1);
      await registry.connect(client).fundProject(2n, p2);

      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://p1");
      await registry.connect(client).approveMilestone(1n, 0n);
      await registry.connect(client).releaseMilestone(1n, 0n);

      await token.connect(admin).transfer(await registry.getAddress(), accidental);
      expect(await registry.untrackedTokenBalance(await token.getAddress())).to.equal(accidental);
    });

    it("supports alternative freelancer recipient for blacklisted payouts", async function () {
      const [admin, arb, client, freelancer, altFreelancer] =
        await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const Blacklist = await ethers.getContractFactory("BlacklistStablecoin");
      const token = await Blacklist.connect(admin).deploy(await admin.getAddress());
      await token.waitForDeployment();
      await registry
        .connect(admin)
        .attestTokenReviewForAllowlist(await token.getAddress());
      await registry
        .connect(admin)
        .setAllowedToken(await token.getAddress(), true);

      const amount = 500n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      await registry.connect(client).approveMilestone(1n, 0n);
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://blacklist");

      await token.connect(admin).setBlacklisted(await freelancer.getAddress(), true);
      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
      ).to.be.revertedWithCustomError(registry, "TokenTransferFailed");

      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());
      const delay = await registry.ALTERNATIVE_RECIPIENT_DELAY();
      await ethers.provider.send("evm_increaseTime", [Number(delay) + 1]);
      await ethers.provider.send("evm_mine", []);
      await registry.connect(freelancer).executeAlternativeRecipient(1n, 0n, true);
      await registry
        .connect(arb)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      expect(await token.balanceOf(await altFreelancer.getAddress())).to.equal(amount);
    });

    it("supports alternative client recipient for blacklisted refunds", async function () {
      const [admin, arb, client, freelancer, altClient] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const Blacklist = await ethers.getContractFactory("BlacklistStablecoin");
      const token = await Blacklist.connect(admin).deploy(await admin.getAddress());
      await token.waitForDeployment();
      await registry
        .connect(admin)
        .attestTokenReviewForAllowlist(await token.getAddress());
      await registry
        .connect(admin)
        .setAllowedToken(await token.getAddress(), true);

      const amount = 500n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await token.connect(admin).setBlacklisted(await client.getAddress(), true);
      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount),
      ).to.be.revertedWithCustomError(registry, "TokenTransferFailed");

      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 0n, false, await altClient.getAddress());
      const delay = await registry.ALTERNATIVE_RECIPIENT_DELAY();
      await ethers.provider.send("evm_increaseTime", [Number(delay) + 1]);
      await ethers.provider.send("evm_mine", []);
      await registry.connect(client).executeAlternativeRecipient(1n, 0n, false);
      await registry
        .connect(arb)
        .resolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount);
      expect(await token.balanceOf(await altClient.getAddress())).to.equal(amount);
    });

    it("reverts alternative recipient updates when no dispute is active", async function () {
      const [admin, arb, client, freelancer, altFreelancer] =
        await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 100n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);

      await expect(
        registry
          .connect(arb)
          .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress()),
      ).to.be.revertedWithCustomError(registry, "DisputeNotActive");
    });

    it("reverts setAlternativeRecipient while paused and allows it again after unpause", async function () {
      const [admin, arb, client, freelancer, altFreelancer] =
        await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      await registry.connect(admin).setArbitratorThreshold(1n);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 220n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await registry.connect(admin).pause();
      await expect(
        registry
          .connect(arb)
          .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress()),
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");

      await registry.connect(admin).unpause();
      await expect(
        registry
          .connect(arb)
          .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress()),
      )
        .to.emit(registry, "AlternativeRecipientSet")
        .withArgs(
          1n,
          0n,
          true,
          await altFreelancer.getAddress(),
          anyValue,
          await arb.getAddress(),
        );
    });

    it("blocks dispute resolution while alternative recipient change is pending", async function () {
      const [admin, arb, client, freelancer, altFreelancer] =
        await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const Blacklist = await ethers.getContractFactory("BlacklistStablecoin");
      const token = await Blacklist.connect(admin).deploy(await admin.getAddress());
      await token.waitForDeployment();
      await registry.connect(admin).attestTokenReviewForAllowlist(await token.getAddress());
      await registry.connect(admin).setAllowedToken(await token.getAddress(), true);

      const amount = 250n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");
      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());

      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
      ).to.be.revertedWithCustomError(registry, "AlternativeRecipientChangePending");
    });

    it("does not block ReleaseToFreelancer after recipient delay; ignores unexecuted pending recipient", async function () {
      const [admin, arb, client, freelancer, altFreelancer] =
        await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 260n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");
      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());
      const pendingSlot = await findPendingAlternativeMappingSlot(
        registry,
        1n,
        0n,
        await altFreelancer.getAddress(),
      );
      const delay = await registry.ALTERNATIVE_RECIPIENT_DELAY();
      await ethers.provider.send("evm_increaseTime", [Number(delay) + 1]);
      await ethers.provider.send("evm_mine", []);

      const freelancerBefore = await token.balanceOf(await freelancer.getAddress());
      const altBefore = await token.balanceOf(await altFreelancer.getAddress());
      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
      ).to.not.emit(registry, "AlternativeRecipientExecuted");

      expect(await token.balanceOf(await freelancer.getAddress())).to.equal(
        freelancerBefore + amount,
      );
      expect(await token.balanceOf(await altFreelancer.getAddress())).to.equal(altBefore);
      expect(await getPendingAlternativeRecipientForTest(registry, 1n, 0n, pendingSlot)).to.equal(
        ethers.ZeroAddress,
      );
    });

    it("does not block RefundToClient after recipient delay; ignores unexecuted pending recipient", async function () {
      const [admin, arb, client, freelancer, altClient] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 260n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");
      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 0n, false, await altClient.getAddress());
      const pendingSlot = await findPendingAlternativeMappingSlot(
        registry,
        1n,
        0n,
        await altClient.getAddress(),
      );
      const delay = await registry.ALTERNATIVE_RECIPIENT_DELAY();
      await ethers.provider.send("evm_increaseTime", [Number(delay) + 1]);
      await ethers.provider.send("evm_mine", []);

      const clientBefore = await token.balanceOf(await client.getAddress());
      const altBefore = await token.balanceOf(await altClient.getAddress());
      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount),
      ).to.not.emit(registry, "AlternativeRecipientExecuted");

      expect(await token.balanceOf(await client.getAddress())).to.equal(clientBefore + amount);
      expect(await token.balanceOf(await altClient.getAddress())).to.equal(altBefore);
      expect(await getPendingAlternativeRecipientForTest(registry, 1n, 0n, pendingSlot)).to.equal(
        ethers.ZeroAddress,
      );
    });

    it("split resolution blocks before delay and succeeds after delay with both pending legs unexecuted", async function () {
      const [admin, arb, client, freelancer, altFreelancer, altClient] =
        await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 300n;
      const toFreelancer = 180n;
      const toClient = 120n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");
      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());
      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 0n, false, await altClient.getAddress());
      const pendingFreelancerSlot = await findPendingAlternativeMappingSlot(
        registry,
        1n,
        0n,
        await altFreelancer.getAddress(),
      );
      const pendingClientSlot = await findPendingAlternativeMappingSlot(
        registry,
        1n,
        0n,
        await altClient.getAddress(),
      );

      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.Split, toFreelancer, toClient),
      ).to.be.revertedWithCustomError(registry, "AlternativeRecipientChangePending");

      const delay = await registry.ALTERNATIVE_RECIPIENT_DELAY();
      await ethers.provider.send("evm_increaseTime", [Number(delay) + 1]);
      await ethers.provider.send("evm_mine", []);

      const freelancerBefore = await token.balanceOf(await freelancer.getAddress());
      const clientBefore = await token.balanceOf(await client.getAddress());
      const altFreelancerBefore = await token.balanceOf(await altFreelancer.getAddress());
      const altClientBefore = await token.balanceOf(await altClient.getAddress());
      await expect(
        registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.Split, toFreelancer, toClient),
      ).to.not.emit(registry, "AlternativeRecipientExecuted");

      expect(await token.balanceOf(await freelancer.getAddress())).to.equal(
        freelancerBefore + toFreelancer,
      );
      expect(await token.balanceOf(await client.getAddress())).to.equal(
        clientBefore + toClient,
      );
      expect(await token.balanceOf(await altFreelancer.getAddress())).to.equal(
        altFreelancerBefore,
      );
      expect(await token.balanceOf(await altClient.getAddress())).to.equal(altClientBefore);
      expect(
        await getPendingAlternativeRecipientForTest(
          registry,
          1n,
          0n,
          pendingFreelancerSlot,
        ),
      ).to.equal(ethers.ZeroAddress);
      expect(
        await getPendingAlternativeRecipientForTest(registry, 1n, 0n, pendingClientSlot),
      ).to.equal(ethers.ZeroAddress);
    });

    it("allows only corresponding project party to execute alternative recipient after delay", async function () {
      const [admin, arb, client, freelancer, outsider, altClient] =
        await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const Blacklist = await ethers.getContractFactory("BlacklistStablecoin");
      const token = await Blacklist.connect(admin).deploy(await admin.getAddress());
      await token.waitForDeployment();
      await registry.connect(admin).attestTokenReviewForAllowlist(await token.getAddress());
      await registry.connect(admin).setAllowedToken(await token.getAddress(), true);
      const amount = 180n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");
      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 0n, false, await altClient.getAddress());

      const delay = await registry.ALTERNATIVE_RECIPIENT_DELAY();
      await ethers.provider.send("evm_increaseTime", [Number(delay) + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        registry.connect(outsider).executeAlternativeRecipient(1n, 0n, false),
      ).to.be.revertedWithCustomError(registry, "NotProjectParty");

      await registry.connect(client).executeAlternativeRecipient(1n, 0n, false);
      await token.connect(admin).setBlacklisted(await client.getAddress(), true);
      await registry.connect(arb).resolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount);
      expect(await token.balanceOf(await altClient.getAddress())).to.equal(amount);
    });

    it("keeps another milestone's alternative client when resolving a different dispute first", async function () {
      const [admin, arb, client, freelancer, altClient] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const Blacklist = await ethers.getContractFactory("BlacklistStablecoin");
      const token = await Blacklist.connect(admin).deploy(await admin.getAddress());
      await token.waitForDeployment();
      await registry.connect(admin).attestTokenReviewForAllowlist(await token.getAddress());
      await registry.connect(admin).setAllowedToken(await token.getAddress(), true);

      const m0 = 300n;
      const m1 = 200n;
      const total = m0 + m1;
      await token.connect(admin).mint(await client.getAddress(), total * 2n);

      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const past = BigInt(now - 10);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(m0, past),
          milestone(m1, past),
        ]);
      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, total);

      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d0");
      await registry.connect(arb).resolveDispute(1n, 0n, Resolution.RefundToClient, 0n, m0);
      await registry.connect(client).raiseDispute(1n, 1n, "ipfs://d1");

      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 1n, false, await altClient.getAddress());
      const delay = await registry.ALTERNATIVE_RECIPIENT_DELAY();
      await ethers.provider.send("evm_increaseTime", [Number(delay) + 1]);
      await ethers.provider.send("evm_mine", []);
      await registry.connect(client).executeAlternativeRecipient(1n, 1n, false);

      await token.connect(admin).setBlacklisted(await client.getAddress(), true);
      await registry.connect(arb).resolveDispute(1n, 1n, Resolution.RefundToClient, 0n, m1);
      expect(await token.balanceOf(await altClient.getAddress())).to.equal(m1);
    });

    it("requires M-of-N arbitrator confirmations for alternative recipient changes", async function () {
      const [admin, arb1, arb2, client, freelancer, altFreelancer] =
        await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb1.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb2.getAddress());
      await registry.connect(admin).setArbitratorThreshold(2n);
      const Blacklist = await ethers.getContractFactory("BlacklistStablecoin");
      const token = await Blacklist.connect(admin).deploy(await admin.getAddress());
      await token.waitForDeployment();
      await registry.connect(admin).attestTokenReviewForAllowlist(await token.getAddress());
      await registry.connect(admin).setAllowedToken(await token.getAddress(), true);

      const amount = 260n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");
      await token.connect(admin).setBlacklisted(await freelancer.getAddress(), true);

      await registry
        .connect(arb1)
        .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());

      await registry
        .connect(arb2)
        .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());

      const delay = await registry.ALTERNATIVE_RECIPIENT_DELAY();
      await ethers.provider.send("evm_increaseTime", [Number(delay) + 1]);
      await ethers.provider.send("evm_mine", []);
      await registry.connect(freelancer).executeAlternativeRecipient(1n, 0n, true);

      await registry
        .connect(arb1)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      await registry
        .connect(arb2)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      expect(await token.balanceOf(await altFreelancer.getAddress())).to.equal(amount);
    });

    it("allows previously approving arbitrator to execute alternative recipient change after threshold is lowered", async function () {
      const [admin, arb1, arb2, client, freelancer, altFreelancer] =
        await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb1.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb2.getAddress());
      await registry.connect(admin).setArbitratorThreshold(2n);
      const Blacklist = await ethers.getContractFactory("BlacklistStablecoin");
      const token = await Blacklist.connect(admin).deploy(await admin.getAddress());
      await token.waitForDeployment();
      await registry.connect(admin).attestTokenReviewForAllowlist(await token.getAddress());
      await registry.connect(admin).setAllowedToken(await token.getAddress(), true);

      const amount = 260n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await registry
        .connect(arb1)
        .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());
      await registry.connect(admin).setArbitratorThreshold(1n);
      await registry.connect(admin).revokeRole(ARBITRATOR_ROLE, await arb2.getAddress());
      await registry
        .connect(arb1)
        .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());

      const delay = await registry.ALTERNATIVE_RECIPIENT_DELAY();
      await ethers.provider.send("evm_increaseTime", [Number(delay) + 1]);
      await ethers.provider.send("evm_mine", []);
      await registry.connect(freelancer).executeAlternativeRecipient(1n, 0n, true);
      await token.connect(admin).setBlacklisted(await freelancer.getAddress(), true);
      await registry
        .connect(arb1)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      expect(await token.balanceOf(await altFreelancer.getAddress())).to.equal(amount);
    });
  });

  describe("project cancellation", function () {
    it("allows client cancellation and refunds unreleased escrow liquidity", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);

      const m0 = 400n;
      const m1 = 600n;
      const total = m0 + m1;
      await token.connect(admin).mint(await client.getAddress(), total * 3n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(m0, 1n),
          milestone(m1, 2n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), total);
      await registry.connect(client).fundProject(1n, total);

      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://m0");
      await registry.connect(client).approveMilestone(1n, 0n);
      await registry.connect(client).releaseMilestone(1n, 0n);

      const before = await token.balanceOf(await client.getAddress());
      await expect(registry.connect(client).cancelProject(1n))
        .to.emit(registry, "ProjectCancelled")
        .withArgs(1n, await client.getAddress(), await token.getAddress(), m1);

      expect(await token.balanceOf(await client.getAddress())).to.equal(before + m1);

      const p = await registry.getProject(1n);
      expect(p.status).to.equal(3); // Cancelled
      expect(p.refundedAmount).to.equal(m1);
    });

    it("reverts cancellation when a milestone is under review", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 500n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");

      await expect(
        registry.connect(client).cancelProject(1n),
      ).to.be.revertedWithCustomError(registry, "CannotCancelWithInReviewMilestone");
    });

    it("reverts cancellation when an active dispute exists", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 500n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);

      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://dispute");

      await expect(
        registry.connect(client).cancelProject(1n),
      ).to.be.revertedWithCustomError(registry, "CannotCancelWithActiveDispute");
    });
  });

  describe("audit fixes (N-1..N-10)", function () {
    const CANCEL_TIMEOUT_SECONDS = 14 * 24 * 60 * 60;

    /** Helper: advance the chain past CANCEL_TIMEOUT plus a small buffer. */
    async function advancePastCancelTimeout(): Promise<void> {
      await ethers.provider.send("evm_increaseTime", [
        CANCEL_TIMEOUT_SECONDS + 1,
      ]);
      await ethers.provider.send("evm_mine", []);
    }

    describe("N-1 / N-7: emergencyAdminCancel guards active disputes", function () {
      it("reverts when any milestone has an active dispute", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 750n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        await expect(
          registry.connect(admin).emergencyAdminCancel(1n),
        ).to.be.revertedWithCustomError(registry, "CannotCancelWithActiveDispute");

        // Reserved tokens stay intact; project remains Disputed.
        const p = await registry.getProject(1n);
        expect(p.status).to.equal(1); // Disputed
        expect(p.reservedAmount).to.equal(amount);
        expect(p.activeDisputeCount).to.equal(1n);
      });

      it("succeeds after the dispute is resolved by the arbitrator", async function () {
        const [admin, arb, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
        await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
        const token = await deployAndAllowMock(registry, admin, admin);

        const m0 = 400n;
        const m1 = 600n;
        const total = m0 + m1;
        await token.connect(admin).mint(await client.getAddress(), total * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(m0, 1n),
            milestone(m1, 2n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), total);
        await registry.connect(client).fundProject(1n, total);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        // Arbitrator clears the dispute first.
        await registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.RefundToClient, 0n, m0);

        const before = await token.balanceOf(await client.getAddress());
        await expect(registry.connect(admin).emergencyAdminCancel(1n))
          .to.emit(registry, "ProjectEmergencyCancelled")
          .withArgs(1n, await admin.getAddress(), await token.getAddress(), m1);

        // m0 was already refunded via dispute, m1 refunded via emergency cancel.
        expect(await token.balanceOf(await client.getAddress())).to.equal(before + m1);
        const p = await registry.getProject(1n);
        expect(p.status).to.equal(3); // Cancelled
        expect(p.reservedAmount).to.equal(0n);
        expect(p.refundedAmount).to.equal(m0 + m1);
      });

      it("reverts when a Submitted milestone exists (no auto-refund of delivered work)", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 600n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");

        await expect(
          registry.connect(admin).emergencyAdminCancel(1n),
        ).to.be.revertedWithCustomError(registry, "CannotCancelApprovedMilestone");
      });

      it("reverts when an Approved milestone exists", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 650n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).approveMilestone(1n, 0n);

        await expect(
          registry.connect(admin).emergencyAdminCancel(1n),
        ).to.be.revertedWithCustomError(registry, "CannotCancelApprovedMilestone");
      });
    });

    describe("N-2: cancelProject uses _freeLiquidity (no double-count)", function () {
      it("force-closes an aged Pending-milestone dispute and refunds exactly fundedAmount - released", async function () {
        // After N-6's (Pending-only) force-close path, reservedAmount is decremented mid-loop
        // and the post-loop refund reads _freeLiquidity. The total refunded must equal funded
        // minus already-released, not funded minus released minus stale-reserved.
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);

        const m0 = 100n;
        const m1 = 200n;
        const total = m0 + m1;
        await token.connect(admin).mint(await client.getAddress(), total * 2n);

        // deadline=1 lets the client raise a Pending-milestone dispute immediately
        // (block.timestamp > 1). Freelancer never submits; this models a non-delivery dispute.
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(m0, 1n),
            milestone(m1, 2n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), total);
        await registry.connect(client).fundProject(1n, total);

        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d0");

        await advancePastCancelTimeout();

        const before = await token.balanceOf(await client.getAddress());
        await registry.connect(client).cancelProject(1n);
        // Whole funded amount comes back: m0 (force-closed Pending dispute → client) +
        // m1 (still-pending milestone). _freeLiquidity correctly accounts for both.
        expect(await token.balanceOf(await client.getAddress())).to.equal(before + total);

        const p = await registry.getProject(1n);
        expect(p.reservedAmount).to.equal(0n);
        expect(p.refundedAmount).to.equal(total);
        expect(p.releasedAmount).to.equal(0n);
        expect(p.status).to.equal(3); // Cancelled
        // Token-level invariant: liabilities are fully drained.
        expect(
          await sumLiabilityForToken(registry, await token.getAddress(), 1n),
        ).to.equal(0n);
      });
    });

    describe("N-3: settledMilestoneCount stays bounded", function () {
      it("each settle path increments by exactly one and never exceeds milestoneCount", async function () {
        const [admin, arb, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
        await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
        const token = await deployAndAllowMock(registry, admin, admin);

        const m0 = 100n;
        const m1 = 200n;
        const m2 = 300n;
        const total = m0 + m1 + m2;
        await token.connect(admin).mint(await client.getAddress(), total * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(m0, 1n),
            milestone(m1, 2n),
            milestone(m2, 3n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), total);
        await registry.connect(client).fundProject(1n, total);

        // m0: regular release.
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://m0");
        await registry.connect(client).approveMilestone(1n, 0n);
        await registry.connect(client).releaseMilestone(1n, 0n);
        let p = await registry.getProject(1n);
        expect(p.settledMilestoneCount).to.equal(1n);

        // m1: dispute, arbitrator splits.
        await registry.connect(freelancer).submitMilestone(1n, 1n, "ipfs://m1");
        await registry.connect(client).raiseDispute(1n, 1n, "ipfs://d1");
        await registry
          .connect(arb)
          .resolveDispute(1n, 1n, Resolution.Split, 80n, 120n);
        p = await registry.getProject(1n);
        expect(p.settledMilestoneCount).to.equal(2n);

        // m2: client cancels remaining (Pending → Refunded).
        await registry.connect(client).cancelProject(1n);
        p = await registry.getProject(1n);
        expect(p.settledMilestoneCount).to.equal(3n);
        expect(p.settledMilestoneCount).to.equal(p.milestoneCount);
        expect(p.status).to.equal(3); // Cancelled (cancelProject bypasses _refreshProjectStatus)
      });
    });

    describe("N-4: reviewEnteredAt is stamped once per submission", function () {
      it("does not re-stamp when status is non-Pending (covered by InvalidMilestoneStatus)", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 500n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);

        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        const stampedAt = (await registry.getMilestone(1n, 0n)).reviewEnteredAt;
        expect(stampedAt).to.not.equal(0n);

        // Time advances; approve does not touch reviewEnteredAt.
        await ethers.provider.send("evm_increaseTime", [3600]);
        await ethers.provider.send("evm_mine", []);
        await registry.connect(client).approveMilestone(1n, 0n);
        const afterApprove = (await registry.getMilestone(1n, 0n)).reviewEnteredAt;
        expect(afterApprove).to.equal(stampedAt);

        // Re-calling submit on a non-Pending milestone reverts (no overwrite path).
        await expect(
          registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w2"),
        ).to.be.revertedWithCustomError(registry, "InvalidMilestoneStatus");

        // Release clears the stamp (terminal transition only).
        await registry.connect(client).releaseMilestone(1n, 0n);
        expect((await registry.getMilestone(1n, 0n)).reviewEnteredAt).to.equal(0n);
      });
    });

    describe("N-5: resolveDispute payout cap is per-milestone", function () {
      it("Split on milestone A only burns its own reserved slice; sibling reservation untouched", async function () {
        const [admin, arb, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
        await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
        const token = await deployAndAllowMock(registry, admin, admin);

        const m0 = 100n;
        const m1 = 200n;
        const total = m0 + m1;
        await token.connect(admin).mint(await client.getAddress(), total * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(m0, 1n),
            milestone(m1, 2n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), total);
        await registry.connect(client).fundProject(1n, total);

        // Submit + dispute milestone 0.
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://m0");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d0");
        // Submit + dispute milestone 1 (after m0 is unblocked? It isn't, but
        // raiseDispute on a Pending milestone after deadline works).
        // Easier path: also dispute m0 only and verify slice accounting.
        let p = await registry.getProject(1n);
        expect(p.reservedAmount).to.equal(m0);

        // Resolve m0 with a 60/40 split summing to m0 exactly.
        await registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.Split, 60n, 40n);

        p = await registry.getProject(1n);
        expect(p.reservedAmount).to.equal(0n);
        expect(p.releasedAmount).to.equal(60n);
        expect(p.refundedAmount).to.equal(40n);
        // Milestone 1 untouched.
        expect((await registry.getMilestone(1n, 1n)).status).to.equal(0); // Pending
      });

      it("rejects an over-payout: invalid Split parts cannot exceed milestone amount", async function () {
        const [admin, arb, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
        await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
        const token = await deployAndAllowMock(registry, admin, admin);

        const amount = 100n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);

        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        // Split parts > milestone.amount: caught by _validateResolutionAmounts (InvalidSplitAmounts).
        await expect(
          registry
            .connect(arb)
            .resolveDispute(1n, 0n, Resolution.Split, 60n, 50n),
        ).to.be.revertedWithCustomError(registry, "InvalidSplitAmounts");
      });
    });

    describe("N-6: cancelProject force-closes aged Pending disputes only", function () {
      it("reverts while a Pending-milestone dispute is still within CANCEL_TIMEOUT", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 500n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        // deadline=1 lets the client raise a Pending dispute immediately.
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        // Advance just under CANCEL_TIMEOUT.
        await ethers.provider.send("evm_increaseTime", [
          CANCEL_TIMEOUT_SECONDS - 60,
        ]);
        await ethers.provider.send("evm_mine", []);

        await expect(
          registry.connect(client).cancelProject(1n),
        ).to.be.revertedWithCustomError(registry, "CannotCancelWithActiveDispute");
      });

      it("force-closes a Pending dispute and refunds the milestone after CANCEL_TIMEOUT", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 500n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        // Pending dispute: freelancer never submitted.
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        await advancePastCancelTimeout();

        const before = await token.balanceOf(await client.getAddress());
        const tx = registry.connect(client).cancelProject(1n);
        await expect(tx).to.not.emit(registry, "DisputeResolved");
        await expect(tx)
          .to.emit(registry, "ProjectCancelled")
          .withArgs(1n, await client.getAddress(), await token.getAddress(), amount);

        expect(await token.balanceOf(await client.getAddress())).to.equal(before + amount);
        const p = await registry.getProject(1n);
        expect(p.status).to.equal(3); // Cancelled
        expect(p.activeDisputeCount).to.equal(0n);
        expect(p.reservedAmount).to.equal(0n);
        expect(p.refundedAmount).to.equal(amount);
        const d = await registry.getDispute(1n, 0n);
        expect(d.active).to.equal(false);
      });

      it("reverts cancellation of dispute on Submitted milestone even after CANCEL_TIMEOUT (steal vector)", async function () {
        // Audit follow-up: the timed force-close MUST NOT apply to contested freelancer work.
        // Otherwise a malicious client could open a dispute against a delivered submission,
        // wait CANCEL_TIMEOUT, and cancelProject() to claim the freelancer's funds.
        const [admin, arb, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
        await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
        const token = await deployAndAllowMock(registry, admin, admin);

        const amount = 500n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);

        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        // Even well past CANCEL_TIMEOUT, cancelProject must refuse to auto-refund.
        await advancePastCancelTimeout();
        await expect(
          registry.connect(client).cancelProject(1n),
        ).to.be.revertedWithCustomError(registry, "CannotCancelWithActiveDispute");

        // Project state is untouched by the failed cancel.
        let p = await registry.getProject(1n);
        expect(p.status).to.equal(1); // Disputed
        expect(p.activeDisputeCount).to.equal(1n);
        expect(p.reservedAmount).to.equal(amount);
        expect(p.releasedAmount).to.equal(0n);
        expect(p.refundedAmount).to.equal(0n);

        // Arbitration is the only path forward — and it can pay the freelancer.
        const fBefore = await token.balanceOf(await freelancer.getAddress());
        await registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
        expect(await token.balanceOf(await freelancer.getAddress())).to.equal(fBefore + amount);

        p = await registry.getProject(1n);
        expect(p.status).to.equal(2); // Completed
        expect(p.activeDisputeCount).to.equal(0n);
        expect(p.reservedAmount).to.equal(0n);
        expect(p.releasedAmount).to.equal(amount);
      });

      it("reverts cancellation of dispute on Approved milestone even after CANCEL_TIMEOUT", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);

        const amount = 400n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);

        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
        await registry.connect(client).approveMilestone(1n, 0n);
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        await advancePastCancelTimeout();

        await expect(
          registry.connect(client).cancelProject(1n),
        ).to.be.revertedWithCustomError(registry, "CannotCancelWithActiveDispute");

        const p = await registry.getProject(1n);
        expect(p.status).to.equal(1); // Disputed
        expect(p.reservedAmount).to.equal(amount);
        expect(p.refundedAmount).to.equal(0n);
      });
    });

    describe("N-8: arbitrator threshold is captured per actionId", function () {
      it("ArbitratorActionConfirmed emits the captured threshold (still consistent across approvals)", async function () {
        const [admin, arb1, arb2, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
        await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb1.getAddress());
        await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb2.getAddress());
        await registry.connect(admin).setArbitratorThreshold(2n);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 200n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        // First approval emits with captured threshold = 2.
        await expect(
          registry
            .connect(arb1)
            .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
        )
          .to.emit(registry, "ArbitratorActionConfirmed")
          .withArgs(anyValue, await arb1.getAddress(), 1n, 2n);

        // Second approval reaches quorum and emits with the SAME captured threshold = 2.
        await expect(
          registry
            .connect(arb2)
            .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
        )
          .to.emit(registry, "ArbitratorActionConfirmed")
          .withArgs(anyValue, await arb2.getAddress(), 2n, 2n);

        const d = await registry.getDispute(1n, 0n);
        expect(d.active).to.equal(false);
      });

      it("re-entry by an already-approved arbitrator before quorum does not double-count", async function () {
        const [admin, arb1, arb2, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
        await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb1.getAddress());
        await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb2.getAddress());
        await registry.connect(admin).setArbitratorThreshold(2n);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 240n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        // arb1 approves.
        await registry
          .connect(arb1)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
        let d = await registry.getDispute(1n, 0n);
        expect(d.active).to.equal(true);

        // arb1 re-enters with same params: early-return path, no event, no execution.
        await expect(
          registry
            .connect(arb1)
            .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
        ).to.not.emit(registry, "DisputeResolved");
        d = await registry.getDispute(1n, 0n);
        expect(d.active).to.equal(true);

        // arb2 finalizes.
        await registry
          .connect(arb2)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
        d = await registry.getDispute(1n, 0n);
        expect(d.active).to.equal(false);
      });
    });

    describe("N-9: timestamp narrowing for reviewEnteredAt", function () {
      it("submitMilestone stamps reviewEnteredAt as uint64(block.timestamp)", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 100n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);

        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        const ms = await registry.getMilestone(1n, 0n);
        const block = await ethers.provider.getBlock("latest");
        expect(block).to.not.equal(null);
        // Matches on-chain uint64(block.timestamp) for realistic chain timestamps.
        expect(ms.reviewEnteredAt).to.equal(BigInt(block!.timestamp));
        expect(ms.reviewEnteredAt).to.be.lessThan(2n ** 64n);
      });

      it("raiseDispute stamps raisedAt with current block timestamp", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 100n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        const d = await registry.getDispute(1n, 0n);
        const block = await ethers.provider.getBlock("latest");
        expect(block).to.not.equal(null);
        expect(d.raisedAt).to.equal(BigInt(block!.timestamp));
      });

      it("proposeEmergencyResolveDispute sets readyAt = now + delay", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 100n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        const delay = await registry.EMERGENCY_RESOLUTION_DELAY();
        const tx = await registry
          .connect(admin)
          .proposeEmergencyResolveDispute(
            1n,
            0n,
            Resolution.ReleaseToFreelancer,
            amount,
            0n,
          );
        const receipt = await tx.wait();
        expect(receipt).to.not.equal(null);
        const proposalBlock = await ethers.provider.getBlock(receipt!.blockNumber);
        expect(proposalBlock).to.not.equal(null);
        const readyAt = await registry.getEmergencyResolutionReadyAt(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          amount,
          0n,
        );
        expect(readyAt).to.equal(BigInt(proposalBlock!.timestamp) + delay);
      });

      it("setAlternativeRecipient sets executableAfter = now + delay", async function () {
        const [admin, arb, client, freelancer, altFreelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
        await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 100n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        const delay = await registry.ALTERNATIVE_RECIPIENT_DELAY();
        const tx = await registry
          .connect(arb)
          .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());
        const receipt = await tx.wait();
        expect(receipt).to.not.equal(null);
        const actionBlock = await ethers.provider.getBlock(receipt!.blockNumber);
        expect(actionBlock).to.not.equal(null);
        await expect(tx)
          .to.emit(registry, "AlternativeRecipientSet")
          .withArgs(
            1n,
            0n,
            true,
            await altFreelancer.getAddress(),
            BigInt(actionBlock!.timestamp) + delay,
            await arb.getAddress(),
          );
      });

      it("toUint64 accepts max uint64 in deterministic harness", async function () {
        const [admin] = await ethers.getSigners();
        const Harness = await ethers.getContractFactory("EscrowFlowRegistryHarness");
        const harness = await Harness.connect(admin).deploy(await admin.getAddress());
        await harness.waitForDeployment();

        const maxU64 = (2n ** 64n) - 1n;
        expect(await harness.exposedToUint64(maxU64)).to.equal(maxU64);
      });

      it("toUint64 reverts above max uint64 in deterministic harness", async function () {
        const [admin] = await ethers.getSigners();
        const Harness = await ethers.getContractFactory("EscrowFlowRegistryHarness");
        const harness = await Harness.connect(admin).deploy(await admin.getAddress());
        await harness.waitForDeployment();

        const overMaxU64 = 2n ** 64n;
        await expect(
          harness.exposedToUint64(overMaxU64),
        ).to.be.revertedWithCustomError(harness, "TimestampOverflow");
      });
    });

    describe("N-10: sweepUntrackedToken uses revert, not assert", function () {
      it("reverts InsufficientUntrackedBalance when post-transfer balance falls below liabilities", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);

        const Drop = await ethers.getContractFactory("BalanceDropToken");
        const token = await Drop.connect(admin).deploy(await admin.getAddress());
        await token.waitForDeployment();
        await registry
          .connect(admin)
          .attestTokenReviewForAllowlist(await token.getAddress());
        await registry
          .connect(admin)
          .setAllowedToken(await token.getAddress(), true);

        const escrowAmount = 1_000n;
        const accidentalAmount = 300n;
        await token.connect(admin).mint(await client.getAddress(), escrowAmount * 2n);
        await token.connect(admin).mint(await admin.getAddress(), accidentalAmount);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(escrowAmount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), escrowAmount);
        await registry.connect(client).fundProject(1n, escrowAmount);
        await token
          .connect(admin)
          .transfer(await registry.getAddress(), accidentalAmount);

        // Now configure the token to drain an extra 50% on each transfer FROM the registry.
        // sweepUntrackedToken transfers `accidentalAmount` to admin → registry loses
        // accidentalAmount + 50% extra, dropping its balance below the escrow liability.
        await token.connect(admin).setExtraDrainBps(5000n);

        await expect(
          registry
            .connect(admin)
            .sweepUntrackedToken(
              await token.getAddress(),
              await admin.getAddress(),
              accidentalAmount,
            ),
        ).to.be.revertedWithCustomError(registry, "InsufficientUntrackedBalance");
      });
    });
  });

  describe("audit fixes (N-11..N-12)", function () {
    describe("N-11: emergencyResolveDispute (admin-only, paused-safe)", function () {
      // FIX N-14: emergencyResolveDispute is now gated by a 24h propose+execute timelock.
      // EMERGENCY_RESOLUTION_DELAY = 1 day. We advance + 1 second of buffer to clear the readyAt
      // boundary safely.
      const EMERGENCY_DELAY_PLUS_BUFFER = 24 * 60 * 60 + 1;

      /** Helper: admin proposes the resolution and the chain advances past readyAt. */
      async function proposeAndAdvanceEmergency(
        registry: EscrowFlowRegistry,
        admin: Signer,
        projectId: bigint,
        milestoneIndex: bigint,
        kind: number,
        freelancerAmount: bigint,
        clientAmount: bigint,
      ): Promise<void> {
        await registry
          .connect(admin)
          .proposeEmergencyResolveDispute(
            projectId,
            milestoneIndex,
            kind,
            freelancerAmount,
            clientAmount,
          );
        await ethers.provider.send("evm_increaseTime", [
          EMERGENCY_DELAY_PLUS_BUFFER,
        ]);
        await ethers.provider.send("evm_mine", []);
      }

      it("admin resolves a Submitted-milestone dispute while paused, paying the freelancer (after 24h timelock)", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);

        const amount = 800n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);

        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        await registry.connect(admin).pause();

        await proposeAndAdvanceEmergency(
          registry,
          admin,
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          amount,
          0n,
        );

        const fBefore = await token.balanceOf(await freelancer.getAddress());
        const tx = registry
          .connect(admin)
          .emergencyResolveDispute(
            1n,
            0n,
            Resolution.ReleaseToFreelancer,
            amount,
            0n,
          );
        await expect(tx)
          .to.emit(registry, "EmergencyDisputeResolved")
          .withArgs(
            1n,
            0n,
            await admin.getAddress(),
            Resolution.ReleaseToFreelancer,
            amount,
            0n,
          );

        expect(await token.balanceOf(await freelancer.getAddress())).to.equal(
          fBefore + amount,
        );
        const p = await registry.getProject(1n);
        expect(p.status).to.equal(2); // Completed
        expect(p.activeDisputeCount).to.equal(0n);
        expect(p.reservedAmount).to.equal(0n);
        expect(p.releasedAmount).to.equal(amount);
        expect(
          await sumLiabilityForToken(registry, await token.getAddress(), 1n),
        ).to.equal(0n);

        // Successful execute consumes the proposal slot.
        expect(
          await registry.getEmergencyResolutionReadyAt(
            1n,
            0n,
            Resolution.ReleaseToFreelancer,
            amount,
            0n,
          ),
        ).to.equal(0n);
      });

      it("admin resolves a Pending-milestone dispute as RefundToClient while paused (after 24h timelock)", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);

        const amount = 600n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        // deadline=1 → client can immediately raise a Pending dispute (no submit).
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        await registry.connect(admin).pause();

        await proposeAndAdvanceEmergency(
          registry,
          admin,
          1n,
          0n,
          Resolution.RefundToClient,
          0n,
          amount,
        );

        const cBefore = await token.balanceOf(await client.getAddress());
        await registry
          .connect(admin)
          .emergencyResolveDispute(
            1n,
            0n,
            Resolution.RefundToClient,
            0n,
            amount,
          );

        expect(await token.balanceOf(await client.getAddress())).to.equal(
          cBefore + amount,
        );
        const p = await registry.getProject(1n);
        expect(p.activeDisputeCount).to.equal(0n);
        expect(p.reservedAmount).to.equal(0n);
        expect(p.refundedAmount).to.equal(amount);
        expect(p.status).to.equal(2); // Completed (only milestone settled)
      });

      it("reverts when called by a non-admin (arbitrator) — propose is admin-gated end-to-end", async function () {
        const [admin, arb, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
        await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
        const token = await deployAndAllowMock(registry, admin, admin);

        const amount = 100n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        // FIX N-14: the timelock front-end (proposeEmergencyResolveDispute) carries the same
        // admin-only gating as the execute call, so a non-admin caller is rejected at the propose
        // step before the 24h delay is even relevant.
        await expect(
          registry
            .connect(arb)
            .proposeEmergencyResolveDispute(
              1n,
              0n,
              Resolution.ReleaseToFreelancer,
              amount,
              0n,
            ),
        ).to.be.revertedWithCustomError(
          registry,
          "AccessControlUnauthorizedAccount",
        );

        // The execute path is also admin-gated; reverts with the same access-control error
        // regardless of any pending proposal state.
        await expect(
          registry
            .connect(arb)
            .emergencyResolveDispute(
              1n,
              0n,
              Resolution.ReleaseToFreelancer,
              amount,
              0n,
            ),
        ).to.be.revertedWithCustomError(
          registry,
          "AccessControlUnauthorizedAccount",
        );
      });

      it("reverts DisputeNotActive when no dispute is open (validation runs at propose time)", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);

        const amount = 100n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);

        // FIX N-14: propose runs the same validation as execute, so the absence of an active
        // dispute is rejected immediately rather than 24h later.
        await expect(
          registry
            .connect(admin)
            .proposeEmergencyResolveDispute(
              1n,
              0n,
              Resolution.RefundToClient,
              0n,
              amount,
            ),
        ).to.be.revertedWithCustomError(registry, "DisputeNotActive");
      });

      it("rejects ReleaseToFreelancer for a Pending milestone (PendingDisputeMustRefundClient at propose time)", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);

        const amount = 100n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        // Pending dispute: freelancer never submitted.
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        await expect(
          registry
            .connect(admin)
            .proposeEmergencyResolveDispute(
              1n,
              0n,
              Resolution.ReleaseToFreelancer,
              amount,
              0n,
            ),
        ).to.be.revertedWithCustomError(
          registry,
          "PendingDisputeMustRefundClient",
        );
      });

      it("end-to-end deadlock unstick: emergencyResolveDispute under pause unblocks emergencyAdminCancel (after 24h timelock)", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);

        const m0 = 200n;
        const m1 = 300n;
        const total = m0 + m1;
        await token.connect(admin).mint(await client.getAddress(), total * 2n);

        // m0 is a Submitted-milestone dispute (contested freelancer work — only resolvable by
        // arbitration normally). m1 stays Pending so emergencyAdminCancel has something to refund
        // after we clear m0 via the new emergency path.
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(m0, 1n),
            milestone(m1, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), total);
        await registry.connect(client).fundProject(1n, total);

        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        // Pause: cancelProject (whenNotPaused) is unavailable, no arbitrator quorum exists, and
        // resolveStaleDisputeByTimeout is Pending-only — classic deadlock.
        await registry.connect(admin).pause();

        // Without the new path, emergencyAdminCancel still refuses (FIX N-1 / N-7).
        await expect(
          registry.connect(admin).emergencyAdminCancel(1n),
        ).to.be.revertedWithCustomError(registry, "CannotCancelWithActiveDispute");

        // Admin emergency-resolves the contested milestone as RefundToClient (a neutral choice in
        // a deadlock scenario where the admin cannot adjudicate the work) — propose first, then
        // wait the 24h FIX N-14 timelock.
        await proposeAndAdvanceEmergency(
          registry,
          admin,
          1n,
          0n,
          Resolution.RefundToClient,
          0n,
          m0,
        );
        await registry
          .connect(admin)
          .emergencyResolveDispute(1n, 0n, Resolution.RefundToClient, 0n, m0);

        const cBefore = await token.balanceOf(await client.getAddress());
        await registry.connect(admin).emergencyAdminCancel(1n);

        // m0 was already refunded (delta only includes m1 from the cancel sweep).
        expect(await token.balanceOf(await client.getAddress())).to.equal(cBefore + m1);
        const p = await registry.getProject(1n);
        expect(p.status).to.equal(3); // Cancelled
        expect(p.activeDisputeCount).to.equal(0n);
        expect(p.reservedAmount).to.equal(0n);
        expect(p.refundedAmount).to.equal(total);
        expect(
          await sumLiabilityForToken(registry, await token.getAddress(), 1n),
        ).to.equal(0n);
      });

      it("pending freelancer alternative recipient does not block emergency release and is ignored unless executed", async function () {
        const [admin, arb, client, freelancer, altFreelancer] =
          await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
        await registry
          .connect(admin)
          .grantRole(ARBITRATOR_ROLE, await arb.getAddress());
        const token = await deployAndAllowMock(registry, admin, admin);

        const amount = 450n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        // Arbitrator sets a pending freelancer recipient, but the freelancer never executes it.
        await registry
          .connect(arb)
          .setAlternativeRecipient(
            1n,
            0n,
            true,
            await altFreelancer.getAddress(),
          );
        const freelancerPendingSlot = await findPendingAlternativeMappingSlot(
          registry,
          1n,
          0n,
          await altFreelancer.getAddress(),
        );

        // Wait until the pending recipient is executable (48h + 1s).
        await ethers.provider.send("evm_increaseTime", [48 * 60 * 60 + 1]);
        await ethers.provider.send("evm_mine", []);
        await registry.connect(admin).pause();

        await proposeAndAdvanceEmergency(
          registry,
          admin,
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          amount,
          0n,
        );
        const freelancerBefore = await token.balanceOf(await freelancer.getAddress());
        const altBefore = await token.balanceOf(await altFreelancer.getAddress());
        await expect(
          registry
            .connect(admin)
            .emergencyResolveDispute(
              1n,
              0n,
              Resolution.ReleaseToFreelancer,
              amount,
              0n,
            ),
        )
          .to.emit(registry, "EmergencyDisputeResolved")
          .and.to.not.emit(registry, "AlternativeRecipientExecuted");

        expect(await token.balanceOf(await freelancer.getAddress())).to.equal(
          freelancerBefore + amount,
        );
        expect(await token.balanceOf(await altFreelancer.getAddress())).to.equal(
          altBefore,
        );
        expect(
          await getPendingAlternativeRecipientForTest(registry, 1n, 0n, freelancerPendingSlot),
        ).to.equal(ethers.ZeroAddress);
      });

      it("pending client alternative recipient does not block emergency refund and can fall back to party-authorized recipient", async function () {
        const [admin, arb, client, freelancer, altClient] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
        await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
        const Blacklist = await ethers.getContractFactory("BlacklistStablecoin");
        const token = await Blacklist.connect(admin).deploy(await admin.getAddress());
        await token.waitForDeployment();
        await registry.connect(admin).attestTokenReviewForAllowlist(await token.getAddress());
        await registry.connect(admin).setAllowedToken(await token.getAddress(), true);

        const amount = 500n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        await registry
          .connect(arb)
          .setAlternativeRecipient(1n, 0n, false, await altClient.getAddress());
        const clientPendingSlot = await findPendingAlternativeMappingSlot(
          registry,
          1n,
          0n,
          await altClient.getAddress(),
        );

        // Client authorizes a safe recipient for the dispute refund path.
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        const deadline = BigInt(now + 3600);
        const signature = await signSetAlternativeRecipient(client, registry, {
          projectId: 1n,
          milestoneIndex: 0n,
          isFreelancer: false,
          originalParty: await client.getAddress(),
          newRecipient: await altClient.getAddress(),
          nonce: 0n,
          deadline,
        });
        await registry.connect(admin).setPartyAuthorizedRecipientBySig(
          1n,
          0n,
          false,
          await client.getAddress(),
          await altClient.getAddress(),
          0n,
          deadline,
          signature,
        );

        await ethers.provider.send("evm_increaseTime", [48 * 60 * 60 + 1]);
        await ethers.provider.send("evm_mine", []);
        await registry.connect(admin).pause();

        await proposeAndAdvanceEmergency(
          registry,
          admin,
          1n,
          0n,
          Resolution.RefundToClient,
          0n,
          amount,
        );
        await token.connect(admin).setBlacklisted(await client.getAddress(), true);
        const altBefore = await token.balanceOf(await altClient.getAddress());
        await expect(
          registry
            .connect(admin)
            .emergencyResolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount),
        ).to.not.emit(registry, "AlternativeRecipientExecuted");
        expect(await token.balanceOf(await altClient.getAddress())).to.equal(
          altBefore + amount,
        );
        expect(
          await getPendingAlternativeRecipientForTest(registry, 1n, 0n, clientPendingSlot),
        ).to.equal(ethers.ZeroAddress);
      });

      it("a stale arbitrator vote cannot replay against an already-emergency-resolved milestone (after 24h timelock)", async function () {
        const [admin, arb, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
        await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
        const token = await deployAndAllowMock(registry, admin, admin);

        const amount = 100n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

        // Admin emergency-resolves while paused — propose first, wait 24h, execute.
        await registry.connect(admin).pause();
        await proposeAndAdvanceEmergency(
          registry,
          admin,
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          amount,
          0n,
        );
        await registry
          .connect(admin)
          .emergencyResolveDispute(
            1n,
            0n,
            Resolution.ReleaseToFreelancer,
            amount,
            0n,
          );
        await registry.connect(admin).unpause();

        // The arbitrator's stale resolveDispute call has nothing to act on: the project is
        // Completed (single milestone settled), and the dispute is no longer active. The nonce
        // bump in emergencyResolveDispute provides defense-in-depth on top of these checks.
        await expect(
          registry
            .connect(arb)
            .resolveDispute(
              1n,
              0n,
              Resolution.ReleaseToFreelancer,
              amount,
              0n,
            ),
        ).to.be.revertedWithCustomError(registry, "ProjectNotActive");
      });

      describe("regression: unexecuted pending alternative recipients cannot freeze emergency recovery", function () {
        const ALT_RECIPIENT_DELAY_PLUS_BUFFER = 48 * 60 * 60 + 1;

        it("pending freelancer alt (never executed): emergency release succeeds after delays; payout not to pending target; pending cleared; invariants", async function () {
          const [admin, arb, client, freelancer, altFreelancer] = await ethers.getSigners();
          const registry = await deployRegistry(admin);
          const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
          await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
          const token = await deployAndAllowMock(registry, admin, admin);
          const amount = 711n;
          await token.connect(admin).mint(await client.getAddress(), amount * 2n);
          await registry
            .connect(client)
            .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
              milestone(amount, 1n),
            ]);
          await token.connect(client).approve(await registry.getAddress(), amount);
          await registry.connect(client).fundProject(1n, amount);
          await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
          await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

          await registry
            .connect(arb)
            .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());
          const pendingSlot = await findPendingAlternativeMappingSlot(
            registry,
            1n,
            0n,
            await altFreelancer.getAddress(),
          );

          await ethers.provider.send("evm_increaseTime", [ALT_RECIPIENT_DELAY_PLUS_BUFFER]);
          await ethers.provider.send("evm_mine", []);

          const pBefore = await registry.getProject(1n);
          expect(pBefore.activeDisputeCount).to.equal(1n);
          expect(pBefore.reservedAmount).to.equal(amount);
          expect(pBefore.releasedAmount).to.equal(0n);
          expect(pBefore.refundedAmount).to.equal(0n);

          await proposeAndAdvanceEmergency(
            registry,
            admin,
            1n,
            0n,
            Resolution.ReleaseToFreelancer,
            amount,
            0n,
          );

          const fBefore = await token.balanceOf(await freelancer.getAddress());
          const altBefore = await token.balanceOf(await altFreelancer.getAddress());
          const liabilityBefore = await sumLiabilityForToken(
            registry,
            await token.getAddress(),
            1n,
          );

          await expect(
            registry
              .connect(admin)
              .emergencyResolveDispute(
                1n,
                0n,
                Resolution.ReleaseToFreelancer,
                amount,
                0n,
              ),
          )
            .to.emit(registry, "EmergencyDisputeResolved")
            .and.to.not.emit(registry, "AlternativeRecipientExecuted");

          expect(await token.balanceOf(await freelancer.getAddress())).to.equal(fBefore + amount);
          expect(await token.balanceOf(await altFreelancer.getAddress())).to.equal(altBefore);
          expect(
            await getPendingAlternativeRecipientForTest(registry, 1n, 0n, pendingSlot),
          ).to.equal(ethers.ZeroAddress);

          const pAfter = await registry.getProject(1n);
          expect(pAfter.activeDisputeCount).to.equal(0n);
          expect(pAfter.reservedAmount).to.equal(0n);
          expect(pAfter.releasedAmount).to.equal(amount);
          expect(pAfter.refundedAmount).to.equal(0n);
          expect(pAfter.releasedAmount + pAfter.refundedAmount).to.equal(pAfter.fundedAmount);
          const liabilityAfter = await sumLiabilityForToken(
            registry,
            await token.getAddress(),
            1n,
          );
          expect(liabilityBefore - liabilityAfter).to.equal(amount);

          await assertProjectCoreInvariants(registry, 1n);
          await assertTokenLiabilityInvariant(registry, token, 1n);
        });

        it("pending client alt (never executed): emergency refund succeeds; refund not to pending alt; pending cleared; invariants", async function () {
          const [admin, arb, client, freelancer, altClient] = await ethers.getSigners();
          const registry = await deployRegistry(admin);
          const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
          await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
          const token = await deployAndAllowMock(registry, admin, admin);
          const amount = 712n;
          await token.connect(admin).mint(await client.getAddress(), amount * 2n);
          await registry
            .connect(client)
            .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
              milestone(amount, 1n),
            ]);
          await token.connect(client).approve(await registry.getAddress(), amount);
          await registry.connect(client).fundProject(1n, amount);
          await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

          await registry
            .connect(arb)
            .setAlternativeRecipient(1n, 0n, false, await altClient.getAddress());
          const pendingSlot = await findPendingAlternativeMappingSlot(
            registry,
            1n,
            0n,
            await altClient.getAddress(),
          );

          await ethers.provider.send("evm_increaseTime", [ALT_RECIPIENT_DELAY_PLUS_BUFFER]);
          await ethers.provider.send("evm_mine", []);

          const pBefore = await registry.getProject(1n);
          expect(pBefore.activeDisputeCount).to.equal(1n);
          expect(pBefore.reservedAmount).to.equal(amount);

          await proposeAndAdvanceEmergency(
            registry,
            admin,
            1n,
            0n,
            Resolution.RefundToClient,
            0n,
            amount,
          );

          const clientBefore = await token.balanceOf(await client.getAddress());
          const altBefore = await token.balanceOf(await altClient.getAddress());
          const liabilityBefore = await sumLiabilityForToken(
            registry,
            await token.getAddress(),
            1n,
          );

          await expect(
            registry
              .connect(admin)
              .emergencyResolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount),
          )
            .to.emit(registry, "EmergencyDisputeResolved")
            .and.to.not.emit(registry, "AlternativeRecipientExecuted");

          expect(await token.balanceOf(await client.getAddress())).to.equal(clientBefore + amount);
          expect(await token.balanceOf(await altClient.getAddress())).to.equal(altBefore);
          expect(
            await getPendingAlternativeRecipientForTest(registry, 1n, 0n, pendingSlot),
          ).to.equal(ethers.ZeroAddress);

          const pAfter = await registry.getProject(1n);
          expect(pAfter.activeDisputeCount).to.equal(0n);
          expect(pAfter.reservedAmount).to.equal(0n);
          expect(pAfter.refundedAmount).to.equal(amount);
          expect(pAfter.releasedAmount).to.equal(0n);
          expect(pAfter.releasedAmount + pAfter.refundedAmount).to.equal(pAfter.fundedAmount);
          const liabilityAfter = await sumLiabilityForToken(
            registry,
            await token.getAddress(),
            1n,
          );
          expect(liabilityBefore - liabilityAfter).to.equal(amount);

          await assertProjectCoreInvariants(registry, 1n);
          await assertTokenLiabilityInvariant(registry, token, 1n);
        });

        it("resolveDispute reverts while alt-recipient delay is pending; emergency release succeeds after only EMERGENCY_RESOLUTION_DELAY (does not wait for alt delay)", async function () {
          const [admin, arb, client, freelancer, altFreelancer] = await ethers.getSigners();
          const registry = await deployRegistry(admin);
          const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
          await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
          const token = await deployAndAllowMock(registry, admin, admin);
          const amount = 713n;
          await token.connect(admin).mint(await client.getAddress(), amount * 2n);
          await registry
            .connect(client)
            .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
              milestone(amount, 1n),
            ]);
          await token.connect(client).approve(await registry.getAddress(), amount);
          await registry.connect(client).fundProject(1n, amount);
          await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
          await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

          await registry
            .connect(arb)
            .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());

          await expect(
            registry
              .connect(arb)
              .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
          ).to.be.revertedWithCustomError(registry, "AlternativeRecipientChangePending");

          await registry.connect(admin).pause();
          await proposeAndAdvanceEmergency(
            registry,
            admin,
            1n,
            0n,
            Resolution.ReleaseToFreelancer,
            amount,
            0n,
          );

          const altDelay = await registry.ALTERNATIVE_RECIPIENT_DELAY();
          expect(altDelay).to.be.gt(BigInt(EMERGENCY_DELAY_PLUS_BUFFER));

          await expect(
            registry
              .connect(admin)
              .emergencyResolveDispute(
                1n,
                0n,
                Resolution.ReleaseToFreelancer,
                amount,
                0n,
              ),
          )
            .to.emit(registry, "EmergencyDisputeResolved")
            .and.to.not.emit(registry, "AlternativeRecipientExecuted");

          expect(await token.balanceOf(await altFreelancer.getAddress())).to.equal(0n);
          await assertProjectCoreInvariants(registry, 1n);
          await assertTokenLiabilityInvariant(registry, token, 1n);
        });
      });
    });

    describe("N-12: outbound balance-delta guard (_safeTransferExact)", function () {
      it("releaseMilestone reverts InvalidPayoutTransfer when the token over-drains the contract (sender-side / rebase)", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);

        const Drop = await ethers.getContractFactory("BalanceDropToken");
        const token = await Drop.connect(admin).deploy(await admin.getAddress());
        await token.waitForDeployment();
        await registry
          .connect(admin)
          .attestTokenReviewForAllowlist(await token.getAddress());
        await registry
          .connect(admin)
          .setAllowedToken(await token.getAddress(), true);

        const amount = 1_000n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);
        // Slack so the token's extra-drain on outbound has somewhere to debit from (otherwise the
        // burn underflows ERC20InsufficientBalance before our helper's check can fire).
        await token.connect(admin).mint(await registry.getAddress(), amount);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);

        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).approveMilestone(1n, 0n);

        // Turn on a 20% over-drain so the contract loses amount * 1.2 on every outbound transfer.
        await token.connect(admin).setExtraDrainBps(2000n);

        await expect(
          registry.connect(client).releaseMilestone(1n, 0n),
        ).to.be.revertedWithCustomError(registry, "InvalidPayoutTransfer");
      });

      it("releaseMilestone reverts InvalidPayoutTransfer when the recipient receives less than amount (recipient-side / FoT)", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);

        const Tok = await ethers.getContractFactory("OutboundFeeToken");
        const token = await Tok.connect(admin).deploy(await admin.getAddress());
        await token.waitForDeployment();
        await registry
          .connect(admin)
          .attestTokenReviewForAllowlist(await token.getAddress());
        await registry
          .connect(admin)
          .setAllowedToken(await token.getAddress(), true);

        const amount = 1_000n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        // Funding leg with feeBps=0 so the inbound balance-delta check passes.
        await registry.connect(client).fundProject(1n, amount);

        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).approveMilestone(1n, 0n);

        // Turn on a 1% recipient-side fee. Outbound transfer credits the recipient by amount, then
        // burns 1% from them — recipient delta is amount * 0.99, which trips the helper's check.
        await token.connect(admin).setFeeBps(100n);

        await expect(
          registry.connect(client).releaseMilestone(1n, 0n),
        ).to.be.revertedWithCustomError(registry, "InvalidPayoutTransfer");
      });
    });
  });

  describe("audit fixes (N-13)", function () {
    const CANCEL_TIMEOUT_SECONDS = 14 * 24 * 60 * 60;

    /** Helper: advance the chain past CANCEL_TIMEOUT plus a small buffer. */
    async function advancePastCancelTimeout(): Promise<void> {
      await ethers.provider.send("evm_increaseTime", [
        CANCEL_TIMEOUT_SECONDS + 1,
      ]);
      await ethers.provider.send("evm_mine", []);
    }

    describe("N-13: cancelProject must not auto-refund Approved milestones", function () {
      it("reverts with CannotCancelApprovedMilestone after CANCEL_TIMEOUT (steal-vector regression)", async function () {
        // Audit Finding 1 (High): a malicious client must not be able to approve, withhold
        // releaseMilestone, wait CANCEL_TIMEOUT, then cancelProject() to claw back funds the
        // freelancer has already earned via the timed force-refund branch.
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);

        const amount = 500n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);

        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).approveMilestone(1n, 0n);

        // Even well past CANCEL_TIMEOUT, cancelProject must refuse: an Approved milestone
        // represents accepted freelancer work and must exit via releaseMilestone or dispute.
        await advancePastCancelTimeout();

        await expect(
          registry.connect(client).cancelProject(1n),
        ).to.be.revertedWithCustomError(
          registry,
          "CannotCancelApprovedMilestone",
        );

        // Funds remain escrowed and accounted for; nothing flipped to Refunded/Cancelled.
        const ms = await registry.getMilestone(1n, 0n);
        expect(ms.status).to.equal(2); // Approved
        const p = await registry.getProject(1n);
        expect(p.status).to.equal(0); // Active
        expect(p.refundedAmount).to.equal(0n);
        expect(p.releasedAmount).to.equal(0n);
        expect(
          await sumLiabilityForToken(registry, await token.getAddress(), 1n),
        ).to.equal(amount);
      });

      it("after CANCEL_TIMEOUT, Submitted milestone auto-releases to freelancer and remaining Pending is refunded to client", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);

        const submittedAmount = 700n;
        const pendingAmount = 300n;
        const total = submittedAmount + pendingAmount;
        await token.connect(admin).mint(await client.getAddress(), total * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(submittedAmount, 1n),
            milestone(pendingAmount, 2n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), total);
        await registry.connect(client).fundProject(1n, total);

        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");

        await advancePastCancelTimeout();

        const cBefore = await token.balanceOf(await client.getAddress());
        const fBefore = await token.balanceOf(await freelancer.getAddress());
        const tx = registry.connect(client).cancelProject(1n);
        await expect(tx)
          .to.emit(registry, "MilestoneFundsReleased")
          .withArgs(
            1n,
            0n,
            await freelancer.getAddress(),
            await freelancer.getAddress(),
            await token.getAddress(),
            submittedAmount,
            submittedAmount,
          );
        await expect(tx)
          .to.emit(registry, "ProjectCancelled")
          .withArgs(
            1n,
            await client.getAddress(),
            await token.getAddress(),
            pendingAmount,
          );

        expect(await token.balanceOf(await client.getAddress())).to.equal(
          cBefore + pendingAmount,
        );
        expect(await token.balanceOf(await freelancer.getAddress())).to.equal(
          fBefore + submittedAmount,
        );
        const ms0 = await registry.getMilestone(1n, 0n);
        expect(ms0.status).to.equal(3); // Released
        const ms1 = await registry.getMilestone(1n, 1n);
        expect(ms1.status).to.equal(4); // Refunded
        const p = await registry.getProject(1n);
        expect(p.status).to.equal(3); // Cancelled
        expect(p.releasedAmount).to.equal(submittedAmount);
        expect(p.refundedAmount).to.equal(pendingAmount);
        expect(p.releasedAmount + p.refundedAmount).to.equal(total);
        expect(
          await sumLiabilityForToken(registry, await token.getAddress(), 1n),
        ).to.equal(0n);
      });

      it("releases multiple Submitted milestones after timeout during cancelProject", async function () {
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);

        const m0 = 200n;
        const m1 = 300n;
        const m2 = 100n; // pending
        const total = m0 + m1 + m2;
        await token.connect(admin).mint(await client.getAddress(), total * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(m0, 1n),
            milestone(m1, 2n),
            milestone(m2, 3n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), total);
        await registry.connect(client).fundProject(1n, total);

        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://s0");
        // Synthetic fixture: force milestone 1 into Submitted with an aged review timestamp
        // to validate that cancelProject releases every eligible Submitted milestone it sees.
        await setMilestoneSubmittedForTest(registry, 1n, 1n, 1n);

        await advancePastCancelTimeout();

        const fBefore = await token.balanceOf(await freelancer.getAddress());
        const cBefore = await token.balanceOf(await client.getAddress());
        await registry.connect(client).cancelProject(1n);

        expect(await token.balanceOf(await freelancer.getAddress())).to.equal(
          fBefore + m0 + m1,
        );
        expect(await token.balanceOf(await client.getAddress())).to.equal(
          cBefore + m2,
        );
        const p = await registry.getProject(1n);
        expect(p.releasedAmount).to.equal(m0 + m1);
        expect(p.refundedAmount).to.equal(m2);
        expect(p.releasedAmount + p.refundedAmount).to.equal(total);
      });

      it("a single Approved milestone blocks cancellation of the whole project, even if other milestones would be refundable", async function () {
        // Defense-in-depth: the loop must bail on the Approved milestone so the client cannot
        // piggyback a legitimate Pending refund onto an illegal Approved-refund in the same call.
        const [admin, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);

        const m0 = 300n; // will be Approved
        const m1 = 200n; // will stay Pending
        const total = m0 + m1;
        await token.connect(admin).mint(await client.getAddress(), total * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(m0, 1n),
            milestone(m1, 2n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), total);
        await registry.connect(client).fundProject(1n, total);

        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).approveMilestone(1n, 0n);

        await advancePastCancelTimeout();

        await expect(
          registry.connect(client).cancelProject(1n),
        ).to.be.revertedWithCustomError(
          registry,
          "CannotCancelApprovedMilestone",
        );

        // Project remains Active and all liquidity is still escrowed.
        const p = await registry.getProject(1n);
        expect(p.status).to.equal(0); // Active
        expect(p.refundedAmount).to.equal(0n);
        expect(
          await sumLiabilityForToken(registry, await token.getAddress(), 1n),
        ).to.equal(total);
      });

      it("freelancer's recourse is preserved: raiseDispute on Approved milestone resolves via arbitrator", async function () {
        // Closing the cancel-on-Approved hole is safe because raiseDispute already accepts
        // either party (line 1258), so a client refusing to release can be escalated to the
        // arbitrator. This test exercises that end-to-end recovery path.
        const [admin, arb, client, freelancer] = await ethers.getSigners();
        const registry = await deployRegistry(admin);
        const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
        await registry
          .connect(admin)
          .grantRole(ARBITRATOR_ROLE, await arb.getAddress());
        const token = await deployAndAllowMock(registry, admin, admin);

        const amount = 900n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);

        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);

        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).approveMilestone(1n, 0n);

        // Aged past CANCEL_TIMEOUT — confirm the Approved-cancel attempt still reverts here.
        await advancePastCancelTimeout();
        await expect(
          registry.connect(client).cancelProject(1n),
        ).to.be.revertedWithCustomError(
          registry,
          "CannotCancelApprovedMilestone",
        );

        // Freelancer escalates: raiseDispute is open to either party.
        await registry
          .connect(freelancer)
          .raiseDispute(1n, 0n, "ipfs://freelancer-dispute");

        // Arbitrator awards the Approved work to the freelancer.
        const fBefore = await token.balanceOf(await freelancer.getAddress());
        await registry
          .connect(arb)
          .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);

        expect(await token.balanceOf(await freelancer.getAddress())).to.equal(
          fBefore + amount,
        );
        const p = await registry.getProject(1n);
        expect(p.status).to.equal(2); // Completed
        expect(p.activeDisputeCount).to.equal(0n);
        expect(p.releasedAmount).to.equal(amount);
        expect(p.refundedAmount).to.equal(0n);
        expect(
          await sumLiabilityForToken(registry, await token.getAddress(), 1n),
        ).to.equal(0n);
      });
    });
  });

  describe("audit fixes (N-14)", function () {
    // FIX N-14 (audit Finding 2, Medium): emergencyResolveDispute is gated by a 24h
    // propose+execute timelock so a compromised admin cannot move disputed funds
    // instantly. EMERGENCY_RESOLUTION_DELAY = 1 day.
    const EMERGENCY_DELAY_SECONDS = 24 * 60 * 60;

    async function advancePastEmergencyDelay(): Promise<void> {
      await ethers.provider.send("evm_increaseTime", [
        EMERGENCY_DELAY_SECONDS + 1,
      ]);
      await ethers.provider.send("evm_mine", []);
    }

    /**
     * Sets up a Submitted-milestone dispute that an admin can propose to resolve. Returns
     * the registry, token, signers, and a fully-funded project (id 1) with milestone 0 in
     * the Submitted+Disputed state — the canonical fixture for N-14 tests.
     */
    async function setupSubmittedDispute(
      amount: bigint,
    ): Promise<{
      admin: Signer;
      arb: Signer;
      client: Signer;
      freelancer: Signer;
      registry: EscrowFlowRegistry;
      token: MockERC20Stablecoin;
    }> {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry
        .connect(admin)
        .grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const token = await deployAndAllowMock(registry, admin, admin);

      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      return { admin, arb, client, freelancer, registry, token };
    }

    it("timelock blocks immediate execution (EmergencyResolutionNotReady)", async function () {
      const { admin, registry } = await setupSubmittedDispute(500n);

      // Admin proposes; readyAt is recorded. The propose tx itself emits the event with the
      // readyAt timestamp so off-chain monitors can react. We also exercise the view helper.
      await registry
        .connect(admin)
        .proposeEmergencyResolveDispute(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          500n,
          0n,
        );
      const readyAt = await registry.getEmergencyResolutionReadyAt(
        1n,
        0n,
        Resolution.ReleaseToFreelancer,
        500n,
        0n,
      );
      expect(readyAt).to.be.greaterThan(0n);

      // Same block, immediate execute → NotReady. The error carries the recorded readyAt.
      await expect(
        registry
          .connect(admin)
          .emergencyResolveDispute(
            1n,
            0n,
            Resolution.ReleaseToFreelancer,
            500n,
            0n,
          ),
      )
        .to.be.revertedWithCustomError(registry, "EmergencyResolutionNotReady")
        .withArgs(readyAt);

      // The proposal slot was not consumed; readyAt still set so monitoring stays accurate.
      expect(
        await registry.getEmergencyResolutionReadyAt(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          500n,
          0n,
        ),
      ).to.equal(readyAt);
    });

    it("duplicate propose of same emergency action reverts with existing readyAt", async function () {
      const { admin, registry } = await setupSubmittedDispute(510n);

      await registry
        .connect(admin)
        .proposeEmergencyResolveDispute(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          510n,
          0n,
        );
      const readyAt = await registry.getEmergencyResolutionReadyAt(
        1n,
        0n,
        Resolution.ReleaseToFreelancer,
        510n,
        0n,
      );
      expect(readyAt).to.be.greaterThan(0n);

      await expect(
        registry
          .connect(admin)
          .proposeEmergencyResolveDispute(
            1n,
            0n,
            Resolution.ReleaseToFreelancer,
            510n,
            0n,
          ),
      )
        .to.be.revertedWithCustomError(
          registry,
          "EmergencyResolutionAlreadyProposed",
        )
        .withArgs(readyAt);
    });

    it("cancel then re-propose allows resetting the emergency proposal", async function () {
      const { admin, registry } = await setupSubmittedDispute(515n);

      await registry
        .connect(admin)
        .proposeEmergencyResolveDispute(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          515n,
          0n,
        );
      const firstReadyAt = await registry.getEmergencyResolutionReadyAt(
        1n,
        0n,
        Resolution.ReleaseToFreelancer,
        515n,
        0n,
      );
      expect(firstReadyAt).to.be.greaterThan(0n);

      await registry
        .connect(admin)
        .cancelEmergencyResolveDispute(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          515n,
          0n,
        );
      expect(
        await registry.getEmergencyResolutionReadyAt(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          515n,
          0n,
        ),
      ).to.equal(0n);

      await registry
        .connect(admin)
        .proposeEmergencyResolveDispute(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          515n,
          0n,
        );
      const secondReadyAt = await registry.getEmergencyResolutionReadyAt(
        1n,
        0n,
        Resolution.ReleaseToFreelancer,
        515n,
        0n,
      );
      expect(secondReadyAt).to.be.greaterThan(0n);
    });

    it("execute without a prior proposal reverts EmergencyResolutionNotProposed", async function () {
      const { admin, registry } = await setupSubmittedDispute(400n);

      // No propose call. Even with the dispute open and params otherwise valid, the timelock
      // gate fails first — confirming the propose+execute pairing is mandatory, not optional.
      await expect(
        registry
          .connect(admin)
          .emergencyResolveDispute(
            1n,
            0n,
            Resolution.ReleaseToFreelancer,
            400n,
            0n,
          ),
      ).to.be.revertedWithCustomError(
        registry,
        "EmergencyResolutionNotProposed",
      );
    });

    it("execute with mismatched params reverts EmergencyResolutionNotProposed (hash binding)", async function () {
      const { admin, registry } = await setupSubmittedDispute(600n);

      // Admin proposes ReleaseToFreelancer(600, 0)…
      await registry
        .connect(admin)
        .proposeEmergencyResolveDispute(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          600n,
          0n,
        );
      await advancePastEmergencyDelay();

      // …then attempts to execute RefundToClient(0, 600) after the delay. Different params
      // → different action hash → no live slot → NotProposed. The proposal is still
      // executable under the original params.
      await expect(
        registry
          .connect(admin)
          .emergencyResolveDispute(
            1n,
            0n,
            Resolution.RefundToClient,
            0n,
            600n,
          ),
      ).to.be.revertedWithCustomError(
        registry,
        "EmergencyResolutionNotProposed",
      );

      // Sanity: the original params still execute successfully after the delay.
      await registry
        .connect(admin)
        .emergencyResolveDispute(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          600n,
          0n,
        );
    });

    it("arbitrator resolution invalidates pending emergency proposal via emergency nonce bump", async function () {
      const { admin, arb, registry } = await setupSubmittedDispute(700n);

      // Admin proposes RefundToClient.
      await registry
        .connect(admin)
        .proposeEmergencyResolveDispute(1n, 0n, Resolution.RefundToClient, 0n, 700n);
      const readyAtBefore = await registry.getEmergencyResolutionReadyAt(
        1n,
        0n,
        Resolution.RefundToClient,
        0n,
        700n,
      );
      expect(readyAtBefore).to.be.greaterThan(0n);

      // Before the delay elapses, an arbitrator resolves the dispute via the normal path.
      await registry
        .connect(arb)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, 700n, 0n);

      // After settlement, the dispute-level emergency nonce increments, so the old proposal
      // hash is no longer reachable.
      await advancePastEmergencyDelay();
      await expect(
        registry
          .connect(admin)
          .emergencyResolveDispute(1n, 0n, Resolution.RefundToClient, 0n, 700n),
      ).to.be.revertedWithCustomError(registry, "EmergencyResolutionNotProposed");

      // View helper also resolves against the new nonce and no longer sees the old proposal.
      expect(
        await registry.getEmergencyResolutionReadyAt(
          1n,
          0n,
          Resolution.RefundToClient,
          0n,
          700n,
        ),
      ).to.equal(0n);
    });

    it("stale-timeout settlement invalidates old emergency proposal", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 430n;

      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);

      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine", []);
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://pending-timeout");

      await registry
        .connect(admin)
        .proposeEmergencyResolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount);
      expect(
        await registry.getEmergencyResolutionReadyAt(
          1n,
          0n,
          Resolution.RefundToClient,
          0n,
          amount,
        ),
      ).to.be.greaterThan(0n);

      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);
      await registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n);

      await advancePastEmergencyDelay();
      await expect(
        registry
          .connect(admin)
          .emergencyResolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount),
      ).to.be.revertedWithCustomError(registry, "EmergencyResolutionNotProposed");
      expect(
        await registry.getEmergencyResolutionReadyAt(
          1n,
          0n,
          Resolution.RefundToClient,
          0n,
          amount,
        ),
      ).to.equal(0n);
    });

    it("cancelProject stale-pending closure invalidates old emergency proposal", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 390n;

      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);

      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine", []);
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://pending-cancel");

      await registry
        .connect(admin)
        .proposeEmergencyResolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount);
      expect(
        await registry.getEmergencyResolutionReadyAt(
          1n,
          0n,
          Resolution.RefundToClient,
          0n,
          amount,
        ),
      ).to.be.greaterThan(0n);

      await ethers.provider.send("evm_increaseTime", [14 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);
      await registry.connect(client).cancelProject(1n);

      await advancePastEmergencyDelay();
      await expect(
        registry
          .connect(admin)
          .emergencyResolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount),
      ).to.be.revertedWithCustomError(registry, "EmergencyResolutionNotProposed");
      expect(
        await registry.getEmergencyResolutionReadyAt(
          1n,
          0n,
          Resolution.RefundToClient,
          0n,
          amount,
        ),
      ).to.equal(0n);
    });

    it("emits EmergencyDisputeResolutionNonceAdvanced on every dispute-clearing path", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();

      // resolveDispute path
      {
        const registry = await deployRegistry(admin);
        const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
        await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 300n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");
        await expect(
          registry
            .connect(arb)
            .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
        )
          .to.emit(registry, "EmergencyDisputeResolutionNonceAdvanced")
          .withArgs(1n, 0n, 1n, await arb.getAddress());
      }

      // emergencyResolveDispute path
      {
        const { admin: a2, registry } = await setupSubmittedDispute(310n);
        await registry
          .connect(a2)
          .proposeEmergencyResolveDispute(
            1n,
            0n,
            Resolution.ReleaseToFreelancer,
            310n,
            0n,
          );
        await advancePastEmergencyDelay();
        await expect(
          registry
            .connect(a2)
            .emergencyResolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, 310n, 0n),
        )
          .to.emit(registry, "EmergencyDisputeResolutionNonceAdvanced")
          .withArgs(1n, 0n, 1n, await a2.getAddress());
      }

      // resolveStaleDisputeByTimeout path
      {
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 280n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await ethers.provider.send("evm_increaseTime", [2]);
        await ethers.provider.send("evm_mine", []);
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://pending");
        await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
        await ethers.provider.send("evm_mine", []);
        await expect(registry.connect(client).resolveStaleDisputeByTimeout(1n, 0n))
          .to.emit(registry, "EmergencyDisputeResolutionNonceAdvanced")
          .withArgs(1n, 0n, 1n, await client.getAddress());
      }

      // cancelProject stale pending-dispute close path
      {
        const registry = await deployRegistry(admin);
        const token = await deployAndAllowMock(registry, admin, admin);
        const amount = 260n;
        await token.connect(admin).mint(await client.getAddress(), amount * 2n);
        await registry
          .connect(client)
          .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
            milestone(amount, 1n),
          ]);
        await token.connect(client).approve(await registry.getAddress(), amount);
        await registry.connect(client).fundProject(1n, amount);
        await ethers.provider.send("evm_increaseTime", [2]);
        await ethers.provider.send("evm_mine", []);
        await registry.connect(client).raiseDispute(1n, 0n, "ipfs://pending");
        await ethers.provider.send("evm_increaseTime", [14 * 24 * 60 * 60 + 1]);
        await ethers.provider.send("evm_mine", []);
        await expect(registry.connect(client).cancelProject(1n))
          .to.emit(registry, "EmergencyDisputeResolutionNonceAdvanced")
          .withArgs(1n, 0n, 1n, await client.getAddress());
      }
    });

    it("setAlternativeRecipient after proposal cannot invalidate emergency execution", async function () {
      const amount = 640n;
      const { admin, arb, freelancer, registry, token } =
        await setupSubmittedDispute(amount);
      const [, , , , altFreelancer] = await ethers.getSigners();

      await registry
        .connect(admin)
        .proposeEmergencyResolveDispute(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          amount,
          0n,
        );
      const readyAtBefore = await registry.getEmergencyResolutionReadyAt(
        1n,
        0n,
        Resolution.ReleaseToFreelancer,
        amount,
        0n,
      );
      expect(readyAtBefore).to.be.greaterThan(0n);

      // Arbitrator recipient action mutates arbitrator action nonce, but must not orphan the
      // emergency proposal hash.
      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 0n, true, await altFreelancer.getAddress());
      expect(
        await registry.getEmergencyResolutionReadyAt(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          amount,
          0n,
        ),
      ).to.equal(readyAtBefore);

      await advancePastEmergencyDelay();

      const freelancerBefore = await token.balanceOf(await freelancer.getAddress());
      const projectBefore = await registry.getProject(1n);
      await expect(
        registry
          .connect(admin)
          .emergencyResolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
      )
        .to.emit(registry, "EmergencyDisputeResolved")
        .withArgs(
          1n,
          0n,
          await admin.getAddress(),
          Resolution.ReleaseToFreelancer,
          amount,
          0n,
        );

      // Pending alternative recipient was not auto-materialized by emergency settlement.
      expect(await token.balanceOf(await freelancer.getAddress())).to.equal(
        freelancerBefore + amount,
      );
      expect(await token.balanceOf(await altFreelancer.getAddress())).to.equal(0n);

      const projectAfter = await registry.getProject(1n);
      expect(projectAfter.releasedAmount).to.equal(projectBefore.releasedAmount + amount);
      expect(projectAfter.refundedAmount).to.equal(projectBefore.refundedAmount);
      expect(projectAfter.releasedAmount + projectAfter.refundedAmount).to.be.lte(
        projectAfter.fundedAmount,
      );

      await assertProjectCoreInvariants(registry, 1n);
      await assertTokenLiabilityInvariant(registry, token, 1n);

      // Proposal is single-use; second execute must fail.
      await expect(
        registry
          .connect(admin)
          .emergencyResolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
      ).to.be.revertedWithCustomError(registry, "EmergencyResolutionNotProposed");
    });

    it("cancelEmergencyResolveDispute clears a pending proposal and prevents later execution", async function () {
      const { admin, registry } = await setupSubmittedDispute(900n);

      await registry
        .connect(admin)
        .proposeEmergencyResolveDispute(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          900n,
          0n,
        );

      // Cancel emits the dedicated event. We don't pin the action hash to a specific value
      // (it depends on the runtime nonce) — anyValue is sufficient for the audit-trail check.
      await expect(
        registry
          .connect(admin)
          .cancelEmergencyResolveDispute(
            1n,
            0n,
            Resolution.ReleaseToFreelancer,
            900n,
            0n,
          ),
      )
        .to.emit(registry, "EmergencyDisputeResolutionCancelled")
        .withArgs(1n, 0n, await admin.getAddress(), anyValue);

      // The slot is cleared — view helper returns 0, late execute reverts NotProposed.
      expect(
        await registry.getEmergencyResolutionReadyAt(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          900n,
          0n,
        ),
      ).to.equal(0n);

      await advancePastEmergencyDelay();
      await expect(
        registry
          .connect(admin)
          .emergencyResolveDispute(
            1n,
            0n,
            Resolution.ReleaseToFreelancer,
            900n,
            0n,
          ),
      ).to.be.revertedWithCustomError(
        registry,
        "EmergencyResolutionNotProposed",
      );

      // Cancelling again with no live proposal also reverts NotProposed (idempotent guard).
      await expect(
        registry
          .connect(admin)
          .cancelEmergencyResolveDispute(
            1n,
            0n,
            Resolution.ReleaseToFreelancer,
            900n,
            0n,
          ),
      ).to.be.revertedWithCustomError(
        registry,
        "EmergencyResolutionNotProposed",
      );
    });

    it("emergencyResolveDispute reverts on project solvency overflow and keeps proposal/dispute/accounting safe", async function () {
      const amount = 700n;
      const { admin, registry } = await setupSubmittedDispute(amount);

      await registry
        .connect(admin)
        .proposeEmergencyResolveDispute(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          amount,
          0n,
        );
      await advancePastEmergencyDelay();

      const readyAtBefore = await registry.getEmergencyResolutionReadyAt(
        1n,
        0n,
        Resolution.ReleaseToFreelancer,
        amount,
        0n,
      );
      expect(readyAtBefore).to.be.greaterThan(0n);

      // Test-only storage shaping: force fundedAmount below emergency totalOut.
      await setProjectFundedAmountForTest(registry, 1n, amount - 1n);
      const projectBefore = await registry.getProject(1n);
      const disputeBefore = await registry.getDispute(1n, 0n);
      const milestoneBefore = await registry.getMilestone(1n, 0n);

      await expect(
        registry
          .connect(admin)
          .emergencyResolveDispute(
            1n,
            0n,
            Resolution.ReleaseToFreelancer,
            amount,
            0n,
          ),
      ).to.be.revertedWithCustomError(registry, "InsufficientEscrowLiquidity");

      // Revert path must not clear dispute/accounting, and the proposal remains executable.
      const projectAfter = await registry.getProject(1n);
      const disputeAfter = await registry.getDispute(1n, 0n);
      const milestoneAfter = await registry.getMilestone(1n, 0n);
      expect(disputeBefore.active).to.equal(true);
      expect(disputeAfter.active).to.equal(true);
      expect(projectAfter.activeDisputeCount).to.equal(projectBefore.activeDisputeCount);
      expect(projectAfter.reservedAmount).to.equal(projectBefore.reservedAmount);
      expect(projectAfter.releasedAmount).to.equal(projectBefore.releasedAmount);
      expect(projectAfter.refundedAmount).to.equal(projectBefore.refundedAmount);
      expect(milestoneAfter.status).to.equal(milestoneBefore.status);
      expect(
        await registry.getEmergencyResolutionReadyAt(
          1n,
          0n,
          Resolution.ReleaseToFreelancer,
          amount,
          0n,
        ),
      ).to.equal(readyAtBefore);

      // Restore fundedAmount and execute the same proposal successfully.
      await setProjectFundedAmountForTest(registry, 1n, amount);
      await expect(
        registry
          .connect(admin)
          .emergencyResolveDispute(
            1n,
            0n,
            Resolution.ReleaseToFreelancer,
            amount,
            0n,
          ),
      ).to.emit(registry, "EmergencyDisputeResolved");
    });

    it("valid emergency RefundToClient executes after delay", async function () {
      const amount = 520n;
      const { admin, client, registry, token } = await setupSubmittedDispute(amount);

      await registry
        .connect(admin)
        .proposeEmergencyResolveDispute(
          1n,
          0n,
          Resolution.RefundToClient,
          0n,
          amount,
        );
      await advancePastEmergencyDelay();

      const before = await token.balanceOf(await client.getAddress());
      await expect(
        registry
          .connect(admin)
          .emergencyResolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount),
      )
        .to.emit(registry, "EmergencyDisputeResolved")
        .withArgs(
          1n,
          0n,
          await admin.getAddress(),
          Resolution.RefundToClient,
          0n,
          amount,
        );
      expect(await token.balanceOf(await client.getAddress())).to.equal(before + amount);
    });

    it("valid emergency Split executes after delay", async function () {
      const amount = 1_000n;
      const toFreelancer = 650n;
      const toClient = 350n;
      const { admin, client, freelancer, registry, token } =
        await setupSubmittedDispute(amount);

      await registry
        .connect(admin)
        .proposeEmergencyResolveDispute(
          1n,
          0n,
          Resolution.Split,
          toFreelancer,
          toClient,
        );
      await advancePastEmergencyDelay();

      const fBefore = await token.balanceOf(await freelancer.getAddress());
      const cBefore = await token.balanceOf(await client.getAddress());
      await expect(
        registry
          .connect(admin)
          .emergencyResolveDispute(
            1n,
            0n,
            Resolution.Split,
            toFreelancer,
            toClient,
          ),
      )
        .to.emit(registry, "EmergencyDisputeResolved")
        .withArgs(
          1n,
          0n,
          await admin.getAddress(),
          Resolution.Split,
          toFreelancer,
          toClient,
        );
      expect(await token.balanceOf(await freelancer.getAddress())).to.equal(
        fBefore + toFreelancer,
      );
      expect(await token.balanceOf(await client.getAddress())).to.equal(
        cBefore + toClient,
      );
    });
  });

  describe("security non-regression matrix (A-M)", function () {
    const Resolution = {
      ReleaseToFreelancer: 0,
      RefundToClient: 1,
      Split: 2,
    } as const;

    async function setupTwoMilestoneProject(amount0: bigint, amount1: bigint) {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      await token.connect(admin).mint(await client.getAddress(), (amount0 + amount1) * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount0, 1n),
          milestone(amount1, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount0 + amount1);
      await registry.connect(client).fundProject(1n, amount0 + amount1);
      return { admin, client, freelancer, registry, token };
    }

    it("A+B: enforces dispute ordering and reserved-liquidity release guard", async function () {
      const amount0 = 300n;
      const amount1 = 300n;
      const { client, freelancer, registry, token } = await setupTwoMilestoneProject(
        amount0,
        amount1,
      );

      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine", []);
      await expect(
        registry.connect(client).raiseDispute(1n, 1n, "ipfs://future-dispute"),
      ).to.be.revertedWithCustomError(registry, "PreviousMilestoneNotCompleted");

      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://m0");
      await registry.connect(client).approveMilestone(1n, 0n);
      await registry.connect(client).releaseMilestone(1n, 0n);
      await registry.connect(client).raiseDispute(1n, 1n, "ipfs://m1");

      // B: force a reserved-liquidity condition on a separate approved milestone and ensure
      // releaseMilestone respects _freeLiquidity.
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta-b", [
          milestone(120n, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), 120n);
      await registry.connect(client).fundProject(2n, 120n);
      await registry.connect(freelancer).submitMilestone(2n, 0n, "ipfs://b");
      await registry.connect(client).approveMilestone(2n, 0n);
      await setProjectReservedAmountForTest(registry, 2n, 120n);
      await expect(registry.connect(client).releaseMilestone(2n, 0n)).to.be.revertedWithCustomError(
        registry,
        "InsufficientEscrowLiquidity",
      );

      await assertProjectCoreInvariants(registry, 1n);
      await assertProjectCoreInvariants(registry, 2n);
      await assertTokenLiabilityInvariant(registry, token, 2n);
    });

    it("C+D: solvency guards hold and stale timeout is pause-gated", async function () {
      const [admin, arb, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 500n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await setProjectFundedAmountForTest(registry, 1n, amount - 1n);
      const projectBefore = await registry.getProject(1n);
      const disputeBefore = await registry.getDispute(1n, 0n);

      await expect(
        registry.connect(arb).resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
      ).to.be.revertedWithCustomError(registry, "InsufficientEscrowLiquidity");

      await registry
        .connect(admin)
        .proposeEmergencyResolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);
      await expect(
        registry
          .connect(admin)
          .emergencyResolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n),
      ).to.be.revertedWithCustomError(registry, "InsufficientEscrowLiquidity");

      // Separate Pending-dispute path for stale-timeout pause + solvency checks.
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "pending", [
          milestone(120n, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), 120n);
      await registry.connect(client).fundProject(2n, 120n);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine", []);
      await registry.connect(client).raiseDispute(2n, 0n, "ipfs://pending");

      await registry.connect(admin).pause();
      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);
      await expect(
        registry.connect(client).resolveStaleDisputeByTimeout(2n, 0n),
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");
      await registry.connect(admin).unpause();
      await setProjectFundedAmountForTest(registry, 2n, 119n);
      await expect(
        registry.connect(client).resolveStaleDisputeByTimeout(2n, 0n),
      ).to.be.revertedWithCustomError(registry, "InsufficientEscrowLiquidity");

      const projectAfter = await registry.getProject(1n);
      const disputeAfter = await registry.getDispute(1n, 0n);
      expect(projectAfter.releasedAmount).to.equal(projectBefore.releasedAmount);
      expect(projectAfter.refundedAmount).to.equal(projectBefore.refundedAmount);
      expect(disputeBefore.active).to.equal(true);
      expect(disputeAfter.active).to.equal(true);
    });

    it("E: revoked arbitrator votes do not count toward execution", async function () {
      const [admin, a, b, c, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await a.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await b.getAddress());
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await c.getAddress());
      await registry.connect(admin).setArbitratorThreshold(2n);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 300n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://w");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await registry
        .connect(a)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      await registry.connect(admin).revokeRole(ARBITRATOR_ROLE, await a.getAddress());
      await registry
        .connect(b)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      let d = await registry.getDispute(1n, 0n);
      expect(d.active).to.equal(true);
      await registry
        .connect(c)
        .resolveDispute(1n, 0n, Resolution.ReleaseToFreelancer, amount, 0n);
      d = await registry.getDispute(1n, 0n);
      expect(d.active).to.equal(false);
    });

    it("F+G: submitted milestones are not refundable via cancel paths", async function () {
      const [admin, client, freelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 250n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://submitted");

      await ethers.provider.send("evm_increaseTime", [14 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);
      const clientBefore = await token.balanceOf(await client.getAddress());
      await registry.connect(client).cancelProject(1n);
      const clientAfter = await token.balanceOf(await client.getAddress());
      expect(clientAfter - clientBefore).to.equal(0n);

      // Emergency admin cancel also refuses submitted milestones.
      const registry2 = await deployRegistry(admin);
      await registry2
        .connect(admin)
        .attestTokenReviewForAllowlist(await token.getAddress());
      await registry2.connect(admin).setAllowedToken(await token.getAddress(), true);
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry2
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry2.getAddress(), amount);
      await registry2.connect(client).fundProject(1n, amount);
      await registry2.connect(freelancer).submitMilestone(1n, 0n, "ipfs://submitted");
      await expect(registry2.connect(admin).emergencyAdminCancel(1n)).to.be.reverted;
    });

    it("H+I+J+K: pending recipient behavior and emergency proposal stability/invalidation", async function () {
      const [admin, arb, client, freelancer, altPending, altExec] =
        await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const ARBITRATOR_ROLE = await registry.ARBITRATOR_ROLE();
      await registry.connect(admin).grantRole(ARBITRATOR_ROLE, await arb.getAddress());
      const token = await deployAndAllowMock(registry, admin, admin);
      const amount = 420n;
      await token.connect(admin).mint(await client.getAddress(), amount * 2n);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(1n, amount);
      await registry.connect(freelancer).submitMilestone(1n, 0n, "ipfs://work");
      await registry.connect(client).raiseDispute(1n, 0n, "ipfs://d");

      await registry
        .connect(admin)
        .proposeEmergencyResolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount);
      const readyBefore = await registry.getEmergencyResolutionReadyAt(
        1n,
        0n,
        Resolution.RefundToClient,
        0n,
        amount,
      );
      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, 0n, false, await altPending.getAddress());
      expect(
        await registry.getEmergencyResolutionReadyAt(
          1n,
          0n,
          Resolution.RefundToClient,
          0n,
          amount,
        ),
      ).to.equal(readyBefore);

      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);
      const pendingSlot = await findPendingAlternativeMappingSlot(
        registry,
        1n,
        0n,
        await altPending.getAddress(),
      );
      await registry
        .connect(admin)
        .emergencyResolveDispute(1n, 0n, Resolution.RefundToClient, 0n, amount);
      expect(await token.balanceOf(await altPending.getAddress())).to.equal(0n);
      expect(await getPendingAlternativeRecipientForTest(registry, 1n, 0n, pendingSlot)).to.equal(
        ethers.ZeroAddress,
      );

      // New dispute for stale-timeout path invalidation + pending non-auto-apply.
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta2", [
          milestone(amount, 1n),
        ]);
      await token.connect(client).approve(await registry.getAddress(), amount);
      await registry.connect(client).fundProject(2n, amount);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine", []);
      await registry.connect(client).raiseDispute(2n, 0n, "ipfs://pending");
      await registry
        .connect(admin)
        .proposeEmergencyResolveDispute(2n, 0n, Resolution.RefundToClient, 0n, amount);
      await registry
        .connect(arb)
        .setAlternativeRecipient(2n, 0n, false, await altExec.getAddress());
      const pendingSlot2 = await findPendingAlternativeMappingSlot(
        registry,
        2n,
        0n,
        await altExec.getAddress(),
      );
      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);
      await registry.connect(client).resolveStaleDisputeByTimeout(2n, 0n);
      await expect(
        registry
          .connect(admin)
          .emergencyResolveDispute(2n, 0n, Resolution.RefundToClient, 0n, amount),
      ).to.be.revertedWithCustomError(registry, "EmergencyResolutionNotProposed");
      expect(await token.balanceOf(await altExec.getAddress())).to.equal(0n);
      expect(await getPendingAlternativeRecipientForTest(registry, 2n, 0n, pendingSlot2)).to.equal(
        ethers.ZeroAddress,
      );
    });

    it("L+M: signature hardening and bytecode bound", async function () {
      const [admin, client, freelancer, altFreelancer] = await ethers.getSigners();
      const registry = await deployRegistry(admin);
      const token = await deployAndAllowMock(registry, admin, admin);
      await registry
        .connect(client)
        .createProject(await freelancer.getAddress(), await token.getAddress(), "meta", [
          milestone(1n, 1n),
        ]);

      const nonce = 0n;
      const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
      const lowSig = await signSetAlternativeRecipient(freelancer, registry, {
        projectId: 1n,
        milestoneIndex: 0n,
        isFreelancer: true,
        originalParty: await freelancer.getAddress(),
        newRecipient: await altFreelancer.getAddress(),
        nonce,
        deadline,
      });
      await registry.connect(client).setPartyAuthorizedRecipientBySig(
        1n,
        0n,
        true,
        await freelancer.getAddress(),
        await altFreelancer.getAddress(),
        nonce,
        deadline,
        lowSig,
      );
      await expect(
        registry.connect(client).setPartyAuthorizedRecipientBySig(
          1n,
          0n,
          true,
          await freelancer.getAddress(),
          await altFreelancer.getAddress(),
          nonce,
          deadline,
          lowSig,
        ),
      ).to.be.revertedWithCustomError(registry, "InvalidAuthorizationNonce");

      const highSig = malleateToHighS(
        await signSetAlternativeRecipient(freelancer, registry, {
          projectId: 1n,
          milestoneIndex: 0n,
          isFreelancer: true,
          originalParty: await freelancer.getAddress(),
          newRecipient: await altFreelancer.getAddress(),
          nonce: 1n,
          deadline,
        }),
      );
      await expect(
        registry.connect(client).setPartyAuthorizedRecipientBySig(
          1n,
          0n,
          true,
          await freelancer.getAddress(),
          await altFreelancer.getAddress(),
          1n,
          deadline,
          highSig,
        ),
      ).to.be.revertedWithCustomError(registry, "InvalidSignature");

      expect((await registry.getAddress()).length).to.be.greaterThan(0);
      expect((await ethers.provider.getCode(await registry.getAddress())).length / 2 - 1).to.be.lt(
        24576,
      );
    });
  });
});
