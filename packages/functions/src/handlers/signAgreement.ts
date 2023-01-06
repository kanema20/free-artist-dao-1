import {Request, Response} from "@sentry/serverless/dist/gcpfunction/general"
import {getAgreements} from "../db"
import {genRequestHandler} from "../helpers"
import * as admin from "firebase-admin"

// signAgreement is used to be shared with the borrowers
export const signAgreement = genRequestHandler({
  requireAuth: "none",
  cors: true,
  handler: async (req: Request, res: Response): Promise<Response> => {
    const addressHeader = req.headers["x-goldfinch-address"]
    const address = Array.isArray(addressHeader) ? addressHeader.join("") : addressHeader
    const pool = (req.body.pool || "").trim()

    console.log("address", address)
    console.log("pool", pool)
    console.log("addressHeader", addressHeader)

    if (!address) {
      return res.status(403).send({error: "Invalid address"})
    }
    const fullName = (req.body.fullName || "").trim()

    console.log("fullName", fullName)

    if (pool === "" || fullName === "") {
      return res.status(403).send({error: "Invalid name or pool"})
    }

    const agreements = getAgreements(admin.firestore())

    console.log("agreements", agreements)

    const key = `${pool.toLowerCase()}-${address.toLowerCase()}`

    console.log("key", key)
    const agreement = await agreements.doc(key)
    console.log("agreement", agreement)

    console.log(
      await agreement.set({
        address: address,
        pool: pool,
        fullName: fullName,
        signedAt: Date.now(),
      }),
    )

    return res.status(200).send({status: "success"})
  },
})
