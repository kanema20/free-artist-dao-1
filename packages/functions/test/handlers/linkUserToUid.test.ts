import chai, {expect} from "chai"
import chaiSubset from "chai-subset"
import * as admin from "firebase-admin"

chai.use(chaiSubset)
import firestore = admin.firestore
import Firestore = firestore.Firestore
import {Request} from "express"
import {
  assertNonNullable,
  presignedMintToMessage,
  presignedMintMessage,
  NonUSEntitiesList,
  USAccreditedEntitiesList,
  USAccreditedIndividualsList,
} from "@goldfinch-eng/utils"
import {mockGetBlockchain} from "../../src/helpers"
import {expectResponse} from "../utils"
import {hardhat} from "@goldfinch-eng/protocol"
import {BigNumber, Wallet} from "ethers"
import {genLinkKycWithUidDeployment} from "../../src/handlers/linkUserToUid"
import {fake} from "sinon"
import * as firebaseTesting from "@firebase/rules-unit-testing"
import {setEnvForTest, getUsers} from "../../src/db"
const {deployments, web3, ethers, upgrades} = hardhat
import UniqueIdentityDeployment from "@goldfinch-eng/protocol/deployments/mainnet/UniqueIdentity.json"
import _ from "lodash"
import {HttpsFunction} from "firebase-functions/lib/cloud-functions"
export const UniqueIdentityAbi = UniqueIdentityDeployment.abi

const setupTest = deployments.createFixture(async ({getNamedAccounts}) => {
  const {protocol_owner: uidContractOwnerAddress} = await getNamedAccounts()
  const [, mainUserAddress, otherUserAddress, mintToAddress] = (await web3.eth.getAccounts()).map((address) =>
    address.toLowerCase(),
  )
  assertNonNullable(uidContractOwnerAddress)
  assertNonNullable(mainUserAddress)
  assertNonNullable(otherUserAddress)
  assertNonNullable(mintToAddress)

  const UniqueIdentity = (await ethers.getContractFactory("TestUniqueIdentity")) as any
  const uniqueIdentity = await upgrades.deployProxy(UniqueIdentity, [
    uidContractOwnerAddress,
    "https://app.goldfinch.finance",
  ])
  await uniqueIdentity.deployed()
  return {uniqueIdentity, uidContractOwnerAddress, mainUserAddress, otherUserAddress, mintToAddress}
})

const UNIQUE_IDENTITY_SIGNER_TEST_ACCOUNT = {
  address: "0xc34461018f970d343d5a25e4Ed28C4ddE6dcCc3F",
  privateKey: "0x50f9c471e3c454b506f39536c06bde77233144784297a95d35896b3be3dfc9d8",
}

const projectId = "goldfinch-frontend-test"

const USER_DATA = {
  countryCode: "ID",
  persona: {
    id: "inq_aaaaaaaaaaaaaaaaaaaaaaaa",
    status: "approved",
  },
}

const config = {
  kyc: {allowed_origins: "http://localhost:3000"},
  persona: {allowed_ips: ""},
}

