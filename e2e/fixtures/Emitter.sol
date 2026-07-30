// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Emits the two Pipeshift settlement events and answers instructionOf.
/// @dev Test fixture for the indexer end to end suite. It has the same event
///      signatures and the same instructionOf shape as the real engines, so the
///      indexer cannot tell the difference, which is exactly the point.
contract Emitter {
    struct Instruction {
        bytes32 security;
        address cash;
        address seller;
        address buyer;
        uint256 quantity;
        uint256 consideration;
        uint64 deadline;
        address venue;
    }

    mapping(bytes32 => Instruction) private _instructions;

    event InstructionSettled(bytes32 indexed id, address indexed seller, address indexed buyer);
    event SessionSettled(uint256 indexed session, bytes32 indexed security, uint256 legs, uint256 grossTrades);

    function settle(
        bytes32 id,
        bytes32 security,
        address seller,
        address buyer,
        uint256 quantity,
        uint256 consideration
    ) external {
        _instructions[id] = Instruction({
            security: security,
            cash: address(0),
            seller: seller,
            buyer: buyer,
            quantity: quantity,
            consideration: consideration,
            deadline: type(uint64).max,
            venue: msg.sender
        });

        emit InstructionSettled(id, seller, buyer);
    }

    function session(uint256 id, bytes32 security, uint256 legs, uint256 grossTrades) external {
        emit SessionSettled(id, security, legs, grossTrades);
    }

    function instructionOf(bytes32 id) external view returns (Instruction memory, uint8) {
        return (_instructions[id], 2);
    }
}
