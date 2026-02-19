// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SwappyStaking — Fixed 10% APY staking for the SWPY token
/// @notice Users stake SWPY and earn 10% per year. Dev funds the contract
///         with SWPY to cover rewards. Rewards accrue per-second.
contract SwappyStaking is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable swappy;
    address public owner;
    address public pendingOwner;

    uint256 public constant APY_BPS = 1000; // 10% = 1000 basis points
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant LOCK_PERIOD = 90 days;
    uint256 public constant MAX_TOTAL_STAKE = 200_000_000 ether; // 200M SWPY

    struct StakeInfo {
        uint256 amount;
        uint256 rewardDebt;  // accumulated rewards already accounted for
        uint256 lastUpdate;  // last time rewards were calculated
        uint256 lockUntil;   // earliest timestamp user can withdraw
    }

    mapping(address => StakeInfo) public stakes;
    uint256 public totalStaked;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsFunded(uint256 amount);

    constructor(address _swappy) {
        swappy = IERC20(_swappy);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "SwappyStaking: FORBIDDEN");
        _;
    }

    // ======================== VIEW FUNCTIONS ========================

    /// @notice Calculate pending rewards for a user
    function pendingReward(address user) public view returns (uint256) {
        StakeInfo storage info = stakes[user];
        if (info.amount == 0) return info.rewardDebt;

        uint256 elapsed = block.timestamp - info.lastUpdate;
        uint256 reward = (info.amount * APY_BPS * elapsed) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
        return info.rewardDebt + reward;
    }

    /// @notice Available reward tokens in the contract (balance minus staked)
    function rewardReserve() public view returns (uint256) {
        uint256 balance = swappy.balanceOf(address(this));
        return balance > totalStaked ? balance - totalStaked : 0;
    }

    // ======================== USER FUNCTIONS ========================

    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "SwappyStaking: ZERO_AMOUNT");
        require(totalStaked + amount <= MAX_TOTAL_STAKE, "SwappyStaking: MAX_STAKE_REACHED");

        StakeInfo storage info = stakes[msg.sender];

        // Settle pending rewards before updating stake
        if (info.amount > 0) {
            info.rewardDebt = pendingReward(msg.sender);
        }

        swappy.safeTransferFrom(msg.sender, address(this), amount);
        info.amount += amount;
        info.lastUpdate = block.timestamp;
        info.lockUntil = block.timestamp + LOCK_PERIOD;
        totalStaked += amount;

        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        StakeInfo storage info = stakes[msg.sender];
        require(amount > 0, "SwappyStaking: ZERO_AMOUNT");
        require(info.amount >= amount, "SwappyStaking: INSUFFICIENT_BALANCE");
        require(block.timestamp >= info.lockUntil, "SwappyStaking: LOCK_ACTIVE");

        // Settle pending rewards before updating stake
        info.rewardDebt = pendingReward(msg.sender);
        info.amount -= amount;
        info.lastUpdate = block.timestamp;
        totalStaked -= amount;

        swappy.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    function claimReward() external nonReentrant {
        StakeInfo storage info = stakes[msg.sender];
        uint256 reward = pendingReward(msg.sender);
        require(reward > 0, "SwappyStaking: NO_REWARD");

        // Ensure contract has enough reward tokens
        require(rewardReserve() >= reward, "SwappyStaking: INSUFFICIENT_REWARDS");

        info.rewardDebt = 0;
        info.lastUpdate = block.timestamp;

        swappy.safeTransfer(msg.sender, reward);

        emit RewardPaid(msg.sender, reward);
    }

    /// @notice Withdraw all and claim rewards in one tx
    function exit() external nonReentrant {
        StakeInfo storage info = stakes[msg.sender];
        require(block.timestamp >= info.lockUntil, "SwappyStaking: LOCK_ACTIVE");
        uint256 stakedAmount = info.amount;
        uint256 reward = pendingReward(msg.sender);

        info.amount = 0;
        info.rewardDebt = 0;
        info.lastUpdate = block.timestamp;
        totalStaked -= stakedAmount;

        if (stakedAmount > 0) {
            swappy.safeTransfer(msg.sender, stakedAmount);
            emit Withdrawn(msg.sender, stakedAmount);
        }
        if (reward > 0 && rewardReserve() + stakedAmount >= reward) {
            // stakedAmount was just returned to balance, rewardReserve increased
            swappy.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    // ======================== OWNER FUNCTIONS ========================

    /// @notice Dev funds the contract with SWPY to cover staking rewards
    function fundRewards(uint256 amount) external onlyOwner {
        swappy.safeTransferFrom(msg.sender, address(this), amount);
        emit RewardsFunded(amount);
    }

    function proposeOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "SwappyStaking: ZERO_ADDRESS");
        pendingOwner = _owner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "SwappyStaking: NOT_PENDING_OWNER");
        owner = pendingOwner;
        pendingOwner = address(0);
    }
}
