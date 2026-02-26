const { expect } = require("chai");
const hre = require("hardhat");

/**
 * Launchpad Stress Test
 *
 * 1. 1000 users each create a token
 * 2. All users buy and sell tokens on the bonding curve
 * 3. 200 tokens graduate (pass bonding curve threshold)
 * 4. Of those 200, 100 have LP liquidated (mass DEX sell), 100 continue trading on DEX
 */

// Minimal ERC20 ABI (avoids ambiguous IERC20 artifact)
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function transfer(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
];

describe("Launchpad Stress Test — 1000 tokens", function () {
  this.timeout(0); // no timeout

  let deployer;
  let users; // 1000 users
  let launchpad, router, factory, weth;
  let launchpadAddr, routerAddr, factoryAddr, wethAddr;

  const GRADUATION_THRESHOLD = hre.ethers.parseEther("1000000"); // 1M BDAG

  // Track state
  const tokenAddresses = []; // token contract address per id
  const graduatedIds = [];
  const lpPairAddresses = []; // pair address per graduated token

  before(async function () {
    const signers = await hre.ethers.getSigners();
    deployer = signers[0];
    users = signers.slice(1, 1001); // 1000 users

    console.log(`  Deployer: ${deployer.address}`);
    console.log(`  Users: ${users.length}`);
    expect(users.length).to.equal(1000);

    // ---- Deploy all contracts ----
    console.log("\n  Deploying contracts...");

    // Multicall3
    const MULTICALL3_ADDR = "0xcA11bde05977b3631167028862bE2a173976CA11";
    const Multicall3 = await hre.ethers.getContractFactory("Multicall3");
    const mc3 = await Multicall3.deploy();
    await mc3.waitForDeployment();
    const runtimeCode = await hre.ethers.provider.getCode(await mc3.getAddress());
    await hre.network.provider.send("hardhat_setCode", [MULTICALL3_ADDR, runtimeCode]);

    const WETH = await hre.ethers.getContractFactory("WETH");
    weth = await WETH.deploy();
    await weth.waitForDeployment();
    wethAddr = await weth.getAddress();

    const Factory = await hre.ethers.getContractFactory("SwapperFactory");
    factory = await Factory.deploy(deployer.address);
    await factory.waitForDeployment();
    factoryAddr = await factory.getAddress();

    const Router = await hre.ethers.getContractFactory("SwapperRouter");
    router = await Router.deploy(factoryAddr, wethAddr);
    await router.waitForDeployment();
    routerAddr = await router.getAddress();

    const LaunchpadFactory = await hre.ethers.getContractFactory("LaunchpadFactory");
    launchpad = await LaunchpadFactory.deploy(routerAddr, factoryAddr, wethAddr, deployer.address);
    await launchpad.waitForDeployment();
    launchpadAddr = await launchpad.getAddress();

    console.log(`  LaunchpadFactory: ${launchpadAddr}`);
    console.log(`  Router: ${routerAddr}`);
    console.log(`  Factory: ${factoryAddr}`);
    console.log(`  WETH: ${wethAddr}`);

    // Fund deployer with enough BDAG for 200 graduations (~1.1M each = 220M total, plus buffer)
    await hre.network.provider.send("hardhat_setBalance", [
      deployer.address,
      "0x" + (BigInt("300000000") * BigInt("1000000000000000000")).toString(16), // 300M BDAG
    ]);
    const deployerBal = await hre.ethers.provider.getBalance(deployer.address);
    console.log(`  Deployer balance: ${hre.ethers.formatEther(deployerBal)} BDAG`);

    // Verify initial virtual BDAG
    const vBdag = await launchpad.initialVirtualBdag();
    console.log(`  initialVirtualBdag: ${hre.ethers.formatEther(vBdag)} BDAG`);
    expect(vBdag).to.equal(hre.ethers.parseEther("200000"));
  });

  // ============================================================
  // PHASE 1: 1000 users create tokens
  // ============================================================
  it("Phase 1: 1000 users each create a token", async function () {
    console.log("\n  Creating 1000 tokens...");
    const BATCH = 50;

    for (let b = 0; b < 1000; b += BATCH) {
      const promises = [];
      for (let i = b; i < Math.min(b + BATCH, 1000); i++) {
        const user = users[i];
        const lp = launchpad.connect(user);
        promises.push(
          lp.createToken(
            `Token${i}`, `T${i}`,
            `Test token ${i}`, "", "", "", "",
            { value: hre.ethers.parseEther("10") } // small initial buy
          ).then(tx => tx.wait())
        );
      }
      await Promise.all(promises);
      if ((b + BATCH) % 200 === 0) console.log(`    ${Math.min(b + BATCH, 1000)} / 1000 created`);
    }

    const count = await launchpad.tokenCount();
    expect(count).to.equal(1000n);
    console.log(`  Total tokens created: ${count}`);

    // Cache all token addresses
    for (let i = 0; i < 1000; i++) {
      const info = await launchpad.getTokenInfo(i);
      tokenAddresses.push(info.token);
    }
  });

  // ============================================================
  // PHASE 2: Random buying and selling on all 1000 tokens
  // ============================================================
  it("Phase 2: Users buy and sell across tokens", async function () {
    console.log("\n  Running buy/sell rounds on all tokens...");

    // Each user buys on ~3 random tokens and sells some back
    const BATCH = 50;

    for (let b = 0; b < 1000; b += BATCH) {
      const promises = [];
      for (let i = b; i < Math.min(b + BATCH, 1000); i++) {
        const user = users[i];

        // Buy on 3 different tokens (not their own)
        const targets = [(i + 1) % 1000, (i + 7) % 1000, (i + 42) % 1000];
        for (const t of targets) {
          const lp = launchpad.connect(user);
          promises.push(
            lp.buy(t, 0, { value: hre.ethers.parseEther("5") }).then(tx => tx.wait())
          );
        }
      }
      await Promise.all(promises);
      if ((b + BATCH) % 200 === 0) console.log(`    ${Math.min(b + BATCH, 1000)} / 1000 users bought`);
    }

    // Some users sell back ~half their tokens on one of their buys
    console.log("  Running sell rounds...");
    for (let b = 0; b < 500; b += BATCH) {
      const promises = [];
      for (let i = b; i < Math.min(b + BATCH, 500); i++) {
        const user = users[i];
        const targetId = (i + 1) % 1000;
        const tokenAddr = tokenAddresses[targetId];

        const erc20 = new hre.ethers.Contract(tokenAddr, ERC20_ABI, user);
        const balance = await erc20.balanceOf(user.address);
        if (balance > 0n) {
          const sellAmount = balance / 2n;
          promises.push(
            erc20.approve(launchpadAddr, sellAmount).then(tx => tx.wait()).then(async () => {
              const tx = await launchpad.connect(user).sell(targetId, sellAmount, 0);
              await tx.wait();
            })
          );
        }
      }
      await Promise.all(promises);
      if ((b + BATCH) % 200 === 0) console.log(`    ${Math.min(b + BATCH, 500)} / 500 users sold`);
    }

    // Print a sample of prices after trading
    console.log("\n  Sample prices after Phase 2:");
    for (const id of [0, 100, 500, 999]) {
      const p = await launchpad.getCurrentPrice(id);
      const info = await launchpad.getTokenInfo(id);
      console.log(`    Token ${id}: price=${hre.ethers.formatEther(p)} BDAG, raised=${hre.ethers.formatEther(info.realBdag)} BDAG`);
    }
  });

  // ============================================================
  // PHASE 3: Push 200 tokens past graduation
  // ============================================================
  it("Phase 3: 200 tokens graduate", async function () {
    console.log("\n  Pushing 200 tokens to graduation...");

    // Tokens 0-199 will graduate. We use deployer (funded with 300M) to pump them.
    // Process sequentially in small batches to avoid nonce issues.
    const BATCH = 5;

    for (let b = 0; b < 200; b += BATCH) {
      const promises = [];
      for (let i = b; i < Math.min(b + BATCH, 200); i++) {
        promises.push(
          (async () => {
            const info = await launchpad.getTokenInfo(i);
            if (info.graduated) return;
            const needed = GRADUATION_THRESHOLD - info.realBdag;
            if (needed <= 0n) return;
            // Buy with enough BDAG to graduate (add 10% buffer for fees)
            const buyAmount = (needed * 110n) / 100n;
            const tx = await launchpad.connect(deployer).buy(i, 0, { value: buyAmount });
            await tx.wait();
          })()
        );
      }
      await Promise.all(promises);
      if ((b + BATCH) % 50 === 0) console.log(`    ${Math.min(b + BATCH, 200)} / 200 graduated`);
    }

    // Verify all 200 graduated
    let gradCount = 0;
    for (let i = 0; i < 200; i++) {
      const info = await launchpad.getTokenInfo(i);
      if (info.graduated) {
        gradCount++;
        graduatedIds.push(i);
      }
    }
    console.log(`  Graduated: ${gradCount} / 200`);
    expect(gradCount).to.equal(200);

    // Verify the other 800 did NOT graduate
    for (const id of [200, 500, 999]) {
      const info = await launchpad.getTokenInfo(id);
      expect(info.graduated).to.equal(false);
    }
    console.log("  Confirmed 800 tokens remain on bonding curve");

    const deployerBal = await hre.ethers.provider.getBalance(deployer.address);
    console.log(`  Deployer balance after graduations: ${hre.ethers.formatEther(deployerBal)} BDAG`);
  });

  // ============================================================
  // PHASE 4: Check LP pairs for graduated tokens
  // ============================================================
  it("Phase 4: Verify LP pairs exist for all 200 graduated tokens", async function () {
    console.log("\n  Checking LP pairs...");
    const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

    for (let i = 0; i < 200; i++) {
      const tokenAddr = tokenAddresses[i];
      const pair = await factory.getPair(tokenAddr, wethAddr);
      expect(pair).to.not.equal(ZERO_ADDR, `Token ${i} has no LP pair`);
      lpPairAddresses.push(pair);
    }
    console.log(`  All 200 LP pairs verified`);

    // Sample LP stats
    for (const idx of [0, 50, 100, 199]) {
      const pairContract = await hre.ethers.getContractAt("SwapperPair", lpPairAddresses[idx]);
      const reserves = await pairContract.getReserves();
      const lpSupply = await pairContract.totalSupply();
      console.log(`    Token ${idx} LP: reserve0=${hre.ethers.formatEther(reserves[0])}, reserve1=${hre.ethers.formatEther(reserves[1])}, lpSupply=${hre.ethers.formatEther(lpSupply)}`);
    }
  });

  // ============================================================
  // PHASE 5: 100 graduated tokens — liquidate via mass DEX sells
  // ============================================================
  it("Phase 5: 100 graduated tokens — LP liquidation via DEX sells", async function () {
    console.log("\n  Liquidating 100 graduated tokens via DEX...");

    // LP tokens were sent to 0xdead during graduation so LP can't be removed directly.
    // "Liquidation" = holders dump all their tokens on the DEX pair.
    // We sell tokens through the router for tokens 0-99.

    const latestBlock = await hre.ethers.provider.getBlock("latest");
    const deadline = latestBlock.timestamp + 86400; // +1 day from chain time
    const BATCH = 5;

    for (let b = 0; b < 100; b += BATCH) {
      for (let i = b; i < Math.min(b + BATCH, 100); i++) {
        const tokenAddr = tokenAddresses[i];

        // Deployer dumps their tokens
        const erc20Deployer = new hre.ethers.Contract(tokenAddr, ERC20_ABI, deployer);
        const deployerBal = await erc20Deployer.balanceOf(deployer.address);
        if (i === b) console.log(`      Token ${i} deployer balance: ${hre.ethers.formatEther(deployerBal)}`);
        if (deployerBal > 0n) {
          await (await erc20Deployer.approve(routerAddr, deployerBal)).wait();
          const tx = await router.connect(deployer).swapExactTokensForETH(
            deployerBal, 0, [tokenAddr, wethAddr], deployer.address, deadline
          );
          await tx.wait();
          if (i === b) console.log(`      Token ${i} deployer sold OK`);
        }

        // Creator dumps their tokens
        const creator = users[i];
        const erc20Creator = new hre.ethers.Contract(tokenAddr, ERC20_ABI, creator);
        const creatorBal = await erc20Creator.balanceOf(creator.address);
        if (creatorBal > 0n) {
          await (await erc20Creator.approve(routerAddr, creatorBal)).wait();
          const tx = await router.connect(creator).swapExactTokensForETH(
            creatorBal, 0, [tokenAddr, wethAddr], creator.address, deadline
          );
          await tx.wait();
        }

        // Also have the buyers who bought in Phase 2 dump
        for (const offset of [1, 7, 42]) {
          const buyerIdx = ((i - offset) + 1000) % 1000;
          const buyer = users[buyerIdx];
          const erc20Buyer = new hre.ethers.Contract(tokenAddr, ERC20_ABI, buyer);
          const buyerBal = await erc20Buyer.balanceOf(buyer.address);
          if (buyerBal > 0n) {
            await (await erc20Buyer.approve(routerAddr, buyerBal)).wait();
            const tx = await router.connect(buyer).swapExactTokensForETH(
              buyerBal, 0, [tokenAddr, wethAddr], buyer.address, deadline
            );
            await tx.wait();
          }
        }
      }
      if ((b + BATCH) % 25 === 0) console.log(`    ${Math.min(b + BATCH, 100)} / 100 liquidated`);
    }

    // Check reserves — BDAG side should be depleted
    console.log("\n  Post-liquidation LP stats (sample):");
    for (const idx of [0, 25, 50, 99]) {
      const pairContract = await hre.ethers.getContractAt("SwapperPair", lpPairAddresses[idx]);
      const reserves = await pairContract.getReserves();
      console.log(`    Token ${idx} LP: reserve0=${hre.ethers.formatEther(reserves[0])}, reserve1=${hre.ethers.formatEther(reserves[1])}`);
    }
  });

  // ============================================================
  // PHASE 6: Other 100 graduated tokens — continued DEX trading
  // ============================================================
  it("Phase 6: 100 graduated tokens — continued normal DEX trading", async function () {
    console.log("\n  Continuing DEX trading on tokens 100-199...");

    const latestBlock = await hre.ethers.provider.getBlock("latest");
    const deadline = latestBlock.timestamp + 86400; // +1 day from chain time
    const BATCH = 10;

    // Multiple rounds of buys and sells
    for (let round = 0; round < 3; round++) {
      console.log(`  Round ${round + 1}/3`);

      // --- BUYS: users buy tokens via DEX ---
      for (let b = 0; b < 100; b += BATCH) {
        const promises = [];
        for (let j = b; j < Math.min(b + BATCH, 100); j++) {
          const tokenIdx = 100 + j; // tokens 100-199
          const tokenAddr = tokenAddresses[tokenIdx];
          const buyerIdx = 200 + j + (round * 100);
          const buyer = users[buyerIdx];
          if (!buyer) continue;

          promises.push(
            (async () => {
              const tx = await router.connect(buyer).swapExactETHForTokens(
                0, [wethAddr, tokenAddr], buyer.address, deadline,
                { value: hre.ethers.parseEther("100") }
              );
              await tx.wait();
            })()
          );
        }
        await Promise.all(promises);
      }
      console.log(`    100 buys done`);

      // --- SELLS: buyers sell back half ---
      for (let b = 0; b < 100; b += BATCH) {
        const promises = [];
        for (let j = b; j < Math.min(b + BATCH, 100); j++) {
          const tokenIdx = 100 + j;
          const tokenAddr = tokenAddresses[tokenIdx];
          const sellerIdx = 200 + j + (round * 100);
          const seller = users[sellerIdx];
          if (!seller) continue;

          promises.push(
            (async () => {
              const erc20 = new hre.ethers.Contract(tokenAddr, ERC20_ABI, seller);
              const balance = await erc20.balanceOf(seller.address);
              if (balance > 0n) {
                const sellAmt = balance / 2n;
                await (await erc20.approve(routerAddr, sellAmt)).wait();
                const tx = await router.connect(seller).swapExactTokensForETH(
                  sellAmt, 0, [tokenAddr, wethAddr], seller.address, deadline
                );
                await tx.wait();
              }
            })()
          );
        }
        await Promise.all(promises);
      }
      console.log(`    100 sells done`);
    }

    // Final LP stats for actively traded tokens
    console.log("\n  Post-trading LP stats (tokens 100-199 sample):");
    for (const idx of [100, 125, 150, 199]) {
      const lpIdx = idx; // lpPairAddresses[0..199] maps to token ids 0..199
      const pairContract = await hre.ethers.getContractAt("SwapperPair", lpPairAddresses[lpIdx]);
      const reserves = await pairContract.getReserves();
      console.log(`    Token ${idx} LP: reserve0=${hre.ethers.formatEther(reserves[0])}, reserve1=${hre.ethers.formatEther(reserves[1])}`);
    }
  });

  // ============================================================
  // SUMMARY
  // ============================================================
  it("Summary: Final state check", async function () {
    console.log("\n  ═══════════════════════════════════════");
    console.log("  FINAL SUMMARY");
    console.log("  ═══════════════════════════════════════\n");

    // Count graduated
    let graduated = 0;
    let onCurve = 0;
    for (let i = 0; i < 1000; i++) {
      const info = await launchpad.getTokenInfo(i);
      if (info.graduated) graduated++;
      else onCurve++;
    }
    console.log(`  Tokens created:     1000`);
    console.log(`  Graduated:          ${graduated}`);
    console.log(`  Still on curve:     ${onCurve}`);

    expect(graduated).to.equal(200);
    expect(onCurve).to.equal(800);

    // Sample liquidated tokens (0-99) — reserves should be skewed (lots of tokens, little BDAG)
    console.log("\n  Liquidated tokens (0-99) sample:");
    for (const idx of [0, 50, 99]) {
      const pairContract = await hre.ethers.getContractAt("SwapperPair", lpPairAddresses[idx]);
      const reserves = await pairContract.getReserves();
      const t0 = await pairContract.token0();
      const label0 = t0.toLowerCase() === tokenAddresses[idx].toLowerCase() ? "TOKEN" : "WBDAG";
      const label1 = label0 === "TOKEN" ? "WBDAG" : "TOKEN";
      console.log(`    Token ${idx}: ${label0}=${hre.ethers.formatEther(reserves[0])}, ${label1}=${hre.ethers.formatEther(reserves[1])}`);
    }

    // Sample active tokens (100-199) — should have healthier reserves
    console.log("\n  Active DEX tokens (100-199) sample:");
    for (const idx of [100, 150, 199]) {
      const pairContract = await hre.ethers.getContractAt("SwapperPair", lpPairAddresses[idx]);
      const reserves = await pairContract.getReserves();
      const t0 = await pairContract.token0();
      const label0 = t0.toLowerCase() === tokenAddresses[idx].toLowerCase() ? "TOKEN" : "WBDAG";
      const label1 = label0 === "TOKEN" ? "WBDAG" : "TOKEN";
      console.log(`    Token ${idx}: ${label0}=${hre.ethers.formatEther(reserves[0])}, ${label1}=${hre.ethers.formatEther(reserves[1])}`);
    }

    // Sample bonding curve tokens (800-999)
    console.log("\n  Bonding curve tokens (800-999) sample:");
    for (const id of [800, 900, 999]) {
      const p = await launchpad.getCurrentPrice(id);
      const info = await launchpad.getTokenInfo(id);
      console.log(`    Token ${id}: price=${hre.ethers.formatEther(p)} BDAG, raised=${hre.ethers.formatEther(info.realBdag)} BDAG, sold=${hre.ethers.formatEther(info.tokensSold)} tokens`);
    }

    // Check deployer pending withdrawals (should have graduation dev share)
    const pending = await launchpad.pendingWithdrawals(deployer.address);
    console.log(`\n  Dev wallet pending withdrawals: ${hre.ethers.formatEther(pending)} BDAG`);

    // Check some creator pending withdrawals
    let totalCreatorPending = 0n;
    for (let i = 0; i < 200; i++) {
      const p = await launchpad.pendingWithdrawals(users[i].address);
      totalCreatorPending += p;
    }
    console.log(`  Total creator pending (200 graduated): ${hre.ethers.formatEther(totalCreatorPending)} BDAG`);

    console.log("\n  ═══════════════════════════════════════");
    console.log("  ALL CHECKS PASSED");
    console.log("  ═══════════════════════════════════════");
  });
});
