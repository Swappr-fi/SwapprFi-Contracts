const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SwappySale", function () {
  let swappy, sale, owner, devWallet;
  let buyers = [];

  const TOTAL_SUPPLY = ethers.parseEther("1000000000"); // 1B SWPY
  const SALE_FUND = ethers.parseEther("200000000"); // 200M SWPY
  const BUY_AMOUNT = ethers.parseEther("100"); // 100 BDAG per buyer

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    owner = signers[0];
    devWallet = signers[1];
    buyers = signers.slice(2, 112); // 110 buyers (100 + 10)

    // Deploy SwappyToken
    const Token = await ethers.getContractFactory("SwappyToken");
    swappy = await Token.deploy(TOTAL_SUPPLY);

    // Deploy SwappySale
    const Sale = await ethers.getContractFactory("SwappySale");
    sale = await Sale.deploy(await swappy.getAddress(), devWallet.address);

    // Fund sale with 200M SWPY
    await swappy.transfer(await sale.getAddress(), SALE_FUND);
  });

  // ======================== FRONTEND DATA FLOW ========================
  // Tests that verify remaining(), totalSold(), paused() update correctly
  // after every action — this is what the frontend reads via useReadContract

  describe("Frontend data flow", function () {
    it("remaining() returns funded amount before any buys", async function () {
      expect(await sale.remaining()).to.equal(SALE_FUND);
    });

    it("totalSold() returns 0 before any buys", async function () {
      expect(await sale.totalSold()).to.equal(0n);
    });

    it("paused() returns false initially", async function () {
      expect(await sale.paused()).to.equal(false);
    });

    it("remaining() and totalSold() update after a single buy", async function () {
      await sale.connect(buyers[0]).buy({ value: BUY_AMOUNT });

      expect(await sale.remaining()).to.equal(SALE_FUND - BUY_AMOUNT);
      expect(await sale.totalSold()).to.equal(BUY_AMOUNT);
    });

    it("remaining() and totalSold() update after multiple sequential buys", async function () {
      // First buy
      await sale.connect(buyers[0]).buy({ value: BUY_AMOUNT });
      expect(await sale.remaining()).to.equal(SALE_FUND - BUY_AMOUNT);
      expect(await sale.totalSold()).to.equal(BUY_AMOUNT);

      // Second buy (same user, different amount)
      const secondAmount = ethers.parseEther("250");
      await sale.connect(buyers[0]).buy({ value: secondAmount });
      expect(await sale.remaining()).to.equal(SALE_FUND - BUY_AMOUNT - secondAmount);
      expect(await sale.totalSold()).to.equal(BUY_AMOUNT + secondAmount);

      // Third buy (different user)
      await sale.connect(buyers[1]).buy({ value: BUY_AMOUNT });
      const totalBought = BUY_AMOUNT + secondAmount + BUY_AMOUNT;
      expect(await sale.remaining()).to.equal(SALE_FUND - totalBought);
      expect(await sale.totalSold()).to.equal(totalBought);
    });

    it("buyer receives correct SWPY balance after buy", async function () {
      expect(await swappy.balanceOf(buyers[0].address)).to.equal(0n);

      await sale.connect(buyers[0]).buy({ value: BUY_AMOUNT });
      expect(await swappy.balanceOf(buyers[0].address)).to.equal(BUY_AMOUNT);

      // Buy again
      await sale.connect(buyers[0]).buy({ value: BUY_AMOUNT });
      expect(await swappy.balanceOf(buyers[0].address)).to.equal(BUY_AMOUNT * 2n);
    });

    it("devWallet receives BDAG after each buy", async function () {
      const before = await ethers.provider.getBalance(devWallet.address);

      await sale.connect(buyers[0]).buy({ value: BUY_AMOUNT });
      const after1 = await ethers.provider.getBalance(devWallet.address);
      expect(after1 - before).to.equal(BUY_AMOUNT);

      await sale.connect(buyers[1]).buy({ value: BUY_AMOUNT });
      const after2 = await ethers.provider.getBalance(devWallet.address);
      expect(after2 - before).to.equal(BUY_AMOUNT * 2n);
    });

    it("paused() updates immediately after setPaused", async function () {
      expect(await sale.paused()).to.equal(false);

      await sale.connect(owner).setPaused(true);
      expect(await sale.paused()).to.equal(true);

      await sale.connect(owner).setPaused(false);
      expect(await sale.paused()).to.equal(false);
    });

    it("data is consistent after: buy → pause → unpause → buy", async function () {
      // Buy 100 BDAG
      await sale.connect(buyers[0]).buy({ value: BUY_AMOUNT });
      expect(await sale.remaining()).to.equal(SALE_FUND - BUY_AMOUNT);
      expect(await sale.totalSold()).to.equal(BUY_AMOUNT);
      expect(await sale.paused()).to.equal(false);

      // Pause
      await sale.connect(owner).setPaused(true);
      expect(await sale.paused()).to.equal(true);

      // Data unchanged while paused
      expect(await sale.remaining()).to.equal(SALE_FUND - BUY_AMOUNT);
      expect(await sale.totalSold()).to.equal(BUY_AMOUNT);

      // Buy fails while paused
      await expect(
        sale.connect(buyers[1]).buy({ value: BUY_AMOUNT })
      ).to.be.revertedWith("SwappySale: PAUSED");

      // Data still unchanged
      expect(await sale.remaining()).to.equal(SALE_FUND - BUY_AMOUNT);
      expect(await sale.totalSold()).to.equal(BUY_AMOUNT);

      // Unpause
      await sale.connect(owner).setPaused(false);
      expect(await sale.paused()).to.equal(false);

      // Buy again
      await sale.connect(buyers[1]).buy({ value: BUY_AMOUNT });
      expect(await sale.remaining()).to.equal(SALE_FUND - BUY_AMOUNT * 2n);
      expect(await sale.totalSold()).to.equal(BUY_AMOUNT * 2n);
    });

    it("remaining() becomes 0 after withdrawToken and buy reverts with SOLD_OUT", async function () {
      await sale.connect(owner).setPaused(true);
      await sale.connect(owner).withdrawToken(await swappy.getAddress(), SALE_FUND);

      expect(await sale.remaining()).to.equal(0n);

      await sale.connect(owner).setPaused(false);
      await expect(
        sale.connect(buyers[0]).buy({ value: BUY_AMOUNT })
      ).to.be.revertedWith("SwappySale: SOLD_OUT");
    });
  });

  // ======================== FULL LIFECYCLE ========================

  describe("Full lifecycle", function () {
    it("should have 200M SWPY after funding", async function () {
      expect(await sale.remaining()).to.equal(SALE_FUND);
    });

    it("should start unpaused", async function () {
      expect(await sale.paused()).to.equal(false);
    });

    it("100 users buy, pause, 100 fail, unpause, 10 buy, pause, withdraw remaining", async function () {
      const saleAddr = await sale.getAddress();

      // ─── Phase 1: 100 users buy successfully ─────────────────
      const devBalanceBefore = await ethers.provider.getBalance(devWallet.address);

      for (let i = 0; i < 100; i++) {
        await sale.connect(buyers[i]).buy({ value: BUY_AMOUNT });
      }

      // Each buyer should have 100 SWPY
      for (let i = 0; i < 100; i++) {
        expect(await swappy.balanceOf(buyers[i].address)).to.equal(BUY_AMOUNT);
      }

      // Total sold should be 100 * 100 = 10,000 SWPY
      const expectedSold = BUY_AMOUNT * 100n;
      expect(await sale.totalSold()).to.equal(expectedSold);

      // Dev wallet should have received 10,000 BDAG
      const devBalanceAfter = await ethers.provider.getBalance(devWallet.address);
      expect(devBalanceAfter - devBalanceBefore).to.equal(expectedSold);

      // Remaining should be 200M - 10,000
      expect(await sale.remaining()).to.equal(SALE_FUND - expectedSold);

      // ─── Phase 2: Pause — 100 users fail to buy ─────────────
      await sale.connect(owner).setPaused(true);
      expect(await sale.paused()).to.equal(true);

      for (let i = 0; i < 100; i++) {
        await expect(
          sale.connect(buyers[i]).buy({ value: BUY_AMOUNT })
        ).to.be.revertedWith("SwappySale: PAUSED");
      }

      // Totals unchanged
      expect(await sale.totalSold()).to.equal(expectedSold);

      // ─── Phase 3: Unpause — 10 users buy ────────────────────
      await sale.connect(owner).setPaused(false);
      expect(await sale.paused()).to.equal(false);

      for (let i = 100; i < 110; i++) {
        await sale.connect(buyers[i]).buy({ value: BUY_AMOUNT });
      }

      // 10 new buyers should have 100 SWPY each
      for (let i = 100; i < 110; i++) {
        expect(await swappy.balanceOf(buyers[i].address)).to.equal(BUY_AMOUNT);
      }

      // Total sold should now be 110 * 100 = 11,000 SWPY
      const totalSoldFinal = BUY_AMOUNT * 110n;
      expect(await sale.totalSold()).to.equal(totalSoldFinal);

      // Should still have tokens remaining
      const remainingAfter = await sale.remaining();
      expect(remainingAfter).to.equal(SALE_FUND - totalSoldFinal);
      expect(remainingAfter).to.be.gt(0n);

      // ─── Phase 4: Pause and withdraw all tokens to dev ──────
      await sale.connect(owner).setPaused(true);
      expect(await sale.paused()).to.equal(true);

      // Verify buy is blocked
      await expect(
        sale.connect(buyers[0]).buy({ value: BUY_AMOUNT })
      ).to.be.revertedWith("SwappySale: PAUSED");

      // Owner withdraws all remaining SWPY
      const ownerSwpyBefore = await swappy.balanceOf(owner.address);
      await sale.connect(owner).withdrawToken(await swappy.getAddress(), remainingAfter);
      const ownerSwpyAfterWithdraw = await swappy.balanceOf(owner.address);

      expect(ownerSwpyAfterWithdraw - ownerSwpyBefore).to.equal(remainingAfter);
      expect(await sale.remaining()).to.equal(0n);
    });
  });

  // ======================== ACCESS CONTROL ========================

  describe("Access control", function () {
    it("non-owner cannot pause", async function () {
      await expect(
        sale.connect(buyers[0]).setPaused(true)
      ).to.be.revertedWith("SwappySale: FORBIDDEN");
    });

    it("non-owner cannot withdraw tokens", async function () {
      await expect(
        sale.connect(buyers[0]).withdrawToken(await swappy.getAddress(), 1n)
      ).to.be.revertedWith("SwappySale: FORBIDDEN");
    });
  });

  // ======================== EDGE CASES ========================

  describe("Edge cases", function () {
    it("reverts on zero amount buy", async function () {
      await expect(
        sale.connect(buyers[0]).buy({ value: 0n })
      ).to.be.revertedWith("SwappySale: ZERO_AMOUNT");
    });

    it("reverts when buying more than remaining", async function () {
      // Withdraw most tokens so only 50 SWPY remains
      const withdrawAmount = SALE_FUND - ethers.parseEther("50");
      await sale.connect(owner).withdrawToken(await swappy.getAddress(), withdrawAmount);

      await expect(
        sale.connect(buyers[0]).buy({ value: BUY_AMOUNT }) // trying to buy 100
      ).to.be.revertedWith("SwappySale: SOLD_OUT");
    });
  });

  // ======================== EVENTS ========================

  describe("Events", function () {
    it("emits SalePaused on pause", async function () {
      await expect(sale.connect(owner).setPaused(true))
        .to.emit(sale, "SalePaused")
        .withArgs(true);
    });

    it("emits SalePaused on unpause", async function () {
      await sale.connect(owner).setPaused(true);
      await expect(sale.connect(owner).setPaused(false))
        .to.emit(sale, "SalePaused")
        .withArgs(false);
    });

    it("emits TokensPurchased on buy", async function () {
      await expect(sale.connect(buyers[0]).buy({ value: BUY_AMOUNT }))
        .to.emit(sale, "TokensPurchased")
        .withArgs(buyers[0].address, BUY_AMOUNT);
    });
  });
});
