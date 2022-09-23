import { BigNumber } from "ethers";
import { useEffect, useState } from "react";

import { KYC } from "@/components/dashboard/kyc";
import { ArtistPool } from "@/components/dashboard/my-open-pool";
import { NotConnected } from "@/components/dashboard/not-connected";
import { DashboardTotal } from "@/components/dashboard/total";
import { Heading } from "@/components/design-system";
import { useUser } from "@/hooks/user-hooks";
import { SupportedCrypto } from "@/lib/graphql/generated";
import { useWallet } from "@/lib/wallet";
import { hasUid } from "@/services/user-services";

const DummyDashboardData = {
  totalEarnedAmount: {
    amount: BigNumber.from(20000),
    token: SupportedCrypto.Usdc,
  },
  totalRaisedAmount: {
    amount: BigNumber.from(232323),
    token: SupportedCrypto.Usdc,
  },
};

const DummyDashboardDataEmpty = {
  totalEarnedAmount: {
    amount: BigNumber.from(0),
    token: SupportedCrypto.Usdc,
  },
  totalRaisedAmount: {
    amount: BigNumber.from(0),
    token: SupportedCrypto.Usdc,
  },
};

function DashBoard() {
  const [dashBoardData, setDashBoardData] = useState<
    typeof DummyDashboardDataEmpty
  >(DummyDashboardDataEmpty);

  const [isVerified, setIsVerified] = useState(false);
  const user = useUser();
  const { account } = useWallet();

  useEffect(() => {
    const isVerified = hasUid(user);
    setIsVerified(isVerified);
  }, [user]);

  if (isVerified) {
    return (
      <>
        <DashboardTotal
          totalEarnedAmount={dashBoardData.totalEarnedAmount}
          totalRaisedAmount={dashBoardData.totalRaisedAmount}
        />
        <Heading className="mt-10 mb-5 text-white" level={5}>
          My Open Pool
        </Heading>
        <ArtistPool
          isVerified={isVerified}
          onButtonClick={() => {
            //TODO: Dummy function definition below
            if (isVerified) {
              setDashBoardData(DummyDashboardData);
            } else {
              setIsVerified(true);
            }
          }}
        />
      </>
    );
  } else if (account && !isVerified) {
    return <KYC />;
  }
  return <NotConnected />;
}

export default DashBoard;
