import {isString} from "@goldfinch-eng/utils/src/type"
import React, {useContext} from "react"
import {AppContext} from "../App"
import {getEtherscanSubdomain} from "../ethereum/utils"

type EtherscanLinkProps = {
  classNames?: string
  children: React.ReactNode
} & (
  | {
      address: string
      txHash: undefined
    }
  | {address: undefined; txHash: string}
)

function EtherscanLink(props: EtherscanLinkProps) {
  const {network} = useContext(AppContext)
  const etherscanSubdomain = getEtherscanSubdomain(network)
  const uri = props.address ? `address/${props.address}` : `tx/${props.txHash}`

  return (
    <a
      href={`https://testnet.aurorascan.dev/${uri}`}
      target="_blank"
      rel="noopener noreferrer"
      className={props.classNames}
    >
      {props.children}
    </a>
  )
}

export default EtherscanLink
