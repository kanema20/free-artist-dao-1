/* global web3 */
import {asNonNullable} from "@goldfinch-eng/utils"
import {expectEvent} from "@openzeppelin/test-helpers"
import BN from "bn.js"
import hre from "hardhat"
import {FIDU_DECIMALS, interestAprAsBN, OWNER_ROLE, TRANCHES} from "../blockchain_scripts/deployHelpers"
import {
  CreditLineInstance,
  ERC20Instance,
  GFIInstance,
  GoldfinchConfigInstance,
  GoldfinchFactoryInstance,
  PoolTokensInstance,
  SeniorPoolInstance,
  StakingRewardsInstance,
  TranchedPoolInstance,
} from "../typechain/truffle"
import {TestBackerRewardsInstance} from "../typechain/truffle/TestBackerRewards"
import {DepositMade} from "../typechain/truffle/TranchedPool"
import {
  advanceTime,
  bigVal,
  createPoolWithCreditLine,
  decodeLogs,
  erc20Approve,
  erc20Transfer,
  expect,
  fiduToUSDC,
  getFirstLog,
  getTruffleContractAtAddress,
  SECONDS_PER_YEAR,
  usdcVal,
  USDC_DECIMALS,
  ZERO_ADDRESS,
} from "./testHelpers"
import {deployBaseFixture} from "./util/fixtures"
const GoldfinchConfig = artifacts.require("GoldfinchConfig")
const BackerRewards = artifacts.require("BackerRewards")

const decimals = new BN(String(1e18))

const {deployments} = hre
const TEST_TIMEOUT = 30_000
const LONG_TEST_TIMEOUT = 40_000

