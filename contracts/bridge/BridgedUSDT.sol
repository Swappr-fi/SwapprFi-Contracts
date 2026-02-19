// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title BridgedUSDT — Bridged USDT on BlockDAG (USDT.e)
/// @notice Minted by the BridgeMinter when users claim their bridged USDT.
contract BridgedUSDT is ERC20 {
    address public owner;
    address public pendingOwner;
    address public minter;

    constructor() ERC20("Bridged USDT", "USDT.e") {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "BridgedUSDT: FORBIDDEN");
        _;
    }

    modifier onlyMinter() {
        require(msg.sender == minter, "BridgedUSDT: NOT_MINTER");
        _;
    }

    /// @notice Override decimals to match real USDT (6 decimals)
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint bridged USDT — only callable by minter (BridgeMinter contract)
    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }

    /// @notice Burn your own bridged USDT
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /// @notice Burn bridged USDT from another address (requires allowance)
    /// @dev Used by BridgeMinter for bridge-back (requestUnlock)
    function burnFrom(address from, uint256 amount) external {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
    }

    /// @notice Set the minter address (BridgeMinter contract)
    function setMinter(address _minter) external onlyOwner {
        minter = _minter;
    }

    function proposeOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "BridgedUSDT: ZERO_ADDRESS");
        pendingOwner = _owner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "BridgedUSDT: NOT_PENDING_OWNER");
        owner = pendingOwner;
        pendingOwner = address(0);
    }
}
