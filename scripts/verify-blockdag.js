const hre = require("hardhat");

// ─── Deployed prod addresses (from contracts.ts PROD_ADDRESSES) ───
const ADDRESSES = {
  WETH:             "0x9441C3b63270bcA27FC94B232e030acaCc5A597D",
  FACTORY:          "0x3a634E1CE44d1b73b27A6F57f2bFF1e9333106d4",
  ROUTER:           "0x5eaBf96f9543F0DB68d1b21C76EB482CE7adaa02",
  NFT_MARKETPLACE:  "0xE58A9ccCedFb93B67b62A5920791f3a559da3a9f",
  SWAPPY_TOKEN:     "0x47470692Ab7D24b0DB42265C18D41cE93155d477",
  SWAPPER_STAKING:  "0x14be19EB5384Da62E988b93b1ae997AA5F64fa6C",
  SWAPPY_STAKING:   "0x39BF3961E54c89329f61163fc4840E7Bb063560a",
  SWAPPY_SALE:      "0xb48569D4B7BA365e2a858CdDb29dB85279d60D7E",
};

async function verify(name, address, constructorArguments = []) {
  console.log(`  Verifying ${name} at ${address}...`);
  try {
    await hre.run("verify:verify", { address, constructorArguments });
    console.log(`  ✓ ${name} verified\n`);
  } catch (e) {
    if (e.message.includes("Already Verified") || e.message.includes("already verified")) {
      console.log(`  ✓ ${name} already verified\n`);
    } else {
      console.log(`  ✗ ${name} failed: ${e.message}\n`);
    }
  }
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const devWallet = deployer.address;
  const totalSupply = hre.ethers.parseEther("1000000000");

  console.log("╔══════════════════════════════════════════╗");
  console.log("║   Swapper — Verify Contracts on BDAGScan ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("Dev Wallet:", devWallet);
  console.log("");

  // 1. WETH — no constructor args
  await verify("WETH", ADDRESSES.WETH);

  // 2. SwapperFactory — constructor(address _devWallet)
  await verify("SwapperFactory", ADDRESSES.FACTORY, [devWallet]);

  // 3. SwapperRouter — constructor(address _factory, address _weth)
  await verify("SwapperRouter", ADDRESSES.ROUTER, [ADDRESSES.FACTORY, ADDRESSES.WETH]);

  // 4. SwapperNFTMarketplace — constructor(address _devWallet)
  await verify("SwapperNFTMarketplace", ADDRESSES.NFT_MARKETPLACE, [devWallet]);

  // 5. SwappyToken — constructor(uint256 _totalSupply)
  await verify("SwappyToken", ADDRESSES.SWAPPY_TOKEN, [totalSupply]);

  // 6. SwapperStaking — no constructor args
  await verify("SwapperStaking", ADDRESSES.SWAPPER_STAKING);

  // 7. SwappyStaking — constructor(address _swappy)
  await verify("SwappyStaking", ADDRESSES.SWAPPY_STAKING, [ADDRESSES.SWAPPY_TOKEN]);

  // 8. SwappySale — constructor(address _swappy, address _devWallet)
  await verify("SwappySale", ADDRESSES.SWAPPY_SALE, [ADDRESSES.SWAPPY_TOKEN, devWallet]);

  console.log("Done. Check https://bdagscan.com for results.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
