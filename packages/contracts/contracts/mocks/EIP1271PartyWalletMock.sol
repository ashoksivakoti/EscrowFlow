// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Test double for EIP-1271 party signatures on `setPartyAuthorizedRecipientBySig` digests.
contract EIP1271PartyWalletMock {
    bytes4 public constant EIP1271_MAGIC_VALUE = 0x1626ba7e;

    function execute(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(result, 0x20), mload(result))
            }
        }
        return result;
    }

    enum Mode {
        MatchDigest,
        WrongMagic,
        RevertCall
    }

    bytes32 public acceptedDigest;
    Mode public mode;

    function setAcceptedDigest(bytes32 digest) external {
        acceptedDigest = digest;
    }

    function setMode(Mode m) external {
        mode = m;
    }

    function isValidSignature(
        bytes32 hash,
        bytes calldata /* signature */
    ) external view returns (bytes4 magicValue) {
        if (mode == Mode.RevertCall) {
            revert("EIP1271PartyWalletMock: revert");
        }
        if (mode == Mode.WrongMagic) {
            return bytes4(0xffffffff);
        }
        if (hash != acceptedDigest) {
            return bytes4(0);
        }
        return EIP1271_MAGIC_VALUE;
    }
}
