const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VukangLedger", function () {
  const THRESHOLD = 1000n;

  async function deploy() {
    const [owner, alice, bob, auditor, outsider] = await ethers.getSigners();
    const Ledger = await ethers.getContractFactory("VukangLedger");
    const ledger = await Ledger.deploy(THRESHOLD);
    await ledger.waitForDeployment();
    return { ledger, owner, alice, bob, auditor, outsider };
  }

  async function funded() {
    const ctx = await deploy();
    await ctx.ledger.mint(ctx.alice.address, 5000, "Opening balance");
    return ctx;
  }

  // Recomputes a record hash off-chain, exactly as the contract does.
  function offchainHash(r) {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint8", "address", "address", "uint256", "string", "uint256", "uint256", "bytes32"],
        [r.id, r.kind, r.from, r.to, r.amount, r.memo, r.timestamp, r.blockNumber, r.prevHash]
      )
    );
  }

  describe("minting", function () {
    it("lets the owner mint and updates balance and supply", async function () {
      const { ledger, alice } = await deploy();
      await expect(ledger.mint(alice.address, 500, "Top up")).to.emit(ledger, "Recorded");
      expect(await ledger.balanceOf(alice.address)).to.equal(500n);
      expect(await ledger.totalSupply()).to.equal(500n);
      expect(await ledger.getRecordCount()).to.equal(1n);
    });

    it("rejects minting by anyone except the owner", async function () {
      const { ledger, alice, outsider } = await deploy();
      await expect(ledger.connect(outsider).mint(alice.address, 1, "x"))
        .to.be.revertedWithCustomError(ledger, "NotOwner");
    });

    it("rejects zero address, zero amount and long memos", async function () {
      const { ledger, alice } = await deploy();
      await expect(ledger.mint(ethers.ZeroAddress, 1, "x")).to.be.revertedWithCustomError(ledger, "InvalidRecipient");
      await expect(ledger.mint(alice.address, 0, "x")).to.be.revertedWithCustomError(ledger, "InvalidAmount");
      await expect(ledger.mint(alice.address, 1, "x".repeat(81))).to.be.revertedWithCustomError(ledger, "InvalidMemo");
    });
  });

  describe("transfers", function () {
    it("moves balances for real and records the transfer", async function () {
      const { ledger, alice, bob } = await funded();
      await expect(ledger.connect(alice)["transfer(address,uint256,string)"](bob.address, 200, "Rent"))
        .to.emit(ledger, "Recorded");
      expect(await ledger.balanceOf(alice.address)).to.equal(4800n);
      expect(await ledger.balanceOf(bob.address)).to.equal(200n);
      expect(await ledger.totalSupply()).to.equal(5000n);

      const r = await ledger.getRecord(2);
      expect(r.from).to.equal(alice.address);
      expect(r.to).to.equal(bob.address);
      expect(r.amount).to.equal(200n);
      expect(r.memo).to.equal("Rent");
      expect(r.flagged).to.equal(false);
    });

    it("rejects a transfer larger than the sender's balance", async function () {
      const { ledger, alice, bob } = await funded();
      await expect(ledger.connect(alice)["transfer(address,uint256,string)"](bob.address, 5001, "Too much"))
        .to.be.revertedWithCustomError(ledger, "InsufficientBalance")
        .withArgs(5000, 5001);
      expect(await ledger.balanceOf(alice.address)).to.equal(5000n);
      expect(await ledger.getRecordCount()).to.equal(1n);
    });

    it("rejects an account with no balance", async function () {
      const { ledger, bob, outsider } = await funded();
      await expect(ledger.connect(outsider)["transfer(address,uint256,string)"](bob.address, 1, "x"))
        .to.be.revertedWithCustomError(ledger, "InsufficientBalance");
    });

    it("rejects zero amount, zero address and self transfer", async function () {
      const { ledger, alice, bob } = await funded();
      await expect(ledger.connect(alice)["transfer(address,uint256,string)"](bob.address, 0, "x")).to.be.revertedWithCustomError(ledger, "InvalidAmount");
      await expect(ledger.connect(alice)["transfer(address,uint256,string)"](ethers.ZeroAddress, 1, "x")).to.be.revertedWithCustomError(ledger, "InvalidRecipient");
      await expect(ledger.connect(alice)["transfer(address,uint256,string)"](alice.address, 1, "x")).to.be.revertedWithCustomError(ledger, "SelfTransfer");
    });
  });

  describe("verification", function () {
    it("verifies records and the whole chain", async function () {
      const { ledger, alice, bob } = await funded();
      await ledger.connect(alice)["transfer(address,uint256,string)"](bob.address, 10, "a");
      await ledger.connect(alice)["transfer(address,uint256,string)"](bob.address, 20, "b");

      for (const id of [1, 2, 3]) expect(await ledger.verifyRecord(id)).to.equal(true);
      const [valid, broken] = await ledger.verifyChain();
      expect(valid).to.equal(true);
      expect(broken).to.equal(0n);
    });

    it("returns false for ids that do not exist", async function () {
      const { ledger } = await funded();
      expect(await ledger.verifyRecord(0)).to.equal(false);
      expect(await ledger.verifyRecord(999)).to.equal(false);
      await expect(ledger.getRecord(999)).to.be.revertedWithCustomError(ledger, "UnknownRecord");
    });

    it("links each record to the previous hash and matches an off-chain recomputation", async function () {
      const { ledger, alice, bob } = await funded();
      await ledger.connect(alice)["transfer(address,uint256,string)"](bob.address, 10, "a");

      const r1 = await ledger.getRecord(1);
      const r2 = await ledger.getRecord(2);
      expect(r1.prevHash).to.equal(ethers.ZeroHash);
      expect(r2.prevHash).to.equal(r1.recordHash);
      expect(offchainHash(r1)).to.equal(r1.recordHash);
      expect(offchainHash(r2)).to.equal(r2.recordHash);
      expect(await ledger.headHash()).to.equal(r2.recordHash);
    });

    it("keeps the integrity hash unchanged when a record is flagged", async function () {
      const { ledger, alice, bob } = await funded();
      await ledger.connect(alice)["transfer(address,uint256,string)"](bob.address, 10, "a");
      const before = (await ledger.getRecord(2)).recordHash;
      await ledger.flag(2, "Manual review");
      expect((await ledger.getRecord(2)).recordHash).to.equal(before);
      expect(await ledger.verifyRecord(2)).to.equal(true);
    });

    it("pages through records", async function () {
      const { ledger, alice, bob } = await funded();
      for (let i = 0; i < 4; i++) await ledger.connect(alice)["transfer(address,uint256,string)"](bob.address, 1, `t${i}`);
      const page = await ledger.getRecords(1, 3);
      expect(page.length).to.equal(3);
      expect(page[0].id).to.equal(2n);
      expect((await ledger.getRecords(10, 5)).length).to.equal(0);
    });
  });

  describe("monitoring", function () {
    it("auto-flags transfers at or above the alert threshold", async function () {
      const { ledger, alice, bob } = await funded();
      await expect(ledger.connect(alice)["transfer(address,uint256,string)"](bob.address, THRESHOLD, "Big"))
        .to.emit(ledger, "Flagged").withArgs(2, alice.address, "LARGE_AMOUNT");
      const r = await ledger.getRecord(2);
      expect(r.flagged).to.equal(true);
      expect(r.flagReason).to.equal("LARGE_AMOUNT");
      await ledger.connect(alice)["transfer(address,uint256,string)"](bob.address, THRESHOLD - 1n, "Just under");
      expect((await ledger.getRecord(3)).flagged).to.equal(false);
    });

    it("lets the owner change the threshold", async function () {
      const { ledger, alice, bob, outsider } = await funded();
      await expect(ledger.connect(outsider).setAlertThreshold(5)).to.be.revertedWithCustomError(ledger, "NotOwner");
      await ledger.setAlertThreshold(50);
      await ledger.connect(alice)["transfer(address,uint256,string)"](bob.address, 50, "x");
      expect((await ledger.getRecord(2)).flagged).to.equal(true);
    });

    it("lets auditors flag a record once, and blocks everyone else", async function () {
      const { ledger, alice, bob, auditor, outsider } = await funded();
      await ledger.connect(alice)["transfer(address,uint256,string)"](bob.address, 10, "x");
      await expect(ledger.connect(auditor).flag(2, "r")).to.be.revertedWithCustomError(ledger, "NotAuditor");
      await ledger.setAuditor(auditor.address, true);
      await expect(ledger.connect(outsider).flag(2, "r")).to.be.revertedWithCustomError(ledger, "NotAuditor");
      await expect(ledger.connect(auditor).flag(2, "Suspicious memo")).to.emit(ledger, "Flagged");
      await expect(ledger.connect(auditor).flag(2, "again")).to.be.revertedWithCustomError(ledger, "AlreadyFlagged");
      await expect(ledger.connect(auditor).flag(99, "x")).to.be.revertedWithCustomError(ledger, "UnknownRecord");
    });

    it("freezes accounts so they cannot send or receive", async function () {
      const { ledger, alice, bob, auditor } = await funded();
      await ledger.setAuditor(auditor.address, true);
      await expect(ledger.connect(auditor).setFrozen(alice.address, true))
        .to.emit(ledger, "FrozenChanged").withArgs(alice.address, true, auditor.address);

      await expect(ledger.connect(alice)["transfer(address,uint256,string)"](bob.address, 1, "x"))
        .to.be.revertedWithCustomError(ledger, "AccountFrozen");

      await ledger.setFrozen(bob.address, true);
      await ledger.setFrozen(alice.address, false);
      await expect(ledger.connect(alice)["transfer(address,uint256,string)"](bob.address, 1, "x"))
        .to.be.revertedWithCustomError(ledger, "AccountFrozen");

      await ledger.setFrozen(bob.address, false);
      await ledger.connect(alice)["transfer(address,uint256,string)"](bob.address, 1, "x");
      expect(await ledger.balanceOf(bob.address)).to.equal(1n);
    });
  });
  describe("wallet compatibility (ERC-20 subset)", function () {
    it("exposes name, symbol, decimals, totalSupply and balanceOf", async function () {
      const { ledger, alice } = await funded();
      expect(await ledger.name()).to.equal("Vukang Credit");
      expect(await ledger.symbol()).to.equal("VKC");
      expect(await ledger.decimals()).to.equal(0n);
      expect(await ledger.totalSupply()).to.equal(5000n);
      expect(await ledger.balanceOf(alice.address)).to.equal(5000n);
    });

    it("accepts the plain transfer(to, amount) call that wallets send", async function () {
      const { ledger, alice, bob } = await funded();
      await expect(ledger.connect(alice)["transfer(address,uint256)"](bob.address, 300))
        .to.emit(ledger, "Transfer").withArgs(alice.address, bob.address, 300)
        .and.to.emit(ledger, "Recorded");
      expect(await ledger.balanceOf(bob.address)).to.equal(300n);
      const r = await ledger.getRecord(2);
      expect(r.memo).to.equal("");
      expect(await ledger.verifyRecord(2)).to.equal(true);
    });

    it("applies the same rules to the plain transfer", async function () {
      const { ledger, alice, bob } = await funded();
      await expect(ledger.connect(alice)["transfer(address,uint256)"](bob.address, 99999))
        .to.be.revertedWithCustomError(ledger, "InsufficientBalance");
      await ledger.connect(alice)["transfer(address,uint256)"](bob.address, THRESHOLD);
      expect((await ledger.getRecord(2)).flagged).to.equal(true);
    });

    it("emits Transfer from the zero address when minting", async function () {
      const { ledger, alice } = await deploy();
      await expect(ledger.mint(alice.address, 10, "x"))
        .to.emit(ledger, "Transfer").withArgs(ethers.ZeroAddress, alice.address, 10);
    });
  });
});
