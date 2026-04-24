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
    .setAllowedToken(await token.getAddress(), true);
  return token;
}

function milestone(
  amount: bigint,
  deadline: bigint,
): { amount: bigint; deadline: bigint } {
  return { amount, deadline };
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

describe("EscrowFlowRegistry", function () {
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

  /** Solidity: Pending=0, Submitted=1, Approved=2, Released=3, Refunded=4 */
  const MS = {
    Pending: 0,
    Submitted: 1,
    Approved: 2,
    Released: 3,
    Refunded: 4,
  } as const;

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
      await token.connect(client).approve(await registry.getAddress(), 500n);
      await registry.connect(client).fundProject(1n, 500n);

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

    it("allows pending dispute when available liquidity covers milestone", async function () {
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
      await token.connect(client).approve(await registry.getAddress(), 500n);
      await registry.connect(client).fundProject(1n, 500n);

      await expect(registry.connect(freelancer).raiseDispute(1n, 2n, "ipfs://late-m2"))
        .to.emit(registry, "DisputeRaised")
        .withArgs(1n, 2n, await freelancer.getAddress(), await token.getAddress(), MS.Pending, "ipfs://late-m2");
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

    it("reverts freelancer dispute on approved milestone", async function () {
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
        registry.connect(freelancer).raiseDispute(1n, 0n, "ipfs://grief"),
      ).to.be.revertedWithCustomError(registry, "NotAuthorizedToRaiseDispute");
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
        .setAlternativeRecipient(1n, true, await altFreelancer.getAddress());

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

    it("reverts raiseDispute while paused but allows resolveDispute", async function () {
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
      ).to.be.revertedWith("BLACKLISTED_TO");

      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, true, await altFreelancer.getAddress());
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
      ).to.be.revertedWith("BLACKLISTED_TO");

      await registry
        .connect(arb)
        .setAlternativeRecipient(1n, false, await altClient.getAddress());
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
          .setAlternativeRecipient(1n, true, await altFreelancer.getAddress()),
      ).to.be.revertedWithCustomError(registry, "NoActiveDisputeForProject");
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
});
