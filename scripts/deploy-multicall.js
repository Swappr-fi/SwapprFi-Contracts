const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying Multicall3...");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "BDAG\n");

  const Multicall3 = await hre.ethers.getContractFactory("contracts/core/Multicall3.sol:Multicall3");
  const multicall = await Multicall3.deploy();
  await multicall.waitForDeployment();

  const address = await multicall.getAddress();
  console.log("Multicall3 deployed to:", address);
  console.log("\nAdd this to PROD_CHAIN in frontend/src/lib/contracts.ts:");
  console.log(`  contracts: {`);
  console.log(`    multicall3: {`);
  console.log(`      address: "${address}" as \`0x\${string}\`,`);
  console.log(`    },`);
  console.log(`  },`);

  // Verify
  try {
    await hre.run("verify:verify", { address, constructorArguments: [] });
    console.log("\nVerified on BDAGScan");
  } catch (e) {
    if (e.message.includes("Already Verified") || e.message.includes("already verified")) {
      console.log("\nAlready verified");
    } else {
      console.log("\nVerification failed:", e.message);
    }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });