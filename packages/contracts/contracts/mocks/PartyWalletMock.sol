// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract PartyWalletMock {
    function execute(
        address target,
        bytes calldata data
    ) external returns (bytes memory) {
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(result, 0x20), mload(result))
            }
        }
        return result;
    }
}
