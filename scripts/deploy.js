const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);

  // Use deployer as dev wallet (placeholder — change later via setDevWallet)
  const devWallet = deployer.address;

  // 0. Ensure Multicall3 exists at canonical address (needed by viem on local hardhat)
  if (hre.network.name === "hardhat" || hre.network.name === "localhost") {
    const MULTICALL3_ADDR = "0xcA11bde05977b3631167028862bE2a173976CA11";
    const Multicall3 = await hre.ethers.getContractFactory("Multicall3");
    const mc3 = await Multicall3.deploy();
    await mc3.waitForDeployment();
    const runtimeCode = await hre.ethers.provider.getCode(await mc3.getAddress());
    await hre.network.provider.send("hardhat_setCode", [MULTICALL3_ADDR, runtimeCode]);
    console.log("Multicall3 set at:", MULTICALL3_ADDR);
  }

  // 1. Deploy WETH
  const WETH = await hre.ethers.getContractFactory("WETH");
  const weth = await WETH.deploy();
  await weth.waitForDeployment();
  console.log("WETH deployed to:", await weth.getAddress());

  // 2. Deploy Factory
  const Factory = await hre.ethers.getContractFactory("SwapperFactory");
  const factory = await Factory.deploy(devWallet);
  await factory.waitForDeployment();
  console.log("SwapperFactory deployed to:", await factory.getAddress());

  // 3. Deploy Router
  const Router = await hre.ethers.getContractFactory("SwapperRouter");
  const router = await Router.deploy(await factory.getAddress(), await weth.getAddress());
  await router.waitForDeployment();
  console.log("SwapperRouter deployed to:", await router.getAddress());

  // 4. Deploy NFT Marketplace
  const Marketplace = await hre.ethers.getContractFactory("SwapperNFTMarketplace");
  const marketplace = await Marketplace.deploy(devWallet);
  await marketplace.waitForDeployment();
  console.log("SwapperNFTMarketplace deployed to:", await marketplace.getAddress());

  // 5. Deploy Swappy Token (1 billion initial supply)
  const initialSupply = hre.ethers.parseEther("1000000000"); // 1B SWPY
  const SwappyToken = await hre.ethers.getContractFactory("SwappyToken");
  const swappy = await SwappyToken.deploy(initialSupply);
  await swappy.waitForDeployment();
  console.log("SwappyToken deployed to:", await swappy.getAddress());

  // 6. Deploy General Staking Pools
  const SwapperStaking = await hre.ethers.getContractFactory("SwapperStaking");
  const staking = await SwapperStaking.deploy();
  await staking.waitForDeployment();
  console.log("SwapperStaking deployed to:", await staking.getAddress());

  // 7. Deploy Swappy Staking (fixed 10% APY)
  const SwappyStaking = await hre.ethers.getContractFactory("SwappyStaking");
  const swappyStaking = await SwappyStaking.deploy(await swappy.getAddress());
  await swappyStaking.waitForDeployment();
  console.log("SwappyStaking deployed to:", await swappyStaking.getAddress());

  // 8. Fund Swappy Staking with rewards (10% of supply = 100M SWPY)
  const rewardFund = hre.ethers.parseEther("100000000"); // 100M SWPY for rewards
  await swappy.approve(await swappyStaking.getAddress(), rewardFund);
  await swappyStaking.fundRewards(rewardFund);
  console.log("SwappyStaking funded with 100M SWPY rewards");

  // 9. Deploy Swappy Sale
  const SwappySale = await hre.ethers.getContractFactory("SwappySale");
  const swappySale = await SwappySale.deploy(await swappy.getAddress(), devWallet);
  await swappySale.waitForDeployment();
  console.log("SwappySale deployed to:", await swappySale.getAddress());

  // 10. Deploy Launchpad Factory
  const LaunchpadFactory = await hre.ethers.getContractFactory("LaunchpadFactory");
  const launchpad = await LaunchpadFactory.deploy(
    await router.getAddress(),
    await factory.getAddress(),
    await weth.getAddress(),
    devWallet
  );
  await launchpad.waitForDeployment();
  console.log("LaunchpadFactory deployed to:", await launchpad.getAddress());

  console.log("\n--- Deployment Summary ---");
  console.log("WETH:              ", await weth.getAddress());
  console.log("Factory:           ", await factory.getAddress());
  console.log("Router:            ", await router.getAddress());
  console.log("NFT Marketplace:   ", await marketplace.getAddress());
  console.log("SwappyToken:       ", await swappy.getAddress());
  console.log("SwapperStaking:    ", await staking.getAddress());
  console.log("SwappyStaking:     ", await swappyStaking.getAddress());
  console.log("SwappySale:        ", await swappySale.getAddress());
  console.log("LaunchpadFactory:  ", await launchpad.getAddress());
  console.log("Dev Wallet:        ", devWallet);
  console.log("--------------------------");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
