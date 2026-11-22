const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AssetTransactionRegistry", function () {
  async function deployFixture() {
    const [owner, recipient] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("AssetTransactionRegistry");
    const registry = await Factory.deploy();
    await registry.waitForDeployment();
    return { registry, owner, recipient };
  }

  it("records and verifies a simulated asset transaction", async function () {
    const { registry, owner, recipient } = await deployFixture();

    await expect(registry.recordTransaction(recipient.address, "DEMO", 25))
      .to.emit(registry, "TransactionRecorded");

    const exists = await registry.verifyTransaction(1);
    expect(exists).to.equal(true);
    const record = await registry.getTransaction(1);
    expect(record.id).to.equal(1n);
    expect(record.from).to.equal(owner.address);
    expect(record.to).to.equal(recipient.address);
    expect(record.asset).to.equal("DEMO");
    expect(record.amount).to.equal(25n);
    expect(await registry.getTransactionCount()).to.equal(1n);
  });

  it("returns false for unknown transaction IDs", async function () {
    const { registry } = await deployFixture();
    const exists = await registry.verifyTransaction(999);
    expect(exists).to.equal(false);
    const record = await registry.getTransaction(999);
    expect(record.id).to.equal(0n);
  });

  it("rejects zero address, empty asset, or zero amount", async function () {
    const { registry, recipient } = await deployFixture();

    await expect(
      registry.recordTransaction(ethers.ZeroAddress, "DEMO", 10)
    ).to.be.revertedWithCustomError(registry, "InvalidRecipient");

    await expect(
      registry.recordTransaction(recipient.address, "", 10)
    ).to.be.revertedWithCustomError(registry, "InvalidAssetLabel");

    await expect(
      registry.recordTransaction(recipient.address, "DEMO", 0)
    ).to.be.revertedWithCustomError(registry, "InvalidAmount");
  });
});
