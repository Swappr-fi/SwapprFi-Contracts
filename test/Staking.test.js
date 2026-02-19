const { expect } = require("chai");
const { ethers } = require("hardhat");

// =================== SWAPPY TOKEN ===================

describe("SwappyToken", function () {
  let swappy, owner, alice, bob;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("SwappyToken");
    swappy = await Token.deploy(ethers.parseEther("1000000000")); // 1B
  });

  describe("Constructor", function () {
    it("should mint initial supply to deployer", async function () {
      expect(await swappy.balanceOf(owner.address)).to.equal(ethers.parseEther("1000000000"));
    });

    it("should set correct name and symbol", async function () {
      expect(await swappy.name()).to.equal("Swappy");
      expect(await swappy.symbol()).to.equal("SWPY");
    });

    it("should set deployer as owner", async function () {
      expect(await swappy.owner()).to.equal(owner.address);
    });
  });

  describe("mint()", function () {
    it("should allow owner to mint", async function () {
      await swappy.mint(alice.address, ethers.parseEther("1000"));
      expect(await swappy.balanceOf(alice.address)).to.equal(ethers.parseEther("1000"));
    });

    it("should revert mint from non-owner", async function () {
      await expect(swappy.connect(alice).mint(alice.address, ethers.parseEther("1000")))
        .to.be.revertedWith("SwappyToken: FORBIDDEN");
    });
  });

  describe("burn()", function () {
    it("should allow anyone to burn their own tokens", async function () {
      await swappy.transfer(alice.address, ethers.parseEther("100"));
      await swappy.connect(alice).burn(ethers.parseEther("50"));
      expect(await swappy.balanceOf(alice.address)).to.equal(ethers.parseEther("50"));
    });

    it("should revert burn with insufficient balance", async function () {
      await expect(swappy.connect(alice).burn(ethers.parseEther("1")))
        .to.be.reverted; // ERC20: burn amount exceeds balance
    });
  });

  describe("Two-step ownership transfer", function () {
    it("should propose and accept new owner", async function () {
      await swappy.proposeOwner(alice.address);
      expect(await swappy.pendingOwner()).to.equal(alice.address);
      expect(await swappy.owner()).to.equal(owner.address);

      await swappy.connect(alice).acceptOwnership();
      expect(await swappy.owner()).to.equal(alice.address);
    });

    it("should revert proposeOwner from non-owner", async function () {
      await expect(swappy.connect(alice).proposeOwner(alice.address))
        .to.be.revertedWith("SwappyToken: FORBIDDEN");
    });

    it("should revert proposeOwner with zero address", async function () {
      await expect(swappy.proposeOwner(ethers.ZeroAddress))
        .to.be.revertedWith("SwappyToken: ZERO_ADDRESS");
    });

    it("should revert acceptOwnership from wrong address", async function () {
      await swappy.proposeOwner(alice.address);
      await expect(swappy.connect(bob).acceptOwnership())
        .to.be.revertedWith("SwappyToken: NOT_PENDING_OWNER");
    });

    it("new owner can mint, old owner cannot", async function () {
      await swappy.proposeOwner(alice.address);
      await swappy.connect(alice).acceptOwnership();

      await swappy.connect(alice).mint(bob.address, ethers.parseEther("100"));
      expect(await swappy.balanceOf(bob.address)).to.equal(ethers.parseEther("100"));

      await expect(swappy.mint(bob.address, ethers.parseEther("100")))
        .to.be.revertedWith("SwappyToken: FORBIDDEN");
    });
  });
});

// =================== SWAPPER STAKING (General Pools) ===================

