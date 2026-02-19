// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IBridgedUSDT {
    function mint(address to, uint256 amount) external;
    function burnFrom(address from, uint256 amount) external;
}

/// @title BridgeMinter — Prepares and executes claims for bridged USDT on BlockDAG
/// @notice Relayer prepares claims after detecting USDT locks on Ethereum.
///         Users claim their bridged USDT (no fee — fee is taken on Ethereum side).
///         Bridge-back: users can request unlock (burns USDT.e) when enabled.
contract BridgeMinter is ReentrancyGuard {
    IBridgedUSDT public immutable bridgedUSDT;

    address public owner;
    address public pendingOwner;
    address public relayer;
    bool public paused;
    bool public bridgeBackEnabled;

    uint256 public claimNonce;
    uint256 public burnNonce;

    struct Claim {
        address recipient;
        uint256 amount; // net amount (after fee on ETH side)
        uint256 ethLockId;
        bool claimed;
    }

    mapping(uint256 => Claim) public claims;
    mapping(uint256 => bool) public ethLockIdPrepared;
    mapping(uint256 => uint256) public ethLockIdToClaimId;

    event ClaimPrepared(uint256 indexed claimId, address indexed recipient, uint256 amount, uint256 ethLockId);
    event Claimed(uint256 indexed claimId, address indexed recipient, uint256 amount);
    event UnlockRequested(uint256 indexed burnId, address indexed sender, uint256 amount);
    event Paused(bool paused);
    event BridgeBackEnabled(bool enabled);

    constructor(address _bridgedUSDT, address _relayer) {
        require(_bridgedUSDT != address(0), "BridgeMinter: ZERO_ADDRESS");
        require(_relayer != address(0), "BridgeMinter: ZERO_ADDRESS");
        bridgedUSDT = IBridgedUSDT(_bridgedUSDT);
        relayer = _relayer;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "BridgeMinter: FORBIDDEN");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "BridgeMinter: NOT_RELAYER");
        _;
    }

    // ======================== RELAYER FUNCTIONS ========================

    /// @notice Prepare a claim for a user after their USDT was locked on Ethereum
    /// @param recipient The user who locked USDT on Ethereum
    /// @param amount The net USDT amount (after fee, 6 decimals)
    /// @param ethLockId The lock ID from the USDTLock contract on Ethereum
    function prepareClaim(address recipient, uint256 amount, uint256 ethLockId) external onlyRelayer {
        require(!paused, "BridgeMinter: PAUSED");
        require(recipient != address(0), "BridgeMinter: ZERO_ADDRESS");
        require(amount > 0, "BridgeMinter: ZERO_AMOUNT");
        require(!ethLockIdPrepared[ethLockId], "BridgeMinter: ALREADY_PREPARED");

        uint256 claimId = claimNonce++;
        claims[claimId] = Claim({
            recipient: recipient,
            amount: amount,
            ethLockId: ethLockId,
            claimed: false
        });
        ethLockIdPrepared[ethLockId] = true;
        ethLockIdToClaimId[ethLockId] = claimId;

        emit ClaimPrepared(claimId, recipient, amount, ethLockId);
    }

    // ======================== USER FUNCTIONS ========================

    /// @notice Claim bridged USDT (full amount — fee was already taken on Ethereum)
    /// @param claimId The claim ID from prepareClaim
    function claim(uint256 claimId) external nonReentrant {
        require(!paused, "BridgeMinter: PAUSED");

        Claim storage c = claims[claimId];
        require(c.recipient == msg.sender, "BridgeMinter: NOT_RECIPIENT");
        require(!c.claimed, "BridgeMinter: ALREADY_CLAIMED");
        require(c.amount > 0, "BridgeMinter: INVALID_CLAIM");

        c.claimed = true;
        bridgedUSDT.mint(msg.sender, c.amount);

        emit Claimed(claimId, msg.sender, c.amount);
    }

    /// @notice Request bridge-back: burn USDT.e to unlock USDT on Ethereum
    /// @dev User must approve this contract to spend their USDT.e first
    /// @param amount Amount of USDT.e to burn (will receive same amount on Ethereum)
    function requestUnlock(uint256 amount) external nonReentrant {
        require(bridgeBackEnabled, "BridgeMinter: BRIDGE_BACK_DISABLED");
        require(amount > 0, "BridgeMinter: ZERO_AMOUNT");

        uint256 burnId = burnNonce++;
        bridgedUSDT.burnFrom(msg.sender, amount);

        emit UnlockRequested(burnId, msg.sender, amount);
    }

    // ======================== OWNER FUNCTIONS ========================

    function setRelayer(address _relayer) external onlyOwner {
        require(_relayer != address(0), "BridgeMinter: ZERO_ADDRESS");
        relayer = _relayer;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function setBridgeBackEnabled(bool _enabled) external onlyOwner {
        bridgeBackEnabled = _enabled;
        emit BridgeBackEnabled(_enabled);
    }

    function proposeOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "BridgeMinter: ZERO_ADDRESS");
        pendingOwner = _owner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "BridgeMinter: NOT_PENDING_OWNER");
        owner = pendingOwner;
        pendingOwner = address(0);
    }
}
