const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("WETH", function () {
  let weth, owner, alice, bob;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    const WETH = await ethers.getContractFactory("WETH");
    weth = await WETH.deploy();
  });

  describe("Metadata", function () {
    it("should have correct name, symbol, decimals", async function () {
      expect(await weth.name()).to.equal("Wrapped Native Token");
      expect(await weth.symbol()).to.equal("WETH");
      expect(await weth.decimals()).to.equal(18);
    });
  });

  describe("deposit()", function () {
    it("should mint WETH on deposit", async function () {
      await weth.deposit({ value: ethers.parseEther("1") });
      expect(await weth.balanceOf(owner.address)).to.equal(ethers.parseEther("1"));
    });

    it("should update totalSupply to match contract balance", async function () {
      await weth.deposit({ value: ethers.parseEther("1") });
      expect(await weth.totalSupply()).to.equal(ethers.parseEther("1"));
    });

    it("should emit Deposit event", async function () {
      await expect(weth.deposit({ value: ethers.parseEther("1") }))
        .to.emit(weth, "Deposit")
        .withArgs(owner.address, ethers.parseEther("1"));
    });

    it("should accept zero deposit without revert", async function () {
      await weth.deposit({ value: 0 });
      expect(await weth.balanceOf(owner.address)).to.equal(0);
    });
  });

  describe("receive()", function () {
    it("should mint WETH when sending ETH directly", async function () {
      await owner.sendTransaction({ to: await weth.getAddress(), value: ethers.parseEther("1") });
      expect(await weth.balanceOf(owner.address)).to.equal(ethers.parseEther("1"));
    });
  });

  describe("withdraw()", function () {
    beforeEach(async function () {
      await weth.deposit({ value: ethers.parseEther("2") });
    });

    it("should burn WETH and return ETH", async function () {
      const balBefore = await ethers.provider.getBalance(owner.address);
      const tx = await weth.withdraw(ethers.parseEther("1"));
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(owner.address);

      expect(await weth.balanceOf(owner.address)).to.equal(ethers.parseEther("1"));
      expect(balAfter + gasCost - balBefore).to.equal(ethers.parseEther("1"));
    });

    it("should emit Withdrawal event", async function () {
      await expect(weth.withdraw(ethers.parseEther("1")))
        .to.emit(weth, "Withdrawal")
        .withArgs(owner.address, ethers.parseEther("1"));
    });

    it("should revert on insufficient balance", async function () {
      await expect(weth.withdraw(ethers.parseEther("3")))
        .to.be.revertedWith("WETH: insufficient balance");
    });
  });

  describe("approve()", function () {
    it("should set allowance", async function () {
      await weth.approve(alice.address, ethers.parseEther("5"));
      expect(await weth.allowance(owner.address, alice.address)).to.equal(ethers.parseEther("5"));
    });

    it("should emit Approval event", async function () {
      await expect(weth.approve(alice.address, ethers.parseEther("5")))
        .to.emit(weth, "Approval")
        .withArgs(owner.address, alice.address, ethers.parseEther("5"));
    });

    it("should overwrite previous allowance", async function () {
      await weth.approve(alice.address, ethers.parseEther("5"));
      await weth.approve(alice.address, ethers.parseEther("3"));
      expect(await weth.allowance(owner.address, alice.address)).to.equal(ethers.parseEther("3"));
    });
  });

  describe("transfer()", function () {
    beforeEach(async function () {
      await weth.deposit({ value: ethers.parseEther("2") });
    });

    it("should transfer tokens", async function () {
      await weth.transfer(alice.address, ethers.parseEther("1"));
      expect(await weth.balanceOf(alice.address)).to.equal(ethers.parseEther("1"));
      expect(await weth.balanceOf(owner.address)).to.equal(ethers.parseEther("1"));
    });

    it("should emit Transfer event", async function () {
      await expect(weth.transfer(alice.address, ethers.parseEther("1")))
        .to.emit(weth, "Transfer")
        .withArgs(owner.address, alice.address, ethers.parseEther("1"));
    });

    it("should revert on insufficient balance", async function () {
      await expect(weth.transfer(alice.address, ethers.parseEther("3")))
        .to.be.revertedWith("WETH: insufficient balance");
    });
  });

  describe("transferFrom()", function () {
    beforeEach(async function () {
      await weth.deposit({ value: ethers.parseEther("2") });
      await weth.approve(alice.address, ethers.parseEther("1"));
    });

    it("should transfer with allowance and decrease it", async function () {
      await weth.connect(alice).transferFrom(owner.address, bob.address, ethers.parseEther("0.5"));
      expect(await weth.balanceOf(bob.address)).to.equal(ethers.parseEther("0.5"));
      expect(await weth.allowance(owner.address, alice.address)).to.equal(ethers.parseEther("0.5"));
    });

    it("should not decrease max allowance", async function () {
      await weth.approve(alice.address, ethers.MaxUint256);
      await weth.connect(alice).transferFrom(owner.address, bob.address, ethers.parseEther("1"));
      expect(await weth.allowance(owner.address, alice.address)).to.equal(ethers.MaxUint256);
    });

    it("should revert on insufficient allowance", async function () {
      // Balance is 2, allowance is 1 — transferring 1.5 should fail on allowance
      await expect(
        weth.connect(alice).transferFrom(owner.address, bob.address, ethers.parseEther("1.5"))
      ).to.be.revertedWith("WETH: insufficient allowance");
    });

    it("should revert on insufficient balance even with enough allowance", async function () {
      await weth.approve(alice.address, ethers.parseEther("100"));
      await expect(
        weth.connect(alice).transferFrom(owner.address, bob.address, ethers.parseEther("3"))
      ).to.be.revertedWith("WETH: insufficient balance");
    });

    it("should allow self-transfer without allowance", async function () {
      await weth.transferFrom(owner.address, alice.address, ethers.parseEther("1"));
      expect(await weth.balanceOf(alice.address)).to.equal(ethers.parseEther("1"));
    });
  });
});
