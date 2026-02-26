// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "./LaunchpadToken.sol";

interface ISwapperRouter {
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);

    function WETH() external view returns (address);
    function factory() external view returns (address);
}

interface ISwapperFactory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

contract LaunchpadFactory is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    // ======================== CONSTANTS ========================

    uint256 public constant TOKEN_TOTAL_SUPPLY = 1_000_000_000 ether; // 1B tokens (18 decimals)
    uint256 public constant FEE_DENOMINATOR = 10000;

    // ======================== STATE ========================

    ISwapperRouter public immutable swapperRouter;
    ISwapperFactory public immutable swapperFactory;
    address public immutable weth;

    address public devWallet;
    uint256 public graduationThreshold = 1_000_000 ether; // 1M BDAG
    uint256 public initialVirtualBdag = 200_000 ether;      // 200,000 BDAG
    uint256 public tradingFee = 100;                        // 1% (100 / 10000)
    uint256 public lpShare = 8500;                          // 85%
    uint256 public creatorShare = 750;                      // 7.5%
    uint256 public devShare = 750;                          // 7.5%

    uint256 public tokenCount;

    // Pull-pattern: pending BDAG withdrawals (prevents griefing graduation)
    mapping(address => uint256) public pendingWithdrawals;

    struct CurveState {
        address token;
        address creator;
        uint256 virtualBdag;
        uint256 virtualTokens;
        uint256 k;
        uint256 realBdag;
        uint256 tokensSold;
        bool graduated;
        uint256 createdAt;
    }

    struct TokenMetadata {
        string description;
        string imageUrl;
        string website;
        string twitter;
        string telegram;
    }

    mapping(uint256 => CurveState) public curves;
    mapping(uint256 => TokenMetadata) public metadata;
    mapping(address => uint256) public tokenToId;

    // ======================== EVENTS ========================

    event TokenCreated(uint256 indexed id, address indexed token, address indexed creator, string name, string symbol);
    event TokenBuy(uint256 indexed id, address indexed buyer, uint256 bdagIn, uint256 tokensOut);
    event TokenSell(uint256 indexed id, address indexed seller, uint256 tokensIn, uint256 bdagOut);
    event TokenGraduated(uint256 indexed id, address indexed token, address pair, uint256 liquidity);

    // ======================== CONSTRUCTOR ========================

    constructor(
        address _swapperRouter,
        address _swapperFactory,
        address _weth,
        address _devWallet
    ) Ownable(msg.sender) {
        swapperRouter = ISwapperRouter(_swapperRouter);
        swapperFactory = ISwapperFactory(_swapperFactory);
        weth = _weth;
        devWallet = _devWallet;
    }

    // ======================== CREATE ========================

    function createToken(
        string calldata name,
        string calldata symbol,
        string calldata description,
        string calldata imageUrl,
        string calldata website,
        string calldata twitter,
        string calldata telegram
    ) external payable nonReentrant returns (uint256 id) {
        require(bytes(name).length > 0 && bytes(name).length <= 64, "Invalid name");
        require(bytes(symbol).length > 0 && bytes(symbol).length <= 16, "Invalid symbol");
        require(bytes(description).length <= 512, "Description too long");
        require(bytes(imageUrl).length <= 256, "Image URL too long");
        require(bytes(website).length <= 256, "Website too long");
        require(bytes(twitter).length <= 64, "Twitter too long");
        require(bytes(telegram).length <= 64, "Telegram too long");

        id = tokenCount++;

        // Deploy token — mints entire supply to this contract
        LaunchpadToken token = new LaunchpadToken(name, symbol, TOKEN_TOTAL_SUPPLY, address(this));

        // Init curve
        uint256 vBdag = initialVirtualBdag;
        uint256 vTokens = TOKEN_TOTAL_SUPPLY;
        uint256 k_ = vBdag * vTokens;

        curves[id] = CurveState({
            token: address(token),
            creator: msg.sender,
            virtualBdag: vBdag,
            virtualTokens: vTokens,
            k: k_,
            realBdag: 0,
            tokensSold: 0,
            graduated: false,
            createdAt: block.timestamp
        });

        metadata[id] = TokenMetadata({
            description: description,
            imageUrl: imageUrl,
            website: website,
            twitter: twitter,
            telegram: telegram
        });

        tokenToId[address(token)] = id;

        emit TokenCreated(id, address(token), msg.sender, name, symbol);

        // Execute initial buy if msg.value > 0 (no slippage check — creator is first buyer)
        if (msg.value > 0) {
            _buy(id, msg.value, 0);
        }
    }

    // ======================== BUY ========================

    function buy(uint256 id, uint256 minTokensOut) external payable nonReentrant {
        require(msg.value > 0, "Zero value");
        _buy(id, msg.value, minTokensOut);
    }

    function _buy(uint256 id, uint256 bdagIn, uint256 minTokensOut) internal {
        CurveState storage curve = curves[id];
        require(curve.token != address(0), "Token not found");
        require(!curve.graduated, "Already graduated");

        // Deduct trading fee
        uint256 fee = (bdagIn * tradingFee) / FEE_DENOMINATOR;
        uint256 netBdag = bdagIn - fee;

        // Calculate tokens out: tokensOut = virtualTokens - (k / (virtualBdag + netBdag))
        uint256 newVirtualBdag = curve.virtualBdag + netBdag;
        uint256 tokensOut = curve.virtualTokens - (curve.k / newVirtualBdag);

        require(tokensOut > 0, "Zero tokens out");
        require(tokensOut <= curve.virtualTokens, "Insufficient liquidity");
        require(tokensOut >= minTokensOut, "Slippage exceeded");

        // Update curve state
        curve.virtualBdag = newVirtualBdag;
        curve.virtualTokens -= tokensOut;
        curve.k = curve.virtualBdag * curve.virtualTokens; // recalculate to prevent drift from integer truncation
        curve.realBdag += bdagIn; // fee stays in contract, counts toward realBdag
        curve.tokensSold += tokensOut;

        // Transfer tokens to buyer
        IERC20(curve.token).safeTransfer(msg.sender, tokensOut);

        emit TokenBuy(id, msg.sender, bdagIn, tokensOut);

        // Check graduation
        if (curve.realBdag >= graduationThreshold) {
            _graduate(id);
        }
    }

    // ======================== SELL ========================

    function sell(uint256 id, uint256 tokensIn, uint256 minBdagOut) external nonReentrant {
        CurveState storage curve = curves[id];
        require(curve.token != address(0), "Token not found");
        require(!curve.graduated, "Already graduated");
        require(tokensIn > 0, "Zero amount");

        // Calculate BDAG out: bdagOut = virtualBdag - (k / (virtualTokens + tokensIn))
        uint256 newVirtualTokens = curve.virtualTokens + tokensIn;
        uint256 rawBdagOut = curve.virtualBdag - (curve.k / newVirtualTokens);

        // Deduct trading fee
        uint256 fee = (rawBdagOut * tradingFee) / FEE_DENOMINATOR;
        uint256 bdagOut = rawBdagOut - fee;

        // Cap at realBdag (can't withdraw more than actually deposited)
        require(bdagOut <= curve.realBdag, "Insufficient real BDAG");
        require(bdagOut > 0, "Zero BDAG out");
        require(bdagOut >= minBdagOut, "Slippage exceeded");

        // Transfer tokens from seller to contract (before state update — token is trusted LaunchpadToken)
        IERC20(curve.token).safeTransferFrom(msg.sender, address(this), tokensIn);

        // Update curve state (CEI: all state before external BDAG transfer)
        curve.virtualBdag -= rawBdagOut;
        curve.virtualTokens = newVirtualTokens;
        curve.k = curve.virtualBdag * curve.virtualTokens; // recalculate to prevent drift from integer truncation
        curve.realBdag -= bdagOut; // fee stays in contract
        curve.tokensSold -= tokensIn;

        // Send BDAG to seller
        (bool sent, ) = msg.sender.call{value: bdagOut}("");
        require(sent, "BDAG transfer failed");

        emit TokenSell(id, msg.sender, tokensIn, bdagOut);
    }

    // ======================== GRADUATION ========================

    function _graduate(uint256 id) internal {
        CurveState storage curve = curves[id];
        curve.graduated = true;

        uint256 totalBdag = curve.realBdag; // only this token's deposited BDAG
        curve.realBdag = 0;                 // zero out before transfers (CEI pattern)

        // Use configured shares
        uint256 lpBdag = (totalBdag * lpShare) / FEE_DENOMINATOR;
        uint256 creatorBdag = (totalBdag * creatorShare) / FEE_DENOMINATOR;
        uint256 devBdag = totalBdag - lpBdag - creatorBdag; // remainder to dev to avoid dust

        // Remaining tokens the contract holds for this curve
        uint256 remainingTokens = TOKEN_TOTAL_SUPPLY - curve.tokensSold;

        // ---- Seed LP at the bonding curve's final price ----
        // Curve price = virtualBdag / virtualTokens
        // LP must match: tokensForLP / lpBdag = virtualTokens / virtualBdag
        // => tokensForLP = lpBdag * virtualTokens / virtualBdag
        uint256 tokensForLP = (lpBdag * curve.virtualTokens) / curve.virtualBdag;

        // Safety cap — can't use more tokens than we hold
        if (tokensForLP > remainingTokens) {
            tokensForLP = remainingTokens;
        }

        // Excess tokens not used for LP — burn to dead address
        uint256 excessTokens = remainingTokens - tokensForLP;
        if (excessTokens > 0) {
            IERC20(curve.token).safeTransfer(address(0xdead), excessTokens);
        }

        // Force approve: resets to 0 then sets allowance (safe for non-standard ERC20s)
        IERC20(curve.token).forceApprove(address(swapperRouter), tokensForLP);

        // Add liquidity to Swappr DEX — LP tokens go to dead address (locked forever)
        // 1% slippage tolerance: if a griefer front-runs pair creation at a bad ratio, tx reverts
        uint256 minTokens = (tokensForLP * 99) / 100;
        uint256 minBdag = (lpBdag * 99) / 100;
        swapperRouter.addLiquidityETH{value: lpBdag}(
            curve.token,
            tokensForLP,
            minTokens,
            minBdag,
            address(0xdead),
            block.timestamp + 300
        );

        // Credit creator & dev shares via pull pattern (prevents reverting recipient from blocking graduation)
        if (creatorBdag > 0) {
            pendingWithdrawals[curve.creator] += creatorBdag;
        }
        if (devBdag > 0) {
            pendingWithdrawals[devWallet] += devBdag;
        }

        // Get the pair address for the event
        address pair = swapperFactory.getPair(curve.token, weth);
        emit TokenGraduated(id, curve.token, pair, lpBdag);
    }

    /// @notice Withdraw accumulated BDAG from graduation payouts
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Withdraw failed");
    }

    // ======================== VIEW FUNCTIONS ========================

    function getTokenInfo(uint256 id) external view returns (
        address token,
        address creator,
        uint256 virtualBdag,
        uint256 virtualTokens,
        uint256 k_,
        uint256 realBdag,
        uint256 tokensSold,
        bool graduated,
        uint256 createdAt
    ) {
        CurveState storage curve = curves[id];
        return (
            curve.token,
            curve.creator,
            curve.virtualBdag,
            curve.virtualTokens,
            curve.k,
            curve.realBdag,
            curve.tokensSold,
            curve.graduated,
            curve.createdAt
        );
    }

    function getMetadata(uint256 id) external view returns (
        string memory description,
        string memory imageUrl,
        string memory website,
        string memory twitter,
        string memory telegram
    ) {
        TokenMetadata storage m = metadata[id];
        return (m.description, m.imageUrl, m.website, m.twitter, m.telegram);
    }

    function getCurrentPrice(uint256 id) external view returns (uint256) {
        CurveState storage curve = curves[id];
        if (curve.virtualTokens == 0) return 0;
        // price = virtualBdag / virtualTokens (scaled by 1e18)
        return (curve.virtualBdag * 1e18) / curve.virtualTokens;
    }

    function getMarketCap(uint256 id) external view returns (uint256) {
        CurveState storage curve = curves[id];
        if (curve.virtualTokens == 0) return 0;
        // mcap = price * totalSupply = (virtualBdag / virtualTokens) * TOKEN_TOTAL_SUPPLY
        return (curve.virtualBdag * TOKEN_TOTAL_SUPPLY) / curve.virtualTokens;
    }

    function getTokensOut(uint256 id, uint256 bdagIn) external view returns (uint256) {
        CurveState storage curve = curves[id];
        if (curve.graduated) return 0;
        uint256 fee = (bdagIn * tradingFee) / FEE_DENOMINATOR;
        uint256 netBdag = bdagIn - fee;
        uint256 newVirtualBdag = curve.virtualBdag + netBdag;
        uint256 tokensOut = curve.virtualTokens - (curve.k / newVirtualBdag);
        return tokensOut;
    }

    function getBdagOut(uint256 id, uint256 tokensIn) external view returns (uint256) {
        CurveState storage curve = curves[id];
        if (curve.graduated) return 0;
        uint256 newVirtualTokens = curve.virtualTokens + tokensIn;
        uint256 rawBdagOut = curve.virtualBdag - (curve.k / newVirtualTokens);
        uint256 fee = (rawBdagOut * tradingFee) / FEE_DENOMINATOR;
        uint256 bdagOut = rawBdagOut - fee;
        if (bdagOut > curve.realBdag) return curve.realBdag;
        return bdagOut;
    }

    // ======================== OWNER FUNCTIONS ========================

    function setDevWallet(address _devWallet) external onlyOwner {
        require(_devWallet != address(0), "Zero address");
        devWallet = _devWallet;
    }

    function setGraduationThreshold(uint256 _threshold) external onlyOwner {
        require(_threshold > 0, "Zero threshold");
        graduationThreshold = _threshold;
    }

    function setInitialVirtualBdag(uint256 _amount) external onlyOwner {
        require(_amount > 0, "Zero amount");
        initialVirtualBdag = _amount;
    }

    function setTradingFee(uint256 _fee) external onlyOwner {
        require(_fee <= 500, "Fee too high"); // max 5%
        tradingFee = _fee;
    }

    function setFeeShares(uint256 _lpShare, uint256 _creatorShare, uint256 _devShare) external onlyOwner {
        require(_lpShare + _creatorShare + _devShare == FEE_DENOMINATOR, "Must sum to 10000");
        lpShare = _lpShare;
        creatorShare = _creatorShare;
        devShare = _devShare;
    }

    receive() external payable {}
}
