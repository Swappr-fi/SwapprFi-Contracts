const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SwapperNFTMarketplace", function () {
  let marketplace, mockNFT, owner, seller, buyer, buyer2, devWallet;

  beforeEach(async function () {
    [owner, seller, buyer, buyer2, devWallet] = await ethers.getSigners();

    const Marketplace = await ethers.getContractFactory("SwapperNFTMarketplace");
    marketplace = await Marketplace.deploy(devWallet.address);

    const MockNFT = await ethers.getContractFactory("MockERC721");
    mockNFT = await MockNFT.deploy();

    // Mint NFTs to seller
    await mockNFT.connect(seller).mint(seller.address); // tokenId 0
    await mockNFT.connect(seller).mint(seller.address); // tokenId 1
    await mockNFT.connect(seller).mint(seller.address); // tokenId 2
    await mockNFT.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);
  });

  describe("Constructor", function () {
    it("should set owner and dev wallet", async function () {
      expect(await marketplace.owner()).to.equal(owner.address);
      expect(await marketplace.devWallet()).to.equal(devWallet.address);
    });

    it("should set DEV_FEE to 50 bps (0.5%)", async function () {
      expect(await marketplace.DEV_FEE()).to.equal(50);
    });
  });

  // =================== LISTINGS ===================

  describe("Listings", function () {
    it("should list an NFT", async function () {
      await marketplace.connect(seller).listNFT(
        await mockNFT.getAddress(), 0, ethers.parseEther("1"), 1, 0
      );
      const listing = await marketplace.listings(0);
      expect(listing.active).to.be.true;
      expect(listing.seller).to.equal(seller.address);
      expect(listing.price).to.equal(ethers.parseEther("1"));
      expect(await marketplace.nextListingId()).to.equal(1);
    });

    it("should emit Listed event", async function () {
      await expect(
        marketplace.connect(seller).listNFT(
          await mockNFT.getAddress(), 0, ethers.parseEther("1"), 1, 0
        )
      ).to.emit(marketplace, "Listed");
    });

    it("should transfer NFT to marketplace on listing", async function () {
      await marketplace.connect(seller).listNFT(
        await mockNFT.getAddress(), 0, ethers.parseEther("1"), 1, 0
      );
      expect(await mockNFT.ownerOf(0)).to.equal(await marketplace.getAddress());
    });

    it("should revert listing with zero price", async function () {
      await expect(
        marketplace.connect(seller).listNFT(await mockNFT.getAddress(), 0, 0, 1, 0)
      ).to.be.revertedWith("NFTMarketplace: ZERO_PRICE");
    });

    it("should revert listing with zero amount", async function () {
      await expect(
        marketplace.connect(seller).listNFT(await mockNFT.getAddress(), 0, ethers.parseEther("1"), 0, 0)
      ).to.be.revertedWith("NFTMarketplace: ZERO_AMOUNT");
    });

    it("should buy a listed NFT and pay fee", async function () {
      await marketplace.connect(seller).listNFT(
        await mockNFT.getAddress(), 0, ethers.parseEther("1"), 1, 0
      );

      const devBefore = await ethers.provider.getBalance(devWallet.address);
      const sellerBefore = await ethers.provider.getBalance(seller.address);

      await marketplace.connect(buyer).buyNFT(0, { value: ethers.parseEther("1") });

      expect(await mockNFT.ownerOf(0)).to.equal(buyer.address);

      const devAfter = await ethers.provider.getBalance(devWallet.address);
      const sellerAfter = await ethers.provider.getBalance(seller.address);
      const fee = ethers.parseEther("1") * 50n / 10000n; // 0.5%
      expect(devAfter - devBefore).to.equal(fee);
      expect(sellerAfter - sellerBefore).to.equal(ethers.parseEther("1") - fee);
    });

    it("should refund excess payment on buy", async function () {
      await marketplace.connect(seller).listNFT(
        await mockNFT.getAddress(), 0, ethers.parseEther("1"), 1, 0
      );

      const balBefore = await ethers.provider.getBalance(buyer.address);
      const tx = await marketplace.connect(buyer).buyNFT(0, { value: ethers.parseEther("2") });
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(buyer.address);

      // Should have spent only ~1 ETH + gas (not 2)
      const spent = balBefore - balAfter - gasCost;
      expect(spent).to.be.closeTo(ethers.parseEther("1"), ethers.parseEther("0.01"));
    });

    it("should revert buying inactive listing", async function () {
      await marketplace.connect(seller).listNFT(
        await mockNFT.getAddress(), 0, ethers.parseEther("1"), 1, 0
      );
      await marketplace.connect(buyer).buyNFT(0, { value: ethers.parseEther("1") });

      await expect(
        marketplace.connect(buyer2).buyNFT(0, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("NFTMarketplace: NOT_ACTIVE");
    });

    it("should revert buying with insufficient payment", async function () {
      await marketplace.connect(seller).listNFT(
        await mockNFT.getAddress(), 0, ethers.parseEther("1"), 1, 0
      );
      await expect(
        marketplace.connect(buyer).buyNFT(0, { value: ethers.parseEther("0.5") })
      ).to.be.revertedWith("NFTMarketplace: INSUFFICIENT_PAYMENT");
    });

    it("should cancel a listing and return NFT", async function () {
      await marketplace.connect(seller).listNFT(
        await mockNFT.getAddress(), 0, ethers.parseEther("1"), 1, 0
      );
      await marketplace.connect(seller).cancelListing(0);

      expect(await mockNFT.ownerOf(0)).to.equal(seller.address);
      const listing = await marketplace.listings(0);
      expect(listing.active).to.be.false;
    });

    it("should revert cancel by non-seller", async function () {
      await marketplace.connect(seller).listNFT(
        await mockNFT.getAddress(), 0, ethers.parseEther("1"), 1, 0
      );
      await expect(marketplace.connect(buyer).cancelListing(0))
        .to.be.revertedWith("NFTMarketplace: NOT_SELLER");
    });

    it("should revert cancel of inactive listing", async function () {
      await marketplace.connect(seller).listNFT(
        await mockNFT.getAddress(), 0, ethers.parseEther("1"), 1, 0
      );
      await marketplace.connect(seller).cancelListing(0);
      await expect(marketplace.connect(seller).cancelListing(0))
        .to.be.revertedWith("NFTMarketplace: NOT_ACTIVE");
    });
  });

  // =================== OFFERS ===================

  describe("Offers", function () {
    it("should make an offer with escrowed ETH", async function () {
      await marketplace.connect(buyer).makeOffer(
        await mockNFT.getAddress(), 0, 1, 0,
        { value: ethers.parseEther("0.5") }
      );

      const offer = await marketplace.offers(0);
      expect(offer.active).to.be.true;
      expect(offer.buyer).to.equal(buyer.address);
      expect(offer.price).to.equal(ethers.parseEther("0.5"));
    });

    it("should emit OfferMade event", async function () {
      await expect(
        marketplace.connect(buyer).makeOffer(
          await mockNFT.getAddress(), 0, 1, 0,
          { value: ethers.parseEther("0.5") }
        )
      ).to.emit(marketplace, "OfferMade");
    });

    it("should revert offer with zero value", async function () {
      await expect(
        marketplace.connect(buyer).makeOffer(await mockNFT.getAddress(), 0, 1, 0, { value: 0 })
      ).to.be.revertedWith("NFTMarketplace: ZERO_OFFER");
    });

    it("should accept an offer — transfer NFT and pay seller", async function () {
      await marketplace.connect(buyer).makeOffer(
        await mockNFT.getAddress(), 0, 1, 0,
        { value: ethers.parseEther("0.5") }
      );

      const sellerBefore = await ethers.provider.getBalance(seller.address);
      const tx = await marketplace.connect(seller).acceptOffer(0);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const sellerAfter = await ethers.provider.getBalance(seller.address);

      expect(await mockNFT.ownerOf(0)).to.equal(buyer.address);

      // Seller receives price minus 0.5% fee minus gas
      const fee = ethers.parseEther("0.5") * 50n / 10000n;
      const expectedSellerIncome = ethers.parseEther("0.5") - fee;
      expect(sellerAfter + gasCost - sellerBefore).to.equal(expectedSellerIncome);
    });

    it("should revert accepting inactive offer", async function () {
      await marketplace.connect(buyer).makeOffer(
        await mockNFT.getAddress(), 0, 1, 0,
        { value: ethers.parseEther("0.5") }
      );
      await marketplace.connect(seller).acceptOffer(0);

      await expect(marketplace.connect(seller).acceptOffer(0))
        .to.be.revertedWith("NFTMarketplace: NOT_ACTIVE");
    });

    it("should cancel an offer and refund buyer", async function () {
      await marketplace.connect(buyer).makeOffer(
        await mockNFT.getAddress(), 0, 1, 0,
        { value: ethers.parseEther("0.5") }
      );

      const balBefore = await ethers.provider.getBalance(buyer.address);
      const tx = await marketplace.connect(buyer).cancelOffer(0);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(buyer.address);

      expect(balAfter + gasCost - balBefore).to.equal(ethers.parseEther("0.5"));
      const offer = await marketplace.offers(0);
      expect(offer.active).to.be.false;
    });

    it("should revert cancel by non-buyer", async function () {
      await marketplace.connect(buyer).makeOffer(
        await mockNFT.getAddress(), 0, 1, 0,
        { value: ethers.parseEther("0.5") }
      );
      await expect(marketplace.connect(seller).cancelOffer(0))
        .to.be.revertedWith("NFTMarketplace: NOT_BUYER");
    });
  });

  // =================== AUCTIONS ===================

  describe("Auctions", function () {
    it("should create an auction", async function () {
      await marketplace.connect(seller).createAuction(
        await mockNFT.getAddress(), 0, 1, 0,
        ethers.parseEther("0.1"), 3600
      );

      const auction = await marketplace.auctions(0);
      expect(auction.active).to.be.true;
      expect(auction.seller).to.equal(seller.address);
      expect(auction.startPrice).to.equal(ethers.parseEther("0.1"));
      expect(await mockNFT.ownerOf(0)).to.equal(await marketplace.getAddress());
    });

    it("should revert auction with zero price", async function () {
      await expect(
        marketplace.connect(seller).createAuction(
          await mockNFT.getAddress(), 0, 1, 0, 0, 3600
        )
      ).to.be.revertedWith("NFTMarketplace: ZERO_PRICE");
    });

    it("should revert auction with invalid duration", async function () {
      // Too short (< 1 hour)
      await expect(
        marketplace.connect(seller).createAuction(
          await mockNFT.getAddress(), 0, 1, 0, ethers.parseEther("0.1"), 60
        )
      ).to.be.revertedWith("NFTMarketplace: INVALID_DURATION");

      // Too long (> 30 days)
      await expect(
        marketplace.connect(seller).createAuction(
          await mockNFT.getAddress(), 0, 1, 0, ethers.parseEther("0.1"), 31 * 24 * 3600
        )
      ).to.be.revertedWith("NFTMarketplace: INVALID_DURATION");
    });

    it("should place a bid", async function () {
      await marketplace.connect(seller).createAuction(
        await mockNFT.getAddress(), 0, 1, 0,
        ethers.parseEther("0.1"), 3600
      );

      await marketplace.connect(buyer).placeBid(0, { value: ethers.parseEther("0.5") });
      const auction = await marketplace.auctions(0);
      expect(auction.highestBidder).to.equal(buyer.address);
      expect(auction.highestBid).to.equal(ethers.parseEther("0.5"));
    });

    it("should revert bid below start price", async function () {
      await marketplace.connect(seller).createAuction(
        await mockNFT.getAddress(), 0, 1, 0,
        ethers.parseEther("1"), 3600
      );

      await expect(
        marketplace.connect(buyer).placeBid(0, { value: ethers.parseEther("0.5") })
      ).to.be.revertedWith("NFTMarketplace: BID_TOO_LOW");
    });

    it("should revert bid not higher than current highest", async function () {
      await marketplace.connect(seller).createAuction(
        await mockNFT.getAddress(), 0, 1, 0,
        ethers.parseEther("0.1"), 3600
      );

      await marketplace.connect(buyer).placeBid(0, { value: ethers.parseEther("0.5") });
      await expect(
        marketplace.connect(buyer2).placeBid(0, { value: ethers.parseEther("0.5") })
      ).to.be.revertedWith("NFTMarketplace: BID_NOT_HIGH_ENOUGH");
    });

    it("should credit outbid bidder via pull pattern (pendingWithdrawals)", async function () {
      await marketplace.connect(seller).createAuction(
        await mockNFT.getAddress(), 0, 1, 0,
        ethers.parseEther("0.1"), 3600
      );

      // Buyer1 bids
      await marketplace.connect(buyer).placeBid(0, { value: ethers.parseEther("0.5") });
      // Buyer2 outbids
      await marketplace.connect(buyer2).placeBid(0, { value: ethers.parseEther("1") });

      // Buyer1 should have pending withdrawal
      expect(await marketplace.pendingWithdrawals(buyer.address)).to.equal(ethers.parseEther("0.5"));

      // Buyer1 withdraws
      const balBefore = await ethers.provider.getBalance(buyer.address);
      const tx = await marketplace.connect(buyer).withdrawBid();
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(buyer.address);

      expect(balAfter + gasCost - balBefore).to.equal(ethers.parseEther("0.5"));
      expect(await marketplace.pendingWithdrawals(buyer.address)).to.equal(0);
    });

    it("should revert withdrawBid with nothing to withdraw", async function () {
      await expect(marketplace.connect(buyer).withdrawBid())
        .to.be.revertedWith("NFTMarketplace: NOTHING_TO_WITHDRAW");
    });

    it("should accumulate pending withdrawals across multiple outbids", async function () {
      await marketplace.connect(seller).createAuction(
        await mockNFT.getAddress(), 0, 1, 0,
        ethers.parseEther("0.1"), 3600
      );

      // Buyer bids 0.5, gets outbid
      await marketplace.connect(buyer).placeBid(0, { value: ethers.parseEther("0.5") });
      await marketplace.connect(buyer2).placeBid(0, { value: ethers.parseEther("0.6") });

      // Buyer bids again at 0.7, gets outbid again
      await marketplace.connect(buyer).placeBid(0, { value: ethers.parseEther("0.7") });
      await marketplace.connect(buyer2).placeBid(0, { value: ethers.parseEther("0.8") });

      // Buyer should have 0.5 + 0.7 = 1.2 pending
      expect(await marketplace.pendingWithdrawals(buyer.address)).to.equal(ethers.parseEther("1.2"));
    });

    it("should revert bid on ended auction", async function () {
      await marketplace.connect(seller).createAuction(
        await mockNFT.getAddress(), 0, 1, 0,
        ethers.parseEther("0.1"), 3600
      );

      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine");

      await expect(
        marketplace.connect(buyer).placeBid(0, { value: ethers.parseEther("0.5") })
      ).to.be.revertedWith("NFTMarketplace: AUCTION_ENDED");
    });

    it("should settle auction — NFT to winner, payment to seller with fee", async function () {
      await marketplace.connect(seller).createAuction(
        await mockNFT.getAddress(), 0, 1, 0,
        ethers.parseEther("0.1"), 3600
      );

      await marketplace.connect(buyer).placeBid(0, { value: ethers.parseEther("1") });

      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine");

      const devBefore = await ethers.provider.getBalance(devWallet.address);
      const sellerBefore = await ethers.provider.getBalance(seller.address);

      await marketplace.endAuction(0);

      expect(await mockNFT.ownerOf(0)).to.equal(buyer.address);

      const devAfter = await ethers.provider.getBalance(devWallet.address);
      const sellerAfter = await ethers.provider.getBalance(seller.address);
      const fee = ethers.parseEther("1") * 50n / 10000n;
      expect(devAfter - devBefore).to.equal(fee);
      expect(sellerAfter - sellerBefore).to.equal(ethers.parseEther("1") - fee);
    });

    it("should return NFT to seller if no bids when settled", async function () {
      await marketplace.connect(seller).createAuction(
        await mockNFT.getAddress(), 0, 1, 0,
        ethers.parseEther("0.1"), 3600
      );

      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine");

      await marketplace.endAuction(0);
      expect(await mockNFT.ownerOf(0)).to.equal(seller.address);
    });

    it("should revert endAuction before end time", async function () {
      await marketplace.connect(seller).createAuction(
        await mockNFT.getAddress(), 0, 1, 0,
        ethers.parseEther("0.1"), 3600
      );

      await expect(marketplace.endAuction(0))
        .to.be.revertedWith("NFTMarketplace: AUCTION_NOT_ENDED");
    });

    it("should revert settling already settled auction", async function () {
      await marketplace.connect(seller).createAuction(
        await mockNFT.getAddress(), 0, 1, 0,
        ethers.parseEther("0.1"), 3600
      );

      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine");

      await marketplace.endAuction(0);
      await expect(marketplace.endAuction(0))
        .to.be.revertedWith("NFTMarketplace: NOT_ACTIVE");
    });

    it("should cancel auction with no bids", async function () {
      await marketplace.connect(seller).createAuction(
        await mockNFT.getAddress(), 0, 1, 0,
        ethers.parseEther("0.1"), 3600
      );

      await marketplace.connect(seller).cancelAuction(0);
      expect(await mockNFT.ownerOf(0)).to.equal(seller.address);
    });

    it("should revert cancel by non-seller", async function () {
      await marketplace.connect(seller).createAuction(
        await mockNFT.getAddress(), 0, 1, 0,
        ethers.parseEther("0.1"), 3600
      );

      await expect(marketplace.connect(buyer).cancelAuction(0))
        .to.be.revertedWith("NFTMarketplace: NOT_SELLER");
    });

    it("should revert cancel when auction has bids", async function () {
      await marketplace.connect(seller).createAuction(
        await mockNFT.getAddress(), 0, 1, 0,
        ethers.parseEther("0.1"), 3600
      );

      await marketplace.connect(buyer).placeBid(0, { value: ethers.parseEther("0.5") });

      await expect(marketplace.connect(seller).cancelAuction(0))
        .to.be.revertedWith("NFTMarketplace: HAS_BIDS");
    });
  });

  // =================== ADMIN ===================

  describe("Admin functions", function () {
    it("should update dev wallet", async function () {
      await marketplace.setDevWallet(buyer.address);
      expect(await marketplace.devWallet()).to.equal(buyer.address);
    });

    it("should revert setDevWallet with zero address", async function () {
      await expect(marketplace.setDevWallet(ethers.ZeroAddress))
        .to.be.revertedWith("NFTMarketplace: ZERO_ADDRESS");
    });

    it("should revert setDevWallet from non-owner", async function () {
      await expect(marketplace.connect(seller).setDevWallet(seller.address))
        .to.be.revertedWith("NFTMarketplace: FORBIDDEN");
    });

    describe("Two-step ownership transfer", function () {
      it("should propose and accept new owner", async function () {
        await marketplace.proposeOwner(seller.address);
        expect(await marketplace.pendingOwner()).to.equal(seller.address);
        expect(await marketplace.owner()).to.equal(owner.address); // not yet

        await marketplace.connect(seller).acceptOwnership();
        expect(await marketplace.owner()).to.equal(seller.address);
        expect(await marketplace.pendingOwner()).to.equal(ethers.ZeroAddress);
      });

      it("should revert proposeOwner from non-owner", async function () {
        await expect(marketplace.connect(seller).proposeOwner(seller.address))
          .to.be.revertedWith("NFTMarketplace: FORBIDDEN");
      });

      it("should revert acceptOwnership from wrong address", async function () {
        await marketplace.proposeOwner(seller.address);
        await expect(marketplace.connect(buyer).acceptOwnership())
          .to.be.revertedWith("NFTMarketplace: NOT_PENDING_OWNER");
      });

      it("should revert proposeOwner with zero address", async function () {
        await expect(marketplace.proposeOwner(ethers.ZeroAddress))
          .to.be.revertedWith("NFTMarketplace: ZERO_ADDRESS");
      });
    });
  });
});
