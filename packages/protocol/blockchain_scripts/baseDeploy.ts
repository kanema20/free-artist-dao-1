import {
  OWNER_ROLE,
  MINTER_ROLE,
  isMainnetForking,
  assertIsChainId,
  ContractDeployer,
  ZAPPER_ROLE,
} from "./deployHelpers"
import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"
import {Fidu} from "../typechain/ethers"
import {Logger} from "./types"
import {assertNonNullable} from "@goldfinch-eng/utils"
import {getDeployEffects} from "./migrations/deployEffects"
import {getOrDeployUSDC} from "./baseDeploy/getOrDeployUSDC"
import {deployBorrower} from "./baseDeploy/deployBorrower"
import {deployClImplementation} from "./baseDeploy/deployClImplementation"
import {deployCommunityRewards} from "./baseDeploy/deployCommunityRewards"
import {deployFidu} from "./baseDeploy/deployFidu"
import {deployGFI} from "./baseDeploy/deployGFI"
import {deployGoldfinchFactory} from "./baseDeploy/deployGoldfinchFactory"
import {deployLPStakingRewards} from "./baseDeploy/deployLPStakingRewards"
import {deployMerkleDirectDistributor} from "./baseDeploy/deployMerkleDirectDistributor"
import {deployMerkleDistributor} from "./baseDeploy/deployMerkleDistributor"
import {deployPoolTokens} from "./baseDeploy/deployPoolTokens"
import {deploySeniorPool} from "./baseDeploy/deploySeniorPool"
import {deploySeniorPoolStrategies} from "./baseDeploy/deploySeniorPoolStrategies"
import {deployBackerRewards} from "./baseDeploy/deployBackerRewards"
import {deployConfig} from "./baseDeploy/deployConfig"
import {deployGo} from "./baseDeploy/deployGo"
import {deployUniqueIdentity} from "./baseDeploy/deployUniqueIdentity"
import {deployZapper} from "./baseDeploy/deployZapper"
import {getOrDeployFiduUSDCCurveLP} from "./baseDeploy/getorDeployFiduUSDCCurveLP"
import {deployTranchedPoolImplementationRepository} from "./baseDeploy/deployTranchedPoolImplementationRepository"

const logger: Logger = console.log

export const TOKEN_LAUNCH_TIME_IN_SECONDS = 1641920400 // Tuesday, January 11, 2022 09:00:00 AM GMT-08:00

export type Deployed<T> = {
  name: string
  contract: T
}

const baseDeploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (isMainnetForking()) {
    return
  }

  const deployEffects = await getDeployEffects()

  const {getNamedAccounts, getChainId} = hre
  const deployer = new ContractDeployer(logger, hre)
  logger("Starting deploy...")
  const {gf_deployer} = await getNamedAccounts()
  logger("Will be deploying using the gf_deployer account:", gf_deployer)

  const chainId = await getChainId()
  assertIsChainId(chainId)
  logger("Chain id is:", chainId)
  const config = await deployConfig(deployer)
  await getOrDeployUSDC(deployer, config)
  await getOrDeployFiduUSDCCurveLP(deployer, config)
  const fidu = await deployFidu(deployer, config)
  await deployPoolTokens(deployer, {config})
  await deployTranchedPoolImplementationRepository(deployer, {config, deployEffects})
  await deployTransferRestrictedVault(deployer, {config})
  await new Promise((r) => setTimeout(r, 4000))
  const pool = await deployPool(deployer, {config})
  await deployTranchedPool(deployer, {config, deployEffects})
  logger("Granting minter role to Pool")
  const seniorPool = await deploySeniorPool(deployer, {config, fidu})
  await deployBorrower(deployer, {config})
  await deploySeniorPoolStrategies(deployer, {config})
  logger("Deploying GoldfinchFactory")
  await deployGoldfinchFactory(deployer, {config})
  await deployClImplementation(deployer, {config})

  const gfi = await deployGFI(deployer, {config})
  await deployLPStakingRewards(deployer, {config, deployEffects})
  const communityRewards = await deployCommunityRewards(deployer, {config, deployEffects})
  await deployMerkleDistributor(deployer, {communityRewards, deployEffects})
  await deployMerkleDirectDistributor(deployer, {gfi, deployEffects})
  await deployMerkleDistributor(deployer, {
    communityRewards,
    deployEffects,
    contractName: "BackerMerkleDistributor",
    merkleDistributorInfoPath: process.env.BACKER_MERKLE_DISTRIBUTOR_INFO_PATH,
  })
  await deployMerkleDirectDistributor(deployer, {
    gfi,
    deployEffects,
    contractName: "BackerMerkleDirectDistributor",
    merkleDirectDistributorInfoPath: process.env.BACKER_MERKLE_DIRECT_DISTRIBUTOR_INFO_PATH,
  })

  const {protocol_owner: trustedSigner} = await deployer.getNamedAccounts()
  assertNonNullable(trustedSigner)
  const uniqueIdentity = await deployUniqueIdentity({deployer, trustedSigner, deployEffects})

  const go = await deployGo(deployer, {configAddress: config.address, uniqueIdentity, deployEffects})
  await deployBackerRewards(deployer, {configAddress: config.address, deployEffects})

  logger("deploying Zapper and granting it ZAPPER_ROLE role on SeniorPool, StakingRewards, and Go")
  const zapper = await deployZapper(deployer, {config, deployEffects})
  await seniorPool.initZapperRole({from: trustedSigner})
  await seniorPool.grantRole(ZAPPER_ROLE, zapper.address, {from: trustedSigner})
  await go.contract.initZapperRole({from: trustedSigner})
  await go.contract.grantRole(await go.contract.ZAPPER_ROLE(), zapper.address, {from: trustedSigner})

  await deployEffects.executeDeferred()
}

export async function grantOwnershipOfPoolToCreditDesk(pool: any, creditDeskAddress: any) {
  const alreadyOwnedByCreditDesk = await pool.hasRole(OWNER_ROLE, creditDeskAddress)
  if (alreadyOwnedByCreditDesk) {
    // We already did this step, so early return
    logger("Looks like Credit Desk already is the owner")
    return
  }
  logger("Adding the Credit Desk as an owner")
  const txn = await pool.grantRole(OWNER_ROLE, creditDeskAddress)
  await txn.wait()
  await new Promise((r) => setTimeout(r, 4000))
  const nowOwnedByCreditDesk = await pool.hasRole(OWNER_ROLE, creditDeskAddress)
  if (!nowOwnedByCreditDesk) {
    throw new Error(`Expected ${creditDeskAddress} to be an owner, but that is not the case`)
  }
}

export async function grantMinterRoleToPool(fidu: Fidu, pool: any) {
  if (!(await fidu.hasRole(MINTER_ROLE, pool.address))) {
    await (await fidu.grantRole(MINTER_ROLE, pool.address)).wait()
    await new Promise((r) => setTimeout(r, 4000))
  }
}

export {baseDeploy, deployBackerRewards}
