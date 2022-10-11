import { Resolvers } from "@apollo/client";

import { getProvider } from "@/lib/wallet";

import { BlockInfo, GfiPrice, SupportedFiat, Viewer } from "../generated";

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
    throw new Error(
      `Coingecko response JSON failed type guard. Tried to get data for ${key}`
    );
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
    throw new Error(
      `Coinbase response JSON failed type guard. Tried to get data for ${key}`
    );
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

export const rootQueryResolvers: Resolvers[string] = {
  async gfiPrice(_, args: { fiat: SupportedFiat }): Promise<GfiPrice> {
    const fiat = args.fiat;
    const amount = await fetchGfiPrice(fiat);
    return {
      __typename: "GfiPrice", // returning typename is very important, since this is meant to be a whole type and not just a scalar. Without this, it won't enter the cache properly as a normalized entry
      lastUpdated: Date.now(),
      price: { __typename: "FiatAmount", symbol: fiat, amount },
    };
  },
  async viewer(): Promise<Partial<Viewer>> {
    const provider = await getProvider();
    try {
      const account = await provider.getSigner().getAddress();
      return {
        __typename: "Viewer",
        account,
      };
    } catch (e) {
      return {
        __typename: "Viewer",
        account: null,
      };
    }
  },
  async currentBlock(): Promise<BlockInfo | null> {
    const provider = await getProvider();
    const currentBlock = await provider.getBlock("latest");
    return {
      __typename: "BlockInfo",
      number: currentBlock.number,
      timestamp: currentBlock.timestamp,
    };
  },
  async curvePool() {
    return {
      __typename: "CurvePool",
    };
  },
};
