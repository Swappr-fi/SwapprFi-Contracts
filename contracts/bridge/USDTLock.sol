// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title USDTLock — Lock USDT on Ethereum for bridging to BlockDAG
/// @notice Users lock USDT here (2% fee sent to devWallet); relayer prepares a claim on BlockDAG.
///         Bridge-back (unlock) is disabled by default — owner can enable it.
contract USDTLock {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdt;
    address public owner;
    address public pendingOwner;
    address public devWallet;
    address public relayer;
    bool public paused;
    bool public bridgeBackEnabled;

    uint256 public feeBps; // default 200 = 2%
    uint256 public constant MAX_FEE_BPS = 1000; // 10% max

    uint256 public lockNonce;
    uint256 public unlockNonce;
    uint256 public totalLocked;
    uint256 public totalFees;

    mapping(uint256 => bool) public bdagBurnIdProcessed;

    event Locked(uint256 indexed lockId, address indexed sender, uint256 netAmount, uint256 fee, uint256 timestamp);
    event Unlocked(uint256 indexed unlockId, address indexed recipient, uint256 amount, uint256 bdagBurnId);
    event Paused(bool paused);
    event BridgeBackEnabled(bool enabled);

    constructor(address _usdt, address _devWallet, uint256 _feeBps) {
        require(_usdt != address(0), "USDTLock: ZERO_ADDRESS");
        require(_devWallet != address(0), "USDTLock: ZERO_ADDRESS");
        require(_feeBps <= MAX_FEE_BPS, "USDTLock: FEE_TOO_HIGH");
        usdt = IERC20(_usdt);
        devWallet = _devWallet;
        feeBps = _feeBps;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "USDTLock: FORBIDDEN");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "USDTLock: NOT_RELAYER");
        _;
    }

    // ======================== USER FUNCTIONS ========================

    /// @notice Lock USDT for bridging to BlockDAG. 2% fee is sent to devWallet.
    /// @param amount Total USDT to bridge (fee is deducted from this amount)
    function lock(uint256 amount) external {
        require(!paused, "USDTLock: PAUSED");
        require(amount > 0, "USDTLock: ZERO_AMOUNT");

        uint256 lockId = lockNonce++;
        uint256 fee = (amount * feeBps) / 10000;
        uint256 netAmount = amount - fee;

        // Pull full amount from user
        usdt.safeTransferFrom(msg.sender, address(this), amount);

        // Send fee to dev wallet
        if (fee > 0) {
            usdt.safeTransfer(devWallet, fee);
        }

        totalLocked += netAmount;
        totalFees += fee;

        emit Locked(lockId, msg.sender, netAmount, fee, block.timestamp);
    }

    // ======================== RELAYER FUNCTIONS ========================

    /// @notice Unlock USDT back to user (bridge-back). Only callable by relayer when enabled.
    /// @param to Recipient on Ethereum
    /// @param amount Amount of USDT to unlock
    /// @param bdagBurnId Burn ID from BridgeMinter on BlockDAG
    function unlock(address to, uint256 amount, uint256 bdagBurnId) external onlyRelayer {
        require(bridgeBackEnabled, "USDTLock: BRIDGE_BACK_DISABLED");
        require(to != address(0), "USDTLock: ZERO_ADDRESS");
        require(amount > 0, "USDTLock: ZERO_AMOUNT");
        require(!bdagBurnIdProcessed[bdagBurnId], "USDTLock: ALREADY_PROCESSED");

        bdagBurnIdProcessed[bdagBurnId] = true;
        uint256 unlockId = unlockNonce++;
        totalLocked -= amount;

        usdt.safeTransfer(to, amount);

        emit Unlocked(unlockId, to, amount, bdagBurnId);
    }

    // ======================== OWNER FUNCTIONS ========================

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function setBridgeBackEnabled(bool _enabled) external onlyOwner {
        bridgeBackEnabled = _enabled;
        emit BridgeBackEnabled(_enabled);
    }

    function setRelayer(address _relayer) external onlyOwner {
        require(_relayer != address(0), "USDTLock: ZERO_ADDRESS");
        relayer = _relayer;
    }

    function setDevWallet(address _devWallet) external onlyOwner {
        require(_devWallet != address(0), "USDTLock: ZERO_ADDRESS");
        devWallet = _devWallet;
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= MAX_FEE_BPS, "USDTLock: FEE_TOO_HIGH");
        feeBps = _feeBps;
    }

    /// @notice Emergency: withdraw USDT from contract
    function withdraw(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "USDTLock: ZERO_ADDRESS");
        usdt.safeTransfer(to, amount);
    }

    function proposeOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "USDTLock: ZERO_ADDRESS");
        pendingOwner = _owner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "USDTLock: NOT_PENDING_OWNER");
        owner = pendingOwner;
        pendingOwner = address(0);
    }
}
