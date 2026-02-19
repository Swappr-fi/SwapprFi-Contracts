const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("SwappyStaking", function () {
  let swappy, staking, owner;
  let stakers = [];

  const TOTAL_SUPPLY = ethers.parseEther("1000000000"); // 1B
  const REWARD_FUND = ethers.parseEther("200000000"); // 200M for rewards
  const STAKE_AMOUNT = ethers.parseEther("100"); // 100 SWPY per staker
  const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
  const LOCK_PERIOD = 90 * 24 * 60 * 60; // 90 days in seconds

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    owner = signers[0];
    stakers = signers.slice(1, 21); // 20 stakers

    // Deploy token
    const Token = await ethers.getContractFactory("SwappyToken");
    swappy = await Token.deploy(TOTAL_SUPPLY);

    // Deploy staking
    const Staking = await ethers.getContractFactory("SwappyStaking");
    staking = await Staking.deploy(await swappy.getAddress());

    // Fund rewards
    await swappy.approve(await staking.getAddress(), REWARD_FUND);
    await staking.fundRewards(REWARD_FUND);

    // Distribute SWPY to stakers (1000 each)
    const dist = ethers.parseEther("1000");
    for (let i = 0; i < stakers.length; i++) {
      await swappy.transfer(stakers[i].address, dist);
    }
  });

  // ======================== STAKING READS ========================
  // Tests that verify what the frontend reads via useReadContract

  describe("Frontend reads after staking", function () {
    it("totalStaked() is 0 initially", async function () {
      expect(await staking.totalStaked()).to.equal(0n);
    });

    it("rewardReserve() equals funded amount initially", async function () {
      expect(await staking.rewardReserve()).to.equal(REWARD_FUND);
    });

    it("stakes() returns zero for user who hasnt staked", async function () {
      const info = await staking.stakes(stakers[0].address);
      expect(info.amount).to.equal(0n);
    });

    it("pendingReward() is 0 for user who hasnt staked", async function () {
      expect(await staking.pendingReward(stakers[0].address)).to.equal(0n);
    });

    it("after staking 100: stakes().amount == 100, totalStaked == 100", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);

      const info = await staking.stakes(stakers[0].address);
      expect(info.amount).to.equal(STAKE_AMOUNT);
      expect(await staking.totalStaked()).to.equal(STAKE_AMOUNT);
    });

    it("wallet balance decreases after staking", async function () {
      const before = await swappy.balanceOf(stakers[0].address);
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);
      const after = await swappy.balanceOf(stakers[0].address);

      expect(before - after).to.equal(STAKE_AMOUNT);
    });

    it("rewardReserve() stays the same after staking (no rewards distributed yet)", async function () {
      const reserveBefore = await staking.rewardReserve();
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);
      const reserveAfter = await staking.rewardReserve();

      // Reserve decreases by 0 because no rewards claimed, but it decreases
      // because totalStaked increased (rewardReserve = balance - totalStaked)
      expect(reserveAfter).to.equal(reserveBefore);
    });
  });

  // ======================== PENDING REWARDS ========================

  describe("Pending rewards after time passes", function () {
    it("pendingReward() > 0 after 1 year at 10% APY", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);

      // Fast forward 1 year
      await time.increase(365 * 24 * 60 * 60);

      const reward = await staking.pendingReward(stakers[0].address);
      // 10% of 100 = 10 SWPY
      const expected = ethers.parseEther("10");

      // Allow small rounding tolerance (within 0.001 SWPY)
      const diff = reward > expected ? reward - expected : expected - reward;
      expect(diff).to.be.lt(ethers.parseEther("0.001"));
    });

    it("pendingReward() accrues proportionally over time", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);

      // Fast forward 6 months
      await time.increase(182.5 * 24 * 60 * 60);

      const reward = await staking.pendingReward(stakers[0].address);
      // ~5% of 100 = ~5 SWPY for 6 months
      const expected = ethers.parseEther("5");
      const diff = reward > expected ? reward - expected : expected - reward;
      expect(diff).to.be.lt(ethers.parseEther("0.1"));
    });
  });

  // ======================== TOTAL STAKED (MULTIPLE USERS) ========================

  describe("Total staked with multiple users", function () {
    it("totalStaked() accumulates across 10 stakers", async function () {
      for (let i = 0; i < 10; i++) {
        await swappy.connect(stakers[i]).approve(await staking.getAddress(), STAKE_AMOUNT);
        await staking.connect(stakers[i]).stake(STAKE_AMOUNT);
      }

      // Total staked = 10 * 100 = 1000 SWPY
      expect(await staking.totalStaked()).to.equal(STAKE_AMOUNT * 10n);
    });

    it("each user sees their own staked amount correctly", async function () {
      const amounts = [
        ethers.parseEther("100"),
        ethers.parseEther("200"),
        ethers.parseEther("50"),
      ];

      for (let i = 0; i < amounts.length; i++) {
        await swappy.connect(stakers[i]).approve(await staking.getAddress(), amounts[i]);
        await staking.connect(stakers[i]).stake(amounts[i]);
      }

      for (let i = 0; i < amounts.length; i++) {
        const info = await staking.stakes(stakers[i].address);
        expect(info.amount).to.equal(amounts[i]);
      }

      // Total = 350
      expect(await staking.totalStaked()).to.equal(ethers.parseEther("350"));
    });

    it("rewardReserve() reflects reward fund minus nothing (staked tokens are separate)", async function () {
      for (let i = 0; i < 10; i++) {
        await swappy.connect(stakers[i]).approve(await staking.getAddress(), STAKE_AMOUNT);
        await staking.connect(stakers[i]).stake(STAKE_AMOUNT);
      }

      // rewardReserve = balance - totalStaked = (200M + 1000) - 1000 = 200M
      expect(await staking.rewardReserve()).to.equal(REWARD_FUND);
    });
  });

  // ======================== WITHDRAW ========================

  describe("Withdraw", function () {
    it("reverts if lock period not elapsed", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);

      await expect(
        staking.connect(stakers[0]).withdraw(STAKE_AMOUNT)
      ).to.be.revertedWith("SwappyStaking: LOCK_ACTIVE");
    });

    it("succeeds after lock period", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);

      await time.increase(LOCK_PERIOD);

      await staking.connect(stakers[0]).withdraw(STAKE_AMOUNT);

      const info = await staking.stakes(stakers[0].address);
      expect(info.amount).to.equal(0n);
      expect(await staking.totalStaked()).to.equal(0n);
    });

    it("wallet balance increases after withdraw", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);

      await time.increase(LOCK_PERIOD);

      const before = await swappy.balanceOf(stakers[0].address);
      await staking.connect(stakers[0]).withdraw(STAKE_AMOUNT);
      const after = await swappy.balanceOf(stakers[0].address);

      expect(after - before).to.equal(STAKE_AMOUNT);
    });

    it("totalStaked() decreases after withdraw", async function () {
      // 3 users stake
      for (let i = 0; i < 3; i++) {
        await swappy.connect(stakers[i]).approve(await staking.getAddress(), STAKE_AMOUNT);
        await staking.connect(stakers[i]).stake(STAKE_AMOUNT);
      }
      expect(await staking.totalStaked()).to.equal(STAKE_AMOUNT * 3n);

      await time.increase(LOCK_PERIOD);

      // 1 withdraws
      await staking.connect(stakers[0]).withdraw(STAKE_AMOUNT);
      expect(await staking.totalStaked()).to.equal(STAKE_AMOUNT * 2n);

      // Remaining users still have their stake
      expect((await staking.stakes(stakers[1].address)).amount).to.equal(STAKE_AMOUNT);
      expect((await staking.stakes(stakers[2].address)).amount).to.equal(STAKE_AMOUNT);
    });

    it("partial withdraw works correctly", async function () {
      const fullAmount = ethers.parseEther("200");
      const halfAmount = ethers.parseEther("100");

      await swappy.connect(stakers[0]).approve(await staking.getAddress(), fullAmount);
      await staking.connect(stakers[0]).stake(fullAmount);

      await time.increase(LOCK_PERIOD);

      await staking.connect(stakers[0]).withdraw(halfAmount);

      const info = await staking.stakes(stakers[0].address);
      expect(info.amount).to.equal(halfAmount);
      expect(await staking.totalStaked()).to.equal(halfAmount);
    });

    it("reverts withdraw more than staked", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);

      await time.increase(LOCK_PERIOD);

      await expect(
        staking.connect(stakers[0]).withdraw(STAKE_AMOUNT + 1n)
      ).to.be.revertedWith("SwappyStaking: INSUFFICIENT_BALANCE");
    });

    it("reverts withdraw zero amount", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);

      await time.increase(LOCK_PERIOD);

      await expect(
        staking.connect(stakers[0]).withdraw(0n)
      ).to.be.revertedWith("SwappyStaking: ZERO_AMOUNT");
    });

    it("pending rewards preserved after partial withdraw", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);

      // Fast forward 1 year (past lock period too)
      await time.increase(365 * 24 * 60 * 60);

      const rewardBefore = await staking.pendingReward(stakers[0].address);
      expect(rewardBefore).to.be.gt(0n);

      // Partial withdraw
      const half = ethers.parseEther("50");
      await staking.connect(stakers[0]).withdraw(half);

      // Rewards should still be there (settled into rewardDebt)
      const rewardAfter = await staking.pendingReward(stakers[0].address);
      // Should be approximately the same (small time passed between reads)
      const diff = rewardAfter > rewardBefore ? rewardAfter - rewardBefore : rewardBefore - rewardAfter;
      expect(diff).to.be.lt(ethers.parseEther("0.01"));
    });
  });

  // ======================== CLAIM REWARDS ========================

  describe("Claim rewards", function () {
    it("claimReward() transfers SWPY to user", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);

      await time.increase(365 * 24 * 60 * 60); // 1 year

      const pending = await staking.pendingReward(stakers[0].address);
      const before = await swappy.balanceOf(stakers[0].address);

      await staking.connect(stakers[0]).claimReward();

      const after = await swappy.balanceOf(stakers[0].address);
      const received = after - before;

      // Should receive ~10 SWPY (10% of 100)
      const diff = received > pending ? received - pending : pending - received;
      expect(diff).to.be.lt(ethers.parseEther("0.01"));
    });

    it("pendingReward() resets to 0 after claim", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);

      await time.increase(365 * 24 * 60 * 60);

      await staking.connect(stakers[0]).claimReward();

      // pendingReward should be ~0 (tiny amount from the claim tx itself)
      expect(await staking.pendingReward(stakers[0].address)).to.be.lt(ethers.parseEther("0.001"));
    });

    it("rewardReserve() decreases after claim", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);

      await time.increase(365 * 24 * 60 * 60);

      const reserveBefore = await staking.rewardReserve();
      await staking.connect(stakers[0]).claimReward();
      const reserveAfter = await staking.rewardReserve();

      expect(reserveAfter).to.be.lt(reserveBefore);
    });
  });

  // ======================== EXIT ========================

  describe("Exit (withdraw + claim in one tx)", function () {
    it("exit() returns stake + rewards", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);

      await time.increase(365 * 24 * 60 * 60); // 1 year past lock

      const before = await swappy.balanceOf(stakers[0].address);
      await staking.connect(stakers[0]).exit();
      const after = await swappy.balanceOf(stakers[0].address);

      const received = after - before;
      // Should receive 100 (stake) + ~10 (reward) = ~110
      expect(received).to.be.gt(ethers.parseEther("109"));
      expect(received).to.be.lt(ethers.parseEther("111"));

      // All zeroed out
      const info = await staking.stakes(stakers[0].address);
      expect(info.amount).to.equal(0n);
      expect(await staking.totalStaked()).to.equal(0n);
    });

    it("exit() reverts during lock period", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);

      await expect(
        staking.connect(stakers[0]).exit()
      ).to.be.revertedWith("SwappyStaking: LOCK_ACTIVE");
    });
  });

  // ======================== FULL SCENARIO ========================

  describe("Full scenario: stake, check data, fast-forward, withdraw, verify", function () {
    it("10 users stake 100 SWPY, verify all reads, fast-forward 1 year, withdraw and claim", async function () {
      // --- 10 users stake ---
      for (let i = 0; i < 10; i++) {
        await swappy.connect(stakers[i]).approve(await staking.getAddress(), STAKE_AMOUNT);
        await staking.connect(stakers[i]).stake(STAKE_AMOUNT);
      }

      // totalStaked = 1000
      expect(await staking.totalStaked()).to.equal(STAKE_AMOUNT * 10n);

      // Each user's stake
      for (let i = 0; i < 10; i++) {
        const info = await staking.stakes(stakers[i].address);
        expect(info.amount).to.equal(STAKE_AMOUNT);
      }

      // rewardReserve = 200M (staked tokens are counted separately)
      expect(await staking.rewardReserve()).to.equal(REWARD_FUND);

      // Wallet balances decreased
      for (let i = 0; i < 10; i++) {
        expect(await swappy.balanceOf(stakers[i].address)).to.equal(ethers.parseEther("900"));
      }

      // --- Fast forward 1 year ---
      await time.increase(365 * 24 * 60 * 60);

      // Each user should have ~10 SWPY pending (10% of 100)
      for (let i = 0; i < 10; i++) {
        const reward = await staking.pendingReward(stakers[i].address);
        const expected = ethers.parseEther("10");
        const diff = reward > expected ? reward - expected : expected - reward;
        expect(diff).to.be.lt(ethers.parseEther("0.01"));
      }

      // --- All 10 users exit ---
      for (let i = 0; i < 10; i++) {
        await staking.connect(stakers[i]).exit();
      }

      // totalStaked = 0
      expect(await staking.totalStaked()).to.equal(0n);

      // All stakes cleared
      for (let i = 0; i < 10; i++) {
        const info = await staking.stakes(stakers[i].address);
        expect(info.amount).to.equal(0n);
      }

      // Each user got back ~110 SWPY (100 stake + ~10 reward) on top of their 900
      for (let i = 0; i < 10; i++) {
        const balance = await swappy.balanceOf(stakers[i].address);
        expect(balance).to.be.gt(ethers.parseEther("1009"));
        expect(balance).to.be.lt(ethers.parseEther("1011"));
      }

      // Reward reserve decreased by ~100 SWPY total (10 users * 10 SWPY each)
      const reserveAfter = await staking.rewardReserve();
      const reserveDecrease = REWARD_FUND - reserveAfter;
      expect(reserveDecrease).to.be.gt(ethers.parseEther("99"));
      expect(reserveDecrease).to.be.lt(ethers.parseEther("101"));
    });
  });

  // ======================== EVENTS ========================

  describe("Events", function () {
    it("emits Staked", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await expect(staking.connect(stakers[0]).stake(STAKE_AMOUNT))
        .to.emit(staking, "Staked")
        .withArgs(stakers[0].address, STAKE_AMOUNT);
    });

    it("emits Withdrawn", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);
      await time.increase(LOCK_PERIOD);

      await expect(staking.connect(stakers[0]).withdraw(STAKE_AMOUNT))
        .to.emit(staking, "Withdrawn")
        .withArgs(stakers[0].address, STAKE_AMOUNT);
    });

    it("emits RewardPaid on claimReward", async function () {
      await swappy.connect(stakers[0]).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(stakers[0]).stake(STAKE_AMOUNT);
      await time.increase(365 * 24 * 60 * 60);

      await expect(staking.connect(stakers[0]).claimReward())
        .to.emit(staking, "RewardPaid");
    });

    it("emits RewardsFunded on fundRewards", async function () {
      const extra = ethers.parseEther("1000");
      await swappy.approve(await staking.getAddress(), extra);
      await expect(staking.fundRewards(extra))
        .to.emit(staking, "RewardsFunded")
        .withArgs(extra);
    });
  });
});
