import { expect } from "chai";
import { ethers } from "hardhat";

import type { MockERC20Stablecoin } from "../typechain-types/contracts/mocks/MockERC20Stablecoin";

async function deployMock(
  owner: { address: string },
): Promise<MockERC20Stablecoin> {
  const Mock = await ethers.getContractFactory("MockERC20Stablecoin");
  const deployed = await Mock.deploy(owner.address);
  await deployed.waitForDeployment();
  return deployed as unknown as MockERC20Stablecoin;
}

describe("MockERC20Stablecoin", function () {
  it("uses 6 decimals and exposes name/symbol", async function () {
    const [owner] = await ethers.getSigners();
    const token = await deployMock(owner);

    expect(await token.name()).to.equal("Mock USD Stablecoin");
    expect(await token.symbol()).to.equal("mUSD");
    expect(await token.decimals()).to.equal(6);
  });

  it("mints only by owner and transfers", async function () {
    const [owner, alice, bob] = await ethers.getSigners();
    const token = await deployMock(owner);

    const amount = 1_000_000n; // 1.0 token in 6 decimals
    await expect(token.connect(alice).mint(alice.address, amount)).to.be
      .revertedWithCustomError(token, "OwnableUnauthorizedAccount")
      .withArgs(alice.address);

    await token.mint(alice.address, amount);
    expect(await token.balanceOf(alice.address)).to.equal(amount);

    await token.connect(alice).transfer(bob.address, 400_000n);
    expect(await token.balanceOf(bob.address)).to.equal(400_000n);
    expect(await token.balanceOf(alice.address)).to.equal(600_000n);
  });
});
