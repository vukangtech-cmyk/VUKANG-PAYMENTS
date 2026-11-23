// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title VukangLedger
 * @notice Academic prototype of a blockchain-based digital asset ledger.
 *
 * The contract manages a real on-chain digital asset (VKC) with enforced
 * balances. Every mint and transfer is written as a hash-linked record:
 * each record stores the hash of the record before it, so changing or
 * removing any record breaks the chain and is detected by verifyRecord().
 *
 * It also supports monitoring: automatic flagging of large transfers,
 * manual flagging by an auditor, and freezing of accounts.
 *
 * VKC is a teaching asset. It has no monetary value.
 */
contract VukangLedger {
    enum Kind { Mint, Transfer }

    struct Record {
        uint256 id;
        Kind kind;
        address from;      // address(0) for mint
        address to;
        uint256 amount;
        string memo;
        uint256 timestamp;
        uint256 blockNumber;
        bytes32 prevHash;
        bytes32 recordHash;
        bool flagged;
        string flagReason;
    }

    string public constant name = "Vukang Credit";
    string public constant symbol = "VKC";
    uint8 public constant decimals = 0;
    uint256 public constant MAX_MEMO_BYTES = 80;

    address public owner;
    uint256 public totalSupply;
    uint256 public alertThreshold;
    bytes32 public headHash;

    mapping(address => uint256) public balanceOf;
    mapping(address => bool) public isAuditor;
    mapping(address => bool) public isFrozen;

    Record[] private _records; // index = id - 1

    event Recorded(
        uint256 indexed id,
        Kind kind,
        address indexed from,
        address indexed to,
        uint256 amount,
        string memo,
        bytes32 recordHash
    );
    event Flagged(uint256 indexed id, address indexed by, string reason);
    event FrozenChanged(address indexed account, bool frozen, address indexed by);
    event AuditorChanged(address indexed account, bool enabled);
    event ThresholdChanged(uint256 newThreshold);

    error NotOwner();
    error NotAuditor();
    error InvalidRecipient();
    error InvalidAmount();
    error InvalidMemo();
    error InsufficientBalance(uint256 available, uint256 required);
    error AccountFrozen(address account);
    error SelfTransfer();
    error UnknownRecord(uint256 id);
    error AlreadyFlagged(uint256 id);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAuditor() {
        if (msg.sender != owner && !isAuditor[msg.sender]) revert NotAuditor();
        _;
    }

    constructor(uint256 initialAlertThreshold) {
        owner = msg.sender;
        alertThreshold = initialAlertThreshold;
    }

    // ---------------------------------------------------------------- writes

    function mint(address to, uint256 amount, string calldata memo) external onlyOwner returns (uint256) {
        if (to == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (bytes(memo).length > MAX_MEMO_BYTES) revert InvalidMemo();

        balanceOf[to] += amount;
        totalSupply += amount;
        return _append(Kind.Mint, address(0), to, amount, memo);
    }

    function transfer(address to, uint256 amount, string calldata memo) external returns (uint256) {
        if (to == address(0)) revert InvalidRecipient();
        if (to == msg.sender) revert SelfTransfer();
        if (amount == 0) revert InvalidAmount();
        if (bytes(memo).length > MAX_MEMO_BYTES) revert InvalidMemo();
        if (isFrozen[msg.sender]) revert AccountFrozen(msg.sender);
        if (isFrozen[to]) revert AccountFrozen(to);

        uint256 available = balanceOf[msg.sender];
        if (available < amount) revert InsufficientBalance(available, amount);

        balanceOf[msg.sender] = available - amount;
        balanceOf[to] += amount;

        uint256 id = _append(Kind.Transfer, msg.sender, to, amount, memo);
        if (alertThreshold != 0 && amount >= alertThreshold) {
            _flag(id, msg.sender, "LARGE_AMOUNT");
        }
        return id;
    }

    function flag(uint256 id, string calldata reason) external onlyAuditor {
        if (id == 0 || id > _records.length) revert UnknownRecord(id);
        if (_records[id - 1].flagged) revert AlreadyFlagged(id);
        _flag(id, msg.sender, reason);
    }

    function setFrozen(address account, bool frozen) external onlyAuditor {
        isFrozen[account] = frozen;
        emit FrozenChanged(account, frozen, msg.sender);
    }

    function setAuditor(address account, bool enabled) external onlyOwner {
        isAuditor[account] = enabled;
        emit AuditorChanged(account, enabled);
    }

    function setAlertThreshold(uint256 newThreshold) external onlyOwner {
        alertThreshold = newThreshold;
        emit ThresholdChanged(newThreshold);
    }

    // ----------------------------------------------------------------- reads

    function getRecordCount() external view returns (uint256) {
        return _records.length;
    }

    function getRecord(uint256 id) external view returns (Record memory) {
        if (id == 0 || id > _records.length) revert UnknownRecord(id);
        return _records[id - 1];
    }

    function getRecords(uint256 offset, uint256 limit) external view returns (Record[] memory page) {
        uint256 total = _records.length;
        if (offset >= total) return new Record[](0);
        uint256 end = offset + limit;
        if (end > total) end = total;
        page = new Record[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = _records[i];
        }
    }

    /**
     * @notice Recomputes the record's hash from its stored fields and checks
     *         that it links correctly to the previous record.
     * @return valid true when the hash matches and the link to the previous record holds.
     */
    function verifyRecord(uint256 id) external view returns (bool valid) {
        if (id == 0 || id > _records.length) return false;
        Record storage r = _records[id - 1];
        bytes32 expectedPrev = id == 1 ? bytes32(0) : _records[id - 2].recordHash;
        if (r.prevHash != expectedPrev) return false;
        return _hash(r) == r.recordHash;
    }

    /// @notice Verifies every record in order. Cost grows with the number of records.
    function verifyChain() external view returns (bool valid, uint256 firstBrokenId) {
        bytes32 prev = bytes32(0);
        for (uint256 i = 0; i < _records.length; i++) {
            Record storage r = _records[i];
            if (r.prevHash != prev || _hash(r) != r.recordHash) {
                return (false, r.id);
            }
            prev = r.recordHash;
        }
        return (true, 0);
    }

    // -------------------------------------------------------------- internal

    function _append(
        Kind kind,
        address from,
        address to,
        uint256 amount,
        string calldata memo
    ) private returns (uint256 id) {
        id = _records.length + 1;

        Record memory r;
        r.id = id;
        r.kind = kind;
        r.from = from;
        r.to = to;
        r.amount = amount;
        r.memo = memo;
        r.timestamp = block.timestamp;
        r.blockNumber = block.number;
        r.prevHash = headHash;
        r.recordHash = _hash(r);

        _records.push(r);
        headHash = r.recordHash;

        emit Recorded(id, kind, from, to, amount, memo, r.recordHash);
    }

    function _flag(uint256 id, address by, string memory reason) private {
        Record storage r = _records[id - 1];
        r.flagged = true;
        r.flagReason = reason;
        emit Flagged(id, by, reason);
    }

    /// @dev The flag fields are excluded on purpose: flagging is monitoring metadata
    ///      and must not change the integrity hash of the underlying transaction.
    function _hash(Record memory r) private pure returns (bytes32) {
        return keccak256(
            abi.encode(r.id, r.kind, r.from, r.to, r.amount, r.memo, r.timestamp, r.blockNumber, r.prevHash)
        );
    }
}
