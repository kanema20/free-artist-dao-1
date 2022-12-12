import {Request, Response} from "@sentry/serverless/dist/gcpfunction/general"
import {getUsers} from "../db"
import {extractHeaderValue, genRequestHandler} from "../helpers"
import {SignatureVerificationSuccessResult} from "../types"
import * as admin from "firebase-admin"
import {
  isApprovedNonUSEntity,
  isApprovedUSAccreditedEntity,
  isApprovedUSAccreditedIndividual,
} from "@goldfinch-eng/utils"

// Top level status transitions should be => pending -> approved | failed -> golisted
// Where:
//  pending: persona verification attempted. Could be in a lot of stages here, persona is the source of truth
//  approved: Approved on persona, but not yet golisted on chain
//  failed: Failed on persona
const userStatusFromPersonaStatus = (personaStatus: string): "unknown" | "approved" | "failed" => {
  // If we don't have a status, or previous attempt expired, treat as a brand new address
  if (personaStatus === "" || personaStatus === undefined || personaStatus === "expired") {
    return "unknown"
  }
  if (personaStatus === "completed" || personaStatus === "approved") {
    return "approved"
  }
  if (personaStatus === "failed" || personaStatus === "declined") {
    return "failed"
  }
  // Treat incomplete applications as unknown for now. In order to resume correctly, we need to
  // generate a resume token via the persona API
  return "unknown"
}

export const kycStatus = genRequestHandler({
  requireAuth: "signature",
  signatureMaxAge: 60 * 60 * 24, // 1 day
  fallbackOnMissingPlaintext: true,
  cors: true,
  handler: async (
    req: Request,
    res: Response,
    verificationResult: SignatureVerificationSuccessResult,
  ): Promise<Response> => {
    // Verify plaintext matches expected plaintext to prevent the use of an arbitrary signature
    const blockNum = extractHeaderValue(req, "x-goldfinch-signature-block-num")
    console.log("blockNum", blockNum)
    const expectedPlaintext = `Sign in to Goldfinch: ${blockNum}`
    if (verificationResult.plaintext !== expectedPlaintext) {
      console.log("Plaintext mismatch", verificationResult.plaintext, expectedPlaintext)
      return res.status(401).send({error: "Unexpected signature"})
    }

    const address = verificationResult.address
    console.log("address", address)
    const payload = {address: address, status: "unknown", countryCode: null, residency: ""}
    console.log("payload", payload)

    // Respond with approved if address on any approved list
    if (
      isApprovedNonUSEntity(address) ||
      isApprovedUSAccreditedEntity(address) ||
      isApprovedUSAccreditedIndividual(address)
    ) {
      return res.status(200).send({...payload, status: "approved"})
    }

    const users = getUsers(admin.firestore())
    console.log("users", users)
    const user = await users.doc(`${address.toLowerCase()}`).get()
    console.log("user", user)

    if (user.exists) {
      payload.status = userStatusFromPersonaStatus(user.data()?.persona?.status)
      console.log("payload status", payload.status)
      payload.countryCode = user.data()?.countryCode
      console.log("payload countryCode", payload.countryCode)
      payload.residency = user.data()?.kyc?.residency
      console.log("payload residency ", payload.residency)
    }

    console.log("return", payload)

    return res.status(200).send(payload)
  },
})