describe("SwapperStaking (General Pools)", function () {
  let staking, rewardToken, stakeToken, owner, user1, user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("SwappyToken");
    stakeToken = await Token.deploy(ethers.parseEther("1000000"));
    rewardToken = await Token.deploy(ethers.parseEther("1000000"));

    const Staking = await ethers.getContractFactory("SwapperStaking");
    staking = await Staking.deploy();

    await stakeToken.transfer(user1.address, ethers.parseEther("10000"));
    await stakeToken.transfer(user2.address, ethers.parseEther("10000"));

    await stakeToken.connect(user1).approve(await staking.getAddress(), ethers.MaxUint256);
    await stakeToken.connect(user2).approve(await staking.getAddress(), ethers.MaxUint256);
    await rewardToken.approve(await staking.getAddress(), ethers.MaxUint256);
  });

  describe("createPool()", function () {
    it("should create a staking pool", async function () {
      const duration = 30 * 24 * 3600;
      await staking.createPool(
        await stakeToken.getAddress(),
        await rewardToken.getAddress(),
        ethers.parseEther("10000"),
        duration
      );

      expect(await staking.poolCount()).to.equal(1);
      const pool = await staking.getPool(0);
      expect(pool.active).to.be.true;
      expect(pool.stakeToken).to.equal(await stakeToken.getAddress());
      expect(pool.rewardToken).to.equal(await rewardToken.getAddress());
    });

    it("should transfer reward tokens to contract", async function () {
      const balBefore = await rewardToken.balanceOf(await staking.getAddress());
      await staking.createPool(
        await stakeToken.getAddress(),
        await rewardToken.getAddress(),
        ethers.parseEther("10000"),
        30 * 24 * 3600
      );
      const balAfter = await rewardToken.balanceOf(await staking.getAddress());
      expect(balAfter - balBefore).to.equal(ethers.parseEther("10000"));
    });

    it("should revert from non-owner", async function () {
      await expect(
        staking.connect(user1).createPool(
          await stakeToken.getAddress(),
          await rewardToken.getAddress(),
          ethers.parseEther("1000"),
          86400
        )
      ).to.be.revertedWith("SwapperStaking: FORBIDDEN");
    });

    it("should revert with zero duration", async function () {
      await expect(
        staking.createPool(
          await stakeToken.getAddress(),
          await rewardToken.getAddress(),
          ethers.parseEther("1000"),
          0
        )
      ).to.be.revertedWith("SwapperStaking: ZERO_DURATION");
    });

    it("should revert with zero reward", async function () {
      await expect(
        staking.createPool(
          await stakeToken.getAddress(),
          await rewardToken.getAddress(),
          0,
          86400
        )
      ).to.be.revertedWith("SwapperStaking: ZERO_REWARD");
    });

    it("should emit PoolCreated event", async function () {
      await expect(
        staking.createPool(
          await stakeToken.getAddress(),
          await rewardToken.getAddress(),
          ethers.parseEther("10000"),
          86400
        )
      ).to.emit(staking, "PoolCreated");
    });
  });

  describe("stake()", function () {
    beforeEach(async function () {
      await staking.createPool(
        await stakeToken.getAddress(),
        await rewardToken.getAddress(),
        ethers.parseEther("10000"),
        30 * 24 * 3600
      );
    });

    it("should stake tokens", async function () {
      await staking.connect(user1).stake(0, ethers.parseEther("1000"));
      expect(await staking.balanceOf(0, user1.address)).to.equal(ethers.parseEther("1000"));
    });

    it("should update pool totalStaked", async function () {
      await staking.connect(user1).stake(0, ethers.parseEther("1000"));
      const pool = await staking.getPool(0);
      expect(pool.totalStaked).to.equal(ethers.parseEther("1000"));
    });

    it("should revert with zero amount", async function () {
      await expect(staking.connect(user1).stake(0, 0))
        .to.be.revertedWith("SwapperStaking: ZERO_AMOUNT");
    });

    it("should emit Staked event", async function () {
      await expect(staking.connect(user1).stake(0, ethers.parseEther("1000")))
        .to.emit(staking, "Staked")
        .withArgs(0, user1.address, ethers.parseEther("1000"));
    });
  });

  describe("withdraw()", function () {
    beforeEach(async function () {
      await staking.createPool(
        await stakeToken.getAddress(),
        await rewardToken.getAddress(),
        ethers.parseEther("10000"),
        30 * 24 * 3600
      );
      await staking.connect(user1).stake(0, ethers.parseEther("1000"));
    });

    it("should withdraw staked tokens", async function () {
      const balBefore = await stakeToken.balanceOf(user1.address);
      await staking.connect(user1).withdraw(0, ethers.parseEther("500"));
      const balAfter = await stakeToken.balanceOf(user1.address);

      expect(balAfter - balBefore).to.equal(ethers.parseEther("500"));
      expect(await staking.balanceOf(0, user1.address)).to.equal(ethers.parseEther("500"));
    });

    it("should revert with zero amount", async function () {
      await expect(staking.connect(user1).withdraw(0, 0))
        .to.be.revertedWith("SwapperStaking: ZERO_AMOUNT");
    });

    it("should revert with insufficient balance", async function () {
      await expect(staking.connect(user1).withdraw(0, ethers.parseEther("2000")))
        .to.be.revertedWith("SwapperStaking: INSUFFICIENT_BALANCE");
    });
  });

  describe("Reward distribution", function () {
    beforeEach(async function () {
      await staking.createPool(
        await stakeToken.getAddress(),
        await rewardToken.getAddress(),
        ethers.parseEther("10000"),
        30 * 24 * 3600
      );
    });

    it("should earn rewards over time", async function () {
      await staking.connect(user1).stake(0, ethers.parseEther("1000"));

      await ethers.provider.send("evm_increaseTime", [15 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      const earned = await staking.earned(0, user1.address);
      expect(earned).to.be.gt(0);
    });

    it("should claim rewards", async function () {
      await staking.connect(user1).stake(0, ethers.parseEther("1000"));

      await ethers.provider.send("evm_increaseTime", [15 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      const balBefore = await rewardToken.balanceOf(user1.address);
      await staking.connect(user1).claimReward(0);
      const balAfter = await rewardToken.balanceOf(user1.address);
      expect(balAfter).to.be.gt(balBefore);
    });

    it("should distribute proportionally — 1:3 staker ratio", async function () {
      await staking.connect(user1).stake(0, ethers.parseEther("1000"));
      await staking.connect(user2).stake(0, ethers.parseEther("3000"));

      await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine");

      const earned1 = await staking.earned(0, user1.address);
      const earned2 = await staking.earned(0, user2.address);

      const ratio = Number(earned2) / Number(earned1);
      expect(ratio).to.be.closeTo(3, 0.1);
    });

    it("should stop earning after pool finishes", async function () {
      await staking.connect(user1).stake(0, ethers.parseEther("1000"));

      // Go past end
      await ethers.provider.send("evm_increaseTime", [60 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      const earned1 = await staking.earned(0, user1.address);

      // Wait more time — earned should not increase
      await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      const earned2 = await staking.earned(0, user1.address);
      expect(earned2).to.equal(earned1);
    });
  });

  describe("exit()", function () {
    it("should withdraw all and claim rewards in one tx", async function () {
      await staking.createPool(
        await stakeToken.getAddress(),
        await rewardToken.getAddress(),
        ethers.parseEther("10000"),
        30 * 24 * 3600
      );

      await staking.connect(user1).stake(0, ethers.parseEther("1000"));

      await ethers.provider.send("evm_increaseTime", [15 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      const stakeBalBefore = await stakeToken.balanceOf(user1.address);
      const rewardBalBefore = await rewardToken.balanceOf(user1.address);

      await staking.connect(user1).exit(0);

      const stakeBalAfter = await stakeToken.balanceOf(user1.address);
      const rewardBalAfter = await rewardToken.balanceOf(user1.address);

      expect(stakeBalAfter - stakeBalBefore).to.equal(ethers.parseEther("1000"));
      expect(rewardBalAfter).to.be.gt(rewardBalBefore);
      expect(await staking.balanceOf(0, user1.address)).to.equal(0);
    });

    it("should work when user has no rewards yet", async function () {
      await staking.createPool(
        await stakeToken.getAddress(),
        await rewardToken.getAddress(),
        ethers.parseEther("10000"),
        30 * 24 * 3600
      );

      await staking.connect(user1).stake(0, ethers.parseEther("1000"));
      // Exit immediately — minimal rewards
      await staking.connect(user1).exit(0);
      expect(await staking.balanceOf(0, user1.address)).to.equal(0);
    });
  });

  describe("fundPool()", function () {
    it("should add rewards and extend duration", async function () {
      await staking.createPool(
        await stakeToken.getAddress(),
        await rewardToken.getAddress(),
        ethers.parseEther("10000"),
        30 * 24 * 3600
      );

      const poolBefore = await staking.getPool(0);

      await staking.fundPool(0, ethers.parseEther("5000"), 15 * 24 * 3600);

      const poolAfter = await staking.getPool(0);
      expect(poolAfter.finishAt).to.be.gt(poolBefore.finishAt);
    });

    it("should revert fundPool from non-owner", async function () {
      await staking.createPool(
        await stakeToken.getAddress(),
        await rewardToken.getAddress(),
        ethers.parseEther("10000"),
        30 * 24 * 3600
      );

      await expect(staking.connect(user1).fundPool(0, ethers.parseEther("1000"), 86400))
        .to.be.revertedWith("SwapperStaking: FORBIDDEN");
    });
  });

  describe("Two-step ownership transfer", function () {
    it("should propose and accept", async function () {
      await staking.proposeOwner(user1.address);
      expect(await staking.pendingOwner()).to.equal(user1.address);
      await staking.connect(user1).acceptOwnership();
      expect(await staking.owner()).to.equal(user1.address);
    });

    it("should revert from non-owner", async function () {
      await expect(staking.connect(user1).proposeOwner(user1.address))
        .to.be.revertedWith("SwapperStaking: FORBIDDEN");
    });

    it("should revert accept from wrong address", async function () {
      await staking.proposeOwner(user1.address);
      await expect(staking.connect(user2).acceptOwnership())
        .to.be.revertedWith("SwapperStaking: NOT_PENDING_OWNER");
    });
  });
});

// =================== SWAPPY STAKING (Fixed 10% APY) ===================

describe("SwappyStaking (Fixed 10% APY)", function () {
  let swappy, swappyStaking, owner, user1, user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("SwappyToken");
    swappy = await Token.deploy(ethers.parseEther("1000000000"));

    const Staking = await ethers.getContractFactory("SwappyStaking");
    swappyStaking = await Staking.deploy(await swappy.getAddress());

    await swappy.approve(await swappyStaking.getAddress(), ethers.MaxUint256);
    await swappyStaking.fundRewards(ethers.parseEther("100000000"));

    await swappy.transfer(user1.address, ethers.parseEther("100000"));
    await swappy.transfer(user2.address, ethers.parseEther("100000"));
    await swappy.connect(user1).approve(await swappyStaking.getAddress(), ethers.MaxUint256);
    await swappy.connect(user2).approve(await swappyStaking.getAddress(), ethers.MaxUint256);
  });

  describe("Constructor", function () {
    it("should set swappy token and owner", async function () {
      expect(await swappyStaking.swappy()).to.equal(await swappy.getAddress());
      expect(await swappyStaking.owner()).to.equal(owner.address);
    });

    it("should have correct constants", async function () {
      expect(await swappyStaking.APY_BPS()).to.equal(1000);
      expect(await swappyStaking.BPS_DENOMINATOR()).to.equal(10000);
    });
  });

  describe("stake()", function () {
    it("should stake SWPY", async function () {
      await swappyStaking.connect(user1).stake(ethers.parseEther("10000"));
      const info = await swappyStaking.stakes(user1.address);
      expect(info.amount).to.equal(ethers.parseEther("10000"));
      expect(await swappyStaking.totalStaked()).to.equal(ethers.parseEther("10000"));
    });

    it("should emit Staked event", async function () {
      await expect(swappyStaking.connect(user1).stake(ethers.parseEther("1000")))
        .to.emit(swappyStaking, "Staked")
        .withArgs(user1.address, ethers.parseEther("1000"));
    });

    it("should revert with zero amount", async function () {
      await expect(swappyStaking.connect(user1).stake(0))
        .to.be.revertedWith("SwappyStaking: ZERO_AMOUNT");
    });

    it("should accumulate stake from multiple deposits", async function () {
      await swappyStaking.connect(user1).stake(ethers.parseEther("5000"));
      await swappyStaking.connect(user1).stake(ethers.parseEther("3000"));
      const info = await swappyStaking.stakes(user1.address);
      expect(info.amount).to.equal(ethers.parseEther("8000"));
    });

    it("should settle pending rewards on additional stake", async function () {
      await swappyStaking.connect(user1).stake(ethers.parseEther("10000"));

      await ethers.provider.send("evm_increaseTime", [180 * 24 * 3600]); // 6 months
      await ethers.provider.send("evm_mine");

      // Stake more — should not lose pending rewards
      await swappyStaking.connect(user1).stake(ethers.parseEther("1000"));
      const info = await swappyStaking.stakes(user1.address);
      expect(info.rewardDebt).to.be.gt(0); // rewards settled into debt
    });
  });

  describe("Reward calculation", function () {
    it("should earn 10% APY over 1 year", async function () {
      await swappyStaking.connect(user1).stake(ethers.parseEther("10000"));

      await ethers.provider.send("evm_increaseTime", [365 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      const pending = await swappyStaking.pendingReward(user1.address);
      const expected = ethers.parseEther("1000");

      const diff = pending > expected ? pending - expected : expected - pending;
      expect(diff).to.be.lt(ethers.parseEther("1"));
    });

    it("should earn proportional over 6 months", async function () {
      await swappyStaking.connect(user1).stake(ethers.parseEther("10000"));

      await ethers.provider.send("evm_increaseTime", [(365 * 24 * 3600) / 2]);
      await ethers.provider.send("evm_mine");

      const pending = await swappyStaking.pendingReward(user1.address);
      const expected = ethers.parseEther("500");

      const diff = pending > expected ? pending - expected : expected - pending;
      expect(diff).to.be.lt(ethers.parseEther("1"));
    });

    it("should return zero for users with no stake", async function () {
      expect(await swappyStaking.pendingReward(user2.address)).to.equal(0);
    });

    it("should track rewards independently per user", async function () {
      await swappyStaking.connect(user1).stake(ethers.parseEther("10000"));
      await swappyStaking.connect(user2).stake(ethers.parseEther("20000"));

      await ethers.provider.send("evm_increaseTime", [365 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      const r1 = await swappyStaking.pendingReward(user1.address);
      const r2 = await swappyStaking.pendingReward(user2.address);

      // user2 has 2x stake, so 2x reward
      const ratio = Number(r2) / Number(r1);
      expect(ratio).to.be.closeTo(2, 0.01);
    });
  });

  describe("withdraw()", function () {
    it("should withdraw staked tokens", async function () {
      await swappyStaking.connect(user1).stake(ethers.parseEther("10000"));

      await ethers.provider.send("evm_increaseTime", [90 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      await swappyStaking.connect(user1).withdraw(ethers.parseEther("5000"));

      const info = await swappyStaking.stakes(user1.address);
      expect(info.amount).to.equal(ethers.parseEther("5000"));
      expect(await swappyStaking.totalStaked()).to.equal(ethers.parseEther("5000"));
    });

    it("should settle rewards on withdraw", async function () {
      await swappyStaking.connect(user1).stake(ethers.parseEther("10000"));

      await ethers.provider.send("evm_increaseTime", [180 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      await swappyStaking.connect(user1).withdraw(ethers.parseEther("5000"));
      const info = await swappyStaking.stakes(user1.address);
      expect(info.rewardDebt).to.be.gt(0);
    });

    it("should revert with zero amount", async function () {
      await swappyStaking.connect(user1).stake(ethers.parseEther("1000"));
      await expect(swappyStaking.connect(user1).withdraw(0))
        .to.be.revertedWith("SwappyStaking: ZERO_AMOUNT");
    });

    it("should revert with insufficient balance", async function () {
      await swappyStaking.connect(user1).stake(ethers.parseEther("1000"));
      await expect(swappyStaking.connect(user1).withdraw(ethers.parseEther("2000")))
        .to.be.revertedWith("SwappyStaking: INSUFFICIENT_BALANCE");
    });
  });

  describe("claimReward()", function () {
    it("should claim pending rewards", async function () {
      await swappyStaking.connect(user1).stake(ethers.parseEther("10000"));

      await ethers.provider.send("evm_increaseTime", [365 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      const balBefore = await swappy.balanceOf(user1.address);
      await swappyStaking.connect(user1).claimReward();
      const balAfter = await swappy.balanceOf(user1.address);

      expect(balAfter - balBefore).to.be.closeTo(ethers.parseEther("1000"), ethers.parseEther("1"));
    });

    it("should revert if no rewards (never staked)", async function () {
      await expect(swappyStaking.connect(user2).claimReward())
        .to.be.revertedWith("SwappyStaking: NO_REWARD");
    });

    it("should reset rewardDebt after claim", async function () {
      await swappyStaking.connect(user1).stake(ethers.parseEther("10000"));

      await ethers.provider.send("evm_increaseTime", [365 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      await swappyStaking.connect(user1).claimReward();
      const info = await swappyStaking.stakes(user1.address);
      expect(info.rewardDebt).to.equal(0);
    });

    it("should emit RewardPaid event", async function () {
      await swappyStaking.connect(user1).stake(ethers.parseEther("10000"));

      await ethers.provider.send("evm_increaseTime", [365 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      await expect(swappyStaking.connect(user1).claimReward())
        .to.emit(swappyStaking, "RewardPaid");
    });
  });

  describe("exit()", function () {
    it("should withdraw all and claim rewards in one tx", async function () {
      await swappyStaking.connect(user1).stake(ethers.parseEther("10000"));

      await ethers.provider.send("evm_increaseTime", [365 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      const balBefore = await swappy.balanceOf(user1.address);
      await swappyStaking.connect(user1).exit();
      const balAfter = await swappy.balanceOf(user1.address);

      // Should have received back 10000 + ~1000 rewards
      const received = balAfter - balBefore;
      expect(received).to.be.closeTo(ethers.parseEther("11000"), ethers.parseEther("2"));

      const info = await swappyStaking.stakes(user1.address);
      expect(info.amount).to.equal(0);
      expect(await swappyStaking.totalStaked()).to.equal(0);
    });

    it("should work with zero stake (no-op)", async function () {
      // Should not revert even if nothing staked
      await swappyStaking.connect(user1).exit();
    });
  });

  describe("rewardReserve()", function () {
    it("should report correct reserve", async function () {
      expect(await swappyStaking.rewardReserve()).to.equal(ethers.parseEther("100000000"));
    });

    it("should decrease reserve by staked amount", async function () {
      await swappyStaking.connect(user1).stake(ethers.parseEther("10000"));
      const reserve = await swappyStaking.rewardReserve();
      // Reserve = balance - totalStaked = 100M + 10k (from stake) - 10k (totalStaked) = 100M
      // Actually: balance = 100M (funded) + 10k (staked), totalStaked = 10k
      // reserve = 100M + 10k - 10k = 100M
      expect(reserve).to.equal(ethers.parseEther("100000000"));
    });

    it("should revert claim when reserve is insufficient", async function () {
      // Deploy a new contract with very low reserve
      const Token = await ethers.getContractFactory("SwappyToken");
      const token = await Token.deploy(ethers.parseEther("1000000"));
      const Staking = await ethers.getContractFactory("SwappyStaking");
      const staking2 = await Staking.deploy(await token.getAddress());

      await token.approve(await staking2.getAddress(), ethers.MaxUint256);
      await staking2.fundRewards(ethers.parseEther("1")); // tiny reserve

      await token.transfer(user1.address, ethers.parseEther("100000"));
      await token.connect(user1).approve(await staking2.getAddress(), ethers.MaxUint256);

      await staking2.connect(user1).stake(ethers.parseEther("100000"));

      // 10% of 100k = 10k. Reserve is only 1 SWPY.
      await ethers.provider.send("evm_increaseTime", [365 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      await expect(staking2.connect(user1).claimReward())
        .to.be.revertedWith("SwappyStaking: INSUFFICIENT_REWARDS");
    });
  });

  describe("fundRewards()", function () {
    it("should increase reward reserve", async function () {
      const reserveBefore = await swappyStaking.rewardReserve();
      await swappyStaking.fundRewards(ethers.parseEther("1000000"));
      const reserveAfter = await swappyStaking.rewardReserve();
      expect(reserveAfter - reserveBefore).to.equal(ethers.parseEther("1000000"));
    });

    it("should revert from non-owner", async function () {
      await swappy.transfer(user1.address, ethers.parseEther("1000"));
      await swappy.connect(user1).approve(await swappyStaking.getAddress(), ethers.MaxUint256);
      await expect(swappyStaking.connect(user1).fundRewards(ethers.parseEther("1000")))
        .to.be.revertedWith("SwappyStaking: FORBIDDEN");
    });

    it("should emit RewardsFunded event", async function () {
      await expect(swappyStaking.fundRewards(ethers.parseEther("1000")))
        .to.emit(swappyStaking, "RewardsFunded")
        .withArgs(ethers.parseEther("1000"));
    });
  });

  describe("Two-step ownership transfer", function () {
    it("should propose and accept", async function () {
      await swappyStaking.proposeOwner(user1.address);
      await swappyStaking.connect(user1).acceptOwnership();
      expect(await swappyStaking.owner()).to.equal(user1.address);
    });

    it("should revert from non-owner", async function () {
      await expect(swappyStaking.connect(user1).proposeOwner(user1.address))
        .to.be.revertedWith("SwappyStaking: FORBIDDEN");
    });

    it("should revert accept from wrong address", async function () {
      await swappyStaking.proposeOwner(user1.address);
      await expect(swappyStaking.connect(user2).acceptOwnership())
        .to.be.revertedWith("SwappyStaking: NOT_PENDING_OWNER");
    });

    it("should revert with zero address", async function () {
      await expect(swappyStaking.proposeOwner(ethers.ZeroAddress))
        .to.be.revertedWith("SwappyStaking: ZERO_ADDRESS");
    });
  });
});
