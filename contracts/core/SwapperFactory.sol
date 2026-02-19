// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./SwapperPair.sol";

contract SwapperFactory {
    address public owner;
    address public pendingOwner;
    address public devWallet;
    uint256 public constant TOTAL_FEE = 50; // 0.5% = 50 basis points total
    uint256 public constant DEV_FEE = 20;   // 0.2% = 20 bps to dev wallet
    // remaining 0.3% (30 bps) stays in pool as LP reward

    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 pairIndex);
    event DevWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);

    constructor(address _devWallet) {
        owner = msg.sender;
        devWallet = _devWallet;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "SwapperFactory: FORBIDDEN");
        _;
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, "SwapperFactory: IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "SwapperFactory: ZERO_ADDRESS");
        require(getPair[token0][token1] == address(0), "SwapperFactory: PAIR_EXISTS");

        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        SwapperPair newPair = new SwapperPair{salt: salt}();
        newPair.initialize(token0, token1);

        pair = address(newPair);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);

        emit PairCreated(token0, token1, pair, allPairs.length - 1);
    }

    function setDevWallet(address _devWallet) external onlyOwner {
        require(_devWallet != address(0), "SwapperFactory: ZERO_ADDRESS");
        emit DevWalletUpdated(devWallet, _devWallet);
        devWallet = _devWallet;
    }

    function proposeOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "SwapperFactory: ZERO_ADDRESS");
        pendingOwner = _owner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "SwapperFactory: NOT_PENDING_OWNER");
        emit OwnerUpdated(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }
}
