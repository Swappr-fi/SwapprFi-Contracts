// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

/// @title Multicall3
/// @notice Aggregate results from multiple function calls
/// @dev Minimal implementation for local development
contract Multicall3 {
    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate3(Call3[] calldata calls) public payable returns (Result[] memory returnData) {
        uint256 length = calls.length;
        returnData = new Result[](length);
        for (uint256 i = 0; i < length; ) {
            Result memory result = returnData[i];
            (result.success, result.returnData) = calls[i].target.call(calls[i].callData);
            if (!calls[i].allowFailure && !result.success) {
                revert("Multicall3: call failed");
            }
            unchecked { ++i; }
        }
    }

    function tryAggregate(bool requireSuccess, bytes[] calldata calls) public payable returns (Result[] memory) {}

    function getBlockNumber() public view returns (uint256 blockNumber) {
        blockNumber = block.number;
    }

    function getCurrentBlockTimestamp() public view returns (uint256 timestamp) {
        timestamp = block.timestamp;
    }

    function getEthBalance(address addr) public view returns (uint256 balance) {
        balance = addr.balance;
    }
}
