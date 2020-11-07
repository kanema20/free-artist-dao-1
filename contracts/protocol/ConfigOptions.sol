// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

/**
 * @title ConfigOptions
 * @notice A central place for enumerating the configurable options of our GoldfinchConfig contract
 * @author Goldfinch
 */

library ConfigOptions {
  // NEVER EVER CHANGE THE ORDER OF THESE!
  // You can rename or append. But NEVER change the order.
  enum Numbers {
    TransactionLimit,
    TotalFundsLimit,
    MaxUnderwriterLimit,
    ReserveDenominator,
    WithdrawFeeDenominator,
    LatenessGracePeriod,
    LatenessMaxPeriod,
    LateFeeGracePeriodInDays
  }
  enum Addresses {
    Pool,
    CreditLineImplementation,
    CreditLineFactory,
    CreditDesk,
    Fidu,
    USDC,
    TreasuryReserve,
    ProtocolAdmin
  }

  function getNumberName(uint256 number) public pure returns (string memory) {
    Numbers numberName = Numbers(number);
    if (Numbers.TransactionLimit == numberName) {
      return "TransactionLimit";
    }
    if (Numbers.TotalFundsLimit == numberName) {
      return "TotalFundsLimit";
    }
    if (Numbers.MaxUnderwriterLimit == numberName) {
      return "MaxUnderwriterLimit";
    }
    if (Numbers.ReserveDenominator == numberName) {
      return "ReserveDenominator";
    }
    if (Numbers.WithdrawFeeDenominator == numberName) {
      return "WithdrawFeeDenominator";
    }
    if (Numbers.LatenessGracePeriod == numberName) {
      return "LatenessGracePeriod";
    }
    if (Numbers.LatenessMaxPeriod == numberName) {
      return "LatenessMaxPeriod";
    }
    if (Numbers.LateFeeGracePeriodInDays == numberName) {
      return "LateFeeGracePeriodInDays";
    }
    revert("Unknown value passed to getNumberName");
  }

  function getAddressName(uint256 addressKey) public pure returns (string memory) {
    Addresses addressName = Addresses(addressKey);
    if (Addresses.Pool == addressName) {
      return "Pool";
    }
    if (Addresses.CreditLineImplementation == addressName) {
      return "CreditLineImplementation";
    }
    if (Addresses.CreditLineFactory == addressName) {
      return "CreditLineFactory";
    }
    if (Addresses.CreditDesk == addressName) {
      return "CreditDesk";
    }
    if (Addresses.Fidu == addressName) {
      return "Fidu";
    }
    if (Addresses.USDC == addressName) {
      return "USDC";
    }
    if (Addresses.TreasuryReserve == addressName) {
      return "TreasuryReserve";
    }
    if (Addresses.ProtocolAdmin == addressName) {
      return "ProtocolAdmin";
    }
    revert("Unknown value passed to getAddressName");
  }
}
