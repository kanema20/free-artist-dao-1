import { Button, Popover } from "@/components/design-system";
import { DESIRED_CHAIN_ID } from "@/constants";
import { openWalletModal } from "@/lib/state/actions";
import { useWallet } from "@/lib/wallet";

import { Identicon } from "../identicon";
import { WalletStatus } from "./wallet-status";

export function WalletButton() {
  const { account, error, connector } = useWallet();

  return error ? (
    <Button
      className="text-clay-500 h-10"
      iconRight="Exclamation"
      onClick={
        error.name === "ChainIdNotAllowedError"
          ? () => connector.activate(DESIRED_CHAIN_ID)
          : openWalletModal
      }
    >
      {error.name === "ChainIdNotAllowedError"
        ? "Wrong network"
        : "Wallet error"}
    </Button>
  ) : account ? (
    <Popover
      placement="bottom-end"
      content={({ close }) => <WalletStatus onWalletDisconnect={close} />}
    >
      <Button className="inline-flex h-10 items-center gap-3 !px-2 md:!px-4">
        <span className="hidden md:block">
          {account.substring(0, 6)}...{account.substring(account.length - 4)}
        </span>
        <Identicon account={account} scale={3} />
      </Button>
    </Popover>
  ) : (
    <Button className="h-10" onClick={openWalletModal}>
      Connect Wallet
    </Button>
  );
}
