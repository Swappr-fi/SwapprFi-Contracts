// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SwappySale — Fixed-rate token sale: 1 BDAG = 1 SWPY
/// @notice Users send BDAG (native token) and receive SWPY at a 1:1 rate.
///         BDAG is forwarded to the dev wallet immediately.
contract SwappySale is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable swappy;
    address public immutable devWallet;
    address public owner;
    address public pendingOwner;

    uint256 public totalSold;
    bool public paused;

    event TokensPurchased(address indexed buyer, uint256 amount);
    event SalePaused(bool paused);

    constructor(address _swappy, address _devWallet) {
        swappy = IERC20(_swappy);
        devWallet = _devWallet;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "SwappySale: FORBIDDEN");
        _;
    }

    // ======================== VIEW FUNCTIONS ========================

    /// @notice Returns SWPY tokens remaining for sale
    function remaining() external view returns (uint256) {
        return swappy.balanceOf(address(this));
    }

    // ======================== USER FUNCTIONS ========================

    /// @notice Buy SWPY with BDAG at 1:1 rate
    function buy() external payable nonReentrant {
        require(!paused, "SwappySale: PAUSED");
        require(msg.value > 0, "SwappySale: ZERO_AMOUNT");

        uint256 amount = msg.value;
        require(swappy.balanceOf(address(this)) >= amount, "SwappySale: SOLD_OUT");

        totalSold += amount;

        // Forward BDAG to dev wallet
        (bool sent, ) = devWallet.call{value: amount}("");
        require(sent, "SwappySale: BDAG_TRANSFER_FAILED");

        // Send SWPY to buyer
        swappy.safeTransfer(msg.sender, amount);

        emit TokensPurchased(msg.sender, amount);
    }

    // ======================== OWNER FUNCTIONS ========================

    /// @notice Pause or unpause the sale
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit SalePaused(_paused);
    }

    /// @notice Emergency: recover ERC20 tokens sent to this contract
    function withdrawToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner, amount);
    }

    /// @notice Emergency: recover native tokens sent to this contract
    function withdrawNative() external onlyOwner {
        (bool sent, ) = owner.call{value: address(this).balance}("");
        require(sent, "SwappySale: TRANSFER_FAILED");
    }

    function proposeOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "SwappySale: ZERO_ADDRESS");
        pendingOwner = _owner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "SwappySale: NOT_PENDING_OWNER");
        owner = pendingOwner;
        pendingOwner = address(0);
    }
}
