const hre = require("hardhat");

const MARKETPLACE_ADDRESS = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";

const MARKETPLACE_ABI = [
  "function listNFT(address nftContract, uint256 tokenId, uint256 price, uint256 amount, uint8 nftType) external",
  "function createAuction(address nftContract, uint256 tokenId, uint256 amount, uint8 nftType, uint256 startPrice, uint256 duration) external",
  "function buyNFT(uint256 listingId) external payable",
  "function placeBid(uint256 auctionId) external payable",
  "function cancelListing(uint256 listingId) external",
  "function cancelAuction(uint256 auctionId) external",
  "function endAuction(uint256 auctionId) external",
  "function withdrawBid() external",
  "function pendingWithdrawals(address) external view returns (uint256)",
  "function nextListingId() external view returns (uint256)",
  "function nextAuctionId() external view returns (uint256)",
  "function listings(uint256) external view returns (address seller, address nftContract, uint256 tokenId, uint256 price, uint256 amount, uint8 nftType, bool active)",
  "function auctions(uint256) external view returns (address seller, address nftContract, uint256 tokenId, uint256 amount, uint8 nftType, uint256 startPrice, uint256 endTime, address highestBidder, uint256 highestBid, bool active, bool settled)",
];

const ERC721_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function setApprovalForAll(address operator, bool approved) external",
  "function isApprovedForAll(address owner, address operator) external view returns (bool)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function nextTokenId() external view returns (uint256)",
  "function maxSupply() external view returns (uint256)",
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
];

// Helpers
const log = (msg) => console.log(`  ${msg}`);
const section = (title) => console.log(`\n${"=".repeat(60)}\n  ${title}\n${"=".repeat(60)}`);
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exitCode = 1; };

function makeTokenURI(name, description, imageId) {
  const metadata = JSON.stringify({
    name,
    description,
    image: `https://picsum.photos/seed/${imageId}/400/400`,
  });
  return "data:application/json;base64," + Buffer.from(metadata).toString("base64");
}

