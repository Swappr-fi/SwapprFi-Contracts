// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SwapperStaking — General-purpose staking pools managed by dev wallet
/// @notice Synthetix-style reward distribution. Dev creates pools with a stake token,
///         reward token, reward amount, and duration. Rewards distribute proportionally.
contract SwapperStaking is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public owner;
    address public pendingOwner;

    struct Pool {
        IERC20 stakeToken;
        IERC20 rewardToken;
        uint256 duration;           // reward period in seconds
        uint256 finishAt;           // timestamp when rewards end
        uint256 updatedAt;          // last update timestamp
        uint256 rewardRate;         // rewards per second
        uint256 rewardPerTokenStored;
        uint256 totalStaked;
        bool active;
    }

    uint256 public poolCount;
    mapping(uint256 => Pool) public pools;

    // poolId => user => amount staked
    mapping(uint256 => mapping(address => uint256)) public balanceOf;
    // poolId => user => rewardPerToken snapshot
    mapping(uint256 => mapping(address => uint256)) public userRewardPerTokenPaid;
    // poolId => user => earned rewards
    mapping(uint256 => mapping(address => uint256)) public rewards;

    event PoolCreated(uint256 indexed poolId, address stakeToken, address rewardToken, uint256 rewardAmount, uint256 duration);
    event Staked(uint256 indexed poolId, address indexed user, uint256 amount);
    event Withdrawn(uint256 indexed poolId, address indexed user, uint256 amount);
    event RewardPaid(uint256 indexed poolId, address indexed user, uint256 reward);
    event PoolFunded(uint256 indexed poolId, uint256 rewardAmount, uint256 newFinishAt);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "SwapperStaking: FORBIDDEN");
        _;
    }

    modifier updateReward(uint256 poolId, address account) {
        Pool storage pool = pools[poolId];
        pool.rewardPerTokenStored = rewardPerToken(poolId);
        pool.updatedAt = lastTimeRewardApplicable(poolId);
        if (account != address(0)) {
            rewards[poolId][account] = earned(poolId, account);
            userRewardPerTokenPaid[poolId][account] = pool.rewardPerTokenStored;
        }
        _;
    }

    // ======================== VIEW FUNCTIONS ========================

    function lastTimeRewardApplicable(uint256 poolId) public view returns (uint256) {
        Pool storage pool = pools[poolId];
        return block.timestamp < pool.finishAt ? block.timestamp : pool.finishAt;
    }

    function rewardPerToken(uint256 poolId) public view returns (uint256) {
        Pool storage pool = pools[poolId];
        if (pool.totalStaked == 0) {
            return pool.rewardPerTokenStored;
        }
        return pool.rewardPerTokenStored + (
            (lastTimeRewardApplicable(poolId) - pool.updatedAt) * pool.rewardRate * 1e18 / pool.totalStaked
        );
    }

    function earned(uint256 poolId, address account) public view returns (uint256) {
        return (
            balanceOf[poolId][account] * (rewardPerToken(poolId) - userRewardPerTokenPaid[poolId][account]) / 1e18
        ) + rewards[poolId][account];
    }

    function getPool(uint256 poolId) external view returns (
        address stakeToken,
        address rewardToken,
        uint256 duration,
        uint256 finishAt,
        uint256 rewardRate,
        uint256 totalStaked,
        bool active
    ) {
        Pool storage pool = pools[poolId];
        return (
            address(pool.stakeToken),
            address(pool.rewardToken),
            pool.duration,
            pool.finishAt,
            pool.rewardRate,
            pool.totalStaked,
            pool.active
        );
    }

    // ======================== OWNER FUNCTIONS ========================

    /// @notice Create a new staking pool. Only dev wallet can call this.
    /// @param stakeToken Token users will stake
    /// @param rewardToken Token used for rewards
    /// @param rewardAmount Total rewards for the duration
    /// @param duration Duration in seconds the pool is active
    function createPool(
        address stakeToken,
        address rewardToken,
        uint256 rewardAmount,
        uint256 duration
    ) external onlyOwner returns (uint256 poolId) {
        require(duration > 0, "SwapperStaking: ZERO_DURATION");
        require(rewardAmount > 0, "SwapperStaking: ZERO_REWARD");

        poolId = poolCount++;

        Pool storage pool = pools[poolId];
        pool.stakeToken = IERC20(stakeToken);
        pool.rewardToken = IERC20(rewardToken);
        pool.duration = duration;
        pool.rewardRate = rewardAmount / duration;
        pool.finishAt = block.timestamp + duration;
        pool.updatedAt = block.timestamp;
        pool.active = true;

        // Transfer reward tokens from owner to this contract
        IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), rewardAmount);

        emit PoolCreated(poolId, stakeToken, rewardToken, rewardAmount, duration);
    }

    /// @notice Top up an existing pool with more rewards
    function fundPool(uint256 poolId, uint256 rewardAmount, uint256 additionalDuration)
        external
        onlyOwner
        updateReward(poolId, address(0))
    {
        Pool storage pool = pools[poolId];
        require(pool.active, "SwapperStaking: POOL_NOT_ACTIVE");

        IERC20(pool.rewardToken).safeTransferFrom(msg.sender, address(this), rewardAmount);

        uint256 remaining = 0;
        if (block.timestamp < pool.finishAt) {
            remaining = (pool.finishAt - block.timestamp) * pool.rewardRate;
        }

        uint256 newDuration = additionalDuration > 0
            ? (block.timestamp < pool.finishAt ? pool.finishAt - block.timestamp + additionalDuration : additionalDuration)
            : (block.timestamp < pool.finishAt ? pool.finishAt - block.timestamp : pool.duration);

        pool.rewardRate = (remaining + rewardAmount) / newDuration;
        pool.finishAt = block.timestamp + newDuration;
        pool.updatedAt = block.timestamp;

        emit PoolFunded(poolId, rewardAmount, pool.finishAt);
    }

    function proposeOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "SwapperStaking: ZERO_ADDRESS");
        pendingOwner = _owner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "SwapperStaking: NOT_PENDING_OWNER");
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    // ======================== USER FUNCTIONS ========================

    function stake(uint256 poolId, uint256 amount)
        external
        nonReentrant
        updateReward(poolId, msg.sender)
    {
        Pool storage pool = pools[poolId];
        require(pool.active, "SwapperStaking: POOL_NOT_ACTIVE");
        require(amount > 0, "SwapperStaking: ZERO_AMOUNT");

        pool.stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        balanceOf[poolId][msg.sender] += amount;
        pool.totalStaked += amount;

        emit Staked(poolId, msg.sender, amount);
    }

    function withdraw(uint256 poolId, uint256 amount)
        external
        nonReentrant
        updateReward(poolId, msg.sender)
    {
        require(amount > 0, "SwapperStaking: ZERO_AMOUNT");
        require(balanceOf[poolId][msg.sender] >= amount, "SwapperStaking: INSUFFICIENT_BALANCE");

        Pool storage pool = pools[poolId];
        balanceOf[poolId][msg.sender] -= amount;
        pool.totalStaked -= amount;
        pool.stakeToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(poolId, msg.sender, amount);
    }

    function claimReward(uint256 poolId)
        external
        nonReentrant
        updateReward(poolId, msg.sender)
    {
        uint256 reward = rewards[poolId][msg.sender];
        if (reward > 0) {
            rewards[poolId][msg.sender] = 0;
            Pool storage pool = pools[poolId];
            pool.rewardToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(poolId, msg.sender, reward);
        }
    }

    /// @notice Withdraw all staked tokens and claim rewards in one tx
    function exit(uint256 poolId) external nonReentrant updateReward(poolId, msg.sender) {
        uint256 stakedAmount = balanceOf[poolId][msg.sender];
        Pool storage pool = pools[poolId];

        if (stakedAmount > 0) {
            balanceOf[poolId][msg.sender] = 0;
            pool.totalStaked -= stakedAmount;
            pool.stakeToken.safeTransfer(msg.sender, stakedAmount);
            emit Withdrawn(poolId, msg.sender, stakedAmount);
        }

        uint256 reward = rewards[poolId][msg.sender];
        if (reward > 0) {
            rewards[poolId][msg.sender] = 0;
            pool.rewardToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(poolId, msg.sender, reward);
        }
    }
}
