const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SwapperRouter", function () {
  let factory, router, weth, tokenA, tokenB, owner, devWallet, alice;

  async function getDeadline() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + 3600;
  }

  beforeEach(async function () {
    [owner, devWallet, alice] = await ethers.getSigners();

    const WETH = await ethers.getContractFactory("WETH");
    weth = await WETH.deploy();

    const Factory = await ethers.getContractFactory("SwapperFactory");
    factory = await Factory.deploy(devWallet.address);

    const Router = await ethers.getContractFactory("SwapperRouter");
    router = await Router.deploy(await factory.getAddress(), await weth.getAddress());

    const Token = await ethers.getContractFactory("WETH");
    tokenA = await Token.deploy();
    tokenB = await Token.deploy();

    await tokenA.deposit({ value: ethers.parseEther("20") });
    await tokenB.deposit({ value: ethers.parseEther("20") });
    await tokenA.approve(await router.getAddress(), ethers.MaxUint256);
    await tokenB.approve(await router.getAddress(), ethers.MaxUint256);

    // Fund alice
    await tokenA.connect(alice).deposit({ value: ethers.parseEther("10") });
    await tokenB.connect(alice).deposit({ value: ethers.parseEther("10") });
    await tokenA.connect(alice).approve(await router.getAddress(), ethers.MaxUint256);
    await tokenB.connect(alice).approve(await router.getAddress(), ethers.MaxUint256);
  });

  describe("Constructor", function () {
    it("should set factory and WETH", async function () {
      expect(await router.factory()).to.equal(await factory.getAddress());
      expect(await router.WETH()).to.equal(await weth.getAddress());
    });
  });

  describe("Library functions", function () {
    it("sortTokens should sort correctly", async function () {
      const addrA = await tokenA.getAddress();
      const addrB = await tokenB.getAddress();
      const [t0, t1] = await router.sortTokens(addrA, addrB);
      expect(BigInt(t0)).to.be.lt(BigInt(t1));
    });

    it("sortTokens should revert on identical addresses", async function () {
      const addr = await tokenA.getAddress();
      await expect(router.sortTokens(addr, addr))
        .to.be.revertedWith("SwapperRouter: IDENTICAL_ADDRESSES");
    });

    it("sortTokens should revert on zero address", async function () {
      await expect(router.sortTokens(ethers.ZeroAddress, await tokenA.getAddress()))
        .to.be.revertedWith("SwapperRouter: ZERO_ADDRESS");
    });

    it("getAmountOut should calculate fee-adjusted output", async function () {
      const amountOut = await router.getAmountOut(
        ethers.parseEther("1"),
        ethers.parseEther("100"),
        ethers.parseEther("100")
      );
      // With 0.5% fee: 1 * 9950 * 100 / (100 * 10000 + 1 * 9950) ≈ 0.98515
      expect(amountOut).to.be.gt(ethers.parseEther("0.98"));
      expect(amountOut).to.be.lt(ethers.parseEther("0.99"));
    });

    it("getAmountIn should calculate fee-adjusted input", async function () {
      const amountIn = await router.getAmountIn(
        ethers.parseEther("1"),
        ethers.parseEther("100"),
        ethers.parseEther("100")
      );
      // Need > 1 token input to get 1 token out (due to fee + price impact)
      expect(amountIn).to.be.gt(ethers.parseEther("1"));
    });

    it("quote should calculate proportional amounts", async function () {
      const amountB = await router.quote(
        ethers.parseEther("10"),
        ethers.parseEther("100"),
        ethers.parseEther("200")
      );
      expect(amountB).to.equal(ethers.parseEther("20"));
    });
  });

  describe("addLiquidity()", function () {
    it("should create pair and add liquidity", async function () {
      const deadline = await getDeadline();
      await router.addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("10"), ethers.parseEther("10"),
        0, 0, owner.address, deadline
      );

      const pair = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      expect(pair).to.not.equal(ethers.ZeroAddress);
    });

    it("should add more liquidity to existing pair", async function () {
      const deadline = await getDeadline();
      await router.addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("10"), ethers.parseEther("10"),
        0, 0, owner.address, deadline
      );

      // Add more
      await router.addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("5"), ethers.parseEther("5"),
        0, 0, owner.address, deadline
      );

      const pairAddr = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      const pair = await ethers.getContractAt("SwapperPair", pairAddr);
      const [r0, r1] = await pair.getReserves();
      // Should have ~15 ETH each
      expect(r0).to.be.closeTo(ethers.parseEther("15"), ethers.parseEther("1"));
    });

    it("should enforce minimum amounts", async function () {
      const deadline = await getDeadline();
      await router.addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("10"), ethers.parseEther("10"),
        0, 0, owner.address, deadline
      );

      // Try to add with unrealistic min — should revert
      await expect(
        router.addLiquidity(
          await tokenA.getAddress(), await tokenB.getAddress(),
          ethers.parseEther("10"), ethers.parseEther("10"),
          ethers.parseEther("10"), ethers.parseEther("100"), // amountBMin too high
          owner.address, deadline
        )
      ).to.be.revertedWith("SwapperRouter: INSUFFICIENT_B_AMOUNT");
    });
  });

  describe("addLiquidityETH()", function () {
    it("should add token + ETH liquidity", async function () {
      const deadline = await getDeadline();
      await router.addLiquidityETH(
        await tokenA.getAddress(),
        ethers.parseEther("2"), 0, 0,
        owner.address, deadline,
        { value: ethers.parseEther("2") }
      );

      const pair = await factory.getPair(await tokenA.getAddress(), await weth.getAddress());
      expect(pair).to.not.equal(ethers.ZeroAddress);
    });

    it("should refund excess ETH", async function () {
      const deadline = await getDeadline();
      // First add liquidity to set the price
      await router.addLiquidityETH(
        await tokenA.getAddress(),
        ethers.parseEther("2"), 0, 0,
        owner.address, deadline,
        { value: ethers.parseEther("2") }
      );

      // Add more with excess ETH
      const balBefore = await ethers.provider.getBalance(alice.address);
      const tx = await router.connect(alice).addLiquidityETH(
        await tokenA.getAddress(),
        ethers.parseEther("1"), 0, 0,
        alice.address, deadline,
        { value: ethers.parseEther("5") } // sending more than needed
      );
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(alice.address);

      // Should have spent roughly 1 ETH + gas (not 5)
      const spent = balBefore - balAfter - gasCost;
      expect(spent).to.be.closeTo(ethers.parseEther("1"), ethers.parseEther("0.5"));
    });
  });

  describe("removeLiquidity()", function () {
    it("should remove liquidity and return tokens", async function () {
      const deadline = await getDeadline();
      await router.addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("5"), ethers.parseEther("5"),
        0, 0, owner.address, deadline
      );

      const pairAddr = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      const pair = await ethers.getContractAt("SwapperPair", pairAddr);
      const lpBalance = await pair.balanceOf(owner.address);
      await pair.approve(await router.getAddress(), ethers.MaxUint256);

      const balA = await tokenA.balanceOf(owner.address);
      await router.removeLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        lpBalance, 0, 0,
        owner.address, deadline
      );

      expect(await tokenA.balanceOf(owner.address)).to.be.gt(balA);
    });

    it("should enforce minimum output amounts", async function () {
      const deadline = await getDeadline();
      await router.addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("10"), ethers.parseEther("10"),
        0, 0, owner.address, deadline
      );

      const pairAddr = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      const pair = await ethers.getContractAt("SwapperPair", pairAddr);
      const lp = await pair.balanceOf(owner.address);
      await pair.approve(await router.getAddress(), ethers.MaxUint256);

      await expect(
        router.removeLiquidity(
          await tokenA.getAddress(), await tokenB.getAddress(),
          lp,
          ethers.parseEther("100"), // way too high
          0,
          owner.address, deadline
        )
      ).to.be.revertedWith("SwapperRouter: INSUFFICIENT_A_AMOUNT");
    });
  });

  describe("removeLiquidityETH()", function () {
    it("should remove ETH liquidity and return ETH + tokens", async function () {
      const deadline = await getDeadline();
      await router.addLiquidityETH(
        await tokenA.getAddress(),
        ethers.parseEther("2"), 0, 0,
        owner.address, deadline,
        { value: ethers.parseEther("2") }
      );

      const pairAddr = await factory.getPair(await tokenA.getAddress(), await weth.getAddress());
      const pair = await ethers.getContractAt("SwapperPair", pairAddr);
      const lp = await pair.balanceOf(owner.address);
      await pair.approve(await router.getAddress(), ethers.MaxUint256);

      const ethBefore = await ethers.provider.getBalance(owner.address);
      const tx = await router.removeLiquidityETH(
        await tokenA.getAddress(),
        lp, 0, 0,
        owner.address, deadline
      );
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const ethAfter = await ethers.provider.getBalance(owner.address);

      // Should have received ETH back
      expect(ethAfter + gasCost).to.be.gt(ethBefore);
    });
  });

  describe("Swap variants", function () {
    beforeEach(async function () {
      const deadline = await getDeadline();
      await router.addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("10"), ethers.parseEther("10"),
        0, 0, owner.address, deadline
      );
      await router.addLiquidityETH(
        await tokenA.getAddress(),
        ethers.parseEther("10"), 0, 0,
        owner.address, deadline,
        { value: ethers.parseEther("10") }
      );
    });

    it("swapExactTokensForTokens — should swap and collect dev fee", async function () {
      const deadline = await getDeadline();
      const path = [await tokenA.getAddress(), await tokenB.getAddress()];
      const amounts = await router.getAmountsOut(ethers.parseEther("1"), path);

      const balBefore = await tokenB.balanceOf(alice.address);
      await router.connect(alice).swapExactTokensForTokens(
        ethers.parseEther("1"), 0, path, alice.address, deadline
      );
      const balAfter = await tokenB.balanceOf(alice.address);

      expect(balAfter - balBefore).to.equal(amounts[1]);
    });

    it("swapExactTokensForTokens — should revert on slippage", async function () {
      const deadline = await getDeadline();
      const path = [await tokenA.getAddress(), await tokenB.getAddress()];

      await expect(
        router.swapExactTokensForTokens(
          ethers.parseEther("1"),
          ethers.parseEther("999"), // impossible min out
          path, owner.address, deadline
        )
      ).to.be.revertedWith("SwapperRouter: INSUFFICIENT_OUTPUT_AMOUNT");
    });

    it("swapTokensForExactTokens — should get exact output", async function () {
      const deadline = await getDeadline();
      const path = [await tokenA.getAddress(), await tokenB.getAddress()];
      const amounts = await router.getAmountsIn(ethers.parseEther("1"), path);

      const balBefore = await tokenB.balanceOf(alice.address);
      await router.connect(alice).swapTokensForExactTokens(
        ethers.parseEther("1"),
        amounts[0] + ethers.parseEther("1"), // allow extra
        path, alice.address, deadline
      );
      const balAfter = await tokenB.balanceOf(alice.address);

      expect(balAfter - balBefore).to.equal(ethers.parseEther("1"));
    });

    it("swapTokensForExactTokens — should revert on excessive input", async function () {
      const deadline = await getDeadline();
      const path = [await tokenA.getAddress(), await tokenB.getAddress()];

      await expect(
        router.swapTokensForExactTokens(
          ethers.parseEther("1"),
          1n, // max input = 1 wei (too low)
          path, owner.address, deadline
        )
      ).to.be.revertedWith("SwapperRouter: EXCESSIVE_INPUT_AMOUNT");
    });

    it("swapExactETHForTokens — should swap ETH for tokens", async function () {
      const deadline = await getDeadline();
      const path = [await weth.getAddress(), await tokenA.getAddress()];

      const balBefore = await tokenA.balanceOf(alice.address);
      await router.connect(alice).swapExactETHForTokens(
        0, path, alice.address, deadline,
        { value: ethers.parseEther("1") }
      );
      const balAfter = await tokenA.balanceOf(alice.address);

      expect(balAfter).to.be.gt(balBefore);
    });

    it("swapExactETHForTokens — should revert if path[0] != WETH", async function () {
      const deadline = await getDeadline();
      const path = [await tokenA.getAddress(), await tokenB.getAddress()];

      await expect(
        router.swapExactETHForTokens(0, path, owner.address, deadline, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("SwapperRouter: INVALID_PATH");
    });

    it("swapExactTokensForETH — should swap tokens for ETH", async function () {
      const deadline = await getDeadline();
      const path = [await tokenA.getAddress(), await weth.getAddress()];

      const ethBefore = await ethers.provider.getBalance(alice.address);
      const tx = await router.connect(alice).swapExactTokensForETH(
        ethers.parseEther("1"), 0, path, alice.address, deadline
      );
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const ethAfter = await ethers.provider.getBalance(alice.address);

      expect(ethAfter + gasCost).to.be.gt(ethBefore);
    });

    it("swapExactTokensForETH — should revert if path[-1] != WETH", async function () {
      const deadline = await getDeadline();
      const path = [await tokenA.getAddress(), await tokenB.getAddress()];

      await expect(
        router.swapExactTokensForETH(ethers.parseEther("1"), 0, path, owner.address, deadline)
      ).to.be.revertedWith("SwapperRouter: INVALID_PATH");
    });

    it("swapETHForExactTokens — should get exact token output and refund excess ETH", async function () {
      const deadline = await getDeadline();
      const path = [await weth.getAddress(), await tokenA.getAddress()];

      const balBefore = await tokenA.balanceOf(alice.address);
      const ethBefore = await ethers.provider.getBalance(alice.address);

      const tx = await router.connect(alice).swapETHForExactTokens(
        ethers.parseEther("0.5"),
        path, alice.address, deadline,
        { value: ethers.parseEther("3") } // send more than needed
      );
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const ethAfter = await ethers.provider.getBalance(alice.address);
      const balAfter = await tokenA.balanceOf(alice.address);

      // Got exact 0.5 token
      expect(balAfter - balBefore).to.equal(ethers.parseEther("0.5"));
      // Spent much less than 3 ETH (excess refunded)
      const ethSpent = ethBefore - ethAfter - gasCost;
      expect(ethSpent).to.be.lt(ethers.parseEther("2"));
    });
  });

  describe("Multi-hop swaps", function () {
    it("should swap through multiple pairs (A -> B -> C)", async function () {
      const deadline = await getDeadline();
      const Token = await ethers.getContractFactory("WETH");
      const tokenC = await Token.deploy();
      await tokenC.deposit({ value: ethers.parseEther("5") });
      await tokenC.approve(await router.getAddress(), ethers.MaxUint256);

      // Create A-B and B-C pairs
      await router.addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("3"), ethers.parseEther("3"),
        0, 0, owner.address, deadline
      );
      await router.addLiquidity(
        await tokenB.getAddress(), await tokenC.getAddress(),
        ethers.parseEther("3"), ethers.parseEther("3"),
        0, 0, owner.address, deadline
      );

      const path = [await tokenA.getAddress(), await tokenB.getAddress(), await tokenC.getAddress()];
      const amounts = await router.getAmountsOut(ethers.parseEther("1"), path);
      expect(amounts.length).to.equal(3);
      expect(amounts[2]).to.be.gt(0);

      const balBefore = await tokenC.balanceOf(alice.address);
      await router.connect(alice).swapExactTokensForTokens(
        ethers.parseEther("1"), 0, path, alice.address, deadline
      );
      const balAfter = await tokenC.balanceOf(alice.address);

      expect(balAfter - balBefore).to.equal(amounts[2]);
    });
  });

  describe("Deadline enforcement", function () {
    it("should revert on expired deadline", async function () {
      const deadline = 1; // expired (1970)
      await expect(
        router.addLiquidity(
          await tokenA.getAddress(), await tokenB.getAddress(),
          ethers.parseEther("1"), ethers.parseEther("1"),
          0, 0, owner.address, deadline
        )
      ).to.be.revertedWith("SwapperRouter: EXPIRED");
    });
  });
});
