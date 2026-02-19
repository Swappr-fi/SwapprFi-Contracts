const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Full Integration Test", function () {
  // Increase timeout — this test does a LOT
  this.timeout(120_000);

  let factory, router, weth, marketplace, swappy, swappyStaking, staking;
  let owner, devWallet, alice, bob;
  let tokens = [];       // 20 tokens
  let nftContracts = [];  // NFT contracts

  async function getDeadline() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + 36000;
  }

  before(async function () {
    [owner, devWallet, alice, bob] = await ethers.getSigners();

    // ========== Deploy core contracts ==========
    const WETH = await ethers.getContractFactory("WETH");
    weth = await WETH.deploy();

    const Factory = await ethers.getContractFactory("SwapperFactory");
    factory = await Factory.deploy(devWallet.address);

    const Router = await ethers.getContractFactory("SwapperRouter");
    router = await Router.deploy(await factory.getAddress(), await weth.getAddress());

    const Marketplace = await ethers.getContractFactory("SwapperNFTMarketplace");
    marketplace = await Marketplace.deploy(devWallet.address);

    const SwappyToken = await ethers.getContractFactory("SwappyToken");
    swappy = await SwappyToken.deploy(ethers.parseEther("1000000000")); // 1B

    const SwapperStaking = await ethers.getContractFactory("SwapperStaking");
    staking = await SwapperStaking.deploy();

    const SwappyStaking = await ethers.getContractFactory("SwappyStaking");
    swappyStaking = await SwappyStaking.deploy(await swappy.getAddress());

    // Fund Swappy staking with 100M rewards
    await swappy.approve(await swappyStaking.getAddress(), ethers.MaxUint256);
    await swappyStaking.fundRewards(ethers.parseEther("100000000"));

    // ========== Deploy 20 tokens ==========
    for (let i = 0; i < 20; i++) {
      const token = await WETH.deploy(); // reuse WETH as generic ERC-20
      await token.deposit({ value: ethers.parseEther("5") });
      await token.approve(await router.getAddress(), ethers.MaxUint256);
      tokens.push(token);
    }

    // Fund alice and bob with native token for trading
    // (they get WETH by depositing ETH)
    for (const user of [alice, bob]) {
      for (const token of tokens) {
        await token.transfer(user.address, ethers.parseEther("1"));
        await token.connect(user).approve(await router.getAddress(), ethers.MaxUint256);
      }
    }

    // Give alice + bob some Swappy
    await swappy.transfer(alice.address, ethers.parseEther("500000"));
    await swappy.transfer(bob.address, ethers.parseEther("500000"));
    await swappy.connect(alice).approve(await swappyStaking.getAddress(), ethers.MaxUint256);
    await swappy.connect(bob).approve(await swappyStaking.getAddress(), ethers.MaxUint256);

    // Deploy NFT contracts
    const MockNFT = await ethers.getContractFactory("MockERC721");
    for (let i = 0; i < 2; i++) {
      const nft = await MockNFT.deploy();
      nftContracts.push(nft);
    }
  });

  // =================== PHASE 1: DEPLOY 20 PAIRS & ADD LP ===================

  it("Phase 1: Should create 20 pairs with WETH and add liquidity", async function () {
    const deadline = await getDeadline();
    const wethAddr = await weth.getAddress();

    for (let i = 0; i < 20; i++) {
      const tokenAddr = await tokens[i].getAddress();

      // Add liquidity: 2 Token + 2 WETH per pair
      await router.addLiquidityETH(
        tokenAddr,
        ethers.parseEther("2"),
        0, 0,
        owner.address,
        deadline,
        { value: ethers.parseEther("2") }
      );

      const pairAddr = await factory.getPair(tokenAddr, wethAddr);
      expect(pairAddr).to.not.equal(ethers.ZeroAddress);
    }

    expect(await factory.allPairsLength()).to.equal(20);
    console.log("    ✓ 20 pairs created with liquidity");
  });

  // =================== PHASE 2: 100 TRADES + FEE VERIFICATION ===================

  it("Phase 2: Should execute 100 swaps and verify fee distribution", async function () {
    const deadline = await getDeadline();
    const wethAddr = await weth.getAddress();

    // Track dev wallet balances before swaps
    const devBalancesBefore = {};
    for (let i = 0; i < 20; i++) {
      const addr = await tokens[i].getAddress();
      devBalancesBefore[addr] = await tokens[i].balanceOf(devWallet.address);
    }
    const devWethBefore = await weth.balanceOf(devWallet.address);

    let totalInputByToken = {};
    let swapCount = 0;

    // Do 100 swaps — cycle through token pairs in both directions
    for (let i = 0; i < 100; i++) {
      const tokenIdx = i % 20;
      const tokenAddr = await tokens[tokenIdx].getAddress();
      const swapAmount = ethers.parseEther("0.01");

      if (i % 2 === 0) {
        // ETH → Token
        await router.swapExactETHForTokens(
          0,
          [wethAddr, tokenAddr],
          owner.address,
          deadline,
          { value: swapAmount }
        );
        // Track WETH input for fee verification
        totalInputByToken[wethAddr] = (totalInputByToken[wethAddr] || 0n) + swapAmount;
      } else {
        // Token → ETH (use alice for variety)
        const trader = i % 4 === 1 ? alice : bob;
        const traderBalance = await tokens[tokenIdx].balanceOf(trader.address);
        if (traderBalance >= swapAmount) {
          await router.connect(trader).swapExactTokensForETH(
            swapAmount,
            0,
            [tokenAddr, wethAddr],
            trader.address,
            deadline
          );
          totalInputByToken[tokenAddr] = (totalInputByToken[tokenAddr] || 0n) + swapAmount;
        }
      }
      swapCount++;
    }

    console.log(`    ✓ ${swapCount} swaps executed`);

    // Verify dev wallet received fees (0.2% of input on each swap)
    // Check WETH fees from ETH→Token swaps
    const devWethAfter = await weth.balanceOf(devWallet.address);
    const wethFeeCollected = devWethAfter - devWethBefore;

    if (totalInputByToken[wethAddr]) {
      const expectedWethFee = totalInputByToken[wethAddr] * 20n / 10000n;
      // Allow ±1% tolerance due to rounding
      expect(wethFeeCollected).to.be.closeTo(expectedWethFee, expectedWethFee / 50n + 1n);
      console.log(`    ✓ WETH dev fee verified: ${ethers.formatEther(wethFeeCollected)} WETH`);
    }

    // Check token fees from Token→ETH swaps
    let tokenFeesVerified = 0;
    for (let i = 0; i < 20; i++) {
      const addr = await tokens[i].getAddress();
      if (totalInputByToken[addr]) {
        const devAfter = await tokens[i].balanceOf(devWallet.address);
        const feeCollected = devAfter - devBalancesBefore[addr];
        const expectedFee = totalInputByToken[addr] * 20n / 10000n;
        expect(feeCollected).to.be.closeTo(expectedFee, expectedFee / 50n + 1n);
        tokenFeesVerified++;
      }
    }
    console.log(`    ✓ Token dev fees verified for ${tokenFeesVerified} tokens`);
  });

  // =================== PHASE 3: 20 NFT LISTINGS, BUY 10 ===================

  it("Phase 3: Should list 20 NFTs and buy 10 of them", async function () {
    const marketplaceAddr = await marketplace.getAddress();

    // Mint 20 NFTs to owner (10 per contract)
    for (let i = 0; i < 20; i++) {
      const nftIdx = i < 10 ? 0 : 1;
      await nftContracts[nftIdx].mint(owner.address);
    }

    // Approve marketplace for both NFT contracts
    await nftContracts[0].setApprovalForAll(marketplaceAddr, true);
    await nftContracts[1].setApprovalForAll(marketplaceAddr, true);

    // List all 20 NFTs at varying prices
    for (let i = 0; i < 20; i++) {
      const nftIdx = i < 10 ? 0 : 1;
      const tokenId = i < 10 ? i : i - 10;
      const price = ethers.parseEther((0.01 + i * 0.005).toFixed(4));

      await marketplace.listNFT(
        await nftContracts[nftIdx].getAddress(),
        tokenId,
        price,
        1,
        0 // ERC721
      );
    }

    expect(await marketplace.nextListingId()).to.equal(20);
    console.log("    ✓ 20 NFTs listed");

    // Buy 10 NFTs (listings 0-9) as alice
    const devBalBefore = await ethers.provider.getBalance(devWallet.address);
    let totalSpent = 0n;

    for (let i = 0; i < 10; i++) {
      const listing = await marketplace.listings(i);
      await marketplace.connect(alice).buyNFT(i, { value: listing.price });
      totalSpent += listing.price;
    }

    // Verify alice owns the NFTs
    for (let i = 0; i < 10; i++) {
      expect(await nftContracts[0].ownerOf(i)).to.equal(alice.address);
    }

    // Verify dev wallet received 0.5% fee on all purchases
    const devBalAfter = await ethers.provider.getBalance(devWallet.address);
    const expectedFee = totalSpent * 50n / 10000n;
    expect(devBalAfter - devBalBefore).to.equal(expectedFee);

    console.log(`    ✓ 10 NFTs purchased by alice`);
    console.log(`    ✓ NFT marketplace fee verified: ${ethers.formatEther(expectedFee)} ETH`);

    // Verify remaining 10 are still listed (active)
    for (let i = 10; i < 20; i++) {
      const listing = await marketplace.listings(i);
      expect(listing.active).to.be.true;
    }
    console.log("    ✓ Remaining 10 listings still active");
  });

  // =================== PHASE 4: STAKE SWAPPY ===================

  it("Phase 4: Should stake Swappy tokens", async function () {
    // Alice stakes 100k SWPY
    await swappyStaking.connect(alice).stake(ethers.parseEther("100000"));
    // Bob stakes 200k SWPY
    await swappyStaking.connect(bob).stake(ethers.parseEther("200000"));

    expect(await swappyStaking.totalStaked()).to.equal(ethers.parseEther("300000"));

    const aliceStake = await swappyStaking.stakes(alice.address);
    expect(aliceStake.amount).to.equal(ethers.parseEther("100000"));

    const bobStake = await swappyStaking.stakes(bob.address);
    expect(bobStake.amount).to.equal(ethers.parseEther("200000"));

    console.log("    ✓ Alice staked 100,000 SWPY");
    console.log("    ✓ Bob staked 200,000 SWPY");
  });

  // =================== PHASE 5: WAIT 2 YEARS, CLAIM REWARDS ===================

  it("Phase 5: Should accrue correct 10% APY rewards over 2 years", async function () {
    // Fast-forward 2 years
    const twoYears = 2 * 365 * 24 * 3600;
    await ethers.provider.send("evm_increaseTime", [twoYears]);
    await ethers.provider.send("evm_mine");

    // Check pending rewards
    const alicePending = await swappyStaking.pendingReward(alice.address);
    const bobPending = await swappyStaking.pendingReward(bob.address);

    // Alice: 100k * 10% * 2 years = 20,000 SWPY
    const aliceExpected = ethers.parseEther("20000");
    expect(alicePending).to.be.closeTo(aliceExpected, ethers.parseEther("10"));

    // Bob: 200k * 10% * 2 years = 40,000 SWPY
    const bobExpected = ethers.parseEther("40000");
    expect(bobPending).to.be.closeTo(bobExpected, ethers.parseEther("10"));

    console.log(`    ✓ Alice pending: ${parseFloat(ethers.formatEther(alicePending)).toFixed(2)} SWPY (expected ~20,000)`);
    console.log(`    ✓ Bob pending: ${parseFloat(ethers.formatEther(bobPending)).toFixed(2)} SWPY (expected ~40,000)`);

    // Alice claims rewards
    const aliceBalBefore = await swappy.balanceOf(alice.address);
    await swappyStaking.connect(alice).claimReward();
    const aliceBalAfter = await swappy.balanceOf(alice.address);
    const aliceClaimed = aliceBalAfter - aliceBalBefore;

    expect(aliceClaimed).to.be.closeTo(aliceExpected, ethers.parseEther("10"));
    console.log(`    ✓ Alice claimed: ${parseFloat(ethers.formatEther(aliceClaimed)).toFixed(2)} SWPY`);

    // Bob exits (withdraw + claim in one tx)
    const bobBalBefore = await swappy.balanceOf(bob.address);
    await swappyStaking.connect(bob).exit();
    const bobBalAfter = await swappy.balanceOf(bob.address);
    const bobReceived = bobBalAfter - bobBalBefore;

    // Bob should receive stake (200k) + rewards (~40k)
    const bobExpectedTotal = ethers.parseEther("240000");
    expect(bobReceived).to.be.closeTo(bobExpectedTotal, ethers.parseEther("10"));
    console.log(`    ✓ Bob exited: ${parseFloat(ethers.formatEther(bobReceived)).toFixed(2)} SWPY (stake + rewards)`);

    // Verify bob fully unstaked
    const bobStake = await swappyStaking.stakes(bob.address);
    expect(bobStake.amount).to.equal(0);
  });

  // =================== PHASE 6: SELL SWAPPY ===================

  it("Phase 6: Should create SWPY-WETH pair and sell Swappy", async function () {
    const deadline = await getDeadline();
    const swappyAddr = await swappy.getAddress();
    const wethAddr = await weth.getAddress();

    // Owner creates SWPY-WETH liquidity pool
    await swappy.approve(await router.getAddress(), ethers.MaxUint256);
    await router.addLiquidityETH(
      swappyAddr,
      ethers.parseEther("1000000"), // 1M SWPY
      0, 0,
      owner.address,
      deadline,
      { value: ethers.parseEther("5") } // 5 ETH
    );

    const pairAddr = await factory.getPair(swappyAddr, wethAddr);
    expect(pairAddr).to.not.equal(ethers.ZeroAddress);
    console.log("    ✓ SWPY-WETH liquidity pool created (1M SWPY / 5 ETH)");

    // Alice sells her SWPY rewards for ETH
    await swappy.connect(alice).approve(await router.getAddress(), ethers.MaxUint256);
    const aliceSwappyBal = await swappy.balanceOf(alice.address);
    const sellAmount = aliceSwappyBal / 10n; // sell 10% of holdings

    const aliceEthBefore = await ethers.provider.getBalance(alice.address);
    const tx = await router.connect(alice).swapExactTokensForETH(
      sellAmount,
      0,
      [swappyAddr, wethAddr],
      alice.address,
      deadline
    );
    const receipt = await tx.wait();
    const gasCost = receipt.gasUsed * receipt.gasPrice;
    const aliceEthAfter = await ethers.provider.getBalance(alice.address);

    const ethReceived = aliceEthAfter + gasCost - aliceEthBefore;
    expect(ethReceived).to.be.gt(0);
    console.log(`    ✓ Alice sold ${parseFloat(ethers.formatEther(sellAmount)).toFixed(2)} SWPY for ${parseFloat(ethers.formatEther(ethReceived)).toFixed(6)} ETH`);

    // Bob also sells some SWPY
    await swappy.connect(bob).approve(await router.getAddress(), ethers.MaxUint256);
    const bobSwappyBal = await swappy.balanceOf(bob.address);
    const bobSellAmount = bobSwappyBal / 10n;

    const bobEthBefore = await ethers.provider.getBalance(bob.address);
    const tx2 = await router.connect(bob).swapExactTokensForETH(
      bobSellAmount,
      0,
      [swappyAddr, wethAddr],
      bob.address,
      deadline
    );
    const receipt2 = await tx2.wait();
    const gasCost2 = receipt2.gasUsed * receipt2.gasPrice;
    const bobEthAfter = await ethers.provider.getBalance(bob.address);

    const bobEthReceived = bobEthAfter + gasCost2 - bobEthBefore;
    expect(bobEthReceived).to.be.gt(0);
    console.log(`    ✓ Bob sold ${parseFloat(ethers.formatEther(bobSellAmount)).toFixed(2)} SWPY for ${parseFloat(ethers.formatEther(bobEthReceived)).toFixed(6)} ETH`);

    // Verify dev wallet received fees from SWPY sells
    const devSwappyFee = await swappy.balanceOf(devWallet.address);
    expect(devSwappyFee).to.be.gt(0);
    console.log(`    ✓ Dev wallet received ${parseFloat(ethers.formatEther(devSwappyFee)).toFixed(4)} SWPY in fees from sells`);
  });

  // =================== PHASE 7: FINAL STATE SUMMARY ===================

  it("Phase 7: Final state verification", async function () {
    console.log("\n    ═══════════════════════════════════════");
    console.log("    ║       INTEGRATION TEST SUMMARY       ║");
    console.log("    ═══════════════════════════════════════");

    // Pairs
    const pairCount = await factory.allPairsLength();
    console.log(`    Pairs created:        ${pairCount} (20 tokens + 1 SWPY)`);

    // NFTs
    const listingCount = await marketplace.nextListingId();
    console.log(`    NFTs listed:          ${listingCount}`);

    // Staking
    const totalStaked = await swappyStaking.totalStaked();
    const reserve = await swappyStaking.rewardReserve();
    console.log(`    SWPY still staked:    ${parseFloat(ethers.formatEther(totalStaked)).toFixed(2)}`);
    console.log(`    Reward reserve left:  ${parseFloat(ethers.formatEther(reserve)).toFixed(2)}`);

    // Dev wallet
    const devEth = await ethers.provider.getBalance(devWallet.address);
    const devSwappy = await swappy.balanceOf(devWallet.address);
    const devWeth = await weth.balanceOf(devWallet.address);
    console.log(`    Dev ETH balance:      ${parseFloat(ethers.formatEther(devEth)).toFixed(4)}`);
    console.log(`    Dev WETH fees:        ${parseFloat(ethers.formatEther(devWeth)).toFixed(6)}`);
    console.log(`    Dev SWPY fees:        ${parseFloat(ethers.formatEther(devSwappy)).toFixed(4)}`);

    console.log("    ═══════════════════════════════════════\n");

    // Sanity checks
    expect(pairCount).to.equal(21); // 20 + SWPY-WETH
    expect(listingCount).to.equal(20);
    expect(totalStaked).to.equal(ethers.parseEther("100000")); // only alice still staked
    expect(reserve).to.be.gt(0);
  });
});
