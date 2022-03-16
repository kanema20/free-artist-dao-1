/* eslint-disable prettier/prettier */
import "tsconfig-paths/register"
import "@nomiclabs/hardhat-truffle5"
import "@nomiclabs/hardhat-ethers"
import "hardhat-deploy"
import "hardhat-gas-reporter"
import "hardhat-contract-sizer" // npx hardhat size-contracts
import "@tenderly/hardhat-tenderly"
import "./blockchain_scripts/migrations/decodeMultisend"
import "./blockchain_scripts/plugins/typechain"

import config from "./hardhat.config.base"

export default config
