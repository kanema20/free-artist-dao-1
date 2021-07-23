// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";

/**
 * @title Safe ERC20 Transfer
 * @notice Reverts when transfer is not successful
 * @author Goldfinch
 */
abstract contract SafeERC20Transfer {
  function safeTransfer(
    IERC20 erc20,
    address to,
    uint256 amount,
    string memory message
  ) internal {
    require(to != address(0), "Can't send to zero address");
    bool success = erc20.transfer(to, amount);
    require(success, message);
  }

  function safeTransfer(
    IERC20 erc20,
    address to,
    uint256 amount
  ) internal {
    safeTransfer(erc20, to, amount, "Failed to transfer ERC20");
  }

  function safeTransferFrom(
    IERC20 erc20,
    address from,
    address to,
    uint256 amount,
    string memory message
  ) internal {
    require(to != address(0), "Can't send to zero address");
    bool success = erc20.transferFrom(from, to, amount);
    require(success, message);
  }

  function safeTransferFrom(
    IERC20 erc20,
    address from,
    address to,
    uint256 amount
  ) internal {
    string memory message = "Failed to transfer ERC20";
    safeTransferFrom(erc20, from, to, amount, message);
  }

  function safeApprove(
    IERC20 erc20,
    address spender,
    uint256 allowance
  ) internal {
    bool success = erc20.approve(spender, allowance);
    require(success, "Failed to approve ERC20");
  }

  function safeApprove(
    IERC20 erc20,
    address spender,
    uint256 allowance,
    string memory message
  ) internal {
    bool success = erc20.approve(spender, allowance);
    require(success, message);
  }
}
