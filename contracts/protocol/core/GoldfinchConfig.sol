// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./BaseUpgradeablePausable.sol";
import "../../interfaces/IGoldfinchConfig.sol";
import "./ConfigOptions.sol";

/**
 * @title GoldfinchConfig
 * @notice This contract stores mappings of useful "protocol config state", giving a central place
 *  for all other contracts to access it. For example, the TransactionLimit, or the PoolAddress. These config vars
 *  are enumerated in the `ConfigOptions` library, and can only be changed by admins of the protocol.
 *  Note: While this inherits from BaseUpgradeablePausable, it is not deployed as an upgradeable contract (this
 *    is mostly to save gas costs of having each call go through a proxy)
 * @author Goldfinch
 */

contract GoldfinchConfig is BaseUpgradeablePausable {
  mapping(uint256 => address) public addresses;
  mapping(uint256 => uint256) public numbers;
  mapping(address => bool) public goList;

  event AddressUpdated(address owner, uint256 index, address oldValue, address newValue);
  event NumberUpdated(address owner, uint256 index, uint256 oldValue, uint256 newValue);

  event GoListed(address indexed member);
  event NoListed(address indexed member);

  bool public valuesInitialized;

  function initialize(address owner) public initializer {
    __BaseUpgradeablePausable__init(owner);
  }

  function setAddress(uint256 addressIndex, address newAddress) public onlyAdmin {
    require(addresses[addressIndex] == address(0), "Address has already been initialized");

    emit AddressUpdated(msg.sender, addressIndex, addresses[addressIndex], newAddress);
    addresses[addressIndex] = newAddress;
  }

  function setNumber(uint256 index, uint256 newNumber) public onlyAdmin {
    emit NumberUpdated(msg.sender, index, numbers[index], newNumber);
    numbers[index] = newNumber;
  }

  function setTreasuryReserve(address newTreasuryReserve) public onlyAdmin {
    uint256 key = uint256(ConfigOptions.Addresses.TreasuryReserve);
    emit AddressUpdated(msg.sender, key, addresses[key], newTreasuryReserve);
    addresses[key] = newTreasuryReserve;
  }

  function setSeniorFundStrategy(address newStrategy) public onlyAdmin {
    uint256 key = uint256(ConfigOptions.Addresses.SeniorFundStrategy);
    emit AddressUpdated(msg.sender, key, addresses[key], newStrategy);
    addresses[key] = newStrategy;
  }

  function setCreditLineImplementation(address newAddress) public onlyAdmin {
    uint256 key = uint256(ConfigOptions.Addresses.CreditLineImplementation);
    emit AddressUpdated(msg.sender, key, addresses[key], newAddress);
    addresses[key] = newAddress;
  }

  function setBorrowerImplementation(address newAddress) public onlyAdmin {
    uint256 key = uint256(ConfigOptions.Addresses.BorrowerImplementation);
    emit AddressUpdated(msg.sender, key, addresses[key], newAddress);
    addresses[key] = newAddress;
  }

  function setGoldfinchConfig(address newAddress) public onlyAdmin {
    uint256 key = uint256(ConfigOptions.Addresses.GoldfinchConfig);
    emit AddressUpdated(msg.sender, key, addresses[key], newAddress);
    addresses[key] = newAddress;
  }

  function initializeFromOtherConfig(address _initialConfig) public onlyAdmin {
    require(!valuesInitialized, "Already initailized values");
    IGoldfinchConfig initialConfig = IGoldfinchConfig(_initialConfig);
    for (uint256 i = 0; i < 7; i++) {
      setNumber(i, initialConfig.getNumber(i));
    }

    for (uint256 i = 0; i < 11; i++) {
      if (getAddress(i) == address(0)) {
        setAddress(i, initialConfig.getAddress(i));
      }
    }
    valuesInitialized = true;
  }

  /**
   * @dev Adds a user to go-list
   * @param _member address to add to go-list
   */
  function addToGoList(address _member) public onlyAdmin {
    goList[_member] = true;
    emit GoListed(_member);
  }

  /**
   * @dev removes a user from go-list
   * @param _member address to remove from go-list
   */
  function removeFromGoList(address _member) public onlyAdmin {
    goList[_member] = false;
    emit NoListed(_member);
  }

  /**
   * @dev adds many users to go-list at once
   * @param _members addresses to ad to go-list
   */
  function bulkAddToGoList(address[] calldata _members) external onlyAdmin {
    for (uint256 i = 0; i < _members.length; i++) {
      addToGoList(_members[i]);
    }
  }

  /**
   * @dev removes many users from go-list at once
   * @param _members addresses to remove from go-list
   */
  function bulkRemoveFromGoList(address[] calldata _members) external onlyAdmin {
    for (uint256 i = 0; i < _members.length; i++) {
      removeFromGoList(_members[i]);
    }
  }

  /*
    Using custom getters in case we want to change underlying implementation later,
    or add checks or validations later on.
  */
  function getAddress(uint256 index) public view returns (address) {
    return addresses[index];
  }

  function getNumber(uint256 index) public view returns (uint256) {
    return numbers[index];
  }
}
