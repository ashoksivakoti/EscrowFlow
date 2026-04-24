// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Test token with address blacklist to simulate compliance blocks.
contract BlacklistStablecoin is ERC20, Ownable {
    mapping(address account => bool blacklisted) public isBlacklisted;

    constructor(address initialOwner) ERC20("Blacklist Stablecoin", "bUSD") Ownable(initialOwner) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function setBlacklisted(address account, bool blacklisted) external onlyOwner {
        isBlacklisted[account] = blacklisted;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && isBlacklisted[from]) revert("BLACKLISTED_FROM");
        if (to != address(0) && isBlacklisted[to]) revert("BLACKLISTED_TO");
        super._update(from, to, value);
    }
}
