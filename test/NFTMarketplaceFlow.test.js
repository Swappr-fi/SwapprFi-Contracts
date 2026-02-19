const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFT Marketplace — Full Flow (20 NFTs, 10 collections)", function () {
  let marketplace, devWallet, owner;
  let nftContracts = []; // 10 ERC721 contracts
  let sellers = [];      // 10 sellers
  let buyers = [];       // 10 buyers

  // Price for listing i = (i + 1) * 0.1 BDAG  →  0.1, 0.2, ..., 2.0
  const priceOf = (i) => ethers.parseEther(((i + 1) * 0.1).toFixed(1));
  const FEE_BPS = 50n; // 0.5%

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    owner = signers[0];
    devWallet = signers[1];
    sellers = signers.slice(2, 12);   // 10 sellers
    buyers = signers.slice(12, 22);   // 10 buyers

    // Deploy marketplace
    const Marketplace = await ethers.getContractFactory("SwapperNFTMarketplace");
    marketplace = await Marketplace.deploy(devWallet.address);

    // Deploy 10 NFT collections
    const MockNFT = await ethers.getContractFactory("MockERC721");
    nftContracts = [];
    for (let c = 0; c < 10; c++) {
      nftContracts.push(await MockNFT.deploy());
    }

    // For each collection c, mint 2 NFTs:
    //   NFT index i = c*2+0  → seller[c], tokenId 0
    //   NFT index i = c*2+1  → seller[c], tokenId 1
    // So seller[c] owns tokenId 0 and 1 on contract c
    for (let c = 0; c < 10; c++) {
      await nftContracts[c].connect(sellers[c]).mint(sellers[c].address); // tokenId 0
      await nftContracts[c].connect(sellers[c]).mint(sellers[c].address); // tokenId 1
      await nftContracts[c].connect(sellers[c]).setApprovalForAll(await marketplace.getAddress(), true);
    }
  });

  // ======================== FRONTEND DATA FLOW ========================
  // Verifies nextListingId(), listings() return correct data
  // — this is exactly what useNextListingId and useListing read in the FE

  describe("Frontend data flow", function () {
    it("nextListingId() is 0 before any listings", async function () {
      expect(await marketplace.nextListingId()).to.equal(0);
    });

    it("nextListingId() increments correctly after sequential listings", async function () {
      for (let i = 0; i < 5; i++) {
        const c = Math.floor(i / 2);
        const tokenId = i % 2;
        await marketplace.connect(sellers[c]).listNFT(
          await nftContracts[c].getAddress(), tokenId, priceOf(i), 1, 0
        );
        expect(await marketplace.nextListingId()).to.equal(i + 1);
      }
    });

    it("listings(id) returns correct seller, price, nftContract, active for each listing", async function () {
      // List all 20
      for (let i = 0; i < 20; i++) {
        const c = Math.floor(i / 2);
        const tokenId = i % 2;
        await marketplace.connect(sellers[c]).listNFT(
          await nftContracts[c].getAddress(), tokenId, priceOf(i), 1, 0
        );
      }

      // Read each listing — mimics useListing(BigInt(id))
      for (let i = 0; i < 20; i++) {
        const c = Math.floor(i / 2);
        const tokenId = i % 2;
        const listing = await marketplace.listings(i);

        expect(listing.seller).to.equal(sellers[c].address);
        expect(listing.nftContract).to.equal(await nftContracts[c].getAddress());
        expect(listing.tokenId).to.equal(tokenId);
        expect(listing.price).to.equal(priceOf(i));
        expect(listing.amount).to.equal(1);
        expect(listing.nftType).to.equal(0); // ERC721
        expect(listing.active).to.be.true;
      }
    });

    it("listing.active becomes false after purchase — FE filters it out", async function () {
      await marketplace.connect(sellers[0]).listNFT(
        await nftContracts[0].getAddress(), 0, priceOf(0), 1, 0
      );

      expect((await marketplace.listings(0)).active).to.be.true;

      await marketplace.connect(buyers[0]).buyNFT(0, { value: priceOf(0) });

      expect((await marketplace.listings(0)).active).to.be.false;
    });

    it("nextListingId() is 20 after listing all 20 NFTs", async function () {
      for (let i = 0; i < 20; i++) {
        const c = Math.floor(i / 2);
        const tokenId = i % 2;
        await marketplace.connect(sellers[c]).listNFT(
          await nftContracts[c].getAddress(), tokenId, priceOf(i), 1, 0
        );
      }
      expect(await marketplace.nextListingId()).to.equal(20);
    });
  });

  // ======================== LIST 20 NFTs ========================

  describe("List 20 NFTs from 10 collections at different prices", function () {
    it("all 20 NFTs transfer to marketplace on listing", async function () {
      const marketplaceAddr = await marketplace.getAddress();

      for (let i = 0; i < 20; i++) {
        const c = Math.floor(i / 2);
        const tokenId = i % 2;
        await marketplace.connect(sellers[c]).listNFT(
          await nftContracts[c].getAddress(), tokenId, priceOf(i), 1, 0
        );
        // NFT should be held by marketplace
        expect(await nftContracts[c].ownerOf(tokenId)).to.equal(marketplaceAddr);
      }
    });

    it("emits Listed event with correct data for every listing", async function () {
      for (let i = 0; i < 20; i++) {
        const c = Math.floor(i / 2);
        const tokenId = i % 2;

        await expect(
          marketplace.connect(sellers[c]).listNFT(
            await nftContracts[c].getAddress(), tokenId, priceOf(i), 1, 0
          )
        )
          .to.emit(marketplace, "Listed")
          .withArgs(i, sellers[c].address, await nftContracts[c].getAddress(), tokenId, priceOf(i), 0);
      }
    });
  });

  // ======================== BUY ALL 20 ========================

  describe("Buy all 20 NFTs with different buyers", function () {
    beforeEach(async function () {
      // List all 20
      for (let i = 0; i < 20; i++) {
        const c = Math.floor(i / 2);
        const tokenId = i % 2;
        await marketplace.connect(sellers[c]).listNFT(
          await nftContracts[c].getAddress(), tokenId, priceOf(i), 1, 0
        );
      }
    });

    it("every NFT transfers to correct buyer after purchase", async function () {
      for (let i = 0; i < 20; i++) {
        const c = Math.floor(i / 2);
        const tokenId = i % 2;
        const buyer = buyers[i % 10]; // round-robin buyers

        await marketplace.connect(buyer).buyNFT(i, { value: priceOf(i) });
        expect(await nftContracts[c].ownerOf(tokenId)).to.equal(buyer.address);
      }
    });

    it("emits Sale event for every purchase", async function () {
      for (let i = 0; i < 20; i++) {
        const buyer = buyers[i % 10];

        await expect(
          marketplace.connect(buyer).buyNFT(i, { value: priceOf(i) })
        )
          .to.emit(marketplace, "Sale")
          .withArgs(i, buyer.address, priceOf(i));
      }
    });

    it("all listings become inactive after purchase", async function () {
      for (let i = 0; i < 20; i++) {
        await marketplace.connect(buyers[i % 10]).buyNFT(i, { value: priceOf(i) });
      }

      for (let i = 0; i < 20; i++) {
        expect((await marketplace.listings(i)).active).to.be.false;
      }
    });

    it("each seller receives price minus 0.5% fee", async function () {
      // Track per-seller expected income
      const sellerIncome = new Array(10).fill(0n);

      for (let i = 0; i < 20; i++) {
        const c = Math.floor(i / 2);
        const price = priceOf(i);
        const fee = (price * FEE_BPS) / 10000n;
        sellerIncome[c] += price - fee;
      }

      const sellerBalancesBefore = [];
      for (let c = 0; c < 10; c++) {
        sellerBalancesBefore.push(await ethers.provider.getBalance(sellers[c].address));
      }

      // Buy all (sellers don't pay gas here, only buyers)
      for (let i = 0; i < 20; i++) {
        await marketplace.connect(buyers[i % 10]).buyNFT(i, { value: priceOf(i) });
      }

      for (let c = 0; c < 10; c++) {
        const after = await ethers.provider.getBalance(sellers[c].address);
        expect(after - sellerBalancesBefore[c]).to.equal(sellerIncome[c]);
      }
    });
  });

  // ======================== DEV FEE ACCOUNTING ========================

  describe("Dev wallet fee accounting", function () {
    it("dev wallet receives exactly 0.5% of each sale", async function () {
      // List 1 NFT, buy it, check exact fee
      await marketplace.connect(sellers[0]).listNFT(
        await nftContracts[0].getAddress(), 0, ethers.parseEther("10"), 1, 0
      );

      const devBefore = await ethers.provider.getBalance(devWallet.address);
      await marketplace.connect(buyers[0]).buyNFT(0, { value: ethers.parseEther("10") });
      const devAfter = await ethers.provider.getBalance(devWallet.address);

      const expectedFee = ethers.parseEther("10") * FEE_BPS / 10000n;
      expect(devAfter - devBefore).to.equal(expectedFee);
    });

    it("dev wallet accumulates correct total fee across all 20 sales", async function () {
      // List all 20
      for (let i = 0; i < 20; i++) {
        const c = Math.floor(i / 2);
        const tokenId = i % 2;
        await marketplace.connect(sellers[c]).listNFT(
          await nftContracts[c].getAddress(), tokenId, priceOf(i), 1, 0
        );
      }

      const devBefore = await ethers.provider.getBalance(devWallet.address);

      // Buy all 20
      for (let i = 0; i < 20; i++) {
        await marketplace.connect(buyers[i % 10]).buyNFT(i, { value: priceOf(i) });
      }

      const devAfter = await ethers.provider.getBalance(devWallet.address);

      // Sum of prices: 0.1 + 0.2 + ... + 2.0 = 21 BDAG
      let totalPrice = 0n;
      for (let i = 0; i < 20; i++) {
        totalPrice += priceOf(i);
      }
      const expectedTotalFee = (totalPrice * FEE_BPS) / 10000n;

      expect(devAfter - devBefore).to.equal(expectedTotalFee);
    });

    it("fee is exactly (price * 50) / 10000 for various price points", async function () {
      const prices = [
        ethers.parseEther("0.001"),
        ethers.parseEther("0.5"),
        ethers.parseEther("1"),
        ethers.parseEther("100"),
      ];

      for (let i = 0; i < prices.length; i++) {
        // Mint a fresh NFT
        await nftContracts[0].connect(sellers[0]).mint(sellers[0].address);
        const tokenId = 2 + i; // 0 and 1 already minted in beforeEach

        await marketplace.connect(sellers[0]).listNFT(
          await nftContracts[0].getAddress(), tokenId, prices[i], 1, 0
        );

        const devBefore = await ethers.provider.getBalance(devWallet.address);
        await marketplace.connect(buyers[0]).buyNFT(i, { value: prices[i] });
        const devAfter = await ethers.provider.getBalance(devWallet.address);

        expect(devAfter - devBefore).to.equal((prices[i] * FEE_BPS) / 10000n);
      }
    });
  });

  // ======================== NFT OWNERSHIP ========================

  describe("NFT ownership transfers", function () {
    it("full chain: seller → marketplace → buyer for all 20 NFTs", async function () {
      const marketplaceAddr = await marketplace.getAddress();

      for (let i = 0; i < 20; i++) {
        const c = Math.floor(i / 2);
        const tokenId = i % 2;

        // Before: seller owns
        expect(await nftContracts[c].ownerOf(tokenId)).to.equal(sellers[c].address);

        // List: marketplace holds
        await marketplace.connect(sellers[c]).listNFT(
          await nftContracts[c].getAddress(), tokenId, priceOf(i), 1, 0
        );
        expect(await nftContracts[c].ownerOf(tokenId)).to.equal(marketplaceAddr);

        // Buy: buyer owns
        const buyer = buyers[i % 10];
        await marketplace.connect(buyer).buyNFT(i, { value: priceOf(i) });
        expect(await nftContracts[c].ownerOf(tokenId)).to.equal(buyer.address);
      }
    });

    it("buyer can re-list purchased NFT", async function () {
      // Seller lists, buyer buys
      await marketplace.connect(sellers[0]).listNFT(
        await nftContracts[0].getAddress(), 0, priceOf(0), 1, 0
      );
      await marketplace.connect(buyers[0]).buyNFT(0, { value: priceOf(0) });

      expect(await nftContracts[0].ownerOf(0)).to.equal(buyers[0].address);

      // Buyer re-lists at double the price
      await nftContracts[0].connect(buyers[0]).setApprovalForAll(await marketplace.getAddress(), true);
      await marketplace.connect(buyers[0]).listNFT(
        await nftContracts[0].getAddress(), 0, priceOf(0) * 2n, 1, 0
      );

      const listing = await marketplace.listings(1);
      expect(listing.seller).to.equal(buyers[0].address);
      expect(listing.price).to.equal(priceOf(0) * 2n);
      expect(listing.active).to.be.true;

      // Second buyer buys the re-listed NFT
      await marketplace.connect(buyers[1]).buyNFT(1, { value: priceOf(0) * 2n });
      expect(await nftContracts[0].ownerOf(0)).to.equal(buyers[1].address);
    });
  });

  // ======================== EVENTS / FE NOTIFICATIONS ========================

  describe("Events for frontend notifications", function () {
    it("Listed event contains all fields the FE needs", async function () {
      const tx = await marketplace.connect(sellers[0]).listNFT(
        await nftContracts[0].getAddress(), 0, ethers.parseEther("5"), 1, 0
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (l) => l.fragment && l.fragment.name === "Listed"
      );

      expect(event).to.not.be.undefined;
      expect(event.args.listingId).to.equal(0);
      expect(event.args.seller).to.equal(sellers[0].address);
      expect(event.args.nftContract).to.equal(await nftContracts[0].getAddress());
      expect(event.args.tokenId).to.equal(0);
      expect(event.args.price).to.equal(ethers.parseEther("5"));
    });

    it("Sale event contains all fields the FE needs", async function () {
      await marketplace.connect(sellers[0]).listNFT(
        await nftContracts[0].getAddress(), 0, ethers.parseEther("5"), 1, 0
      );

      const tx = await marketplace.connect(buyers[0]).buyNFT(0, { value: ethers.parseEther("5") });
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (l) => l.fragment && l.fragment.name === "Sale"
      );

      expect(event).to.not.be.undefined;
      expect(event.args.listingId).to.equal(0);
      expect(event.args.buyer).to.equal(buyers[0].address);
      expect(event.args.price).to.equal(ethers.parseEther("5"));
    });

    it("20 Listed + 20 Sale events emitted across the full flow", async function () {
      let listedCount = 0;
      let saleCount = 0;

      // List all
      for (let i = 0; i < 20; i++) {
        const c = Math.floor(i / 2);
        const tokenId = i % 2;
        const tx = await marketplace.connect(sellers[c]).listNFT(
          await nftContracts[c].getAddress(), tokenId, priceOf(i), 1, 0
        );
        const receipt = await tx.wait();
        listedCount += receipt.logs.filter(
          (l) => l.fragment && l.fragment.name === "Listed"
        ).length;
      }

      // Buy all
      for (let i = 0; i < 20; i++) {
        const tx = await marketplace.connect(buyers[i % 10]).buyNFT(i, { value: priceOf(i) });
        const receipt = await tx.wait();
        saleCount += receipt.logs.filter(
          (l) => l.fragment && l.fragment.name === "Sale"
        ).length;
      }

      expect(listedCount).to.equal(20);
      expect(saleCount).to.equal(20);
    });
  });

  // ======================== CROSS-COLLECTION ========================

  describe("Cross-collection integrity", function () {
    it("listing from collection A doesn't affect collection B", async function () {
      // List NFT 0 from collection 0
      await marketplace.connect(sellers[0]).listNFT(
        await nftContracts[0].getAddress(), 0, priceOf(0), 1, 0
      );

      // Collection 1 seller still owns their NFTs
      expect(await nftContracts[1].ownerOf(0)).to.equal(sellers[1].address);
      expect(await nftContracts[1].ownerOf(1)).to.equal(sellers[1].address);
    });

    it("buying from collection A doesn't give buyer tokens from collection B", async function () {
      // List from both collections
      await marketplace.connect(sellers[0]).listNFT(
        await nftContracts[0].getAddress(), 0, priceOf(0), 1, 0
      );
      await marketplace.connect(sellers[1]).listNFT(
        await nftContracts[1].getAddress(), 0, priceOf(1), 1, 0
      );

      // Buyer 0 buys from collection 0 only
      await marketplace.connect(buyers[0]).buyNFT(0, { value: priceOf(0) });

      // Buyer 0 owns token 0 from collection 0
      expect(await nftContracts[0].ownerOf(0)).to.equal(buyers[0].address);
      // Token 0 from collection 1 is still in marketplace (listed, not bought)
      expect(await nftContracts[1].ownerOf(0)).to.equal(await marketplace.getAddress());
    });

    it("all 10 collections tracked independently in listing data", async function () {
      for (let c = 0; c < 10; c++) {
        await marketplace.connect(sellers[c]).listNFT(
          await nftContracts[c].getAddress(), 0, priceOf(c), 1, 0
        );
      }

      // Each listing points to the correct contract
      for (let c = 0; c < 10; c++) {
        const listing = await marketplace.listings(c);
        expect(listing.nftContract).to.equal(await nftContracts[c].getAddress());
        expect(listing.seller).to.equal(sellers[c].address);
      }
    });
  });

  // ======================== FULL END-TO-END ========================

  describe("Full end-to-end: 20 NFTs minted, listed, bought", function () {
    it("complete lifecycle with correct balances and ownership", async function () {
      const marketplaceAddr = await marketplace.getAddress();

      // Track initial balances
      const devBefore = await ethers.provider.getBalance(devWallet.address);
      const sellerBalsBefore = [];
      for (let c = 0; c < 10; c++) {
        sellerBalsBefore.push(await ethers.provider.getBalance(sellers[c].address));
      }

      let totalGasPerSeller = new Array(10).fill(0n);

      // ─── Phase 1: List all 20 ─────────────────────────
      for (let i = 0; i < 20; i++) {
        const c = Math.floor(i / 2);
        const tokenId = i % 2;
        const tx = await marketplace.connect(sellers[c]).listNFT(
          await nftContracts[c].getAddress(), tokenId, priceOf(i), 1, 0
        );
        const receipt = await tx.wait();
        totalGasPerSeller[c] += receipt.gasUsed * receipt.gasPrice;
      }

      // Verify: marketplace holds all 20
      expect(await marketplace.nextListingId()).to.equal(20);
      for (let i = 0; i < 20; i++) {
        const c = Math.floor(i / 2);
        const tokenId = i % 2;
        expect(await nftContracts[c].ownerOf(tokenId)).to.equal(marketplaceAddr);
      }

      // ─── Phase 2: Buy all 20 ──────────────────────────
      for (let i = 0; i < 20; i++) {
        const buyer = buyers[i % 10];
        await marketplace.connect(buyer).buyNFT(i, { value: priceOf(i) });
      }

      // ─── Verify: ownership ─────────────────────────────
      for (let i = 0; i < 20; i++) {
        const c = Math.floor(i / 2);
        const tokenId = i % 2;
        const buyer = buyers[i % 10];
        expect(await nftContracts[c].ownerOf(tokenId)).to.equal(buyer.address);
      }

      // ─── Verify: all listings inactive ─────────────────
      for (let i = 0; i < 20; i++) {
        expect((await marketplace.listings(i)).active).to.be.false;
      }

      // ─── Verify: total dev fee ─────────────────────────
      let totalPrice = 0n;
      for (let i = 0; i < 20; i++) totalPrice += priceOf(i);
      const expectedTotalFee = (totalPrice * FEE_BPS) / 10000n;
      const devAfter = await ethers.provider.getBalance(devWallet.address);
      expect(devAfter - devBefore).to.equal(expectedTotalFee);

      // ─── Verify: each seller's net income ──────────────
      for (let c = 0; c < 10; c++) {
        const p0 = priceOf(c * 2);
        const p1 = priceOf(c * 2 + 1);
        const expectedIncome = (p0 - (p0 * FEE_BPS) / 10000n) + (p1 - (p1 * FEE_BPS) / 10000n);
        const sellerAfter = await ethers.provider.getBalance(sellers[c].address);
        const actualIncome = sellerAfter - sellerBalsBefore[c] + totalGasPerSeller[c];
        expect(actualIncome).to.equal(expectedIncome);
      }
    });
  });
});
