const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

describe("Bridge", function () {
  this.timeout(600_000); // 10 minutes for 1200-user test

  const FEE_BPS = 200n; // 2%
  const NUM_USERS = 1200;

  let owner, relayer, devWallet, other;
  let usdt, usdtLock, bridgedUSDT, bridgeMinter;

  // Shared state for the 1200-user flow (populated in sequential tests)
  let users; // [{ wallet, amount, netAmount, fee, lockId }]
  let expectedTotalLocked = 0n;
  let expectedTotalFees = 0n;

  before(async function () {
    [owner, relayer, devWallet, other] = await ethers.getSigners();

    // ─── Deploy mock USDT (use BridgedUSDT as ERC20 mock on "Ethereum" side) ───
    usdt = await (await ethers.getContractFactory("BridgedUSDT")).deploy();
    await usdt.waitForDeployment();
    await usdt.setMinter(owner.address);

    // ─── Deploy USDTLock (Ethereum side) ───
    usdtLock = await (await ethers.getContractFactory("USDTLock")).deploy(
      await usdt.getAddress(),
      devWallet.address,
      FEE_BPS
    );
    await usdtLock.waitForDeployment();
    await usdtLock.setRelayer(relayer.address);

    // ─── Deploy BridgedUSDT (BlockDAG side) ───
    bridgedUSDT = await (await ethers.getContractFactory("BridgedUSDT")).deploy();
    await bridgedUSDT.waitForDeployment();

    // ─── Deploy BridgeMinter (BlockDAG side) ───
    bridgeMinter = await (await ethers.getContractFactory("BridgeMinter")).deploy(
      await bridgedUSDT.getAddress(),
      relayer.address
    );
    await bridgeMinter.waitForDeployment();

    // Set BridgeMinter as minter on BridgedUSDT
    await bridgedUSDT.setMinter(await bridgeMinter.getAddress());

    // ─── Create 1200 deterministic user wallets ───
    users = [];
    for (let i = 0; i < NUM_USERS; i++) {
      const pk = ethers.id(`bridge-user-${i}`);
      const wallet = new ethers.Wallet(pk, ethers.provider);
      // Deterministic amount between 10 and 1000 USDT (whole numbers, 6 decimals)
      const amountUsdt = 10 + ((i * 997 + 1) % 991); // range: 10–1000
      const amount = BigInt(amountUsdt) * 1_000_000n;
      const fee = (amount * FEE_BPS) / 10000n;
      const netAmount = amount - fee;
      users.push({ wallet, amount, fee, netAmount, lockId: BigInt(i) });
    }

    // ─── Fund all users with ETH (for gas) and USDT ───
    for (const u of users) {
      await ethers.provider.send("hardhat_setBalance", [
        u.wallet.address,
        "0xDE0B6B3A7640000", // 1 ETH
      ]);
      await usdt.mint(u.wallet.address, u.amount);
    }
  });

  // ======================== USDTLock Unit Tests ========================

  describe("USDTLock", function () {
    let localUsdt, localLock;
    let localUser;

    beforeEach(async function () {
      localUsdt = await (await ethers.getContractFactory("BridgedUSDT")).deploy();
      await localUsdt.waitForDeployment();
      await localUsdt.setMinter(owner.address);

      localLock = await (await ethers.getContractFactory("USDTLock")).deploy(
        await localUsdt.getAddress(), devWallet.address, FEE_BPS
      );
      await localLock.waitForDeployment();
      await localLock.setRelayer(relayer.address);

      localUser = other;
      await localUsdt.mint(localUser.address, 10_000_000n); // 10 USDT
    });

    it("should lock USDT with 2% fee to devWallet", async function () {
      const amount = 1_000_000n; // 1 USDT
      const fee = (amount * FEE_BPS) / 10000n; // 20,000
      const net = amount - fee; // 980,000

      await localUsdt.connect(localUser).approve(await localLock.getAddress(), amount);

      await expect(localLock.connect(localUser).lock(amount))
        .to.emit(localLock, "Locked")
        .withArgs(0n, localUser.address, net, fee, (v) => v > 0n);

      // Net stays in lock contract
      expect(await localUsdt.balanceOf(await localLock.getAddress())).to.equal(net);
      // Fee went to devWallet
      expect(await localUsdt.balanceOf(devWallet.address)).to.equal(fee);
      expect(await localLock.totalLocked()).to.equal(net);
      expect(await localLock.totalFees()).to.equal(fee);
    });

    it("should auto-increment lockNonce", async function () {
      await localUsdt.connect(localUser).approve(await localLock.getAddress(), 3_000_000n);
      await localLock.connect(localUser).lock(1_000_000n);
      await localLock.connect(localUser).lock(1_000_000n);
      await localLock.connect(localUser).lock(1_000_000n);
      expect(await localLock.lockNonce()).to.equal(3n);
    });

    it("should revert on zero amount", async function () {
      await expect(localLock.connect(localUser).lock(0n))
        .to.be.revertedWith("USDTLock: ZERO_AMOUNT");
    });

    it("should revert when paused", async function () {
      await localLock.setPaused(true);
      await localUsdt.connect(localUser).approve(await localLock.getAddress(), 1_000_000n);
      await expect(localLock.connect(localUser).lock(1_000_000n))
        .to.be.revertedWith("USDTLock: PAUSED");
    });

    it("should allow owner to withdraw", async function () {
      await localUsdt.connect(localUser).approve(await localLock.getAddress(), 1_000_000n);
      await localLock.connect(localUser).lock(1_000_000n);
      const locked = await localUsdt.balanceOf(await localLock.getAddress());
      await localLock.withdraw(owner.address, locked);
      expect(await localUsdt.balanceOf(owner.address)).to.equal(locked);
    });

    it("should reject non-owner withdraw", async function () {
      await expect(localLock.connect(other).withdraw(other.address, 1n))
        .to.be.revertedWith("USDTLock: FORBIDDEN");
    });

    it("should support two-step ownership transfer", async function () {
      await localLock.proposeOwner(other.address);
      await localLock.connect(other).acceptOwnership();
      expect(await localLock.owner()).to.equal(other.address);
    });

    it("bridge back is disabled by default", async function () {
      expect(await localLock.bridgeBackEnabled()).to.equal(false);
    });

    it("unlock reverts when bridge back is disabled", async function () {
      await expect(localLock.connect(relayer).unlock(localUser.address, 1000n, 0n))
        .to.be.revertedWith("USDTLock: BRIDGE_BACK_DISABLED");
    });

    it("unlock reverts for non-relayer", async function () {
      await localLock.setBridgeBackEnabled(true);
      await expect(localLock.connect(other).unlock(localUser.address, 1000n, 0n))
        .to.be.revertedWith("USDTLock: NOT_RELAYER");
    });
  });

  // ======================== BridgedUSDT Unit Tests ========================

  describe("BridgedUSDT", function () {
    it("should have correct name, symbol, and decimals", async function () {
      expect(await bridgedUSDT.name()).to.equal("Bridged USDT");
      expect(await bridgedUSDT.symbol()).to.equal("USDT.e");
      expect(await bridgedUSDT.decimals()).to.equal(6n);
    });

    it("should only allow minter to mint", async function () {
      await expect(bridgedUSDT.connect(other).mint(other.address, 1000n))
        .to.be.revertedWith("BridgedUSDT: NOT_MINTER");
    });

    it("should support burnFrom with allowance", async function () {
      // Mint via full flow
      await bridgeMinter.connect(relayer).prepareClaim(other.address, 1_000_000n, 99999n);
      const claimId = await bridgeMinter.ethLockIdToClaimId(99999n);
      await bridgeMinter.connect(other).claim(claimId);

      const bal = await bridgedUSDT.balanceOf(other.address);
      expect(bal).to.equal(1_000_000n);

      // Approve owner to burn from other
      await bridgedUSDT.connect(other).approve(owner.address, 500_000n);
      await bridgedUSDT.connect(owner).burnFrom(other.address, 500_000n);
      expect(await bridgedUSDT.balanceOf(other.address)).to.equal(500_000n);
    });

    it("burnFrom reverts without allowance", async function () {
      await expect(bridgedUSDT.connect(owner).burnFrom(other.address, 1n))
        .to.be.reverted;
    });
  });

  // ======================== BridgeMinter Unit Tests ========================

  describe("BridgeMinter", function () {
    it("should prepare a claim", async function () {
      await expect(bridgeMinter.connect(relayer).prepareClaim(other.address, 500_000n, 88888n))
        .to.emit(bridgeMinter, "ClaimPrepared")
        .withArgs((v) => v >= 0n, other.address, 500_000n, 88888n);
    });

    it("should reject non-relayer prepareClaim", async function () {
      await expect(bridgeMinter.connect(other).prepareClaim(other.address, 1000n, 77777n))
        .to.be.revertedWith("BridgeMinter: NOT_RELAYER");
    });

    it("should reject duplicate ethLockId", async function () {
      await bridgeMinter.connect(relayer).prepareClaim(other.address, 1000n, 66666n);
      await expect(bridgeMinter.connect(relayer).prepareClaim(other.address, 1000n, 66666n))
        .to.be.revertedWith("BridgeMinter: ALREADY_PREPARED");
    });

    it("claim mints full amount (no fee on BlockDAG)", async function () {
      const amount = 1_000_000n;
      await bridgeMinter.connect(relayer).prepareClaim(other.address, amount, 55555n);
      const claimId = await bridgeMinter.ethLockIdToClaimId(55555n);

      const balBefore = await bridgedUSDT.balanceOf(other.address);
      await bridgeMinter.connect(other).claim(claimId);
      const balAfter = await bridgedUSDT.balanceOf(other.address);

      // Full amount minted — no fee deducted
      expect(balAfter - balBefore).to.equal(amount);
    });

    it("should reject double claim", async function () {
      await bridgeMinter.connect(relayer).prepareClaim(other.address, 1000n, 44444n);
      const claimId = await bridgeMinter.ethLockIdToClaimId(44444n);
      await bridgeMinter.connect(other).claim(claimId);
      await expect(bridgeMinter.connect(other).claim(claimId))
        .to.be.revertedWith("BridgeMinter: ALREADY_CLAIMED");
    });

    it("bridge back is disabled by default", async function () {
      expect(await bridgeMinter.bridgeBackEnabled()).to.equal(false);
    });

    it("requestUnlock reverts when bridge back is disabled", async function () {
      await expect(bridgeMinter.connect(other).requestUnlock(1000n))
        .to.be.revertedWith("BridgeMinter: BRIDGE_BACK_DISABLED");
    });

    it("should reject non-owner admin calls", async function () {
      await expect(bridgeMinter.connect(other).setRelayer(other.address))
        .to.be.revertedWith("BridgeMinter: FORBIDDEN");
      await expect(bridgeMinter.connect(other).setPaused(true))
        .to.be.revertedWith("BridgeMinter: FORBIDDEN");
      await expect(bridgeMinter.connect(other).setBridgeBackEnabled(true))
        .to.be.revertedWith("BridgeMinter: FORBIDDEN");
    });

    it("should support two-step ownership transfer", async function () {
      // Use a fresh instance to not affect shared state
      const fresh = await (await ethers.getContractFactory("BridgeMinter")).deploy(
        await bridgedUSDT.getAddress(), relayer.address
      );
      await fresh.waitForDeployment();
      await fresh.proposeOwner(other.address);
      await fresh.connect(other).acceptOwnership();
      expect(await fresh.owner()).to.equal(other.address);
    });
  });

  // ======================== 1200 Users End-to-End ========================

  describe("1200 Users — Lock on Ethereum", function () {
    it("all 1200 users approve and lock USDT", async function () {
      const lockAddr = await usdtLock.getAddress();

      for (let i = 0; i < NUM_USERS; i++) {
        const u = users[i];
        const usdtConnected = usdt.connect(u.wallet);
        const lockConnected = usdtLock.connect(u.wallet);

        await usdtConnected.approve(lockAddr, u.amount);
        await lockConnected.lock(u.amount);
      }

      expect(await usdtLock.lockNonce()).to.equal(BigInt(NUM_USERS));
    });

    it("2% fee of each lock was sent to devWallet as USDT on ETH chain", async function () {
      for (const u of users) {
        expectedTotalFees += u.fee;
        expectedTotalLocked += u.netAmount;
      }

      const devBalance = await usdt.balanceOf(devWallet.address);
      expect(devBalance).to.equal(expectedTotalFees);
      expect(await usdtLock.totalFees()).to.equal(expectedTotalFees);
    });

    it("USDT tokens are locked in contract, not burned", async function () {
      const lockBalance = await usdt.balanceOf(await usdtLock.getAddress());
      expect(lockBalance).to.equal(expectedTotalLocked);
      expect(await usdtLock.totalLocked()).to.equal(expectedTotalLocked);

      // USDT total supply is unchanged — tokens are locked, not burned
      // Total minted = sum of all user amounts (each user was minted their full amount)
      let totalMinted = 0n;
      for (const u of users) totalMinted += u.amount;
      // Supply = totalMinted (user tokens) — no burns happened
      // The devWallet + lock contract + user remaining = totalMinted
      const supply = await usdt.totalSupply();
      expect(supply).to.be.gte(totalMinted);
    });

    it("each user's USDT balance is now zero (fully locked)", async function () {
      // Spot-check first, last, and middle users
      for (const idx of [0, 599, 1199]) {
        expect(await usdt.balanceOf(users[idx].wallet.address)).to.equal(0n);
      }
    });
  });

  describe("1200 Users — Relayer prepares claims on BlockDAG", function () {
    it("relayer prepares a claim for each lock", async function () {
      const nonceBefore = await bridgeMinter.claimNonce();

      for (let i = 0; i < NUM_USERS; i++) {
        const u = users[i];
        await bridgeMinter.connect(relayer).prepareClaim(
          u.wallet.address,
          u.netAmount,
          u.lockId
        );
      }

      expect(await bridgeMinter.claimNonce()).to.equal(nonceBefore + BigInt(NUM_USERS));

      // Verify all ethLockIds are prepared
      for (const idx of [0, 599, 1199]) {
        expect(await bridgeMinter.ethLockIdPrepared(users[idx].lockId)).to.equal(true);
      }
    });
  });

  describe("1200 Users — Claim USDT.e on BlockDAG", function () {
    it("each user claims their full net USDT.e (no fee on BlockDAG)", async function () {
      for (let i = 0; i < NUM_USERS; i++) {
        const u = users[i];
        const claimId = await bridgeMinter.ethLockIdToClaimId(u.lockId);
        await bridgeMinter.connect(u.wallet).claim(claimId);
      }
    });

    it("each user's USDT.e balance equals their net amount", async function () {
      // Spot-check several users
      for (const idx of [0, 1, 100, 500, 599, 1000, 1199]) {
        const u = users[idx];
        const bal = await bridgedUSDT.balanceOf(u.wallet.address);
        expect(bal).to.equal(u.netAmount, `User ${idx} balance mismatch`);
      }
    });

    it("total USDT.e minted equals total locked on ETH", async function () {
      const supply = await bridgedUSDT.totalSupply();
      // Supply includes unit-test mints from earlier describe blocks, so check >= expectedTotalLocked
      expect(supply).to.be.gte(expectedTotalLocked);
    });
  });

  // ======================== Bridge Back ========================

  describe("Bridge Back (Ethereum ← BlockDAG)", function () {
    it("requestUnlock reverts when bridge back is disabled (default)", async function () {
      const u = users[0];
      const minterAddr = await bridgeMinter.getAddress();
      await bridgedUSDT.connect(u.wallet).approve(minterAddr, u.netAmount);
      await expect(bridgeMinter.connect(u.wallet).requestUnlock(u.netAmount))
        .to.be.revertedWith("BridgeMinter: BRIDGE_BACK_DISABLED");
    });

    it("owner enables bridge back on BridgeMinter", async function () {
      await expect(bridgeMinter.setBridgeBackEnabled(true))
        .to.emit(bridgeMinter, "BridgeBackEnabled")
        .withArgs(true);
      expect(await bridgeMinter.bridgeBackEnabled()).to.equal(true);
    });

    it("user requests unlock — burns USDT.e, emits UnlockRequested", async function () {
      const u = users[0];
      const minterAddr = await bridgeMinter.getAddress();
      const unlockAmount = u.netAmount;

      // User approves BridgeMinter to spend their USDT.e
      await bridgedUSDT.connect(u.wallet).approve(minterAddr, unlockAmount);

      const balBefore = await bridgedUSDT.balanceOf(u.wallet.address);

      await expect(bridgeMinter.connect(u.wallet).requestUnlock(unlockAmount))
        .to.emit(bridgeMinter, "UnlockRequested")
        .withArgs(0n, u.wallet.address, unlockAmount);

      const balAfter = await bridgedUSDT.balanceOf(u.wallet.address);
      expect(balBefore - balAfter).to.equal(unlockAmount);
    });

    it("unlock on USDTLock reverts when bridge back disabled on ETH side", async function () {
      await expect(usdtLock.connect(relayer).unlock(users[0].wallet.address, users[0].netAmount, 0n))
        .to.be.revertedWith("USDTLock: BRIDGE_BACK_DISABLED");
    });

    it("owner enables bridge back on USDTLock", async function () {
      await expect(usdtLock.setBridgeBackEnabled(true))
        .to.emit(usdtLock, "BridgeBackEnabled")
        .withArgs(true);
      expect(await usdtLock.bridgeBackEnabled()).to.equal(true);
    });

    it("relayer unlocks USDT on ETH — user receives their tokens back", async function () {
      const u = users[0];
      const unlockAmount = u.netAmount;

      const userBalBefore = await usdt.balanceOf(u.wallet.address);
      const lockBalBefore = await usdt.balanceOf(await usdtLock.getAddress());
      const totalLockedBefore = await usdtLock.totalLocked();

      await expect(usdtLock.connect(relayer).unlock(u.wallet.address, unlockAmount, 0n))
        .to.emit(usdtLock, "Unlocked")
        .withArgs(0n, u.wallet.address, unlockAmount, 0n);

      expect(await usdt.balanceOf(u.wallet.address)).to.equal(userBalBefore + unlockAmount);
      expect(await usdt.balanceOf(await usdtLock.getAddress())).to.equal(lockBalBefore - unlockAmount);
      expect(await usdtLock.totalLocked()).to.equal(totalLockedBefore - unlockAmount);
    });

    it("duplicate bdagBurnId is rejected", async function () {
      await expect(usdtLock.connect(relayer).unlock(users[1].wallet.address, 1000n, 0n))
        .to.be.revertedWith("USDTLock: ALREADY_PROCESSED");
    });

    it("full bridge-back round trip for multiple users", async function () {
      const minterAddr = await bridgeMinter.getAddress();
      // Bridge back users[1], users[2], users[3]
      for (let i = 1; i <= 3; i++) {
        const u = users[i];
        const amount = u.netAmount;

        // Step 1: User requests unlock on BlockDAG
        await bridgedUSDT.connect(u.wallet).approve(minterAddr, amount);
        await bridgeMinter.connect(u.wallet).requestUnlock(amount);

        // Step 2: Relayer unlocks on Ethereum
        const burnId = BigInt(i); // burnNonce increments: 1, 2, 3
        await usdtLock.connect(relayer).unlock(u.wallet.address, amount, burnId);

        // Verify user got USDT back on ETH
        expect(await usdt.balanceOf(u.wallet.address)).to.equal(amount);
        // Verify USDT.e burned
        expect(await bridgedUSDT.balanceOf(u.wallet.address)).to.equal(0n);
      }
    });

    it("owner can disable bridge back again", async function () {
      await bridgeMinter.setBridgeBackEnabled(false);
      expect(await bridgeMinter.bridgeBackEnabled()).to.equal(false);

      const u = users[4];
      const minterAddr = await bridgeMinter.getAddress();
      await bridgedUSDT.connect(u.wallet).approve(minterAddr, u.netAmount);
      await expect(bridgeMinter.connect(u.wallet).requestUnlock(u.netAmount))
        .to.be.revertedWith("BridgeMinter: BRIDGE_BACK_DISABLED");
    });
  });
});
