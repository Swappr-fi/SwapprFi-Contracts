const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying SwapperERC721 with:", deployer.address);

  const name = process.env.NFT_NAME || "My Collection";
  const symbol = process.env.NFT_SYMBOL || "MNFT";
  const maxSupply = parseInt(process.env.NFT_MAX_SUPPLY || "0");

  console.log(`Name: ${name}`);
  console.log(`Symbol: ${symbol}`);
  console.log(`Max Supply: ${maxSupply === 0 ? "Unlimited" : maxSupply}`);

  const SwapperERC721 = await hre.ethers.getContractFactory("SwapperERC721");
  const nft = await SwapperERC721.deploy(name, symbol, maxSupply);
  await nft.waitForDeployment();
  const address = await nft.getAddress();

  console.log(`\nSwapperERC721 deployed to: ${address}`);
  console.log(`Owner: ${deployer.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