const uidType = BigNumber.from(1)
const nonce = BigNumber.from(0)
describe("linkUserToUid", () => {
  let mainUserAddress: string
  let otherUserAddress: string
  let mintToAddress: string
  let uidContractOwnerAddress: string
  let chainId: string
  let signer: any
  let testLinkKycToUid: HttpsFunction
  let uniqueIdentity: any
  let testFirestore: Firestore
  let testApp: admin.app.App
  let users: firestore.CollectionReference<firestore.DocumentData>
  let expiresAt: BigNumber
  let validMintPresigMessage: Uint8Array
  let validMintSignature: string
  let validMintToPresigMessage: Uint8Array
  let validMintToSignature: string
  let mintRequest: Request
  let mintToRequest: Request

  let currentBlockNum: number
  let currentBlockTimestamp: number

  let mainUser: Record<string, unknown>

  const expectSuccessfulMint = async (fromAddress: string) => {
    const startedAt = Date.now()
    const presigMintMessage = presignedMintMessage(
      fromAddress,
      uidType,
      expiresAt,
      uniqueIdentity.address,
      BigNumber.from(0),
      parseInt(chainId),
    )
    const mintSig = await signer.signMessage(presigMintMessage)
    const mintRequest = {
      body: {msgSender: fromAddress, uidType, expiresAt, nonce},
      headers: {
        "x-goldfinch-address": UNIQUE_IDENTITY_SIGNER_TEST_ACCOUNT.address,
        "x-goldfinch-signature": mintSig,
        "x-goldfinch-signature-block-num": currentBlockNum,
        "x-goldfinch-signature-plaintext": presigMintMessage.toString(),
      },
    } as unknown as Request
    await testLinkKycToUid(
      mintRequest,
      expectResponse(200, {
        status: "success",
        message: `User's address ${fromAddress} is linked to the ${fromAddress} UID recipient address.`,
      }),
    )
    const endedAt = Date.now()
    const userDoc = await users.doc(fromAddress).get()
    expect(userDoc.exists).to.be.true
    expect(userDoc.data()).to.containSubset({
      address: fromAddress,
      uidRecipientAuthorizations: {[uidType.toString()]: fromAddress},
    })
    expect(userDoc.data()?.updatedAt).to.satisfy((updatedAt: number) => updatedAt >= startedAt && updatedAt <= endedAt)
    const uidTypeRecipientAuthorizations = userDoc.data()?.uidRecipientAuthorizations
    expect(uidTypeRecipientAuthorizations[uidType.toString()]).to.eq(fromAddress)
    expect(Object.keys(uidTypeRecipientAuthorizations).length).to.eq(1)
  }

  const expectSuccessfulMintTo = async (fromAddress: string, recipientAddress: string) => {
    const startedAt = Date.now()
    const presigMintToMessage = presignedMintToMessage(
      fromAddress,
      recipientAddress,
      uidType,
      expiresAt,
      uniqueIdentity.address,
      BigNumber.from(0),
      parseInt(chainId),
    )
    const mintToSig = await signer.signMessage(presigMintToMessage)
    const mintToRequest = {
      body: {msgSender: fromAddress, mintToAddress: recipientAddress, uidType, expiresAt, nonce},
      headers: {
        "x-goldfinch-address": UNIQUE_IDENTITY_SIGNER_TEST_ACCOUNT.address,
        "x-goldfinch-signature": mintToSig,
        "x-goldfinch-signature-block-num": currentBlockNum,
        "x-goldfinch-signature-plaintext": presigMintToMessage.toString(),
      },
    } as unknown as Request

    await testLinkKycToUid(
      mintToRequest,
      expectResponse(200, {
        status: "success",
        message: `User's address ${fromAddress} is linked to the ${recipientAddress} UID recipient address.`,
      }),
    )
    const endedAt = Date.now()
    const userDoc = await users.doc(fromAddress).get()
    expect(userDoc.exists).to.be.true
    expect(userDoc.data()).to.containSubset({
      address: fromAddress,
      uidRecipientAuthorizations: {[uidType.toString()]: recipientAddress},
    })
    expect(userDoc.data()?.updatedAt).to.satisfy((updatedAt: number) => updatedAt >= startedAt && updatedAt <= endedAt)
    const uidTypeRecipientAuthorizations = userDoc.data()?.uidRecipientAuthorizations
    expect(uidTypeRecipientAuthorizations[uidType.toString()]).to.eq(recipientAddress)
    expect(Object.keys(uidTypeRecipientAuthorizations).length).to.eq(1)
  }

  beforeEach(async () => {
    ;({uniqueIdentity, mainUserAddress, uidContractOwnerAddress, otherUserAddress, mintToAddress} = await setupTest())
    signer = new Wallet(UNIQUE_IDENTITY_SIGNER_TEST_ACCOUNT.privateKey)
    const block = await web3.eth.getBlock("latest")
    currentBlockNum = block.number
    currentBlockTimestamp = block.timestamp as number

    testApp = firebaseTesting.initializeAdminApp({projectId: projectId})
    testFirestore = testApp.firestore()
    setEnvForTest(testFirestore, config)

    chainId = await hardhat.getChainId()
    testLinkKycToUid = genLinkKycWithUidDeployment({address: uniqueIdentity.address, abi: UniqueIdentityAbi})
    const mock = fake.returns(ethers.provider)
    mockGetBlockchain(mock as any)
    expiresAt = BigNumber.from(currentBlockTimestamp + 3600)
    validMintPresigMessage = presignedMintMessage(
      mainUserAddress,
      uidType,
      expiresAt,
      uniqueIdentity.address,
      BigNumber.from(0),
      parseInt(chainId),
    )
    validMintSignature = await signer.signMessage(validMintPresigMessage)
    validMintToPresigMessage = presignedMintToMessage(
      mainUserAddress,
      mintToAddress,
      uidType,
      expiresAt,
      uniqueIdentity.address,
      BigNumber.from(0),
      parseInt(chainId),
    )
    validMintToSignature = await signer.signMessage(validMintToPresigMessage)
    mintRequest = {
      body: {msgSender: mainUserAddress, uidType, expiresAt, nonce},
      headers: {
        "x-goldfinch-address": UNIQUE_IDENTITY_SIGNER_TEST_ACCOUNT.address,
        "x-goldfinch-signature": validMintSignature,
        "x-goldfinch-signature-block-num": currentBlockNum,
        "x-goldfinch-signature-plaintext": validMintPresigMessage.toString(),
      },
    } as unknown as Request
    mintToRequest = {
      body: {msgSender: mainUserAddress, mintToAddress, uidType, expiresAt, nonce},
      headers: {
        "x-goldfinch-address": UNIQUE_IDENTITY_SIGNER_TEST_ACCOUNT.address,
        "x-goldfinch-signature": validMintToSignature,
        "x-goldfinch-signature-block-num": currentBlockNum,
        "x-goldfinch-signature-plaintext": validMintToPresigMessage.toString(),
      },
    } as unknown as Request
  })

  afterEach(async () => {
    await firebaseTesting.clearFirestoreData({projectId})
  })

  context("with an existing user in firestore", () => {
    beforeEach(async () => {
      mainUser = {
        ...USER_DATA,
        address: mainUserAddress,
        updatedAt: Date.now(),
      }
      users = getUsers(testFirestore)
      await users.doc(mainUserAddress).set(mainUser)
    })

    it("links a user to a UID recipient address for a valid mintTo operation", async () => {
      await expectSuccessfulMintTo(mainUserAddress, mintToAddress)
    })

    it("links a user to a UID recipient address for a valid mint operation", async () => {
      await expectSuccessfulMint(mainUserAddress)
    })

    it("throws a 400 error when the msgSender already has a UID of tokenId linked to a different UID recipient", async () => {
      await users.doc(mainUserAddress).set({
        ...mainUser,
        uidRecipientAuthorizations: {[uidType.toString()]: otherUserAddress},
      })
      await testLinkKycToUid(
        mintToRequest,
        expectResponse(400, {
          status: "error",
          message: `Address ${mainUserAddress} has already been linked to a different UID recipient address ${otherUserAddress}`,
        }),
      )
      const userDoc = await users.doc(mainUserAddress).get()
      expect(userDoc.exists).to.be.true
      expect(userDoc.data()).to.containSubset(mainUser)
      const uidTypeRecipientAuthorizations = userDoc.data()?.uidRecipientAuthorizations
      expect(uidTypeRecipientAuthorizations[uidType.toString()]).to.eq(otherUserAddress)
      expect(Object.keys(uidTypeRecipientAuthorizations).length).to.eq(1)
    })

    it("throws a 400 error when a uidRecipient already owns a UID of tokenId", async () => {
      await uniqueIdentity._mintForTest(mintToAddress, uidType, BigNumber.from(1), web3.utils.asciiToHex(""), {
        from: uidContractOwnerAddress,
      })
      await testLinkKycToUid(
        mintToRequest,
        expectResponse(400, {
          status: "error",
          message: `UID recipient address ${mintToAddress} already owns a UID of type ${uidType}`,
        }),
      )
      await uniqueIdentity._mintForTest(mainUserAddress, uidType, BigNumber.from(1), web3.utils.asciiToHex(""), {
        from: uidContractOwnerAddress,
      })
      await testLinkKycToUid(
        mintRequest,
        expectResponse(400, {
          status: "error",
          message: `UID recipient address ${mainUserAddress} already owns a UID of type ${uidType}`,
        }),
      )
    })

    it("throws a 400 error when a msg sender already owns a UID of tokenId", async () => {
      await uniqueIdentity._mintForTest(mainUserAddress, uidType, BigNumber.from(1), web3.utils.asciiToHex(""), {
        from: uidContractOwnerAddress,
      })
      await testLinkKycToUid(
        mintRequest,
        expectResponse(400, {
          status: "error",
          message: `UID recipient address ${mainUserAddress} already owns a UID of type ${uidType}`,
        }),
      )
      await testLinkKycToUid(
        mintToRequest,
        expectResponse(400, {
          status: "error",
          message: `User with address ${mainUserAddress} already owns a UID of type ${uidType}`,
        }),
      )
    })

    it("throws a 400 error when the signature has expired", async () => {
      const modifiedRequest = mintRequest
      modifiedRequest.body.expiresAt = 0
      await testLinkKycToUid(
        modifiedRequest,
        expectResponse(400, {
          status: "error",
          message: "Signature has expired",
        }),
      )
    })

    it("throws a 401 error when an invalid presigned message was used to generate the signature", async () => {
      const modifiedRequest = mintRequest
      modifiedRequest.headers["x-goldfinch-signature-plaintext"] = "invalid presigned message"
      await testLinkKycToUid(
        modifiedRequest,
        expectResponse(401, {
          error: "Invalid address or signature.",
        }),
      )
    })
    it("throws a 401 error when another signer signed the signature in the headers", async () => {
      const modifiedRequest = mintRequest
      modifiedRequest.headers["x-goldfinch-address"] = otherUserAddress
      await testLinkKycToUid(
        modifiedRequest,
        expectResponse(401, {
          error: "Invalid address or signature.",
        }),
      )
    })
  })

  context(
    "when the user is on the parallel markets isApprovedNonUSEntity, isApprovedUSAccreditedEntity, or isApprovedUSAccreditedIndividual list",
    () => {
      const nonUSEntityUserAddress = (NonUSEntitiesList[0] as any).toLowerCase()
      const usAccreditedEntityUserAddress = (USAccreditedEntitiesList[0] as any).toLowerCase()
      const usAccreditedIndividualUserAddress = (USAccreditedIndividualsList[0] as any).toLowerCase()

      const nonUsEntityMintToAddress = "0x0000000000000000000000000000000000000004"
      const usAccreditedEntityMintToAddress = "0x0000000000000000000000000000000000000005"
      const usAccreditedIndividualMintToAddress = "0x0000000000000000000000000000000000000006"

      context("mint", () => {
        it("can successfully create a new user & add the uid recipient to the user data for a mint request", async () => {
          await expectSuccessfulMint(nonUSEntityUserAddress)
          await expectSuccessfulMint(usAccreditedEntityUserAddress)
          await expectSuccessfulMint(usAccreditedIndividualUserAddress)
        })
      })

      context("mintTo", () => {
        it("can successfully create a new user & add the uid recipient to the user data for a mintTo request", async () => {
          await expectSuccessfulMintTo(nonUSEntityUserAddress, nonUsEntityMintToAddress)
          await expectSuccessfulMintTo(usAccreditedEntityUserAddress, usAccreditedEntityMintToAddress)
          await expectSuccessfulMintTo(usAccreditedIndividualUserAddress, usAccreditedIndividualMintToAddress)
        })
      })
    },
  )

  it("throws an error when the requested user to link does not exist and the user is not on a KYC'ed user list", async () => {
    await testLinkKycToUid(
      mintRequest,
      expectResponse(404, {
        status: "error",
        message: `User with address ${mainUserAddress} not found`,
      }),
    )
  })
})
