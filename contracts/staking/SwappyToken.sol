// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SwappyToken is ERC20 {
    address public owner;
    address public pendingOwner;

    constructor(uint256 initialSupply) ERC20("Swappy", "SWPY") {
        owner = msg.sender;
        _mint(msg.sender, initialSupply);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "SwappyToken: FORBIDDEN");
        _;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function proposeOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "SwappyToken: ZERO_ADDRESS");
        pendingOwner = _owner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "SwappyToken: NOT_PENDING_OWNER");
        owner = pendingOwner;
        pendingOwner = address(0);
    }
}
