const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying LaunchpadFactory with:", deployer.address);

  // Existing deployed addresses — update per environment
  const ROUTER = process.env.ROUTER_ADDRESS || "0x5eaBf96f9543F0DB68d1b21C76EB482CE7adaa02";
  const FACTORY = process.env.FACTORY_ADDRESS || "0x3a634E1CE44d1b73b27A6F57f2bFF1e9333106d4";
  const WETH = process.env.WETH_ADDRESS || "0x9441C3b63270bcA27FC94B232e030acaCc5A597D";
  const DEV_WALLET = process.env.DEV_WALLET || deployer.address;

  console.log(`Router: ${ROUTER}`);
  console.log(`Factory: ${FACTORY}`);
  console.log(`WETH: ${WETH}`);
  console.log(`Dev Wallet: ${DEV_WALLET}`);

  const LaunchpadFactory = await hre.ethers.getContractFactory("LaunchpadFactory");
  const launchpad = await LaunchpadFactory.deploy(ROUTER, FACTORY, WETH, DEV_WALLET);
  await launchpad.waitForDeployment();
  const address = await launchpad.getAddress();

  console.log(`\n========================================`);
  console.log(`  LaunchpadFactory: ${address}`);
  console.log(`========================================`);
  console.log(`  initialVirtualBdag:  ${hre.ethers.formatEther(await launchpad.initialVirtualBdag())} BDAG`);
  console.log(`  graduationThreshold: ${hre.ethers.formatEther(await launchpad.graduationThreshold())} BDAG`);
  console.log(`  tradingFee:          ${Number(await launchpad.tradingFee()) / 100}%`);
  console.log(`  lpShare:             ${Number(await launchpad.lpShare()) / 100}%`);
  console.log(`  creatorShare:        ${Number(await launchpad.creatorShare()) / 100}%`);
  console.log(`  devShare:            ${Number(await launchpad.devShare()) / 100}%`);
  console.log(`\n  >> Update LAUNCHPAD_FACTORY in frontend/src/lib/contracts.ts (line 28):`);
  console.log(`     LAUNCHPAD_FACTORY: "${address}",\n`);

  // Verify on BDAGScan
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("\nWaiting 30s for block confirmations...");
    await new Promise((r) => setTimeout(r, 30000));

    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments: [ROUTER, FACTORY, WETH, DEV_WALLET],
      });
      console.log("Contract verified on BDAGScan");
    } catch (e) {
      console.log("Verification failed:", e.message);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