async function main() {
  const signers = await hre.ethers.getSigners();
  const deployer = signers[0];  // Main account (collection owner)
  const buyer1 = signers[1];
  const buyer2 = signers[2];
  const buyer3 = signers[3];

  const marketplace = new hre.ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, deployer);

  section("1. Deploy 10 Collections with 2 NFTs each (= 20 NFTs)");

  const collections = [];
  const SwapperERC721 = await hre.ethers.getContractFactory("SwapperERC721");

  for (let c = 0; c < 10; c++) {
    const name = `Collection ${c + 1}`;
    const symbol = `COL${c + 1}`;
    const maxSupply = c < 5 ? 0 : 20 + c * 5; // first 5 unlimited, rest have limits

    const nft = await SwapperERC721.deploy(name, symbol, maxSupply);
    await nft.waitForDeployment();
    const addr = await nft.getAddress();

    // Mint 2 NFTs
    const uris = [
      makeTokenURI(`${name} #0`, `First NFT of ${name}`, `${c}-0`),
      makeTokenURI(`${name} #1`, `Second NFT of ${name}`, `${c}-1`),
    ];
    await nft.mintBatch(deployer.address, uris);

    collections.push({ name, symbol, maxSupply, address: addr, contract: nft });
    ok(`${name} (${symbol}) deployed at ${addr} — minted 2, maxSupply: ${maxSupply || "∞"}`);
  }

  // Verify: 20 NFTs total
  let totalNFTs = 0;
  for (const col of collections) {
    const bal = await col.contract.balanceOf(deployer.address);
    totalNFTs += Number(bal);
  }
  totalNFTs === 20 ? ok(`Total NFTs minted: ${totalNFTs}`) : fail(`Expected 20 NFTs, got ${totalNFTs}`);

  section("2. Mint 15 more NFTs per collection (= 150 more)");

  for (const col of collections) {
    const currentId = Number(await col.contract.nextTokenId());
    const uris = [];
    for (let i = 0; i < 15; i++) {
      uris.push(makeTokenURI(`${col.name} #${currentId + i}`, `NFT ${currentId + i} of ${col.name}`, `${col.name}-${currentId + i}`));
    }
    await col.contract.mintBatch(deployer.address, uris);
    const newTotal = Number(await col.contract.nextTokenId());
    ok(`${col.name}: minted 15 more → total ${newTotal}`);
  }

  // Verify: 170 NFTs total (20 + 150)
  totalNFTs = 0;
  for (const col of collections) {
    totalNFTs += Number(await col.contract.balanceOf(deployer.address));
  }
  totalNFTs === 170 ? ok(`Total NFTs: ${totalNFTs}`) : fail(`Expected 170 NFTs, got ${totalNFTs}`);

  section("3. Approve marketplace for all collections");

  for (const col of collections) {
    await col.contract.setApprovalForAll(MARKETPLACE_ADDRESS, true);
    const approved = await col.contract.isApprovedForAll(deployer.address, MARKETPLACE_ADDRESS);
    approved ? ok(`${col.name}: marketplace approved`) : fail(`${col.name}: approval failed`);
  }

  section("4. List NFTs on marketplace (mix of listings & auctions)");

  const listingStartId = Number(await marketplace.nextListingId());
  const auctionStartId = Number(await marketplace.nextAuctionId());
  let listingsMade = 0;
  let auctionsMade = 0;

  // For each collection, list token 0 as fixed-price, token 1 as auction
  for (let c = 0; c < 10; c++) {
    const col = collections[c];
    const price = hre.ethers.parseEther(String(0.1 + c * 0.05)); // 0.1, 0.15, 0.2, ...

    // List token 0 as fixed-price listing
    await marketplace.listNFT(col.address, 0, price, 1, 0); // nftType 0 = ERC721
    listingsMade++;

    // List token 1 as auction (1 hour duration)
    await marketplace.createAuction(col.address, 1, 1, 0, price, 3600);
    auctionsMade++;

    ok(`${col.name}: token #0 listed at ${hre.ethers.formatEther(price)} BDAG, token #1 auctioned`);
  }

  const nextListing = Number(await marketplace.nextListingId());
  const nextAuction = Number(await marketplace.nextAuctionId());
  nextListing === listingStartId + listingsMade
    ? ok(`Listings created: ${listingsMade} (IDs ${listingStartId}-${nextListing - 1})`)
    : fail(`Expected ${listingsMade} listings, got ${nextListing - listingStartId}`);
  nextAuction === auctionStartId + auctionsMade
    ? ok(`Auctions created: ${auctionsMade} (IDs ${auctionStartId}-${nextAuction - 1})`)
    : fail(`Expected ${auctionsMade} auctions, got ${nextAuction - auctionStartId}`);

  section("5. Buy 5 listings with different accounts");

  const buyerAccounts = [buyer1, buyer2, buyer3, buyer1, buyer2];
  for (let i = 0; i < 5; i++) {
    const listingId = listingStartId + i;
    const buyer = buyerAccounts[i];
    const listing = await marketplace.listings(listingId);
    const buyerMarket = marketplace.connect(buyer);

    await buyerMarket.buyNFT(listingId, { value: listing.price });

    // Verify ownership transferred
    const col = collections[i];
    const newOwner = await col.contract.ownerOf(0);
    newOwner.toLowerCase() === buyer.address.toLowerCase()
      ? ok(`Listing #${listingId}: ${col.name} #0 bought by ${buyer.address.slice(0, 10)}...`)
      : fail(`Listing #${listingId}: ownership not transferred`);
  }

  section("6. Place bids on 5 auctions with different accounts");

  for (let i = 0; i < 5; i++) {
    const auctionId = auctionStartId + i;
    const bidder = buyerAccounts[i];
    const auction = await marketplace.auctions(auctionId);
    const bidAmount = auction.startPrice + hre.ethers.parseEther("0.01");
    const bidderMarket = marketplace.connect(bidder);

    await bidderMarket.placeBid(auctionId, { value: bidAmount });
    ok(`Auction #${auctionId}: bid of ${hre.ethers.formatEther(bidAmount)} BDAG by ${bidder.address.slice(0, 10)}...`);
  }

  // Place higher bids on first 3 auctions from different accounts
  for (let i = 0; i < 3; i++) {
    const auctionId = auctionStartId + i;
    const bidder = buyerAccounts[(i + 2) % 3]; // different bidder
    const auction = await marketplace.auctions(auctionId);
    const bidAmount = auction.highestBid + hre.ethers.parseEther("0.05");
    const bidderMarket = marketplace.connect(bidder);

    await bidderMarket.placeBid(auctionId, { value: bidAmount });
    ok(`Auction #${auctionId}: higher bid of ${hre.ethers.formatEther(bidAmount)} BDAG by ${bidder.address.slice(0, 10)}...`);
  }

  section("6b. Verify pending withdrawals from outbid users");

  // After step 6, buyers who were outbid should have pendingWithdrawals
  // Auction 0: buyer1 bid first, then buyer3 (=(i+2)%3 where i=0 → idx 2) outbid → buyer1 has pending
  // Auction 1: buyer2 bid first, then buyer1 (=(i+2)%3 where i=1 → idx 0) outbid → buyer2 has pending
  // Auction 2: buyer3 bid first, then buyer2 (=(i+2)%3 where i=2 → idx 1) outbid → buyer3 has pending
  // Auctions 3,4: only single bids, no outbids

  const pending1 = await marketplace.pendingWithdrawals(buyer1.address);
  const pending2 = await marketplace.pendingWithdrawals(buyer2.address);
  const pending3 = await marketplace.pendingWithdrawals(buyer3.address);

  pending1 > 0n
    ? ok(`Buyer1 pending withdrawal: ${hre.ethers.formatEther(pending1)} BDAG`)
    : fail(`Buyer1 should have pending withdrawal from auction #${auctionStartId}`);
  pending2 > 0n
    ? ok(`Buyer2 pending withdrawal: ${hre.ethers.formatEther(pending2)} BDAG`)
    : fail(`Buyer2 should have pending withdrawal from auction #${auctionStartId + 1}`);
  pending3 > 0n
    ? ok(`Buyer3 pending withdrawal: ${hre.ethers.formatEther(pending3)} BDAG`)
    : fail(`Buyer3 should have pending withdrawal from auction #${auctionStartId + 2}`);

  section("6c. Test self-overbid (bid on same auction twice)");

  // buyer1 bids on auction 3, then overbids themselves
  {
    const auctionId = auctionStartId + 3;
    const auction = await marketplace.auctions(auctionId);
    const currentBid = auction.highestBid;

    // buyer1 already has the highest bid from step 6 — overbid self
    const selfBid = currentBid + hre.ethers.parseEther("0.1");
    const pendingBefore = await marketplace.pendingWithdrawals(buyer1.address);
    await marketplace.connect(buyer1).placeBid(auctionId, { value: selfBid });
    const pendingAfter = await marketplace.pendingWithdrawals(buyer1.address);

    const pendingIncrease = pendingAfter - pendingBefore;
    pendingIncrease === currentBid
      ? ok(`Self-overbid: previous bid of ${hre.ethers.formatEther(currentBid)} BDAG moved to pending`)
      : fail(`Self-overbid: expected ${hre.ethers.formatEther(currentBid)} added to pending, got ${hre.ethers.formatEther(pendingIncrease)}`);

    const newAuction = await marketplace.auctions(auctionId);
    newAuction.highestBid === selfBid
      ? ok(`Self-overbid: new highest bid is ${hre.ethers.formatEther(selfBid)} BDAG`)
      : fail(`Self-overbid: highest bid mismatch`);
  }

  section("6d. Withdraw outbid funds");

  // Buyer1 withdraws
  {
    const pendingBefore = await marketplace.pendingWithdrawals(buyer1.address);
    ok(`Buyer1 pending before withdraw: ${hre.ethers.formatEther(pendingBefore)} BDAG`);

    const balBefore = await hre.ethers.provider.getBalance(buyer1.address);
    const tx = await marketplace.connect(buyer1).withdrawBid();
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed * receipt.gasPrice;
    const balAfter = await hre.ethers.provider.getBalance(buyer1.address);

    const received = balAfter - balBefore + gasUsed;
    received === pendingBefore
      ? ok(`Buyer1 withdrew ${hre.ethers.formatEther(pendingBefore)} BDAG (exact match after gas)`)
      : fail(`Buyer1 withdrawal amount mismatch: expected ${hre.ethers.formatEther(pendingBefore)}, got ${hre.ethers.formatEther(received)}`);

    const pendingAfter = await marketplace.pendingWithdrawals(buyer1.address);
    pendingAfter === 0n
      ? ok(`Buyer1 pending after withdraw: 0 BDAG`)
      : fail(`Buyer1 pending should be 0 after withdraw, got ${hre.ethers.formatEther(pendingAfter)}`);
  }

  // Buyer2 withdraws
  {
    const pendingBefore = await marketplace.pendingWithdrawals(buyer2.address);
    ok(`Buyer2 pending before withdraw: ${hre.ethers.formatEther(pendingBefore)} BDAG`);

    await marketplace.connect(buyer2).withdrawBid();

    const pendingAfter = await marketplace.pendingWithdrawals(buyer2.address);
    pendingAfter === 0n
      ? ok(`Buyer2 withdrew successfully, pending: 0 BDAG`)
      : fail(`Buyer2 pending should be 0 after withdraw`);
  }

  // Buyer3 withdraws
  {
    const pendingBefore = await marketplace.pendingWithdrawals(buyer3.address);
    ok(`Buyer3 pending before withdraw: ${hre.ethers.formatEther(pendingBefore)} BDAG`);

    await marketplace.connect(buyer3).withdrawBid();

    const pendingAfter = await marketplace.pendingWithdrawals(buyer3.address);
    pendingAfter === 0n
      ? ok(`Buyer3 withdrew successfully, pending: 0 BDAG`)
      : fail(`Buyer3 pending should be 0 after withdraw`);
  }

  // Verify double-withdraw reverts
  {
    let reverted = false;
    try {
      await marketplace.connect(buyer1).withdrawBid();
    } catch (e) {
      reverted = true;
    }
    reverted
      ? ok(`Double withdraw correctly reverted (nothing to withdraw)`)
      : fail(`Double withdraw should have reverted`);
  }

  section("7. Cancel 5 items (3 listings + 2 auctions)");

  // Cancel listings 5, 6, 7 (the ones that weren't bought)
  for (let i = 5; i < 8; i++) {
    const listingId = listingStartId + i;
    await marketplace.cancelListing(listingId);
    const listing = await marketplace.listings(listingId);
    !listing.active
      ? ok(`Listing #${listingId}: cancelled`)
      : fail(`Listing #${listingId}: cancel failed, still active`);

    // Verify NFT returned to deployer
    const col = collections[i];
    const owner = await col.contract.ownerOf(0);
    owner.toLowerCase() === deployer.address.toLowerCase()
      ? ok(`  NFT returned to deployer`)
      : fail(`  NFT not returned to deployer`);
  }

  // Cancel auctions 5, 6 (no bids placed on those)
  for (let i = 5; i < 7; i++) {
    const auctionId = auctionStartId + i;
    await marketplace.cancelAuction(auctionId);
    const auction = await marketplace.auctions(auctionId);
    !auction.active
      ? ok(`Auction #${auctionId}: cancelled`)
      : fail(`Auction #${auctionId}: cancel failed, still active`);

    // Verify NFT returned
    const col = collections[i];
    const owner = await col.contract.ownerOf(1);
    owner.toLowerCase() === deployer.address.toLowerCase()
      ? ok(`  NFT returned to deployer`)
      : fail(`  NFT not returned to deployer`);
  }

  section("8. End 3 auctions (time-travel + settle)");

  // Fast-forward time by 2 hours to pass auction end time
  await hre.network.provider.send("evm_increaseTime", [7200]);
  await hre.network.provider.send("evm_mine");
  ok("Time advanced by 2 hours");

  for (let i = 0; i < 3; i++) {
    const auctionId = auctionStartId + i;
    const auction = await marketplace.auctions(auctionId);
    const expectedWinner = auction.highestBidder;

    await marketplace.endAuction(auctionId);

    // Verify NFT transferred to highest bidder
    const col = collections[i];
    const newOwner = await col.contract.ownerOf(1);
    newOwner.toLowerCase() === expectedWinner.toLowerCase()
      ? ok(`Auction #${auctionId}: settled → ${col.name} #1 to ${expectedWinner.slice(0, 10)}...`)
      : fail(`Auction #${auctionId}: NFT not transferred to winner`);
  }

  section("9. Create 2 more NFT collections + mint");

  for (let c = 0; c < 2; c++) {
    const name = `Extra Collection ${c + 1}`;
    const symbol = `EXT${c + 1}`;
    const nft = await SwapperERC721.deploy(name, symbol, 100);
    await nft.waitForDeployment();
    const addr = await nft.getAddress();

    // Mint 3 NFTs
    const uris = Array.from({ length: 3 }, (_, i) =>
      makeTokenURI(`${name} #${i}`, `Extra NFT ${i}`, `extra-${c}-${i}`)
    );
    await nft.mintBatch(deployer.address, uris);

    const balance = Number(await nft.balanceOf(deployer.address));
    collections.push({ name, symbol, maxSupply: 100, address: addr, contract: nft });
    ok(`${name} deployed at ${addr} — minted ${balance}`);
  }

  section("10. Final Verification");

  // Count total collections
  ok(`Total collections: ${collections.length}`);

  // Count deployer NFTs
  let deployerTotal = 0;
  for (const col of collections) {
    deployerTotal += Number(await col.contract.balanceOf(deployer.address));
  }
  ok(`Deployer NFTs remaining: ${deployerTotal}`);

  // Count buyer NFTs
  for (const buyer of [buyer1, buyer2, buyer3]) {
    let buyerTotal = 0;
    for (const col of collections) {
      buyerTotal += Number(await col.contract.balanceOf(buyer.address));
    }
    if (buyerTotal > 0) ok(`${buyer.address.slice(0, 10)}... owns: ${buyerTotal} NFTs`);
  }

  // Marketplace state
  const finalListings = Number(await marketplace.nextListingId());
  const finalAuctions = Number(await marketplace.nextAuctionId());
  ok(`Marketplace: ${finalListings} total listings, ${finalAuctions} total auctions`);

  // Check active listings
  let activeListings = 0;
  for (let i = listingStartId; i < finalListings; i++) {
    const listing = await marketplace.listings(i);
    if (listing.active) activeListings++;
  }
  ok(`Active listings: ${activeListings}`);

  // Check active auctions
  let activeAuctions = 0;
  for (let i = auctionStartId; i < finalAuctions; i++) {
    const auction = await marketplace.auctions(i);
    if (auction.active && !auction.settled) activeAuctions++;
  }
  ok(`Active auctions: ${activeAuctions}`);

  // Verify supply info for each collection
  log("");
  log("Collection supply summary:");
  for (const col of collections) {
    const minted = Number(await col.contract.nextTokenId());
    const max = Number(await col.contract.maxSupply());
    log(`  ${col.name}: ${minted}/${max === 0 ? "∞" : max}`);
  }

  section("ALL TESTS COMPLETE");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
