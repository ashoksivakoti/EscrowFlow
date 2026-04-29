// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {EscrowFlowRegistry} from "../contracts/EscrowFlowRegistry.sol";

/**
 * Foundry deployment script (optional) for canonical production deployment.
 *
 * Env:
 *   DEPLOYER_PRIVATE_KEY
 *   CANONICAL_REGISTRY_ADMIN_ADDRESS
 */
contract DeployEscrowFlowRegistry is Script {
    function run() external returns (EscrowFlowRegistry deployed) {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.envAddress("CANONICAL_REGISTRY_ADMIN_ADDRESS");

        vm.startBroadcast(deployerPk);
        deployed = new EscrowFlowRegistry(admin);
        vm.stopBroadcast();

        console2.log("deployer", vm.addr(deployerPk));
        console2.log("admin", admin);
        console2.log("registry", address(deployed));
        console2.log("chainId", block.chainid);
        console2.log("runtimeSize", address(deployed).code.length);
    }
}
