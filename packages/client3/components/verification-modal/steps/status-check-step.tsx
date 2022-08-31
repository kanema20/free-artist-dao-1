import { gql, useApolloClient } from "@apollo/client";
import { useEffect, useState } from "react";
import { useWizard } from "react-use-wizard";

import { Spinner } from "@/components/design-system";
import {
  StatusCheckStepQuery,
  StatusCheckStepQueryVariables,
} from "@/lib/graphql/generated";
import { fetchKycStatus, getSignatureForKyc } from "@/lib/verify";
import { useWallet } from "@/lib/wallet";

import { VerificationFlowSteps } from "../step-manifest";
import { useVerificationFlowContext } from "../verification-flow-context";

const statusCheckStepQuery = gql`
  query StatusCheckStep($account: ID!) {
    user(id: $account) {
      id
      isUsEntity
      isNonUsEntity
      isUsAccreditedIndividual
      isUsNonAccreditedIndividual
      isNonUsIndividual
    }
  }
`;

export function StatusCheckStep() {
  const { goToStep } = useWizard();
  const apolloClient = useApolloClient();
  const { setSignature } = useVerificationFlowContext();
  const { account, provider } = useWallet();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!account || !provider) {
      return;
    }
    const asyncEffect = async () => {
      try {
        const { data, error } = await apolloClient.query<
          StatusCheckStepQuery,
          StatusCheckStepQueryVariables
        >({
          query: statusCheckStepQuery,
          variables: { account: account.toLowerCase() },
        });
        if (error) {
          throw error;
        }
        if (
          data.user &&
          (data.user.isUsEntity ||
            data.user.isNonUsEntity ||
            data.user.isUsAccreditedIndividual ||
            data.user.isUsNonAccreditedIndividual ||
            data.user.isNonUsIndividual)
        ) {
          goToStep(VerificationFlowSteps.AlreadyMinted);
          return;
        }

        const signature = await getSignatureForKyc(provider);
        setSignature(signature);
        const kycStatus = await fetchKycStatus(
          account,
          signature.signature,
          signature.signatureBlockNum
        );
        if (kycStatus.status === "failed") {
          goToStep(VerificationFlowSteps.Ineligible);
        } else if (kycStatus.status === "approved") {
          goToStep(VerificationFlowSteps.Mint);
        } else {
          goToStep(VerificationFlowSteps.Intro);
        }
      } catch (e) {
        setError((e as Error).message ?? "Something went wrong");
      }
    };
    asyncEffect();
  }, [account, provider, setSignature, goToStep, apolloClient]);

  return (
    <div className="flex h-full w-full grow items-center justify-center text-center">
      <div>
        <Spinner className="m-auto mb-8 block !h-16 !w-16" />
        <div>
          {error ? (
            <span className="text-clay-500">{error}</span>
          ) : !account || !provider ? (
            "You must connect your wallet to proceed"
          ) : (
            "Checking your verification status, this requires a signature"
          )}
        </div>
      </div>
    </div>
  );
}
