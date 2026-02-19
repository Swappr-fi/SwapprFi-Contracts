const hre = require("hardhat");

async function verify(address, constructorArguments = []) {
  try {
    await hre.run("verify:verify", { address, constructorArguments });
    console.log(`  Verified: ${address}`);
  } catch (e) {
    if (e.message.includes("Already Verified") || e.message.includes("already verified")) {
      console.log(`  Already verified: ${address}`);
    } else {
      console.log(`  Verification failed: ${e.message}`);
    }
  }
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const devWallet = deployer.address;

  console.log("╔══════════════════════════════════════════╗");
  console.log("║     Swapper — BlockDAG Deployment        ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("Deployer / Dev Wallet:", devWallet);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(devWallet)), "BDAG\n");

  // ─── 1. Deploy WETH ───────────────────────────────────────────
  console.log("[1/8] Deploying WETH...");
  const weth = await (await hre.ethers.getContractFactory("WETH")).deploy();
  await weth.waitForDeployment();
  console.log("  WETH:", await weth.getAddress());

  // ─── 2. Deploy Factory ────────────────────────────────────────
  console.log("[2/8] Deploying SwapperFactory...");
  const factory = await (await hre.ethers.getContractFactory("SwapperFactory")).deploy(devWallet);
  await factory.waitForDeployment();
  console.log("  Factory:", await factory.getAddress());

  // ─── 3. Deploy Router ─────────────────────────────────────────
  console.log("[3/8] Deploying SwapperRouter...");
  const router = await (await hre.ethers.getContractFactory("SwapperRouter")).deploy(
    await factory.getAddress(),
    await weth.getAddress()
  );
  await router.waitForDeployment();
  console.log("  Router:", await router.getAddress());

  // ─── 4. Deploy NFT Marketplace ────────────────────────────────
  console.log("[4/8] Deploying SwapperNFTMarketplace...");
  const marketplace = await (await hre.ethers.getContractFactory("SwapperNFTMarketplace")).deploy(devWallet);
  await marketplace.waitForDeployment();
  console.log("  NFT Marketplace:", await marketplace.getAddress());

  // ─── 5. Deploy SwappyToken (1B supply) ────────────────────────
  //   1,000,000,000 SWPY minted to deployer
  //   └── 200,000,000  → SwappySale (1:1 for BDAG)
  //   └── 200,000,000  → Staking rewards (10% APY)
  //   └──       2,000  → LP (paired with 2,000 BDAG)
  //   └── 599,998,000  → Remains in dev wallet
  console.log("[5/8] Deploying SwappyToken (1,000,000,000 SWPY)...");
  const totalSupply = hre.ethers.parseEther("1000000000");
  const swappy = await (await hre.ethers.getContractFactory("SwappyToken")).deploy(totalSupply);
  await swappy.waitForDeployment();
  console.log("  SwappyToken:", await swappy.getAddress());

  // ─── 6. Deploy Staking Contracts ──────────────────────────────
  console.log("[6/8] Deploying staking contracts...");

  const staking = await (await hre.ethers.getContractFactory("SwapperStaking")).deploy();
  await staking.waitForDeployment();
  console.log("  SwapperStaking (general):", await staking.getAddress());

  const swappyStaking = await (await hre.ethers.getContractFactory("SwappyStaking")).deploy(
    await swappy.getAddress()
  );
  await swappyStaking.waitForDeployment();
  console.log("  SwappyStaking (10% APY):", await swappyStaking.getAddress());

  // Fund staking with 200M SWPY for rewards
  const rewardFund = hre.ethers.parseEther("200000000");
  console.log("  Funding SwappyStaking with 200,000,000 SWPY...");
  let tx = await swappy.approve(await swappyStaking.getAddress(), rewardFund);
  await tx.wait();
  tx = await swappyStaking.fundRewards(rewardFund);
  await tx.wait();
  console.log("  Staking rewards funded.");

  // ─── 7. Deploy SwappySale ─────────────────────────────────────
  //   200,000,000 SWPY available at 1:1 rate for BDAG
  console.log("[7/8] Deploying SwappySale (200M SWPY at 1:1 for BDAG)...");

  const swappySale = await (await hre.ethers.getContractFactory("SwappySale")).deploy(
    await swappy.getAddress(),
    devWallet
  );
  await swappySale.waitForDeployment();
  console.log("  SwappySale:", await swappySale.getAddress());

  // Fund sale with 200M SWPY
  const saleFund = hre.ethers.parseEther("200000000");
  tx = await swappy.transfer(await swappySale.getAddress(), saleFund);
  await tx.wait();
  console.log("  Funded with 200,000,000 SWPY");
  console.log("  Rate: 1 BDAG = 1 SWPY");

  // ─── 8. Create SWPY-BDAG LP ─────────────────────────────────
  //   2,000 SWPY + 2,000 BDAG initial liquidity
  console.log("[8/8] Creating SWPY-BDAG liquidity pool (2,000 SWPY + 2,000 BDAG)...");

  const lpSwpy = hre.ethers.parseEther("2000");
  const lpBdag = hre.ethers.parseEther("2000");
  const routerAddr = await router.getAddress();

  // Approve router to spend SWPY
  tx = await swappy.approve(routerAddr, lpSwpy);
  await tx.wait();
  console.log("  Approved router for 2,000 SWPY");

  // Add liquidity: 2,000 SWPY + 2,000 BDAG
  const deadline = Math.floor(Date.now() / 1000) + 600; // 10 min
  tx = await router.addLiquidityETH(
    await swappy.getAddress(), // token
    lpSwpy,                    // amountTokenDesired
    lpSwpy,                    // amountTokenMin (exact for initial)
    lpBdag,                    // amountETHMin (exact for initial)
    devWallet,                 // LP tokens go to dev wallet
    deadline,                  // deadline
    { value: lpBdag }
  );
  await tx.wait();

  const pairAddr = await factory.getPair(await swappy.getAddress(), await weth.getAddress());
  console.log("  LP Pair:", pairAddr);
  console.log("  Seeded: 2,000 SWPY + 2,000 BDAG (1:1 ratio)");

  // ─── Summary ──────────────────────────────────────────────────
  const remaining = await swappy.balanceOf(devWallet);

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║         DEPLOYMENT COMPLETE               ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log("║ WETH:             ", await weth.getAddress());
  console.log("║ SwapperFactory:   ", await factory.getAddress());
  console.log("║ SwapperRouter:    ", await router.getAddress());
  console.log("║ NFT Marketplace:  ", await marketplace.getAddress());
  console.log("║ SwappyToken:      ", await swappy.getAddress());
  console.log("║ SwapperStaking:   ", await staking.getAddress());
  console.log("║ SwappyStaking:    ", await swappyStaking.getAddress());
  console.log("║ SwappySale:       ", await swappySale.getAddress());
  console.log("║ LP Pair:          ", pairAddr);
  console.log("╠══════════════════════════════════════════╣");
  console.log("║ Dev Wallet:       ", devWallet);
  console.log("║ SWPY in wallet:   ", hre.ethers.formatEther(remaining), "SWPY");
  console.log("║ SWPY in sale:      200,000,000 SWPY (1:1 for BDAG)");
  console.log("║ SWPY in staking:   200,000,000 SWPY (rewards)");
  console.log("║ SWPY in LP:        2,000 SWPY + 2,000 BDAG");
  console.log("║ BDAG remaining:   ", hre.ethers.formatEther(await hre.ethers.provider.getBalance(devWallet)), "BDAG");
  console.log("╚══════════════════════════════════════════╝");

  // ─── Frontend Config (copy into frontend/src/lib/contracts.ts) ──
  console.log("\n\n// ─── Copy below into frontend/src/lib/contracts.ts ───");
  console.log(`export const ADDRESSES = {
  WETH: "${await weth.getAddress()}",
  FACTORY: "${await factory.getAddress()}",
  ROUTER: "${await router.getAddress()}",
  NFT_MARKETPLACE: "${await marketplace.getAddress()}",
  SWAPPY_TOKEN: "${await swappy.getAddress()}",
  SWAPPER_STAKING: "${await staking.getAddress()}",
  SWAPPY_STAKING: "${await swappyStaking.getAddress()}",
  SWAPPY_SALE: "${await swappySale.getAddress()}",
  LP_PAIR: "${pairAddr}",
} as const;`);

  // ─── Verify Contracts on BDAGScan ──────────────────────────────
  console.log("\n\nVerifying contracts on BDAGScan...\n");

  console.log("  [1/8] WETH...");
  await verify(await weth.getAddress(), []);

  console.log("  [2/8] SwapperFactory...");
  await verify(await factory.getAddress(), [devWallet]);

  console.log("  [3/8] SwapperRouter...");
  await verify(await router.getAddress(), [await factory.getAddress(), await weth.getAddress()]);

  console.log("  [4/8] SwapperNFTMarketplace...");
  await verify(await marketplace.getAddress(), [devWallet]);

  console.log("  [5/8] SwappyToken...");
  await verify(await swappy.getAddress(), [totalSupply]);

  console.log("  [6/8] SwapperStaking...");
  await verify(await staking.getAddress(), []);

  console.log("  [7/8] SwappyStaking...");
  await verify(await swappyStaking.getAddress(), [await swappy.getAddress()]);

  console.log("  [8/8] SwappySale...");
  await verify(await swappySale.getAddress(), [await swappy.getAddress(), devWallet]);

  console.log("\nAll verifications attempted. Check https://bdagscan.com for results.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
