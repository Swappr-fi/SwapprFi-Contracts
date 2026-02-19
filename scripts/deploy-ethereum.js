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
  console.log("║     USDTLock — Ethereum Deployment       ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH\n");

  // USDT address on Ethereum Mainnet
  const USDT_ADDRESS = process.env.USDT_ADDRESS || "0xdAC17F958D2ee523a2206206994597C13D831ec7";
  const devWallet = process.env.DEV_WALLET || deployer.address;
  const feeBps = parseInt(process.env.FEE_BPS || "200"); // 2%

  console.log("USDT address:", USDT_ADDRESS);
  console.log("Dev wallet:", devWallet);
  console.log("Fee:", feeBps, "bps (" + (feeBps / 100) + "%)\n");

  // ─── Deploy USDTLock ────────────────────────────────────────
  console.log("[1/1] Deploying USDTLock...");
  const usdtLock = await (await hre.ethers.getContractFactory("USDTLock")).deploy(
    USDT_ADDRESS, devWallet, feeBps
  );
  await usdtLock.waitForDeployment();
  const lockAddr = await usdtLock.getAddress();
  console.log("  USDTLock:", lockAddr);

  // Set relayer if provided
  if (process.env.RELAYER_ADDRESS) {
    console.log("  Setting relayer:", process.env.RELAYER_ADDRESS);
    const tx = await usdtLock.setRelayer(process.env.RELAYER_ADDRESS);
    await tx.wait();
  }

  // ─── Summary ────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║         DEPLOYMENT COMPLETE               ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log("║ USDTLock:         ", lockAddr);
  console.log("║ USDT:             ", USDT_ADDRESS);
  console.log("║ Dev Wallet:       ", devWallet);
  console.log("║ Fee:              ", feeBps, "bps");
  console.log("║ Owner:            ", deployer.address);
  console.log("╚══════════════════════════════════════════╝");

  // ─── Frontend Config ────────────────────────────────────────
  console.log("\n// ─── Copy into frontend/src/lib/contracts.ts ───");
  console.log(`export const ETHEREUM_ADDRESSES = {
  USDT: "${USDT_ADDRESS}",
  USDT_LOCK: "${lockAddr}",
} as const;`);

  // ─── Verify ─────────────────────────────────────────────────
  console.log("\nVerifying on Etherscan...\n");
  await verify(lockAddr, [USDT_ADDRESS, devWallet, feeBps]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
