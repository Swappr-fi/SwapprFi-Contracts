// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SwapperNFTMarketplace is ERC721Holder, ERC1155Holder, ReentrancyGuard {
    address public owner;
    address public pendingOwner;
    address public devWallet;
    uint256 public constant DEV_FEE = 50; // 0.5% = 50 basis points

    enum NFTType { ERC721, ERC1155 }

    // ======================== LISTINGS ========================

    struct Listing {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 price;
        uint256 amount; // 1 for ERC721, variable for ERC1155
        NFTType nftType;
        bool active;
    }

    uint256 public nextListingId;
    mapping(uint256 => Listing) public listings;

    // ======================== OFFERS ========================

    struct Offer {
        address buyer;
        address nftContract;
        uint256 tokenId;
        uint256 price;
        uint256 amount;
        NFTType nftType;
        bool active;
    }

    uint256 public nextOfferId;
    mapping(uint256 => Offer) public offers;

    // ======================== AUCTIONS ========================

    struct Auction {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 amount;
        NFTType nftType;
        uint256 startPrice;
        uint256 endTime;
        address highestBidder;
        uint256 highestBid;
        bool active;
        bool settled;
    }

    uint256 public nextAuctionId;
    mapping(uint256 => Auction) public auctions;

    // Pull-pattern for bid refunds — prevents griefing via ETH rejection
    mapping(address => uint256) public pendingWithdrawals;

    // ======================== EVENTS ========================

    event Listed(uint256 indexed listingId, address indexed seller, address nftContract, uint256 tokenId, uint256 price, NFTType nftType);
    event ListingCancelled(uint256 indexed listingId);
    event Sale(uint256 indexed listingId, address indexed buyer, uint256 price);

    event OfferMade(uint256 indexed offerId, address indexed buyer, address nftContract, uint256 tokenId, uint256 price);
    event OfferAccepted(uint256 indexed offerId, address indexed seller);
    event OfferCancelled(uint256 indexed offerId);

    event AuctionCreated(uint256 indexed auctionId, address indexed seller, address nftContract, uint256 tokenId, uint256 startPrice, uint256 endTime);
    event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 amount);
    event AuctionSettled(uint256 indexed auctionId, address indexed winner, uint256 amount);
    event AuctionCancelled(uint256 indexed auctionId);

    event DevWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event WithdrawalAvailable(address indexed bidder, uint256 amount);

    constructor(address _devWallet) {
        owner = msg.sender;
        devWallet = _devWallet;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "NFTMarketplace: FORBIDDEN");
        _;
    }

    function setDevWallet(address _devWallet) external onlyOwner {
        require(_devWallet != address(0), "NFTMarketplace: ZERO_ADDRESS");
        emit DevWalletUpdated(devWallet, _devWallet);
        devWallet = _devWallet;
    }

    function proposeOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "NFTMarketplace: ZERO_ADDRESS");
        pendingOwner = _owner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "NFTMarketplace: NOT_PENDING_OWNER");
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function _transferFee(uint256 totalPrice) internal returns (uint256 sellerAmount) {
        uint256 fee = (totalPrice * DEV_FEE) / 10000;
        sellerAmount = totalPrice - fee;
        if (fee > 0) {
            (bool feeSuccess, ) = devWallet.call{value: fee}("");
            require(feeSuccess, "NFTMarketplace: FEE_TRANSFER_FAILED");
        }
    }

    function _transferNFT(address nftContract, NFTType nftType, address from, address to, uint256 tokenId, uint256 amount) internal {
        if (nftType == NFTType.ERC721) {
            IERC721(nftContract).safeTransferFrom(from, to, tokenId);
        } else {
            IERC1155(nftContract).safeTransferFrom(from, to, tokenId, amount, "");
        }
    }

    // ======================== FIXED-PRICE LISTINGS ========================

    function listNFT(
        address nftContract,
        uint256 tokenId,
        uint256 price,
        uint256 amount,
        NFTType nftType
    ) external nonReentrant returns (uint256 listingId) {
        require(price > 0, "NFTMarketplace: ZERO_PRICE");
        require(amount > 0, "NFTMarketplace: ZERO_AMOUNT");

        _transferNFT(nftContract, nftType, msg.sender, address(this), tokenId, amount);

        listingId = nextListingId++;
        listings[listingId] = Listing({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            price: price,
            amount: amount,
            nftType: nftType,
            active: true
        });

        emit Listed(listingId, msg.sender, nftContract, tokenId, price, nftType);
    }

    function buyNFT(uint256 listingId) external payable nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "NFTMarketplace: NOT_ACTIVE");
        require(msg.value >= listing.price, "NFTMarketplace: INSUFFICIENT_PAYMENT");

        listing.active = false;

        uint256 sellerAmount = _transferFee(listing.price);
        (bool success, ) = listing.seller.call{value: sellerAmount}("");
        require(success, "NFTMarketplace: PAYMENT_FAILED");

        _transferNFT(listing.nftContract, listing.nftType, address(this), msg.sender, listing.tokenId, listing.amount);

        // Refund excess
        if (msg.value > listing.price) {
            (bool refundSuccess, ) = msg.sender.call{value: msg.value - listing.price}("");
            require(refundSuccess, "NFTMarketplace: REFUND_FAILED");
        }

        emit Sale(listingId, msg.sender, listing.price);
    }

    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "NFTMarketplace: NOT_ACTIVE");
        require(listing.seller == msg.sender, "NFTMarketplace: NOT_SELLER");

        listing.active = false;
        _transferNFT(listing.nftContract, listing.nftType, address(this), msg.sender, listing.tokenId, listing.amount);

        emit ListingCancelled(listingId);
    }

    // ======================== OFFERS ========================

    function makeOffer(
        address nftContract,
        uint256 tokenId,
        uint256 amount,
        NFTType nftType
    ) external payable nonReentrant returns (uint256 offerId) {
        require(msg.value > 0, "NFTMarketplace: ZERO_OFFER");

        offerId = nextOfferId++;
        offers[offerId] = Offer({
            buyer: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            price: msg.value,
            amount: amount,
            nftType: nftType,
            active: true
        });

        emit OfferMade(offerId, msg.sender, nftContract, tokenId, msg.value);
    }

    function acceptOffer(uint256 offerId) external nonReentrant {
        Offer storage offer = offers[offerId];
        require(offer.active, "NFTMarketplace: NOT_ACTIVE");

        offer.active = false;

        // Transfer NFT from seller (msg.sender) to buyer
        _transferNFT(offer.nftContract, offer.nftType, msg.sender, offer.buyer, offer.tokenId, offer.amount);

        // Pay seller (minus fee)
        uint256 sellerAmount = _transferFee(offer.price);
        (bool success, ) = msg.sender.call{value: sellerAmount}("");
        require(success, "NFTMarketplace: PAYMENT_FAILED");

        emit OfferAccepted(offerId, msg.sender);
    }

    function cancelOffer(uint256 offerId) external nonReentrant {
        Offer storage offer = offers[offerId];
        require(offer.active, "NFTMarketplace: NOT_ACTIVE");
        require(offer.buyer == msg.sender, "NFTMarketplace: NOT_BUYER");

        offer.active = false;
        (bool success, ) = msg.sender.call{value: offer.price}("");
        require(success, "NFTMarketplace: REFUND_FAILED");

        emit OfferCancelled(offerId);
    }

    // ======================== AUCTIONS ========================

    function createAuction(
        address nftContract,
        uint256 tokenId,
        uint256 amount,
        NFTType nftType,
        uint256 startPrice,
        uint256 duration
    ) external nonReentrant returns (uint256 auctionId) {
        require(startPrice > 0, "NFTMarketplace: ZERO_PRICE");
        require(duration >= 1 hours && duration <= 30 days, "NFTMarketplace: INVALID_DURATION");

        _transferNFT(nftContract, nftType, msg.sender, address(this), tokenId, amount);

        auctionId = nextAuctionId++;
        auctions[auctionId] = Auction({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            amount: amount,
            nftType: nftType,
            startPrice: startPrice,
            endTime: block.timestamp + duration,
            highestBidder: address(0),
            highestBid: 0,
            active: true,
            settled: false
        });

        emit AuctionCreated(auctionId, msg.sender, nftContract, tokenId, startPrice, block.timestamp + duration);
    }

    function placeBid(uint256 auctionId) external payable nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(auction.active, "NFTMarketplace: NOT_ACTIVE");
        require(block.timestamp < auction.endTime, "NFTMarketplace: AUCTION_ENDED");
        require(msg.value >= auction.startPrice, "NFTMarketplace: BID_TOO_LOW");
        require(msg.value > auction.highestBid, "NFTMarketplace: BID_NOT_HIGH_ENOUGH");

        // Credit previous highest bidder (pull-pattern to prevent griefing)
        if (auction.highestBidder != address(0)) {
            pendingWithdrawals[auction.highestBidder] += auction.highestBid;
            emit WithdrawalAvailable(auction.highestBidder, auction.highestBid);
        }

        auction.highestBidder = msg.sender;
        auction.highestBid = msg.value;

        emit BidPlaced(auctionId, msg.sender, msg.value);
    }

    function endAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(auction.active, "NFTMarketplace: NOT_ACTIVE");
        require(block.timestamp >= auction.endTime, "NFTMarketplace: AUCTION_NOT_ENDED");
        require(!auction.settled, "NFTMarketplace: ALREADY_SETTLED");

        auction.active = false;
        auction.settled = true;

        if (auction.highestBidder != address(0)) {
            // Transfer NFT to winner
            _transferNFT(auction.nftContract, auction.nftType, address(this), auction.highestBidder, auction.tokenId, auction.amount);

            // Pay seller minus fee
            uint256 sellerAmount = _transferFee(auction.highestBid);
            (bool success, ) = auction.seller.call{value: sellerAmount}("");
            require(success, "NFTMarketplace: PAYMENT_FAILED");

            emit AuctionSettled(auctionId, auction.highestBidder, auction.highestBid);
        } else {
            // No bids — return NFT to seller
            _transferNFT(auction.nftContract, auction.nftType, address(this), auction.seller, auction.tokenId, auction.amount);
            emit AuctionCancelled(auctionId);
        }
    }

    function cancelAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(auction.active, "NFTMarketplace: NOT_ACTIVE");
        require(auction.seller == msg.sender, "NFTMarketplace: NOT_SELLER");
        require(auction.highestBidder == address(0), "NFTMarketplace: HAS_BIDS");

        auction.active = false;
        _transferNFT(auction.nftContract, auction.nftType, address(this), msg.sender, auction.tokenId, auction.amount);

        emit AuctionCancelled(auctionId);
    }

    /// @notice Withdraw outbid funds (pull-pattern)
    function withdrawBid() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "NFTMarketplace: NOTHING_TO_WITHDRAW");

        pendingWithdrawals[msg.sender] = 0;
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "NFTMarketplace: WITHDRAWAL_FAILED");
    }
}
