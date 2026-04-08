// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title IERC20 — minimal interface for ERC-20 token transfers.
 */
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title BCPEscrow
 * @notice Permissionless escrow contract for the Business Commerce Protocol (BCP).
 *         Deployed on Base (or Base Sepolia for testnet).
 *
 *         Supports both native ETH and ERC-20 tokens (e.g. FDUSD, USDC).
 *
 *         Three core functions:
 *         - lock: buyer deposits funds for a commitId
 *         - release: seller withdraws after releaseAfter timestamp
 *         - freeze: either party freezes; requires both signatures to unfreeze
 *
 *         This contract is fully standalone. No external oracle, no admin key.
 */
contract BCPEscrow {

    enum Status { Empty, Locked, Released, Frozen }

    struct Escrow {
        address buyer;
        address seller;
        uint256 amount;
        uint256 releaseAfter;  // unix timestamp
        Status  status;
        address token;         // address(0) = native ETH
        bool    buyerApprovedUnfreeze;
        bool    sellerApprovedUnfreeze;
    }

    mapping(bytes32 => Escrow) public escrows;

    event Locked(bytes32 indexed commitId, address buyer, address seller, uint256 amount, uint256 releaseAfter, address token);
    event Released(bytes32 indexed commitId, address seller, uint256 amount);
    event Frozen(bytes32 indexed commitId, address frozenBy);
    event Unfrozen(bytes32 indexed commitId);
    event UnfreezeApproved(bytes32 indexed commitId, address approver);

    error EscrowAlreadyExists(bytes32 commitId);
    error EscrowNotLocked(bytes32 commitId);
    error NotParty(bytes32 commitId);
    error TooEarly(bytes32 commitId, uint256 releaseAfter);
    error OnlySeller(bytes32 commitId);
    error EscrowNotFrozen(bytes32 commitId);
    error TransferFailed();
    error ZeroAmount();

    /**
     * @notice Lock native ETH in escrow for a BCP commit.
     * @param commitId     bytes32 BCP commit identifier
     * @param buyer        address of the buyer
     * @param seller       address of the seller
     * @param releaseAfter unix timestamp after which the seller can release
     */
    function lock(
        bytes32 commitId,
        address buyer,
        address seller,
        uint256 releaseAfter
    ) external payable {
        if (msg.value == 0) revert ZeroAmount();
        if (escrows[commitId].status != Status.Empty) revert EscrowAlreadyExists(commitId);

        escrows[commitId] = Escrow({
            buyer: buyer,
            seller: seller,
            amount: msg.value,
            releaseAfter: releaseAfter,
            status: Status.Locked,
            token: address(0),
            buyerApprovedUnfreeze: false,
            sellerApprovedUnfreeze: false
        });

        emit Locked(commitId, buyer, seller, msg.value, releaseAfter, address(0));
    }

    /**
     * @notice Lock ERC-20 tokens in escrow for a BCP commit.
     *         Buyer must have approved this contract to spend `amount` tokens.
     * @param commitId     bytes32 BCP commit identifier
     * @param buyer        address of the buyer
     * @param seller       address of the seller
     * @param releaseAfter unix timestamp after which the seller can release
     * @param token        ERC-20 token contract address
     * @param amount       amount of tokens to lock
     */
    function lockToken(
        bytes32 commitId,
        address buyer,
        address seller,
        uint256 releaseAfter,
        address token,
        uint256 amount
    ) external {
        if (amount == 0) revert ZeroAmount();
        if (escrows[commitId].status != Status.Empty) revert EscrowAlreadyExists(commitId);

        bool ok = IERC20(token).transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();

        escrows[commitId] = Escrow({
            buyer: buyer,
            seller: seller,
            amount: amount,
            releaseAfter: releaseAfter,
            status: Status.Locked,
            token: token,
            buyerApprovedUnfreeze: false,
            sellerApprovedUnfreeze: false
        });

        emit Locked(commitId, buyer, seller, amount, releaseAfter, token);
    }

    /**
     * @notice Release escrowed funds to the seller. Callable by seller after releaseAfter.
     * @param commitId   bytes32 BCP commit identifier
     */
    function release(bytes32 commitId) external {
        Escrow storage e = escrows[commitId];
        if (e.status != Status.Locked) revert EscrowNotLocked(commitId);
        if (msg.sender != e.seller) revert OnlySeller(commitId);
        if (block.timestamp < e.releaseAfter) revert TooEarly(commitId, e.releaseAfter);

        e.status = Status.Released;
        uint256 amt = e.amount;

        if (e.token == address(0)) {
            // Native ETH
            (bool ok, ) = payable(e.seller).call{value: amt}("");
            if (!ok) revert TransferFailed();
        } else {
            // ERC-20
            bool ok = IERC20(e.token).transfer(e.seller, amt);
            if (!ok) revert TransferFailed();
        }

        emit Released(commitId, e.seller, amt);
    }

    /**
     * @notice Freeze the escrow. Callable by either buyer or seller.
     *         Once frozen, both parties must approve to unfreeze.
     * @param commitId   bytes32 BCP commit identifier
     */
    function freeze(bytes32 commitId) external {
        Escrow storage e = escrows[commitId];
        if (e.status != Status.Locked) revert EscrowNotLocked(commitId);
        if (msg.sender != e.buyer && msg.sender != e.seller) revert NotParty(commitId);

        e.status = Status.Frozen;
        e.buyerApprovedUnfreeze = false;
        e.sellerApprovedUnfreeze = false;

        emit Frozen(commitId, msg.sender);
    }

    /**
     * @notice Approve unfreezing. Both buyer and seller must call this.
     *         Once both approve, escrow returns to Locked status.
     * @param commitId   bytes32 BCP commit identifier
     */
    function approveUnfreeze(bytes32 commitId) external {
        Escrow storage e = escrows[commitId];
        if (e.status != Status.Frozen) revert EscrowNotFrozen(commitId);
        if (msg.sender != e.buyer && msg.sender != e.seller) revert NotParty(commitId);

        if (msg.sender == e.buyer) {
            e.buyerApprovedUnfreeze = true;
        } else {
            e.sellerApprovedUnfreeze = true;
        }

        emit UnfreezeApproved(commitId, msg.sender);

        if (e.buyerApprovedUnfreeze && e.sellerApprovedUnfreeze) {
            e.status = Status.Locked;
            e.buyerApprovedUnfreeze = false;
            e.sellerApprovedUnfreeze = false;
            emit Unfrozen(commitId);
        }
    }

    /**
     * @notice View helper — get escrow details.
     */
    function getEscrow(bytes32 commitId) external view returns (
        address buyer,
        address seller,
        uint256 amount,
        uint256 releaseAfter,
        Status  status,
        address token
    ) {
        Escrow storage e = escrows[commitId];
        return (e.buyer, e.seller, e.amount, e.releaseAfter, e.status, e.token);
    }
}
