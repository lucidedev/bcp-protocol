// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {BCPEscrow} from "../BCPEscrow.sol";

contract DeployBCPEscrow is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        BCPEscrow escrow = new BCPEscrow();
        console.log("BCPEscrow deployed at:", address(escrow));

        vm.stopBroadcast();
    }
}
