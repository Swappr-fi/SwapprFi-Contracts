const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SwapperFactory", function () {
  let factory, weth, tokenA, tokenB, owner, devWallet, alice;

  beforeEach(async function () {
    [owner, devWallet, alice] = await ethers.getSigners();

    const WETH = await ethers.getContractFactory("WETH");
    weth = await WETH.deploy();

    const Factory = await ethers.getContractFactory("SwapperFactory");
    factory = await Factory.deploy(devWallet.address);

    const Token = await ethers.getContractFactory("WETH");
    tokenA = await Token.deploy();
    tokenB = await Token.deploy();
  });

  describe("Constructor", function () {
    it("should set owner to deployer", async function () {
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("should set dev wallet", async function () {
      expect(await factory.devWallet()).to.equal(devWallet.address);
    });

    it("should set correct fee constants", async function () {
      expect(await factory.TOTAL_FEE()).to.equal(50);
      expect(await factory.DEV_FEE()).to.equal(20);
    });
  });

  describe("createPair()", function () {
    it("should create a pair", async function () {
      await factory.createPair(await tokenA.getAddress(), await tokenB.getAddress());
      const pair = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      expect(pair).to.not.equal(ethers.ZeroAddress);
      expect(await factory.allPairsLength()).to.equal(1);
    });

    it("should store pair in both directions", async function () {
      await factory.createPair(await tokenA.getAddress(), await tokenB.getAddress());
      const pairAB = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      const pairBA = await factory.getPair(await tokenB.getAddress(), await tokenA.getAddress());
      expect(pairAB).to.equal(pairBA);
    });

    it("should emit PairCreated event", async function () {
      const addrA = await tokenA.getAddress();
      const addrB = await tokenB.getAddress();
      const [token0, token1] = addrA.toLowerCase() < addrB.toLowerCase() ? [addrA, addrB] : [addrB, addrA];
      await expect(factory.createPair(addrA, addrB))
        .to.emit(factory, "PairCreated");
    });

    it("should not create duplicate pairs", async function () {
      await factory.createPair(await tokenA.getAddress(), await tokenB.getAddress());
      await expect(
        factory.createPair(await tokenA.getAddress(), await tokenB.getAddress())
      ).to.be.revertedWith("SwapperFactory: PAIR_EXISTS");
    });

    it("should not create pair with reversed duplicate", async function () {
      await factory.createPair(await tokenA.getAddress(), await tokenB.getAddress());
      await expect(
        factory.createPair(await tokenB.getAddress(), await tokenA.getAddress())
      ).to.be.revertedWith("SwapperFactory: PAIR_EXISTS");
    });

    it("should revert on identical addresses", async function () {
      await expect(
        factory.createPair(await tokenA.getAddress(), await tokenA.getAddress())
      ).to.be.revertedWith("SwapperFactory: IDENTICAL_ADDRESSES");
    });

    it("should revert on zero address", async function () {
      await expect(
        factory.createPair(ethers.ZeroAddress, await tokenA.getAddress())
      ).to.be.revertedWith("SwapperFactory: ZERO_ADDRESS");
    });

    it("should allow anyone to create pairs", async function () {
      await factory.connect(alice).createPair(await tokenA.getAddress(), await tokenB.getAddress());
      expect(await factory.allPairsLength()).to.equal(1);
    });

    it("should create multiple distinct pairs", async function () {
      const Token = await ethers.getContractFactory("WETH");
      const tokenC = await Token.deploy();

      await factory.createPair(await tokenA.getAddress(), await tokenB.getAddress());
      await factory.createPair(await tokenA.getAddress(), await tokenC.getAddress());
      expect(await factory.allPairsLength()).to.equal(2);

      const pair1 = await factory.allPairs(0);
      const pair2 = await factory.allPairs(1);
      expect(pair1).to.not.equal(pair2);
    });
  });

  describe("setDevWallet()", function () {
    it("should update dev wallet", async function () {
      await factory.setDevWallet(alice.address);
      expect(await factory.devWallet()).to.equal(alice.address);
    });

    it("should emit DevWalletUpdated event", async function () {
      await expect(factory.setDevWallet(alice.address))
        .to.emit(factory, "DevWalletUpdated")
        .withArgs(devWallet.address, alice.address);
    });

    it("should revert on zero address", async function () {
      await expect(factory.setDevWallet(ethers.ZeroAddress))
        .to.be.revertedWith("SwapperFactory: ZERO_ADDRESS");
    });

    it("should revert when called by non-owner", async function () {
      await expect(factory.connect(alice).setDevWallet(alice.address))
        .to.be.revertedWith("SwapperFactory: FORBIDDEN");
    });
  });

  describe("Two-step ownership transfer", function () {
    it("should propose a new owner", async function () {
      await factory.proposeOwner(alice.address);
      expect(await factory.pendingOwner()).to.equal(alice.address);
      // Owner should not change yet
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("should accept ownership", async function () {
      await factory.proposeOwner(alice.address);
      await factory.connect(alice).acceptOwnership();
      expect(await factory.owner()).to.equal(alice.address);
      expect(await factory.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it("should emit OwnerUpdated on accept", async function () {
      await factory.proposeOwner(alice.address);
      await expect(factory.connect(alice).acceptOwnership())
        .to.emit(factory, "OwnerUpdated")
        .withArgs(owner.address, alice.address);
    });

    it("should revert proposeOwner with zero address", async function () {
      await expect(factory.proposeOwner(ethers.ZeroAddress))
        .to.be.revertedWith("SwapperFactory: ZERO_ADDRESS");
    });

    it("should revert proposeOwner from non-owner", async function () {
      await expect(factory.connect(alice).proposeOwner(alice.address))
        .to.be.revertedWith("SwapperFactory: FORBIDDEN");
    });

    it("should revert acceptOwnership from wrong address", async function () {
      await factory.proposeOwner(alice.address);
      await expect(factory.connect(devWallet).acceptOwnership())
        .to.be.revertedWith("SwapperFactory: NOT_PENDING_OWNER");
    });

    it("new owner should be able to use owner functions", async function () {
      await factory.proposeOwner(alice.address);
      await factory.connect(alice).acceptOwnership();
      await factory.connect(alice).setDevWallet(alice.address);
      expect(await factory.devWallet()).to.equal(alice.address);
    });

    it("old owner should lose access after transfer", async function () {
      await factory.proposeOwner(alice.address);
      await factory.connect(alice).acceptOwnership();
      await expect(factory.setDevWallet(owner.address))
        .to.be.revertedWith("SwapperFactory: FORBIDDEN");
    });
  });
});
