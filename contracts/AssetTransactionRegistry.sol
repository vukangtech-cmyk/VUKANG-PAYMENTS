// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AssetTransactionRegistry
 * @notice Local academic prototype for recording and verifying simulated asset transaction metadata.
 *         Does not transfer tokens or custody real assets.
 */
contract AssetTransactionRegistry {
    struct TransactionRecord {
        uint256 id;
        address from;
        address to;
        string asset;
        uint256 amount;
        uint256 timestamp;
        bool exists;
    }

    uint256 private _nextId = 1;
    mapping(uint256 => TransactionRecord) private _records;

    event TransactionRecorded(
        uint256 indexed id,
        address indexed from,
        address indexed to,
        string asset,
        uint256 amount,
        uint256 timestamp
    );

    error InvalidRecipient();
    error InvalidAssetLabel();
    error InvalidAmount();

    function recordTransaction(
        address to,
        string calldata asset,
        uint256 amount
    ) external returns (uint256) {
        if (to == address(0)) revert InvalidRecipient();
        if (bytes(asset).length == 0 || bytes(asset).length > 32) revert InvalidAssetLabel();
        if (amount == 0) revert InvalidAmount();

        uint256 id = _nextId++;
        uint256 recordedAt = block.timestamp;

        _records[id] = TransactionRecord({
            id: id,
            from: msg.sender,
            to: to,
            asset: asset,
            amount: amount,
            timestamp: recordedAt,
            exists: true
        });

        emit TransactionRecorded(id, msg.sender, to, asset, amount, recordedAt);
        return id;
    }

    function verifyTransaction(uint256 id) external view returns (bool) {
        return _records[id].exists;
    }

    function getTransaction(uint256 id) external view returns (TransactionRecord memory) {
        return _records[id];
    }

    function getTransactionCount() external view returns (uint256) {
        return _nextId - 1;
    }
}
