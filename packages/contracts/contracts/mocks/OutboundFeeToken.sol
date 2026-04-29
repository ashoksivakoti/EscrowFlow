// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Test token used to exercise the recipient-side balance-delta guard in EscrowFlowRegistry
///         (FIX N-12). Charges a fee that is taken from the recipient (i.e., the recipient receives
///         `value - fee` even though the sender is debited by `value`). The fee rate is togglable
///         via setFeeBps so the same token can be funded successfully (feeBps == 0) and then
///         enabled (feeBps > 0) just before an outbound payout, isolating the outbound check.
contract OutboundFeeToken is ERC20, Ownable {
    uint256 public feeBps;

    constructor(
        address initialOwner
    ) ERC20("Outbound Fee Token", "OFT") Ownable(initialOwner) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function setFeeBps(uint256 bps) external onlyOwner {
        feeBps = bps;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (
            from == address(0) ||
            to == address(0) ||
            value == 0 ||
            feeBps == 0
        ) {
            return;
        }
        uint256 fee = (value * feeBps) / 10000;
        if (fee > 0) {
            super._update(to, address(0), fee);
        }
    }
}
