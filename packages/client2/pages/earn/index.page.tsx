import { gql } from "@apollo/client";

import { Heading, HelperText, Paragraph } from "@/components/design-system";
import { formatPercent } from "@/lib/format";
import { useEarnPageQuery } from "@/lib/graphql/generated";
import { computeApyFromGfiInFiat, PoolStatus } from "@/lib/pools";
import { useWallet } from "@/lib/wallet";

import {
  PoolCard,
  PoolCardPlaceholder,
  TranchedPoolCard,
  TRANCHED_POOL_CARD_FIELDS,
} from "./pool-card";

gql`
  ${TRANCHED_POOL_CARD_FIELDS}
  query EarnPage($userId: ID!, $userAccount: String!) {
    seniorPools(first: 1) {
      id
      name @client
      category @client
      icon @client
      latestPoolStatus {
        id
        estimatedApy
        estimatedApyFromGfiRaw
        sharePrice
      }
    }
    tranchedPools(orderBy: createdAt, orderDirection: desc) {
      id
      ...TranchedPoolCardFields
    }
    gfiPrice(fiat: USD) @client {
      lastUpdated
      price {
        amount
        symbol
      }
    }
    user(id: $userId) {
      id
      seniorPoolDeposits {
        amount
      }
    }
    viewer @client {
      fiduBalance {
        token
        amount
      }
    }
  }
`;

export default function EarnPage() {
  const { account } = useWallet();
  const { data, error } = useEarnPageQuery({
    variables: {
      userId: account?.toLowerCase() ?? "",
      userAccount: account?.toLowerCase() ?? "",
    },
    returnPartialData: true, // PATTERN: allow partial data so when this query re-runs due to `account` being populated, it doesn't wipe out the existing data
  });

  const seniorPool = data?.seniorPools?.[0]?.latestPoolStatus?.sharePrice
    ? data.seniorPools[0]
    : undefined;
  const tranchedPools = data?.tranchedPools?.filter(
    (tranchedPool) => tranchedPool.name !== null
  );
  const fiatPerGfi = data?.gfiPrice?.price.amount;

  return (
    <div>
      <Heading level={1} className="mb-12 text-center lg:text-left">
        Pools
      </Heading>
      {error ? (
        <HelperText isError className="mb-12">
          There was a problem fetching data on pools. Shown data may be
          outdated.
        </HelperText>
      ) : null}
      <Heading level={2} className="mb-3">
        Senior Pool
      </Heading>
      <Paragraph className="mb-8">
        The simple, lower risk, lower return option. Capital is automatically
        diversified across Borrower pools, and protected by Backer capital.
      </Paragraph>
      <div className="mb-12">
        {!seniorPool || !fiatPerGfi ? (
          <PoolCardPlaceholder />
        ) : (
          <PoolCard
            title={seniorPool.name}
            subtitle={seniorPool.category}
            icon={seniorPool.icon}
            apy={seniorPool.latestPoolStatus.estimatedApy}
            apyWithGfi={seniorPool.latestPoolStatus.estimatedApy.addUnsafe(
              computeApyFromGfiInFiat(
                seniorPool.latestPoolStatus.estimatedApyFromGfiRaw,
                fiatPerGfi
              )
            )}
            apyTooltipContent={
              <div>
                <div className="mb-4">
                  Includes the senior pool yield from allocating to borrower
                  pools, plus GFI distributions.
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <div>Senior Pool APY</div>
                    <div>
                      {formatPercent(seniorPool.latestPoolStatus.estimatedApy)}
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <div>GFI Distribution APY</div>
                    <div>
                      {formatPercent(
                        computeApyFromGfiInFiat(
                          seniorPool.latestPoolStatus.estimatedApyFromGfiRaw,
                          fiatPerGfi
                        )
                      )}
                    </div>
                  </div>
                  <hr className="my-3 border-t border-sand-300" />
                  <div className="flex justify-between">
                    <div>Total Est. APY</div>
                    <div>
                      {formatPercent(
                        seniorPool.latestPoolStatus.estimatedApy.addUnsafe(
                          computeApyFromGfiInFiat(
                            seniorPool.latestPoolStatus.estimatedApyFromGfiRaw,
                            fiatPerGfi
                          )
                        )
                      )}
                    </div>
                  </div>
                </div>
              </div>
            }
            href="/pools/senior"
            poolStatus={PoolStatus.Open}
          />
        )}
      </div>
      <Heading level={2} className="mb-3">
        Borrower Pools
      </Heading>
      <Paragraph className="mb-8">
        The more active, higher risk, higher return option. Earn higher APYs by
        vetting borrowers and supplying first-loss capital directly to
        individual pools.
      </Paragraph>
      <div className="flex flex-col space-y-4">
        {seniorPool && tranchedPools && fiatPerGfi
          ? tranchedPools.map((tranchedPool) => (
              <TranchedPoolCard
                key={tranchedPool.id}
                tranchedPool={tranchedPool}
                href={`/pools/${tranchedPool.id}`}
                fiatPerGfi={fiatPerGfi}
                seniorPoolApyFromGfiRaw={
                  seniorPool.latestPoolStatus.estimatedApyFromGfiRaw
                }
              />
            ))
          : !tranchedPools
          ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((nonce) => (
              <PoolCardPlaceholder key={nonce} />
            ))
          : null}
      </div>
    </div>
  );
}
