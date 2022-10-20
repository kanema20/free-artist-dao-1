import {SeniorPool} from "@goldfinch-eng/protocol/typechain/ethers"
import {assertIsString} from "@goldfinch-eng/utils"
import {CONFIG_KEYS} from "../configKeys"
import {MINTER_ROLE, ContractDeployer, isTestEnv, getProtocolOwner, updateConfig} from "../deployHelpers"
import {DeployOpts} from "../types"

const logger = console.log

export async function deploySeniorPool(deployer: ContractDeployer, {config, fidu}: DeployOpts): Promise<SeniorPool> {
  let contractName = "SeniorPool"
  if (isTestEnv()) {
    contractName = "TestSeniorPool"
  }
  const {gf_deployer} = await deployer.getNamedAccounts()
  const protocol_owner = await getProtocolOwner()
  assertIsString(protocol_owner)
  assertIsString(gf_deployer)
  const accountant = await deployer.deployLibrary("Accountant", {from: gf_deployer, args: []})
  await new Promise((r) => setTimeout(r, 4000))
  const seniorPool = await deployer.deploy<SeniorPool>(contractName, {
    from: gf_deployer,
    proxy: {
      owner: protocol_owner,
      execute: {
        init: {
          methodName: "initialize",
          args: [protocol_owner, config.address],
        },
      },
    },
    libraries: {["Accountant"]: accountant.address},
  })
  await new Promise((r) => setTimeout(r, 4000))
  await updateConfig(config, "address", CONFIG_KEYS.SeniorPool, seniorPool.address, {logger})
  await new Promise((r) => setTimeout(r, 4000))
  await (await config.addToGoList(seniorPool.address)).wait()
  await new Promise((r) => setTimeout(r, 4000))
  if (fidu) {
    logger(`Granting minter role to ${contractName}`)
    if (!(await fidu.hasRole(MINTER_ROLE, seniorPool.address))) {
      await fidu.grantRole(MINTER_ROLE, seniorPool.address)
    }
  }
  return seniorPool
}
