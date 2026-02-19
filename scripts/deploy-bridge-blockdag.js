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

  console.log("╔══════════════════════════════════════════╗");
  console.log("║  Bridge Contracts — BlockDAG Deployment  ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "BDAG\n");

  const relayerAddress = process.env.RELAYER_ADDRESS || deployer.address;
  console.log("Relayer:", relayerAddress, "\n");

  // ─── 1. Deploy BridgedUSDT ──────────────────────────────────
  console.log("[1/2] Deploying BridgedUSDT (USDT.e)...");
  const bridgedUSDT = await (await hre.ethers.getContractFactory("BridgedUSDT")).deploy();
  await bridgedUSDT.waitForDeployment();
  const bridgedAddr = await bridgedUSDT.getAddress();
  console.log("  BridgedUSDT:", bridgedAddr);

  // ─── 2. Deploy BridgeMinter ─────────────────────────────────
  console.log("[2/2] Deploying BridgeMinter...");
  const bridgeMinter = await (await hre.ethers.getContractFactory("BridgeMinter")).deploy(
    bridgedAddr,
    relayerAddress
  );
  await bridgeMinter.waitForDeployment();
  const minterAddr = await bridgeMinter.getAddress();
  console.log("  BridgeMinter:", minterAddr);

  // ─── Set BridgeMinter as minter on BridgedUSDT ──────────────
  console.log("\nSetting BridgeMinter as minter on BridgedUSDT...");
  const tx = await bridgedUSDT.setMinter(minterAddr);
  await tx.wait();
  console.log("  Minter set successfully.");

  // ─── Summary ────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║         DEPLOYMENT COMPLETE               ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log("║ BridgedUSDT:      ", bridgedAddr);
  console.log("║ BridgeMinter:     ", minterAddr);
  console.log("║ Relayer:          ", relayerAddress);
  console.log("╚══════════════════════════════════════════╝");

  // ─── Frontend Config ────────────────────────────────────────
  console.log("\n// ─── Add to ADDRESSES in frontend/src/lib/contracts.ts ───");
  console.log(`  BRIDGED_USDT: "${bridgedAddr}",`);
  console.log(`  BRIDGE_MINTER: "${minterAddr}",`);

  // ─── Verify ─────────────────────────────────────────────────
  console.log("\nVerifying contracts on BDAGScan...\n");

  console.log("  [1/2] BridgedUSDT...");
  await verify(bridgedAddr, []);

  console.log("  [2/2] BridgeMinter...");
  await verify(minterAddr, [bridgedAddr, relayerAddress]);

  console.log("\nAll verifications attempted. Check https://bdagscan.com for results.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
