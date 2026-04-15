// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockERC20Stablecoin
 * @notice Mintable test double for stablecoin-style ERC20 (6 decimals, like USDC).
 * @dev Deploy for local Hardhat networks and integration tests. Not for production.
 */
contract MockERC20Stablecoin is ERC20, Ownable {
    uint8 private constant _STABLE_DECIMALS = 6;

    constructor(address initialOwner)
        ERC20("Mock USD Stablecoin", "mUSD")
        Ownable(initialOwner)
    {}

    function decimals() public pure override returns (uint8) {
        return _STABLE_DECIMALS;
    }

    /// @notice Mint test tokens to any address (owner-only).
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