describe("BackerRewards", function () {
  this.timeout(TEST_TIMEOUT)
  let owner: string,
    borrower: string,
    investor: string,
    anotherUser: string,
    anotherAnotherUser: string,
    goldfinchFactory: GoldfinchFactoryInstance,
    goldfinchConfig: GoldfinchConfigInstance,
    gfi: GFIInstance,
    usdc: ERC20Instance,
    backerRewards: TestBackerRewardsInstance,
    seniorPool: SeniorPoolInstance,
    stakingRewards: StakingRewardsInstance,
    tranchedPool: TranchedPoolInstance,
    creditLine: CreditLineInstance,
    poolTokens: PoolTokensInstance

  const withPoolSender = async (func, otherPoolAddress?) => {
    // We need to fake the address so we can bypass the pool
    await backerRewards._setSender(otherPoolAddress || tranchedPool.address)
    return func().then(async (res) => {
      await backerRewards._setSender("0x0000000000000000000000000000000000000000")
      return res
    })
  }

  const testCalcAccRewardsPerPrincipalDollar = ({
    accRewardsPerPrincipalDollar = 0,
    interestPaymentAmount,
    maxInterestDollarsEligible,
    totalGFISupply,
    totalRewards,
    juniorTranchePrincipal,
    previousInterestReceived,
  }: {
    accRewardsPerPrincipalDollar?: number
    interestPaymentAmount: number
    maxInterestDollarsEligible: number
    totalGFISupply: number
    totalRewards: number
    juniorTranchePrincipal: number
    previousInterestReceived: number
  }) => {
    let newTotalInterest = previousInterestReceived + interestPaymentAmount
    if (newTotalInterest > maxInterestDollarsEligible) {
      newTotalInterest = maxInterestDollarsEligible
    }

    const sqrtNewTotalInterest = new BN(Math.sqrt(newTotalInterest * 10 ** 18))
    const sqrtOrigTotalInterest = new BN(Math.sqrt(previousInterestReceived * 10 ** 18))

    const percent = Math.round((totalRewards / totalGFISupply) * 100)

    const sqrtDiff = sqrtNewTotalInterest.sub(sqrtOrigTotalInterest)

    const sqrtMaxInterestDollarsEligible = new BN(Math.sqrt(maxInterestDollarsEligible * 10 ** 18))

    const testNewGrossRewards = sqrtDiff
      .mul(new BN(percent).mul(decimals))
      .div(sqrtMaxInterestDollarsEligible)
      .div(new BN(100))
      .mul(new BN(totalGFISupply))

    const testAccRewardsPerPrincipalDollar = new BN(accRewardsPerPrincipalDollar).add(
      testNewGrossRewards.mul(decimals).div(new BN(juniorTranchePrincipal).mul(decimals))
    )

    const testPoolTokenClaimableRewards = new BN(juniorTranchePrincipal)
      .mul(decimals)
      .mul(testAccRewardsPerPrincipalDollar)
      .div(decimals)

    return {testNewGrossRewards, testAccRewardsPerPrincipalDollar, testPoolTokenClaimableRewards}
  }

  const mintGFI = async (totalGFISupply = 100_000_000, from = owner) => {
    const gfiAmount = bigVal(totalGFISupply)
    await gfi.setCap(gfiAmount, {from: from})
    await gfi.mint(from, gfiAmount)
    await gfi.approve(from, gfiAmount)
  }

  const setupBackerRewardsContract = async ({
    totalGFISupply,
    maxInterestDollarsEligible,
    totalRewards,
    previousInterestReceived,
  }) => {
    await mintGFI(totalGFISupply)
    await backerRewards.setMaxInterestDollarsEligible(bigVal(maxInterestDollarsEligible))
    await backerRewards.setTotalRewards(bigVal(Math.round(totalRewards * 100)).div(new BN(100)))
    await backerRewards.setTotalInterestReceived(usdcVal(previousInterestReceived))
  }

  const testSetup = deployments.createFixture(async ({deployments, getNamedAccounts}) => {
    const [_owner, _borrower, _investor, _anotherUser, _anotherAnotherUser] = await web3.eth.getAccounts()
    const owner = asNonNullable(_owner)
    const investor = asNonNullable(_investor)
    const borrower = asNonNullable(_borrower)
    const anotherUser = asNonNullable(_anotherUser)
    const anotherAnotherUser = asNonNullable(_anotherAnotherUser)

    const {goldfinchConfig, gfi, backerRewards, seniorPool, stakingRewards, usdc, goldfinchFactory, poolTokens} =
      await deployBaseFixture()
    await goldfinchConfig.bulkAddToGoList([owner, investor, borrower, anotherUser, anotherAnotherUser])

    await erc20Transfer(usdc, [anotherUser], usdcVal(100_000), owner)
    await erc20Transfer(usdc, [anotherAnotherUser], usdcVal(100_000), owner)
    await erc20Transfer(usdc, [investor], usdcVal(100_000), owner)

    const limit = usdcVal(1_000_000)
    const interestApr = interestAprAsBN("5.00")
    const paymentPeriodInDays = new BN(30)
    const termInDays = new BN(365)
    const lateFeeApr = new BN(0)
    const juniorFeePercent = new BN(20)
    const {tranchedPool, creditLine} = await createPoolWithCreditLine({
      people: {owner, borrower},
      goldfinchFactory,
      juniorFeePercent,
      limit,
      interestApr,
      paymentPeriodInDays,
      termInDays,
      lateFeeApr,
      usdc,
    })
    return {
      owner,
      goldfinchFactory,
      borrower,
      investor,
      anotherUser,
      anotherAnotherUser,
      goldfinchConfig,
      gfi,
      backerRewards,
      tranchedPool,
      creditLine,
      seniorPool,
      stakingRewards,
      usdc,
      poolTokens,
    }
  })

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;({
      owner,
      borrower,
      investor,
      anotherUser,
      anotherAnotherUser,
      goldfinchFactory,
      goldfinchConfig,
      gfi,
      backerRewards,
      seniorPool,
      stakingRewards,
      tranchedPool,
      creditLine,
      usdc,
      poolTokens,
    } = await testSetup())
  })

  describe("initialization", () => {
    const testSetup = deployments.createFixture(async () => {
      goldfinchConfig = await GoldfinchConfig.new({from: owner})
      await goldfinchConfig.initialize(owner)

      backerRewards = (await BackerRewards.new({from: owner})) as TestBackerRewardsInstance
      await backerRewards.__initialize__(owner, goldfinchConfig.address)
    })

    beforeEach(async () => {
      await testSetup()
    })

    it("should not allow it to be called twice", async () => {
      return expect(backerRewards.__initialize__(owner, goldfinchConfig.address)).to.be.rejectedWith(
        /has already been initialized/
      )
    })

    describe("ownership", async () => {
      it("should be owned by the owner", async () => {
        expect(await backerRewards.hasRole(OWNER_ROLE, owner)).to.be.true
      })
    })
  })

  describe("setTotalRewards()", () => {
    it("emits an event", async () => {
      const totalGFISupply = 100_000_000
      const totalRewards = 1_000
      const maxInterestDollarsEligible = 1_000_000_000
      await setupBackerRewardsContract({
        totalGFISupply,
        maxInterestDollarsEligible,
        totalRewards,
        previousInterestReceived: 0,
      })
      const tx = await backerRewards.setTotalRewards(bigVal(Math.round(totalRewards * 100)).div(new BN(100)))
      expectEvent(tx, "BackerRewardsSetTotalRewards", {
        owner,
        totalRewards: bigVal(totalRewards),
        totalRewardPercentOfTotalGFI: bigVal(totalRewards).div(new BN(totalGFISupply)).mul(new BN(100)),
      })
    })
    it("properly sets totalRewards and totalRewardPercentOfTotalGFI", async () => {
      const totalGFISupply = 100_000_000
      const totalRewards = 1_000
      const maxInterestDollarsEligible = 1_000_000_000
      await setupBackerRewardsContract({
        totalGFISupply,
        maxInterestDollarsEligible,
        totalRewards,
        previousInterestReceived: 0,
      })
      expect(await backerRewards.totalRewards()).to.bignumber.equal(bigVal(totalRewards))
      expect(await backerRewards.totalRewardPercentOfTotalGFI()).to.bignumber.equal(
        bigVal(totalRewards).div(new BN(totalGFISupply)).mul(new BN(100))
      ) // 3*10^18
    })
  })

  describe("setMaxInterestDollarsEligible()", () => {
    it("emits an event", async () => {
      const maxInterestDollarsEligible = bigVal(1_000)
      const tx = await backerRewards.setMaxInterestDollarsEligible(maxInterestDollarsEligible)
      expectEvent(tx, "BackerRewardsSetMaxInterestDollarsEligible", {
        owner,
        maxInterestDollarsEligible,
      })
    })
    it("properly sets maxInterestDollarsEligible", async () => {
      const maxInterestDollarsEligible = bigVal(1_000)
      await backerRewards.setMaxInterestDollarsEligible(maxInterestDollarsEligible)
      expect(await backerRewards.maxInterestDollarsEligible()).to.bignumber.equal(maxInterestDollarsEligible)
    })
  })

  describe("setTotalInterestReceived()", () => {
    it("emits an event", async () => {
      const totalInterestReceived = usdcVal(1_000)
      const tx = await backerRewards.setTotalInterestReceived(totalInterestReceived)
      expectEvent(tx, "BackerRewardsSetTotalInterestReceived", {
        owner,
        totalInterestReceived,
      })
    })
    it("properly sets setTotalInterestReceived", async () => {
      const totalInterestReceived = usdcVal(1_000)
      await backerRewards.setTotalInterestReceived(totalInterestReceived)
      expect(await backerRewards.totalInterestReceived()).to.bignumber.equal(totalInterestReceived)
    })
  })

  describe("allocateRewards()", () => {
    context("Invalid pool address", () => {
      const interestPaymentAmount = new BN(1_000)
      it("should error", async () => {
        await expect(backerRewards.allocateRewards(interestPaymentAmount)).to.be.rejectedWith(/Invalid pool!/)
      })
    })

    context("Should not execute if interestPayment is 0", () => {
      const interestPaymentAmount = new BN(0)
      it("should be fulfilled, not error", async () => {
        await expect(withPoolSender(() => backerRewards.allocateRewards(interestPaymentAmount), tranchedPool.address))
          .to.be.fulfilled
      })
    })
  })

  describe("setPoolTokenAccRewardsPerPrincipalDollarAtMint()", () => {
    context("Invalid sender", () => {
      it("should error", async () => {
        const juniorTranchePrincipal = 100_000
        const response = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(juniorTranchePrincipal))
        const logs = decodeLogs<DepositMade>(response.receipt.rawLogs, tranchedPool, "DepositMade")
        const firstLog = getFirstLog(logs)
        const tokenId = firstLog.args.tokenId

        return expect(
          backerRewards.setPoolTokenAccRewardsPerPrincipalDollarAtMint(tranchedPool.address, tokenId)
        ).to.be.rejectedWith(/Invalid sender/)
      })
    })

    context("Invalid pool", () => {
      it("should error", async () => {
        const juniorTranchePrincipal = 100_000
        const response = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(juniorTranchePrincipal))
        const logs = decodeLogs<DepositMade>(response.receipt.rawLogs, tranchedPool, "DepositMade")
        const firstLog = getFirstLog(logs)
        const tokenId = firstLog.args.tokenId

        await expect(
          withPoolSender(
            () => backerRewards.setPoolTokenAccRewardsPerPrincipalDollarAtMint(ZERO_ADDRESS, tokenId),
            poolTokens.address
          )
        ).to.be.rejectedWith(/Invalid pool/)
      })
    })

    context("Pool address does not match token address", () => {
      it("should error", async () => {
        return expect(
          withPoolSender(
            () => backerRewards.setPoolTokenAccRewardsPerPrincipalDollarAtMint(tranchedPool.address, "0"),
            poolTokens.address
          )
        ).to.be.rejectedWith(/PoolAddress must equal PoolToken pool address/)
      })
    })

    context("Mint price has already been set", () => {
      it("should error", async () => {
        // TODO @sanjay integration test to make sure that if a accRewardsPerPrincipalDollarAtMint is not zero, it cannot be overriden again
      })
    })

    context("Successfully updates", () => {
      it("should succeed", async () => {
        // TODO @sanjay integration test to make sure that after a second drawdown, you cannot successfully set the mint price
      })
    })
  })

  describe("tranchedPool interest repayment", () => {
    // 100% repayment with all tokens distributed
    const maxRepaymentTestCases = [
      {
        juniorTranchePrincipal: 100_000,
        previousInterestReceived: 0,
        totalGFISupply: 100_000_000,
        maxInterestDollarsEligible: 100_000,
        totalRewards: 3_000_000,
        interestPaymentAmount: 5_000,
      },
      {
        juniorTranchePrincipal: 100_000,
        previousInterestReceived: 0,
        totalGFISupply: 114_285_714,
        maxInterestDollarsEligible: 100_000,
        totalRewards: 2_285_714.28,
        interestPaymentAmount: 5_000,
      },
    ]

    maxRepaymentTestCases.forEach(
      async ({
        juniorTranchePrincipal,
        previousInterestReceived,
        totalGFISupply,
        maxInterestDollarsEligible,
        totalRewards,
      }) => {
        it(`should handle a MAX 100% apy full repayment totalRewards:${totalRewards}, totalGFISupply:${totalGFISupply}`, async () => {
          await setupBackerRewardsContract({
            totalGFISupply,
            maxInterestDollarsEligible,
            totalRewards,
            previousInterestReceived,
          })
          const {tranchedPool: tranchedPoolMax} = await createPoolWithCreditLine({
            people: {owner, borrower},
            goldfinchFactory,
            juniorFeePercent: new BN(20),
            limit: usdcVal(100_000),
            interestApr: interestAprAsBN("100.00"),
            paymentPeriodInDays: new BN(30),
            termInDays: new BN(365),
            lateFeeApr: new BN(0),
            usdc,
          })
          const response = await tranchedPoolMax.deposit(TRANCHES.Junior, usdcVal(juniorTranchePrincipal))
          const logs = decodeLogs<DepositMade>(response.receipt.rawLogs, tranchedPoolMax, "DepositMade")
          const firstLog = getFirstLog(logs)
          const tokenId = firstLog.args.tokenId
          await tranchedPoolMax.lockJuniorCapital({from: borrower})
          await tranchedPoolMax.lockPool({from: borrower})
          await tranchedPoolMax.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
          await advanceTime({days: new BN(365).toNumber()})
          const payAmount = usdcVal(juniorTranchePrincipal)
          await erc20Approve(usdc, tranchedPoolMax.address, payAmount, [borrower])
          await tranchedPoolMax.pay(payAmount, {from: borrower})

          const {testPoolTokenClaimableRewards} = testCalcAccRewardsPerPrincipalDollar({
            interestPaymentAmount: juniorTranchePrincipal,
            maxInterestDollarsEligible,
            totalRewards,
            totalGFISupply,
            juniorTranchePrincipal,
            previousInterestReceived,
          })

          const expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(tokenId)
          expect(expectedPoolTokenClaimableRewards).to.bignumber.equal(testPoolTokenClaimableRewards)
        })
      }
    )

    it("should handle not allocating any rewards if backerrewards is not yet configured", async () => {
      const juniorTranchePrincipal = 100_000
      const response = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(juniorTranchePrincipal))
      const logs = decodeLogs<DepositMade>(response.receipt.rawLogs, tranchedPool, "DepositMade")
      const firstLog = getFirstLog(logs)
      const tokenId = firstLog.args.tokenId
      await tranchedPool.lockJuniorCapital({from: borrower})
      await tranchedPool.lockPool({from: borrower})
      await tranchedPool.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
      await advanceTime({days: new BN(365).toNumber()})
      const payAmount = usdcVal(juniorTranchePrincipal)
      await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
      await tranchedPool.pay(payAmount, {from: borrower})

      // verify accRewardsPerPrincipalDollar
      const accRewardsPerPrincipalDollar = await backerRewards.pools(tranchedPool.address)
      expect(accRewardsPerPrincipalDollar).to.bignumber.equal(new BN(0))

      // verify claimable rewards
      const expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(tokenId)
      expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(new BN(0))
    })

    // set a pool to $1 below it's max interest dollar limit
    // have a $5000 interest payment come in
    // expect only the last $1 of gfi rewards earned
    it("should handle interest payments that exceed maxInterestDollarsEligible", async () => {
      const maxInterestDollarsEligible = 1_000_000_000
      const totalGFISupply = 100_000_000
      const totalRewards = 3_000_000 // 3% of 100m
      const previousInterestReceived = maxInterestDollarsEligible - 1

      await setupBackerRewardsContract({
        totalGFISupply,
        maxInterestDollarsEligible,
        totalRewards,
        previousInterestReceived,
      })

      const juniorTranchePrincipal = 100_000
      const response = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(juniorTranchePrincipal))
      const logs = decodeLogs<DepositMade>(response.receipt.rawLogs, tranchedPool, "DepositMade")
      const firstLog = getFirstLog(logs)
      const tokenId = firstLog.args.tokenId
      await tranchedPool.lockJuniorCapital({from: borrower})
      await tranchedPool.lockPool({from: borrower})
      await tranchedPool.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
      await advanceTime({days: new BN(365).toNumber()})
      const payAmount = usdcVal(juniorTranchePrincipal)
      await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
      await tranchedPool.pay(payAmount, {from: borrower})

      const {testPoolTokenClaimableRewards, testAccRewardsPerPrincipalDollar} = testCalcAccRewardsPerPrincipalDollar({
        interestPaymentAmount: 5000,
        maxInterestDollarsEligible,
        totalRewards,
        totalGFISupply,
        juniorTranchePrincipal,
        previousInterestReceived,
      })

      // verify accRewardsPerPrincipalDollar
      const accRewardsPerPrincipalDollar = await backerRewards.pools(tranchedPool.address)
      expect(accRewardsPerPrincipalDollar).to.bignumber.equal(testAccRewardsPerPrincipalDollar)

      // verify pool token principal
      const {principalAmount: poolTokenPrincipalAmount} = await poolTokens.getTokenInfo(tokenId)
      expect(poolTokenPrincipalAmount).to.bignumber.eq(usdcVal(juniorTranchePrincipal))

      // verify claimable rewards
      const expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(tokenId)
      expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(testPoolTokenClaimableRewards)
    })

    // Create a pool with $100,000
    // $5,000 interest payment comes in, $4500 to jr pool
    // previous protocol total interest received is 0
    const testCases = [
      {
        juniorTranchePrincipal: 100_000,
        previousInterestReceived: 0,
        percent: 3,
        totalGFISupply: 100_000_000,
        maxInterestDollarsEligible: 1_000_000_000,
        totalRewards: 3_000_000,
        interestPaymentAmount: 5_000,
      },
      {
        juniorTranchePrincipal: 100_000,
        previousInterestReceived: 5000,
        percent: 3,
        totalGFISupply: 100_000_000,
        maxInterestDollarsEligible: 1_000_000_000,
        totalRewards: 3_000_000,
        interestPaymentAmount: 5_000,
      },
      {
        juniorTranchePrincipal: 100_000,
        previousInterestReceived: 0,
        percent: 2,
        totalGFISupply: 114_285_714,
        maxInterestDollarsEligible: 1_000_000_000,
        totalRewards: 2_285_714.28,
        interestPaymentAmount: 5_000,
      },
      {
        juniorTranchePrincipal: 100_000,
        previousInterestReceived: 5_000,
        percent: 2,
        totalGFISupply: 114_285_714,
        maxInterestDollarsEligible: 1_000_000_000,
        totalRewards: 2_285_714.28,
        interestPaymentAmount: 5_000,
      },
      {
        juniorTranchePrincipal: 100_000,
        previousInterestReceived: 150_000,
        percent: 2,
        totalGFISupply: 114_285_714,
        maxInterestDollarsEligible: 1_000_000_000,
        totalRewards: 2_285_714.28,
        interestPaymentAmount: 5_000,
      },
    ]

    testCases.forEach(
      async ({
        juniorTranchePrincipal,
        previousInterestReceived,
        totalGFISupply,
        maxInterestDollarsEligible,
        totalRewards,
        interestPaymentAmount,
      }) => {
        it(`calculate accRewardsPerPrincipalDollar for protocol interest deposits totalGFISupply:${totalGFISupply}, totalRewards:${totalRewards}, previousInterestReceived:${previousInterestReceived}`, async () => {
          await setupBackerRewardsContract({
            totalGFISupply,
            maxInterestDollarsEligible,
            totalRewards,
            previousInterestReceived,
          })
          const response = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(juniorTranchePrincipal))
          const logs = decodeLogs<DepositMade>(response.receipt.rawLogs, tranchedPool, "DepositMade")
          const firstLog = getFirstLog(logs)
          const tokenId = firstLog.args.tokenId
          await tranchedPool.lockJuniorCapital({from: borrower})
          await tranchedPool.lockPool({from: borrower})
          await tranchedPool.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
          await advanceTime({days: new BN(365).toNumber()})
          const payAmount = usdcVal(juniorTranchePrincipal)
          await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
          await tranchedPool.pay(payAmount, {from: borrower})

          const {testPoolTokenClaimableRewards, testAccRewardsPerPrincipalDollar} =
            testCalcAccRewardsPerPrincipalDollar({
              interestPaymentAmount,
              maxInterestDollarsEligible,
              totalGFISupply,
              totalRewards,
              juniorTranchePrincipal,
              previousInterestReceived,
            })

          // verify accRewardsPerPrincipalDollar
          const accRewardsPerPrincipalDollar = await backerRewards.pools(tranchedPool.address)

          expect(accRewardsPerPrincipalDollar).to.bignumber.equal(testAccRewardsPerPrincipalDollar)

          // verify pool token principal
          const {principalAmount: poolTokenPrincipalAmount} = await poolTokens.getTokenInfo(tokenId)
          expect(poolTokenPrincipalAmount).to.bignumber.eq(usdcVal(juniorTranchePrincipal))

          // verify claimable rewards
          const expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(tokenId)
          expect(expectedPoolTokenClaimableRewards).to.bignumber.equal(testPoolTokenClaimableRewards)
        })
      }
    )

    it("should increment totalInterestReceived when a interest payment comes in", async () => {
      const maxInterestDollarsEligible = 1_000_000_000
      const totalGFISupply = 100_000_000
      const totalRewards = 3_000_000 // 3% of 100m
      const previousInterestReceived = 0

      await setupBackerRewardsContract({
        totalGFISupply,
        maxInterestDollarsEligible,
        totalRewards,
        previousInterestReceived,
      })
      const juniorTranchePrincipal = 100_000
      const totalInterestReceived = 0

      expect(await backerRewards.totalInterestReceived()).to.bignumber.equal(new BN(totalInterestReceived))
      await backerRewards.setTotalInterestReceived(fiduToUSDC(totalInterestReceived))
      expect(await backerRewards.totalInterestReceived()).to.bignumber.equal(fiduToUSDC(totalInterestReceived))

      await tranchedPool.deposit(TRANCHES.Junior, usdcVal(juniorTranchePrincipal))
      await tranchedPool.lockJuniorCapital({from: borrower})
      await tranchedPool.lockPool({from: borrower})
      await tranchedPool.drawdown(usdcVal(100_000), {from: borrower})
      await advanceTime({days: new BN(365).toNumber()})
      const payAmount = usdcVal(100_000)
      await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])

      await tranchedPool.pay(payAmount, {from: borrower})
      expect(await backerRewards.totalInterestReceived()).to.bignumber.equal(new BN(100_000 * 0.05 * 10 ** 6)) // 5% interest
    })

    context("All rewards exhausted", () => {
      // put the interest received at 999_999_999
      it("should succeed when maxInterestDollarsEligible-1", async () => {
        const maxInterestDollarsEligible = 1_000_000_000
        const totalRewards = 3_000_000 // 3% of 100m
        await mintGFI(totalRewards)
        const totalInterestReceived = maxInterestDollarsEligible - 1
        const juniorTranchePrincipal = 100_000
        await backerRewards.setTotalInterestReceived(fiduToUSDC(totalInterestReceived))
        await tranchedPool.deposit(TRANCHES.Junior, usdcVal(juniorTranchePrincipal))
        await tranchedPool.lockJuniorCapital({from: borrower})
        await tranchedPool.lockPool({from: borrower})
        await tranchedPool.drawdown(usdcVal(20), {from: borrower})
        await advanceTime({days: new BN(365).toNumber()})
        const payAmount = usdcVal(20)
        await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
        await expect(tranchedPool.pay(payAmount, {from: borrower})).to.be.fulfilled

        // TODO: need to add a check to make sure only $1 of rewards got distributed
      })

      // borrow $20 for a $1 payback to push total interest received over threshold
      it("should return and make no changes when totalInterestReceived is >= maxInterestDollarsEligible", async () => {
        const maxInterestDollarsEligible = bigVal(1_000_000_000)
        await backerRewards.setMaxInterestDollarsEligible(maxInterestDollarsEligible)
        await backerRewards.setTotalInterestReceived(fiduToUSDC(maxInterestDollarsEligible))
        await tranchedPool.deposit(TRANCHES.Junior, usdcVal(100_000))
        await tranchedPool.lockJuniorCapital({from: borrower})
        await tranchedPool.lockPool({from: borrower})
        await tranchedPool.drawdown(usdcVal(20), {from: borrower})
        await advanceTime({days: new BN(365).toNumber()})
        const payAmount = usdcVal(20)
        await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])

        const beforeAccRewardsPerPrincipalDollar = await backerRewards.pools(tranchedPool.address)
        const beforeTotalInterestReceived = await backerRewards.totalInterestReceived()

        await expect(tranchedPool.pay(payAmount, {from: borrower})).to.be.fulfilled

        const afterAccRewardsPerPrincipalDollar = await backerRewards.pools(tranchedPool.address)
        const afterTotalInterestReceived = await backerRewards.totalInterestReceived()

        expect(beforeAccRewardsPerPrincipalDollar).to.bignumber.equal(afterAccRewardsPerPrincipalDollar)
        expect(beforeTotalInterestReceived).to.bignumber.equal(afterTotalInterestReceived)
      })
    })

    describe("perverse scenario regarding total junior deposits", () => {
      const previousInterestReceived = 0
      const totalGFISupply = 100_000_000
      const maxInterestDollarsEligible = 100_000
      const totalRewards = 3_000_000

      let tranchedPool: TranchedPoolInstance

      beforeEach(async () => {
        await setupBackerRewardsContract({
          totalGFISupply,
          maxInterestDollarsEligible,
          totalRewards,
          previousInterestReceived,
        })
        const created = await createPoolWithCreditLine({
          people: {owner, borrower},
          goldfinchFactory,
          juniorFeePercent: new BN(20),
          limit: usdcVal(100_000),
          interestApr: interestAprAsBN("100.00"),
          paymentPeriodInDays: new BN(30),
          termInDays: new BN(365),
          lateFeeApr: new BN(0),
          usdc,
        })
        tranchedPool = created.tranchedPool
      })

      context("total junior deposits are greater than or equal to 1", () => {
        it("should allocate some rewards", async () => {
          const juniorTranchePrincipal = usdcVal(1)

          const response = await tranchedPool.deposit(TRANCHES.Junior, juniorTranchePrincipal)
          const logs = decodeLogs<DepositMade>(response.receipt.rawLogs, tranchedPool, "DepositMade")
          const firstLog = getFirstLog(logs)
          const tokenId = firstLog.args.tokenId
          await tranchedPool.lockJuniorCapital({from: borrower})
          await tranchedPool.lockPool({from: borrower})
          await tranchedPool.drawdown(juniorTranchePrincipal, {from: borrower})
          await advanceTime({days: new BN(365).toNumber()})
          const payAmount = juniorTranchePrincipal
          await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
          await tranchedPool.pay(payAmount, {from: borrower})

          const poolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(tokenId)
          expect(poolTokenClaimableRewards.gt(new BN(0))).to.be.true
        })
      })

      context("total junior deposits are less than 1", () => {
        it("should allocate no rewards", async () => {
          const juniorTranchePrincipal = usdcVal(1).div(new BN(2))

          const response = await tranchedPool.deposit(TRANCHES.Junior, juniorTranchePrincipal)
          const logs = decodeLogs<DepositMade>(response.receipt.rawLogs, tranchedPool, "DepositMade")
          const firstLog = getFirstLog(logs)
          const tokenId = firstLog.args.tokenId
          await tranchedPool.lockJuniorCapital({from: borrower})
          await tranchedPool.lockPool({from: borrower})
          await tranchedPool.drawdown(juniorTranchePrincipal, {from: borrower})
          await advanceTime({days: new BN(365).toNumber()})
          const payAmount = juniorTranchePrincipal
          await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
          await tranchedPool.pay(payAmount, {from: borrower})

          const poolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(tokenId)
          expect(poolTokenClaimableRewards).to.bignumber.equal(new BN(0))
        })
      })
    })

    describe("perverse scenario where backer withdraws early", async () => {
      const previousInterestReceived = 0
      const totalGFISupply = 100_000_000
      const maxInterestDollarsEligible = 100_000
      const totalRewards = 3_000_000

      let tranchedPool: TranchedPoolInstance

      beforeEach(async () => {
        await setupBackerRewardsContract({
          totalGFISupply,
          maxInterestDollarsEligible,
          totalRewards,
          previousInterestReceived,
        })
        const created = await createPoolWithCreditLine({
          people: {owner, borrower},
          goldfinchFactory,
          juniorFeePercent: new BN(20),
          limit: usdcVal(100_000),
          interestApr: interestAprAsBN("100.00"),
          paymentPeriodInDays: new BN(30),
          termInDays: new BN(365),
          lateFeeApr: new BN(0),
          usdc,
        })
        tranchedPool = created.tranchedPool
      })

      context("backer withdraws before pool is locked", () => {
        it("should not give them rewards", async () => {
          const juniorTranchePrincipal = usdcVal(10000)

          // Deposit
          const response = await tranchedPool.deposit(TRANCHES.Junior, juniorTranchePrincipal)
          const logs = decodeLogs<DepositMade>(response.receipt.rawLogs, tranchedPool, "DepositMade")
          const firstLog = getFirstLog(logs)
          const tokenId = firstLog.args.tokenId

          // Withdraw before pool is locked
          await tranchedPool.withdrawMax(tokenId)

          // Some other deposit happens that funds the pool
          await tranchedPool.deposit(TRANCHES.Junior, juniorTranchePrincipal)

          // Borrower draws down and pays back
          await tranchedPool.lockJuniorCapital({from: borrower})
          await tranchedPool.lockPool({from: borrower})
          await tranchedPool.drawdown(juniorTranchePrincipal, {from: borrower})
          await advanceTime({days: new BN(365).toNumber()})
          const payAmount = juniorTranchePrincipal
          await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
          await tranchedPool.pay(payAmount, {from: borrower})

          const poolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(tokenId)
          expect(poolTokenClaimableRewards).to.bignumber.eq(new BN(0))
        })
      })
    })

    describe("perverse scenario in which borrower would drawdown interest they'd previously repaid, to get duplicative rewards from their next repayment", () => {
      // Currently the tranched pool contract does not behave exactly like one would expect for a term loan,
      // in that it allows a borrower to drawdown again principal they've previously repaid. (For a term loan, unlike a
      // revolving loan, one would expect principal not to be able to be borrowed again once repaid.)
      // This behavior does not pose a problem for the earning of backer rewards; however much interest the
      // tranched pool calculates the borrower owes, based on whatever drawdown -> repay -> drawdown -> ...
      // sequence the borrower does, will earn backer rewards.
      //
      // What we do want to want to double-check here, though, is that it's not possible for a borrower
      // to drawdown *interest* they've already repaid. If they could, that *would* be a problem, because it
      // would enable them to earn duplicative rewards on their interest payments, because the BackerRewards
      // contract maintains no understanding of how much interest in total it should give rewards for, for a
      // given pool, so the contract would have no means to "de-duplicate" such payments in its allocation
      // of rewards.

      let tranchedPool: TranchedPoolInstance
      const paymentPeriodInDays = new BN(30)

      beforeEach(async () => {
        const created = await createPoolWithCreditLine({
          people: {owner, borrower},
          goldfinchFactory,
          juniorFeePercent: new BN(20),
          limit: usdcVal(100_000),
          interestApr: interestAprAsBN("100.00"),
          paymentPeriodInDays,
          termInDays: new BN(365),
          lateFeeApr: new BN(0),
          usdc,
        })
        tranchedPool = created.tranchedPool
      })

      it("should be impossible", async () => {
        // Establish that it is impossible for the borrower to drawdown interest they'd previously repaid.
        const juniorTranchePrincipal = usdcVal(10000)
        await tranchedPool.deposit(TRANCHES.Junior, juniorTranchePrincipal)
        await tranchedPool.lockJuniorCapital({from: borrower})
        await tranchedPool.lockPool({from: borrower})

        const creditLine = await getTruffleContractAtAddress<CreditLineInstance>(
          "CreditLine",
          await tranchedPool.creditLine()
        )
        const limit = await creditLine.limit()
        expect(limit).to.bignumber.equal(juniorTranchePrincipal)

        await tranchedPool.drawdown(juniorTranchePrincipal, {from: borrower})

        const balance1 = await creditLine.balance()
        expect(balance1).to.bignumber.equal(juniorTranchePrincipal)
        const interestOwed1 = await creditLine.interestOwed()
        expect(interestOwed1).to.bignumber.equal(new BN(0))

        await advanceTime({days: paymentPeriodInDays.toNumber()})

        const interestPaymentAmount = new BN(821917808)
        const interestOwed2 = await creditLine.interestOwed()
        expect(interestOwed2).to.bignumber.equal(new BN(0))

        await tranchedPool.assess()

        const interestOwed3 = await creditLine.interestOwed()
        expect(interestOwed3).to.bignumber.equal(interestPaymentAmount)
        await erc20Approve(usdc, tranchedPool.address, interestPaymentAmount, [borrower])
        await tranchedPool.pay(interestPaymentAmount, {from: borrower})

        const interestOwed4 = await creditLine.interestOwed()
        expect(interestOwed4).to.bignumber.equal(new BN(0))

        const interestDrawdown = tranchedPool.drawdown(new BN(1), {from: borrower})
        await expect(interestDrawdown).to.be.rejectedWith(/IF/)
      })
    })
  })

  describe("poolTokenClaimableRewards()", () => {
    context("Senior-tranche pool token", () => {
      it("returns 0", async () => {
        const maxInterestDollarsEligible = 1_000_000_000
        const totalGFISupply = 100_000_000
        const totalRewards = 3_000_000 // 3% of 100m
        const previousInterestReceived = 5000

        await setupBackerRewardsContract({
          totalGFISupply,
          maxInterestDollarsEligible,
          totalRewards,
          previousInterestReceived,
        })
        const totalPrincipal = 100_000

        await backerRewards.setTotalInterestReceived(usdcVal(previousInterestReceived))

        await erc20Approve(usdc, tranchedPool.address, usdcVal(25_000), [anotherUser])
        const juniorResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(25_000), {from: anotherUser})
        const juniorLogs = decodeLogs<DepositMade>(juniorResponse.receipt.rawLogs, tranchedPool, "DepositMade")
        const firstJuniorLog = getFirstLog(juniorLogs)
        const juniorTokenId = firstJuniorLog.args.tokenId

        await erc20Approve(usdc, tranchedPool.address, usdcVal(75_000), [investor])
        const seniorRole = await tranchedPool.SENIOR_ROLE()
        await tranchedPool.grantRole(seniorRole, investor)
        const seniorResponse = await tranchedPool.deposit(TRANCHES.Senior, usdcVal(75_000), {from: investor})
        const seniorLogs = decodeLogs<DepositMade>(seniorResponse.receipt.rawLogs, tranchedPool, "DepositMade")
        const firstSeniorLog = getFirstLog(seniorLogs)
        const seniorTokenId = firstSeniorLog.args.tokenId

        await tranchedPool.lockJuniorCapital({from: borrower})
        await tranchedPool.lockPool({from: borrower})
        await tranchedPool.drawdown(usdcVal(totalPrincipal), {from: borrower})
        await advanceTime({days: new BN(365).toNumber()})
        const payAmount = usdcVal(totalPrincipal)
        await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
        await tranchedPool.pay(payAmount, {from: borrower})

        const juniorClaimable = await backerRewards.poolTokenClaimableRewards(juniorTokenId)
        expect(juniorClaimable.gt(new BN(0))).to.be.true

        const seniorClaimable = await backerRewards.poolTokenClaimableRewards(seniorTokenId)
        expect(seniorClaimable).to.bignumber.equal(new BN(0))
      })
    })

    // two users each having 50% of the pool principal
    it("Distributes 50%/50% rewards", async () => {
      const maxInterestDollarsEligible = 1_000_000_000
      const totalGFISupply = 100_000_000
      const totalRewards = 3_000_000 // 3% of 100m
      const previousInterestReceived = 5000

      await setupBackerRewardsContract({
        totalGFISupply,
        maxInterestDollarsEligible,
        totalRewards,
        previousInterestReceived,
      })
      const juniorTranchePrincipal = 100_000

      let logs, firstLog
      await backerRewards.setTotalInterestReceived(usdcVal(previousInterestReceived))

      // AnotherUser deposits 50% of $100k
      await erc20Approve(usdc, tranchedPool.address, usdcVal(50_000), [anotherUser])
      const anotherUserResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(50_000), {from: anotherUser})
      logs = decodeLogs<DepositMade>(anotherUserResponse.receipt.rawLogs, tranchedPool, "DepositMade")
      firstLog = getFirstLog(logs)
      const anotherUserTokenId = firstLog.args.tokenId

      // AnotherUser deposits 50% of $100k
      await erc20Approve(usdc, tranchedPool.address, usdcVal(50_000), [investor])
      const investorResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(50_000), {from: investor})
      logs = decodeLogs<DepositMade>(investorResponse.receipt.rawLogs, tranchedPool, "DepositMade")
      firstLog = getFirstLog(logs)
      const investorTokenId = firstLog.args.tokenId

      await tranchedPool.lockJuniorCapital({from: borrower})
      await tranchedPool.lockPool({from: borrower})
      await tranchedPool.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
      await advanceTime({days: new BN(365).toNumber()})
      const payAmount = usdcVal(juniorTranchePrincipal)
      await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
      await tranchedPool.pay(payAmount, {from: borrower})

      const {testPoolTokenClaimableRewards} = testCalcAccRewardsPerPrincipalDollar({
        interestPaymentAmount: 5000,
        maxInterestDollarsEligible: 1_000_000_000,
        totalRewards,
        totalGFISupply: 100_000_000,
        juniorTranchePrincipal,
        previousInterestReceived,
      })

      // ensure each user gets 50% of the pool
      // total rewards = 2,778.629048005770000000
      let expectedPoolTokenClaimableRewards
      expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(investorTokenId)
      expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(testPoolTokenClaimableRewards.div(new BN(2)))

      expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(anotherUserTokenId)
      expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(testPoolTokenClaimableRewards.div(new BN(2)))
    })

    // two users, one with 75k principal, the other with 25k principal
    it("Distributes 75%/25% rewards", async () => {
      const maxInterestDollarsEligible = 1_000_000_000
      const totalGFISupply = 100_000_000
      const totalRewards = 3_000_000 // 3% of 100m
      const previousInterestReceived = 5000

      await setupBackerRewardsContract({
        totalGFISupply,
        maxInterestDollarsEligible,
        totalRewards,
        previousInterestReceived,
      })
      const juniorTranchePrincipal = 100_000

      let logs, firstLog
      await backerRewards.setTotalInterestReceived(usdcVal(previousInterestReceived))

      await erc20Approve(usdc, tranchedPool.address, usdcVal(75_000), [anotherUser])
      const anotherUserResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(75_000), {from: anotherUser})
      logs = decodeLogs<DepositMade>(anotherUserResponse.receipt.rawLogs, tranchedPool, "DepositMade")
      firstLog = getFirstLog(logs)
      const anotherUserTokenId = firstLog.args.tokenId

      await erc20Approve(usdc, tranchedPool.address, usdcVal(25_000), [investor])
      const investorResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(25_000), {from: investor})
      logs = decodeLogs<DepositMade>(investorResponse.receipt.rawLogs, tranchedPool, "DepositMade")
      firstLog = getFirstLog(logs)
      const investorTokenId = firstLog.args.tokenId

      await tranchedPool.lockJuniorCapital({from: borrower})
      await tranchedPool.lockPool({from: borrower})
      await tranchedPool.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
      await advanceTime({days: new BN(365).toNumber()})
      const payAmount = usdcVal(juniorTranchePrincipal)
      await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
      await tranchedPool.pay(payAmount, {from: borrower})

      const {testPoolTokenClaimableRewards} = testCalcAccRewardsPerPrincipalDollar({
        interestPaymentAmount: 5000,
        maxInterestDollarsEligible: 1_000_000_000,
        totalRewards,
        totalGFISupply: 100_000_000,
        juniorTranchePrincipal,
        previousInterestReceived,
      })

      // investor gets 25% of the pool
      // total rewards = 2,778.629048005770000000
      let expectedPoolTokenClaimableRewards
      expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(investorTokenId)
      expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(testPoolTokenClaimableRewards.div(new BN(4)))

      // anotherUser gets 75% of pool
      expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(anotherUserTokenId)
      expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(
        testPoolTokenClaimableRewards.div(new BN(4)).mul(new BN(3))
      )
    })

    it("Distributes 1%/99% rewards", async () => {
      const maxInterestDollarsEligible = 1_000_000_000
      const totalGFISupply = 100_000_000
      const totalRewards = 3_000_000 // 3% of 100m
      const previousInterestReceived = 5000

      await setupBackerRewardsContract({
        totalGFISupply,
        maxInterestDollarsEligible,
        totalRewards,
        previousInterestReceived,
      })
      const juniorTranchePrincipal = 100_000

      let logs, firstLog
      await backerRewards.setTotalInterestReceived(usdcVal(previousInterestReceived))

      await erc20Approve(usdc, tranchedPool.address, usdcVal(99_000), [anotherUser])
      const anotherUserResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(99_000), {from: anotherUser})
      logs = decodeLogs<DepositMade>(anotherUserResponse.receipt.rawLogs, tranchedPool, "DepositMade")
      firstLog = getFirstLog(logs)
      const anotherUserTokenId = firstLog.args.tokenId

      await erc20Approve(usdc, tranchedPool.address, usdcVal(1_000), [investor])
      const investorResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(1_000), {from: investor})
      logs = decodeLogs<DepositMade>(investorResponse.receipt.rawLogs, tranchedPool, "DepositMade")
      firstLog = getFirstLog(logs)
      const investorTokenId = firstLog.args.tokenId

      await tranchedPool.lockJuniorCapital({from: borrower})
      await tranchedPool.lockPool({from: borrower})
      await tranchedPool.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
      await advanceTime({days: new BN(365).toNumber()})
      const payAmount = usdcVal(juniorTranchePrincipal)
      await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
      await tranchedPool.pay(payAmount, {from: borrower})

      const {testPoolTokenClaimableRewards} = testCalcAccRewardsPerPrincipalDollar({
        interestPaymentAmount: 5000,
        maxInterestDollarsEligible: 1_000_000_000,
        totalRewards,
        totalGFISupply: 100_000_000,
        juniorTranchePrincipal,
        previousInterestReceived,
      })

      // investor gets 1% of the pool
      let expectedPoolTokenClaimableRewards
      expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(investorTokenId)
      expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(
        testPoolTokenClaimableRewards.div(new BN(100))
      )

      // anotherUser gets 99% of pool
      expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(anotherUserTokenId)
      expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(
        testPoolTokenClaimableRewards.div(new BN(100)).mul(new BN(99))
      )
    })

    it("Distributes 33.3%/33.3%/33.3% rewards", async () => {
      const maxInterestDollarsEligible = 1_000_000_000
      const totalGFISupply = 100_000_000
      const totalRewards = 3_000_000 // 3% of 100m
      const previousInterestReceived = 5000
      const juniorTranchePrincipal = 99_999

      await setupBackerRewardsContract({
        totalGFISupply,
        maxInterestDollarsEligible,
        totalRewards,
        previousInterestReceived,
      })

      let logs, firstLog
      await backerRewards.setTotalInterestReceived(usdcVal(previousInterestReceived))

      await erc20Approve(usdc, tranchedPool.address, usdcVal(33_333), [anotherUser])
      const anotherUserResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(33_333), {from: anotherUser})
      logs = decodeLogs<DepositMade>(anotherUserResponse.receipt.rawLogs, tranchedPool, "DepositMade")
      firstLog = getFirstLog(logs)
      const anotherUserTokenId = firstLog.args.tokenId

      await erc20Approve(usdc, tranchedPool.address, usdcVal(33_333), [anotherAnotherUser])
      const anotherAnotherUserResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(33_333), {
        from: anotherAnotherUser,
      })
      logs = decodeLogs<DepositMade>(anotherAnotherUserResponse.receipt.rawLogs, tranchedPool, "DepositMade")
      firstLog = getFirstLog(logs)
      const anotherAnotherUserTokenId = firstLog.args.tokenId

      await erc20Approve(usdc, tranchedPool.address, usdcVal(33_333), [investor])
      const investorResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(33_333), {from: investor})
      logs = decodeLogs<DepositMade>(investorResponse.receipt.rawLogs, tranchedPool, "DepositMade")
      firstLog = getFirstLog(logs)
      const investorTokenId = firstLog.args.tokenId

      await tranchedPool.lockJuniorCapital({from: borrower})
      await tranchedPool.lockPool({from: borrower})
      await tranchedPool.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
      await advanceTime({days: new BN(365).toNumber()})
      const payAmount = usdcVal(juniorTranchePrincipal)
      await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
      await tranchedPool.pay(payAmount, {from: borrower})

      const {testPoolTokenClaimableRewards} = testCalcAccRewardsPerPrincipalDollar({
        interestPaymentAmount: juniorTranchePrincipal * 0.05,
        maxInterestDollarsEligible: 1_000_000_000,
        totalRewards,
        totalGFISupply: 100_000_000,
        juniorTranchePrincipal,
        previousInterestReceived,
      })

      // investor gets 33% of the pool
      let expectedPoolTokenClaimableRewards
      expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(investorTokenId)
      console.log("expectedPoolTokenClaimableRewards", expectedPoolTokenClaimableRewards.toString())
      console.log("testPoolTokenClaimableRewards", testPoolTokenClaimableRewards.toString())
      expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(testPoolTokenClaimableRewards.div(new BN(3)))

      // anotherUser gets 34% of pool
      expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(anotherUserTokenId)
      expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(testPoolTokenClaimableRewards.div(new BN(3)))

      // anotherAnotherUser gets 33% of pool
      expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(anotherAnotherUserTokenId)
      expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(testPoolTokenClaimableRewards.div(new BN(3)))
    })

    context("When tranche is oversubscribed", () => {
      it("Handles proportionately 50%/50%", async () => {
        const maxInterestDollarsEligible = 1_000_000_000
        const totalGFISupply = 100_000_000
        const totalRewards = 3_000_000 // 3% of 100m
        const previousInterestReceived = 5000

        await setupBackerRewardsContract({
          totalGFISupply,
          maxInterestDollarsEligible,
          totalRewards,
          previousInterestReceived,
        })
        const juniorTranchePrincipal = 100_000

        let logs, firstLog
        await backerRewards.setTotalInterestReceived(usdcVal(previousInterestReceived))

        await erc20Approve(usdc, tranchedPool.address, usdcVal(100_000), [anotherUser])
        const anotherUserResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(100_000), {from: anotherUser})
        logs = decodeLogs<DepositMade>(anotherUserResponse.receipt.rawLogs, tranchedPool, "DepositMade")
        firstLog = getFirstLog(logs)
        const anotherUserTokenId = firstLog.args.tokenId

        await erc20Approve(usdc, tranchedPool.address, usdcVal(100_000), [investor])
        const investorResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(100_000), {from: investor})
        logs = decodeLogs<DepositMade>(investorResponse.receipt.rawLogs, tranchedPool, "DepositMade")
        firstLog = getFirstLog(logs)
        const investorTokenId = firstLog.args.tokenId

        await tranchedPool.lockJuniorCapital({from: borrower})
        await tranchedPool.lockPool({from: borrower})
        await tranchedPool.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
        await advanceTime({days: new BN(365).toNumber()})
        const payAmount = usdcVal(juniorTranchePrincipal)
        await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
        await tranchedPool.pay(payAmount, {from: borrower})

        const {testPoolTokenClaimableRewards} = testCalcAccRewardsPerPrincipalDollar({
          interestPaymentAmount: 5000,
          maxInterestDollarsEligible: 1_000_000_000,
          totalRewards,
          totalGFISupply: 100_000_000,
          juniorTranchePrincipal,
          previousInterestReceived,
        })

        // investor gets 50% of the pool
        // total rewards = 2,778.629048005770000000
        let expectedPoolTokenClaimableRewards
        expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(investorTokenId)
        expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(
          testPoolTokenClaimableRewards.div(new BN(2))
        )

        // anotherUser gets 50% of pool
        expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(anotherUserTokenId)
        expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(
          testPoolTokenClaimableRewards.div(new BN(2))
        )
      })

      it("Handles proportionately 66%/33%", async () => {
        const maxInterestDollarsEligible = 1_000_000_000
        const totalGFISupply = 100_000_000
        const totalRewards = 3_000_000 // 3% of 100m
        const previousInterestReceived = 5000
        const juniorTranchePrincipal = 100_000

        await setupBackerRewardsContract({
          totalGFISupply,
          maxInterestDollarsEligible,
          totalRewards,
          previousInterestReceived,
        })

        let logs, firstLog
        await backerRewards.setTotalInterestReceived(usdcVal(previousInterestReceived))

        await erc20Approve(usdc, tranchedPool.address, usdcVal(100_000), [anotherUser])
        const anotherUserResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(100_000), {from: anotherUser})
        logs = decodeLogs<DepositMade>(anotherUserResponse.receipt.rawLogs, tranchedPool, "DepositMade")
        firstLog = getFirstLog(logs)
        const anotherUserTokenId = firstLog.args.tokenId

        await erc20Approve(usdc, tranchedPool.address, usdcVal(50_000), [investor])
        const investorResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(50_000), {from: investor})
        logs = decodeLogs<DepositMade>(investorResponse.receipt.rawLogs, tranchedPool, "DepositMade")
        firstLog = getFirstLog(logs)
        const investorTokenId = firstLog.args.tokenId

        await tranchedPool.lockJuniorCapital({from: borrower})
        await tranchedPool.lockPool({from: borrower})
        await tranchedPool.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
        await advanceTime({days: new BN(365).toNumber()})
        const payAmount = usdcVal(juniorTranchePrincipal)

        await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
        await tranchedPool.pay(payAmount, {from: borrower})

        const {testPoolTokenClaimableRewards} = testCalcAccRewardsPerPrincipalDollar({
          interestPaymentAmount: 5000,
          maxInterestDollarsEligible: 1_000_000_000,
          totalRewards,
          totalGFISupply: 100_000_000,
          juniorTranchePrincipal,
          previousInterestReceived,
        })

        // investor gets 33.333% of the pool
        let expectedPoolTokenClaimableRewards
        expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(investorTokenId)
        expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(
          testPoolTokenClaimableRewards.div(new BN(3))
        )

        // anotherUser gets 66.666% of pool
        expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(anotherUserTokenId)
        expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(
          testPoolTokenClaimableRewards.div(new BN(3)).mul(new BN(2))
        )
      })
    })
  })

  describe("withdraw()", () => {
    const maxInterestDollarsEligible = 1_000_000_000
    const totalGFISupply = 100_000_000
    const totalRewards = 3_000_000 // 3% of 100m
    const previousInterestReceived = 0
    const testSetup = deployments.createFixture(async () => {
      await setupBackerRewardsContract({
        totalGFISupply,
        maxInterestDollarsEligible,
        totalRewards,
        previousInterestReceived,
      })
      // transfer GFI to BackerRewards contract
      await gfi.approve(backerRewards.address, bigVal(totalRewards))
      await erc20Transfer(gfi, [backerRewards.address], bigVal(totalRewards), owner)
    })

    beforeEach(async () => {
      await testSetup()
    })

    it("validates must be owner of token", async () => {
      const previousInterestReceived = 5000
      const juniorTranchePrincipal = 100_000

      let logs, firstLog
      await backerRewards.setTotalInterestReceived(usdcVal(previousInterestReceived))

      await erc20Approve(usdc, tranchedPool.address, usdcVal(50_000), [anotherUser])
      const anotherUserResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(50_000), {from: anotherUser})
      logs = decodeLogs<DepositMade>(anotherUserResponse.receipt.rawLogs, tranchedPool, "DepositMade")
      firstLog = getFirstLog(logs)
      const anotherUserTokenId = firstLog.args.tokenId

      await erc20Approve(usdc, tranchedPool.address, usdcVal(50_000), [investor])
      const investorResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(50_000), {from: investor})
      logs = decodeLogs<DepositMade>(investorResponse.receipt.rawLogs, tranchedPool, "DepositMade")
      firstLog = getFirstLog(logs)
      const investorTokenId = firstLog.args.tokenId

      await tranchedPool.lockJuniorCapital({from: borrower})
      await tranchedPool.lockPool({from: borrower})
      await tranchedPool.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
      await advanceTime({days: new BN(365).toNumber()})
      const payAmount = usdcVal(juniorTranchePrincipal)
      await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
      await tranchedPool.pay(payAmount, {from: borrower})

      const {testPoolTokenClaimableRewards} = testCalcAccRewardsPerPrincipalDollar({
        interestPaymentAmount: 5000,
        maxInterestDollarsEligible: 1_000_000_000,
        totalRewards,
        totalGFISupply: 100_000_000,
        juniorTranchePrincipal,
        previousInterestReceived,
      })

      // ensure each user gets 50% of the pool
      // total rewards = 2,778.629048005770000000
      let expectedPoolTokenClaimableRewards
      expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(investorTokenId)
      expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(testPoolTokenClaimableRewards.div(new BN(2)))

      expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(anotherUserTokenId)
      expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(testPoolTokenClaimableRewards.div(new BN(2)))

      await expect(backerRewards.withdraw(investorTokenId, {from: anotherUser})).to.be.rejectedWith(
        /Must be owner of PoolToken/
      )
    })

    it("rejects senior-tranche token", async () => {
      const totalPrincipal = 100_000

      await backerRewards.setTotalInterestReceived(usdcVal(previousInterestReceived))

      await erc20Approve(usdc, tranchedPool.address, usdcVal(25_000), [anotherUser])
      const juniorResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(25_000), {from: anotherUser})
      const juniorLogs = decodeLogs<DepositMade>(juniorResponse.receipt.rawLogs, tranchedPool, "DepositMade")
      const firstJuniorLog = getFirstLog(juniorLogs)
      const juniorTokenId = firstJuniorLog.args.tokenId

      await erc20Approve(usdc, tranchedPool.address, usdcVal(75_000), [investor])
      const seniorRole = await tranchedPool.SENIOR_ROLE()
      await tranchedPool.grantRole(seniorRole, investor)
      const seniorResponse = await tranchedPool.deposit(TRANCHES.Senior, usdcVal(75_000), {from: investor})
      const seniorLogs = decodeLogs<DepositMade>(seniorResponse.receipt.rawLogs, tranchedPool, "DepositMade")
      const firstSeniorLog = getFirstLog(seniorLogs)
      const seniorTokenId = firstSeniorLog.args.tokenId

      await tranchedPool.lockJuniorCapital({from: borrower})
      await tranchedPool.lockPool({from: borrower})
      await tranchedPool.drawdown(usdcVal(totalPrincipal), {from: borrower})
      await advanceTime({days: new BN(365).toNumber()})
      const payAmount = usdcVal(totalPrincipal)
      await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
      await tranchedPool.pay(payAmount, {from: borrower})

      const juniorClaimable = await backerRewards.poolTokenClaimableRewards(juniorTokenId)
      expect(juniorClaimable.gt(new BN(0))).to.be.true
      expect(backerRewards.withdraw(juniorTokenId, {from: anotherUser})).to.be.fulfilled

      const seniorClaimable = await backerRewards.poolTokenClaimableRewards(seniorTokenId)
      expect(seniorClaimable).to.bignumber.equal(new BN(0))
      await expect(backerRewards.withdraw(seniorTokenId, {from: investor})).to.be.rejectedWith(
        /Ineligible senior tranche token/
      )
    })

    context("Pool is paused", () => {
      // pause the pool after payment
      it("errors Pool withdraw paused", async () => {
        const previousInterestReceived = 5000
        const juniorTranchePrincipal = 100_000

        let logs, firstLog
        await backerRewards.setTotalInterestReceived(usdcVal(previousInterestReceived))

        await erc20Approve(usdc, tranchedPool.address, usdcVal(50_000), [anotherUser])
        const anotherUserResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(50_000), {from: anotherUser})
        logs = decodeLogs<DepositMade>(anotherUserResponse.receipt.rawLogs, tranchedPool, "DepositMade")
        firstLog = getFirstLog(logs)
        const anotherUserTokenId = firstLog.args.tokenId

        await erc20Approve(usdc, tranchedPool.address, usdcVal(50_000), [investor])
        const investorResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(50_000), {from: investor})
        logs = decodeLogs<DepositMade>(investorResponse.receipt.rawLogs, tranchedPool, "DepositMade")
        firstLog = getFirstLog(logs)
        const investorTokenId = firstLog.args.tokenId

        await tranchedPool.lockJuniorCapital({from: borrower})
        await tranchedPool.lockPool({from: borrower})
        await tranchedPool.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
        await advanceTime({days: new BN(365).toNumber()})
        const payAmount = usdcVal(juniorTranchePrincipal)
        await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
        await tranchedPool.pay(payAmount, {from: borrower})
        await tranchedPool.pause()

        const {testPoolTokenClaimableRewards} = testCalcAccRewardsPerPrincipalDollar({
          interestPaymentAmount: 5000,
          maxInterestDollarsEligible: 1_000_000_000,
          totalRewards,
          totalGFISupply: 100_000_000,
          juniorTranchePrincipal,
          previousInterestReceived,
        })

        // ensure each user gets 50% of the pool
        // total rewards = 2,778.629048005770000000
        let expectedPoolTokenClaimableRewards
        expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(investorTokenId)
        expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(
          testPoolTokenClaimableRewards.div(new BN(2))
        )

        expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(anotherUserTokenId)
        expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(
          testPoolTokenClaimableRewards.div(new BN(2))
        )

        await expect(backerRewards.withdraw(investorTokenId, {from: investor})).to.be.rejectedWith(
          /Pool withdraw paused/
        )
      })
    })

    context("Invalid Token id", () => {
      // pass in a zero address to withdraw
      it("errors Pool withdraw paused", async () => {
        const previousInterestReceived = 5000
        const juniorTranchePrincipal = 100_000

        let logs, firstLog
        await backerRewards.setTotalInterestReceived(usdcVal(previousInterestReceived))

        await erc20Approve(usdc, tranchedPool.address, usdcVal(50_000), [anotherUser])
        const anotherUserResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(50_000), {from: anotherUser})
        logs = decodeLogs<DepositMade>(anotherUserResponse.receipt.rawLogs, tranchedPool, "DepositMade")
        firstLog = getFirstLog(logs)
        const anotherUserTokenId = firstLog.args.tokenId

        await erc20Approve(usdc, tranchedPool.address, usdcVal(50_000), [investor])
        const investorResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(50_000), {from: investor})
        logs = decodeLogs<DepositMade>(investorResponse.receipt.rawLogs, tranchedPool, "DepositMade")
        firstLog = getFirstLog(logs)
        const investorTokenId = firstLog.args.tokenId

        await tranchedPool.lockJuniorCapital({from: borrower})
        await tranchedPool.lockPool({from: borrower})
        await tranchedPool.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
        await advanceTime({days: new BN(365).toNumber()})
        const payAmount = usdcVal(juniorTranchePrincipal)
        await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
        await tranchedPool.pay(payAmount, {from: borrower})

        const {testPoolTokenClaimableRewards} = testCalcAccRewardsPerPrincipalDollar({
          interestPaymentAmount: 5000,
          maxInterestDollarsEligible: 1_000_000_000,
          totalRewards,
          totalGFISupply: 100_000_000,
          juniorTranchePrincipal,
          previousInterestReceived,
        })

        // ensure each user gets 50% of the pool
        // total rewards = 2,778.629048005770000000
        let expectedPoolTokenClaimableRewards
        expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(investorTokenId)
        expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(
          testPoolTokenClaimableRewards.div(new BN(2))
        )

        expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(anotherUserTokenId)
        expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(
          testPoolTokenClaimableRewards.div(new BN(2))
        )

        await expect(backerRewards.withdraw(ZERO_ADDRESS, {from: investor})).to.be.rejectedWith(/Invalid pool/)
      })
    })

    context("Updates rewardsClaimed", () => {
      it("successfully updates claimed amount and transfers gfi", async () => {
        const previousInterestReceived = 5000
        const juniorTranchePrincipal = 100_000
        let logs, firstLog
        await backerRewards.setTotalInterestReceived(usdcVal(previousInterestReceived))

        // AnotherUser deposits 50% of $100k
        await erc20Approve(usdc, tranchedPool.address, usdcVal(50_000), [anotherUser])
        const anotherUserResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(50_000), {from: anotherUser})
        logs = decodeLogs<DepositMade>(anotherUserResponse.receipt.rawLogs, tranchedPool, "DepositMade")
        firstLog = getFirstLog(logs)
        const anotherUserTokenId = firstLog.args.tokenId

        // Investor deposits 50% of $100k
        await erc20Approve(usdc, tranchedPool.address, usdcVal(50_000), [investor])
        const investorResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(50_000), {from: investor})
        logs = decodeLogs<DepositMade>(investorResponse.receipt.rawLogs, tranchedPool, "DepositMade")
        firstLog = getFirstLog(logs)
        const investorTokenId = firstLog.args.tokenId

        await tranchedPool.lockJuniorCapital({from: borrower})
        await tranchedPool.lockPool({from: borrower})
        await tranchedPool.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
        await advanceTime({days: new BN(365).toNumber()})
        const payAmount = usdcVal(juniorTranchePrincipal)
        await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
        await tranchedPool.pay(payAmount, {from: borrower})

        const {testPoolTokenClaimableRewards} = testCalcAccRewardsPerPrincipalDollar({
          interestPaymentAmount: 5000,
          maxInterestDollarsEligible,
          totalRewards,
          totalGFISupply,
          juniorTranchePrincipal,
          previousInterestReceived,
        })

        let expectedPoolTokenClaimableRewards

        // ensure each user gets 50% of the pool
        // total rewards = 2,778.629048005770000000
        expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(investorTokenId)
        expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(
          testPoolTokenClaimableRewards.div(new BN(2))
        )

        expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(anotherUserTokenId)
        expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(
          testPoolTokenClaimableRewards.div(new BN(2))
        )

        const contractGfiBalanceBefore = await gfi.balanceOf(investor)
        expect(contractGfiBalanceBefore).to.bignumber.equal(new BN(0))

        // Investor: claim all of the token
        await expect(backerRewards.withdraw(investorTokenId, {from: investor})).to.be.fulfilled
        const investorTokens = await backerRewards.tokens(investorTokenId)
        const investorRewardsClaimed = investorTokens["rewardsClaimed"]
        await expect(investorRewardsClaimed).to.bignumber.equal(testPoolTokenClaimableRewards.div(new BN(2)))
        // make sure the gfi transferred
        expect(await gfi.balanceOf(investor)).to.bignumber.equal(testPoolTokenClaimableRewards.div(new BN(2)))
        // make sure investor has no more claimable tokens
        expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(investorTokenId)
        expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(new BN("0"))

        // AnotherUser: claim all of the tokens
        await expect(backerRewards.withdraw(anotherUserTokenId, {from: anotherUser})).to.be.fulfilled
        const anotherUserTokens = await backerRewards.tokens(anotherUserTokenId)
        const anotherUserRewardsClaimed = await anotherUserTokens["rewardsClaimed"]
        expect(anotherUserRewardsClaimed).to.bignumber.equal(testPoolTokenClaimableRewards.div(new BN(2)))
        expect(await gfi.balanceOf(anotherUser)).to.bignumber.equal(testPoolTokenClaimableRewards.div(new BN(2)))
        // make sure anotherUser has no more claimable tokens
        expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(anotherUserTokenId)
        expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(new BN("0"))
      })
    })

    context("withdrawMultiple()", () => {
      it("successfully updates claimed amount and transfers gfi for multiple pooltokens", async () => {
        const previousInterestReceived = 5000
        const juniorTranchePrincipal = 100_000
        let logs, firstLog
        await backerRewards.setTotalInterestReceived(usdcVal(previousInterestReceived))

        // AnotherUser deposits 50% of $100k
        await erc20Approve(usdc, tranchedPool.address, usdcVal(50_000), [anotherUser])
        const anotherUserResponse = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(50_000), {from: anotherUser})
        logs = decodeLogs<DepositMade>(anotherUserResponse.receipt.rawLogs, tranchedPool, "DepositMade")
        firstLog = getFirstLog(logs)
        const anotherUserTokenId = firstLog.args.tokenId

        // Investor deposits 50% of $100k
        await erc20Approve(usdc, tranchedPool.address, usdcVal(50_000), [anotherUser])
        const anotherUser2 = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(50_000), {from: anotherUser})
        logs = decodeLogs<DepositMade>(anotherUser2.receipt.rawLogs, tranchedPool, "DepositMade")
        firstLog = getFirstLog(logs)
        const anotherUser2TokenId = firstLog.args.tokenId

        await tranchedPool.lockJuniorCapital({from: borrower})
        await tranchedPool.lockPool({from: borrower})
        await tranchedPool.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
        await advanceTime({days: new BN(365).toNumber()})
        const payAmount = usdcVal(juniorTranchePrincipal)
        await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
        await tranchedPool.pay(payAmount, {from: borrower})

        const {testPoolTokenClaimableRewards} = testCalcAccRewardsPerPrincipalDollar({
          interestPaymentAmount: 5000,
          maxInterestDollarsEligible,
          totalRewards,
          totalGFISupply,
          juniorTranchePrincipal,
          previousInterestReceived,
        })

        let expectedPoolTokenClaimableRewards

        // ensure each user gets 50% of the pool
        // total rewards = 2,778.629048005770000000
        expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(anotherUser2TokenId)
        expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(
          testPoolTokenClaimableRewards.div(new BN(2))
        )

        expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(anotherUserTokenId)
        expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(
          testPoolTokenClaimableRewards.div(new BN(2))
        )

        const contractGfiBalanceBefore = await gfi.balanceOf(anotherUser)
        expect(contractGfiBalanceBefore).to.bignumber.equal(new BN(0))

        // Investor&AnotherUser: claim all of the token
        await expect(backerRewards.withdrawMultiple([anotherUser2TokenId, anotherUserTokenId], {from: anotherUser})).to
          .be.fulfilled

        // Verify AnotherUser2 got tokens properly allocated
        const anotherUser2Tokens = await backerRewards.tokens(anotherUser2TokenId)
        const investorRewardsClaimed = anotherUser2Tokens["rewardsClaimed"]
        await expect(investorRewardsClaimed).to.bignumber.equal(testPoolTokenClaimableRewards.div(new BN(2)))
        // make sure the gfi transferred
        expect(await gfi.balanceOf(anotherUser)).to.bignumber.equal(testPoolTokenClaimableRewards)
        // make sure investor has no more claimable tokens
        expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(anotherUser2TokenId)
        expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(new BN("0"))

        // Verify AnotherUser got tokens properly allocated
        const anotherUserTokens = await backerRewards.tokens(anotherUserTokenId)
        const anotherUserRewardsClaimed = await anotherUserTokens["rewardsClaimed"]
        expect(anotherUserRewardsClaimed).to.bignumber.equal(testPoolTokenClaimableRewards.div(new BN(2)))
        expect(await gfi.balanceOf(anotherUser)).to.bignumber.equal(testPoolTokenClaimableRewards)
        // make sure anotherUser has no more claimable tokens
        expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(anotherUserTokenId)
        expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(new BN("0"))
      })
    })

    // TODO @sanjay - need to test multiple drawdowns w/ mint price changing
    context("Principal share price at deposit time is not zero", () => {
      it("properly handles calculating the difference in share price and share price at mint", async () => {
        // AnotherUser deposits 100% of $100k
        // Lock the pool and pay back full amount
        // unlock pool, raise more capital
        // Investor deposits 50% of $100k
      })
    })
  })

  context("Changing rewards or total supply gfi", () => {
    it("changing total rewards or max interest dollars after interest has been received", async () => {
      const maxInterestDollarsEligible = 1_000_000_000
      const totalGFISupply = 100_000_000
      const totalRewards = 3_000_000 // 3% of 100m
      const previousInterestReceived = 0
      const juniorTranchePrincipal = 100_000

      await setupBackerRewardsContract({
        totalGFISupply,
        maxInterestDollarsEligible,
        totalRewards,
        previousInterestReceived,
      })
      let response = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(juniorTranchePrincipal))
      let logs = decodeLogs<DepositMade>(response.receipt.rawLogs, tranchedPool, "DepositMade")
      let firstLog = getFirstLog(logs)
      let tokenId = firstLog.args.tokenId
      await tranchedPool.lockJuniorCapital({from: borrower})
      await tranchedPool.lockPool({from: borrower})
      await tranchedPool.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
      await advanceTime({days: new BN(365).toNumber()})
      let payAmount = usdcVal(juniorTranchePrincipal)
      await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
      await tranchedPool.pay(payAmount, {from: borrower})

      const {testPoolTokenClaimableRewards, testAccRewardsPerPrincipalDollar} = testCalcAccRewardsPerPrincipalDollar({
        interestPaymentAmount: 5000,
        maxInterestDollarsEligible,
        totalGFISupply,
        totalRewards,
        juniorTranchePrincipal,
        previousInterestReceived,
      })

      // verify accRewardsPerPrincipalDollar
      let accRewardsPerPrincipalDollar = await backerRewards.pools(tranchedPool.address)
      expect(accRewardsPerPrincipalDollar).to.bignumber.equal(testAccRewardsPerPrincipalDollar)

      // verify pool token principal
      const {principalAmount: poolTokenPrincipalAmount} = await poolTokens.getTokenInfo(tokenId)
      expect(poolTokenPrincipalAmount).to.bignumber.eq(usdcVal(juniorTranchePrincipal))

      // verify claimable rewards
      let expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(tokenId)
      expect(expectedPoolTokenClaimableRewards).to.bignumber.equal(testPoolTokenClaimableRewards)

      // update the supply and rewards
      const newTotalGFISupply = 114_285_714
      const newTotalRewards = 2_285_714.28

      // mint new gfi.
      await gfi.setCap(bigVal(114_285_714), {from: owner})
      await gfi.mint(owner, bigVal(114_285_714 - 100_000_000))
      await gfi.approve(owner, bigVal(114_285_714 - 100_000_000))

      await backerRewards.setTotalRewards(bigVal(Math.round(newTotalRewards * 100)).div(new BN(100)))

      // make a new trancehed pool & interest payment
      const {tranchedPool: tranchedPoolMax} = await createPoolWithCreditLine({
        people: {owner, borrower},
        goldfinchFactory,
        juniorFeePercent: new BN(20),
        limit: usdcVal(100_000),
        interestApr: interestAprAsBN("100.00"),
        paymentPeriodInDays: new BN(30),
        termInDays: new BN(365),
        lateFeeApr: new BN(0),
        usdc,
      })
      response = await tranchedPoolMax.deposit(TRANCHES.Junior, usdcVal(juniorTranchePrincipal))
      logs = decodeLogs<DepositMade>(response.receipt.rawLogs, tranchedPoolMax, "DepositMade")
      firstLog = getFirstLog(logs)
      tokenId = firstLog.args.tokenId
      await tranchedPoolMax.lockJuniorCapital({from: borrower})
      await tranchedPoolMax.lockPool({from: borrower})
      await tranchedPoolMax.drawdown(usdcVal(juniorTranchePrincipal), {from: borrower})
      await advanceTime({days: new BN(365).toNumber()})
      payAmount = usdcVal(juniorTranchePrincipal)
      await erc20Approve(usdc, tranchedPoolMax.address, payAmount, [borrower])
      await tranchedPoolMax.pay(payAmount, {from: borrower})

      const {
        testPoolTokenClaimableRewards: newTestPoolTokenClaimableRewards,
        testAccRewardsPerPrincipalDollar: newTestAccRewardsPerPrincipalDollar,
      } = testCalcAccRewardsPerPrincipalDollar({
        interestPaymentAmount: 100_000,
        maxInterestDollarsEligible,
        totalGFISupply: newTotalGFISupply,
        totalRewards: newTotalRewards,
        juniorTranchePrincipal,
        previousInterestReceived: 5000,
      })

      // verify accRewardsPerPrincipalDollar
      accRewardsPerPrincipalDollar = await backerRewards.pools(tranchedPoolMax.address)
      expect(accRewardsPerPrincipalDollar).to.bignumber.equal(newTestAccRewardsPerPrincipalDollar)

      // verify claimable rewards
      expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(tokenId)
      expect(expectedPoolTokenClaimableRewards).to.bignumber.equal(newTestPoolTokenClaimableRewards)
    }).timeout(LONG_TEST_TIMEOUT)
  })

  describe("Staking-rewards-related view functions", () => {
    const maxInterestDollarsEligible = 1_000_000_000
    const totalGFISupply = 100_000_000
    const totalBackerRewards = totalGFISupply / 2
    const totalStakingRewards = totalGFISupply / 2
    const previousInterestReceived = 0

    const testSetup = deployments.createFixture(async () => {
      await setupBackerRewardsContract({
        totalGFISupply,
        maxInterestDollarsEligible,
        totalRewards: totalBackerRewards,
        previousInterestReceived,
      })

      // Transfer GFI to BackerRewards contract
      await gfi.approve(backerRewards.address, bigVal(totalBackerRewards))
      await erc20Transfer(gfi, [backerRewards.address], bigVal(totalBackerRewards), owner)

      // Configure the StakingRewards contract such that the current earn rate is non-zero.
      const targetCapacity = bigVal(1000)
      const maxRate = bigVal(2).div(new BN(100))
      const minRate = bigVal(1).div(new BN(100))
      const maxRateAtPercent = new BN(5).mul(new BN(String(1e17))) // 50%
      const minRateAtPercent = new BN(3).mul(new BN(String(1e18))) // 300%
      await stakingRewards.setRewardsParameters(targetCapacity, minRate, maxRate, minRateAtPercent, maxRateAtPercent)

      await gfi.approve(stakingRewards.address, bigVal(totalStakingRewards))
      await stakingRewards.loadRewards(bigVal(totalStakingRewards))

      await usdc.approve(stakingRewards.address, usdcVal(1000), {from: owner})
      await stakingRewards.depositAndStake(usdcVal(1000), {from: owner})
    })

    let juniorTokenId: BN
    let seniorTokenId: BN
    const totalPrincipal = 100_000
    const juniorPrincipal = usdcVal(25_000)
    let sharePrice: BN
    let currentEarnRate: BN

    beforeEach(async () => {
      await testSetup()

      const expectedCurrentEarnRate = new BN("18000000000000")
      currentEarnRate = await stakingRewards.currentEarnRatePerToken()
      expect(currentEarnRate).to.bignumber.equal(expectedCurrentEarnRate)
      const expectedSharePrice = new BN("1000000000000000000")
      sharePrice = await seniorPool.sharePrice()
      expect(sharePrice).to.bignumber.equal(expectedSharePrice)

      await backerRewards.setTotalInterestReceived(usdcVal(previousInterestReceived))

      await erc20Approve(usdc, tranchedPool.address, juniorPrincipal, [anotherUser])
      const juniorResponse = await tranchedPool.deposit(TRANCHES.Junior, juniorPrincipal, {from: anotherUser})
      const juniorLogs = decodeLogs<DepositMade>(juniorResponse.receipt.rawLogs, tranchedPool, "DepositMade")
      const firstJuniorLog = getFirstLog(juniorLogs)
      juniorTokenId = firstJuniorLog.args.tokenId

      await erc20Approve(usdc, tranchedPool.address, usdcVal(75_000), [investor])
      const seniorRole = await tranchedPool.SENIOR_ROLE()
      await tranchedPool.grantRole(seniorRole, investor)
      const seniorResponse = await tranchedPool.deposit(TRANCHES.Senior, usdcVal(75_000), {from: investor})
      const seniorLogs = decodeLogs<DepositMade>(seniorResponse.receipt.rawLogs, tranchedPool, "DepositMade")
      const firstSeniorLog = getFirstLog(seniorLogs)
      seniorTokenId = firstSeniorLog.args.tokenId

      await tranchedPool.lockJuniorCapital({from: borrower})
      await tranchedPool.lockPool({from: borrower})
      await tranchedPool.drawdown(usdcVal(totalPrincipal), {from: borrower})

      const payAmount = usdcVal(
        // Principal plus interest
        totalPrincipal * 1.05
      )
      await erc20Approve(usdc, tranchedPool.address, payAmount, [borrower])
      await advanceTime({toSecond: await creditLine.termEndTime()})
      await tranchedPool.pay(payAmount, {from: borrower})
    })

    describe("stakingRewardsEarnedSinceLastWithdraw", () => {
      it("Junior-tranche pool token returns non-0 as appropriate", async () => {
        const juniorStakingRewardsEarned = await backerRewards.stakingRewardsEarnedSinceLastWithdraw(juniorTokenId)
        const expectedJuniorStakingRewardsEarned = juniorPrincipal
          .mul(FIDU_DECIMALS)
          .div(USDC_DECIMALS)
          .div(sharePrice)
          .mul(currentEarnRate.mul(SECONDS_PER_YEAR))
        expect(expectedJuniorStakingRewardsEarned).to.bignumber.equal("14191200000000000000000000")
        expect(juniorStakingRewardsEarned).to.bignumber.equal(expectedJuniorStakingRewardsEarned)
      })
      it("Senior-tranched pool token returns 0", async () => {
        const seniorStakingRewardsEarned = await backerRewards.stakingRewardsEarnedSinceLastWithdraw(seniorTokenId)
        expect(seniorStakingRewardsEarned).to.bignumber.equal(new BN(0))
      })
    })

    describe("stakingRewardsClaimed", () => {
      it("Junior-tranche pool token returns non-0 as appropriate", async () => {
        const juniorStakingRewardsEarnedBefore = await backerRewards.stakingRewardsEarnedSinceLastWithdraw(
          juniorTokenId
        )
        const expectedJuniorStakingRewardsEarnedBefore = juniorPrincipal
          .mul(FIDU_DECIMALS)
          .div(USDC_DECIMALS)
          .div(sharePrice)
          .mul(currentEarnRate.mul(SECONDS_PER_YEAR))
        expect(expectedJuniorStakingRewardsEarnedBefore).to.bignumber.equal("14191200000000000000000000")
        expect(juniorStakingRewardsEarnedBefore).to.bignumber.equal(expectedJuniorStakingRewardsEarnedBefore)

        const juniorStakingRewardsClaimedBefore = await backerRewards.stakingRewardsClaimed(juniorTokenId)
        expect(juniorStakingRewardsClaimedBefore).to.bignumber.equal(new BN(0))

        await backerRewards.withdraw(juniorTokenId, {from: anotherUser})

        const juniorStakingRewardsEarnedAfter = await backerRewards.stakingRewardsEarnedSinceLastWithdraw(juniorTokenId)
        expect(juniorStakingRewardsEarnedAfter).to.bignumber.equal(new BN(0))
        const juniorStakingRewardsClaimedAfter = await backerRewards.stakingRewardsClaimed(juniorTokenId)
        expect(juniorStakingRewardsClaimedAfter).to.bignumber.equal(juniorStakingRewardsEarnedBefore)
      })
      it("Senior-tranche pool token returns 0", async () => {
        const seniorStakingRewardsClaimed = await backerRewards.stakingRewardsClaimed(seniorTokenId)
        expect(seniorStakingRewardsClaimed).to.bignumber.equal(new BN(0))
      })
    })
  })
})
