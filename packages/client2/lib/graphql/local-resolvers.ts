import { Resolvers } from "@apollo/client";

import { getGfiContract, getUsdcContract, getUidContract } from "../contracts";
import { UIDType } from "../user";
import { getProvider } from "../wallet";
import { GfiPrice, SupportedCrypto, SupportedFiat, Viewer } from "./generated";

async function fetchCoingeckoPrice(fiat: SupportedFiat): Promise<number> {
  const key = fiat.toLowerCase();
  const coingeckoResponse = await (
    await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=goldfinch&vs_currencies=${key}`
    )
  ).json();

  if (
    !coingeckoResponse ||
    !coingeckoResponse.goldfinch ||
    !coingeckoResponse.goldfinch[key] ||
    typeof coingeckoResponse.goldfinch[key] !== "number"
  ) {
    throw new Error("Coingecko response JSON failed type guard");
  }
  return coingeckoResponse.goldfinch[key];
}

async function fetchCoinbasePrice(fiat: SupportedFiat): Promise<number> {
  const key = fiat.toUpperCase();
  const coinbaseResponse = await (
    await fetch(`https://api.coinbase.com/v2/prices/GFI-${key}/spot`)
  ).json();

  if (
    !coinbaseResponse ||
    !coinbaseResponse.data ||
    !coinbaseResponse.data.amount
  ) {
    throw new Error("Coinbase response JSON failed type guard");
  }
  return parseFloat(coinbaseResponse.data.amount);
}

async function fetchGfiPrice(fiat: SupportedFiat): Promise<number> {
  try {
    return await fetchCoingeckoPrice(fiat);
  } catch (e) {
    return await fetchCoinbasePrice(fiat);
  }
}

export const resolvers: Resolvers = {
  Query: {
    async gfiPrice(_, args: { fiat: SupportedFiat }): Promise<GfiPrice> {
      const fiat = args ? args.fiat : SupportedFiat.Usd;
      const amount = await fetchGfiPrice(fiat);
      return {
        __typename: "GfiPrice", // returning typename is very important, since this is meant to be a whole type and not just a scalar. Without this, it won't enter the cache properly as a normalized entry
        lastUpdated: Date.now(),
        price: { symbol: fiat, amount },
      };
    },
    async viewer(): Promise<Viewer | null> {
      const provider = getProvider();

      if (!provider) {
        return {
          __typename: "Viewer",
          account: null,
          gfiBalance: null,
          usdcBalance: null,
          uidBalances: null,
        };
      }

      const account = await provider.getSigner().getAddress();
      const chainId = await provider.getSigner().getChainId();

      const gfiContract = await getGfiContract(chainId, provider);
      const gfiBalance = await gfiContract.balanceOf(account);

      const usdcContract = await getUsdcContract(chainId, provider);
      const usdcBalance = await usdcContract.balanceOf(account);

      const uidContract = await getUidContract(chainId, provider);
      const uidBalances = await uidContract.balanceOfBatch(
        [account, account, account, account, account],
        [
          UIDType.NonUSIndividual,
          UIDType.USAccreditedIndividual,
          UIDType.USNonAccreditedIndividual,
          UIDType.USEntity,
          UIDType.NonUSEntity,
        ]
      );

      return {
        __typename: "Viewer",
        account,
        gfiBalance: {
          token: SupportedCrypto.Gfi,
          amount: gfiBalance,
        },
        usdcBalance: {
          token: SupportedCrypto.Usdc,
          amount: usdcBalance,
        },
        uidBalances: {
          NonUSIndividual: !uidBalances[0].isZero(),
          USAccreditedIndividual: !uidBalances[1].isZero(),
          USNonAccreditedIndividual: !uidBalances[2].isZero(),
          USEntity: !uidBalances[3].isZero(),
          NonUSEntity: !uidBalances[4].isZero(),
        },
      };
    },
  },
};
