// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Test token that burns 1% on each transfer/transferFrom.
contract FeeOnTransferToken is ERC20, Ownable {
    uint256 private constant FEE_BPS = 100; // 1%

    constructor(address initialOwner) ERC20("Fee On Transfer Token", "FEE") Ownable(initialOwner) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || value == 0) {
            super._update(from, to, value);
            return;
        }

        uint256 fee = value / 100;
        uint256 sendAmount = value - fee;
        if (fee > 0) {
            super._update(from, address(0), fee);
        }
        super._update(from, to, sendAmount);
    }
}
