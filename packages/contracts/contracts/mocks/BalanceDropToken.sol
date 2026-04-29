// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Test token whose transfer can be configured to burn an additional fraction
 * from the sender beyond the transferred value, simulating a misbehaving rebasing /
 * deflationary token. Used to exercise the post-transfer liability check in
 * `sweepUntrackedToken` (audit fix N-10): the explicit revert must trigger instead
 * of an all-gas-consuming `assert(...)` panic.
 */
contract BalanceDropToken is ERC20, Ownable {
    uint256 public extraDrainBps;

    constructor(address initialOwner)
        ERC20("Balance Drop Token", "BDT")
        Ownable(initialOwner)
    {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function setExtraDrainBps(uint256 bps) external onlyOwner {
        extraDrainBps = bps;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (
            from == address(0) ||
            to == address(0) ||
            value == 0 ||
            extraDrainBps == 0
        ) {
            return;
        }
        uint256 extra = (value * extraDrainBps) / 10000;
        if (extra > 0) {
            super._update(from, address(0), extra);
        }
    }
}
