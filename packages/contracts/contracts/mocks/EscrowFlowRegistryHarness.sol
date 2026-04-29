// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EscrowFlowRegistry} from "../EscrowFlowRegistry.sol";

contract EscrowFlowRegistryHarness is EscrowFlowRegistry {
    constructor(address admin) EscrowFlowRegistry(admin) {}

    function exposedToUint64(uint256 value) external pure returns (uint64) {
        return _toUint64(value);
    }
}
