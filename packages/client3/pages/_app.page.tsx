import "react-toastify/dist/ReactToastify.min.css";
import "../styles/globals.css";
import { ApolloProvider } from "@apollo/client";
import type { AppProps } from "next/app";
import Head from "next/head";
import { createContext, useState } from "react";
import { ToastContainer } from "react-toastify";

import { DevToolsPanel } from "@/components/dev-tools";
import { Layout } from "@/components/layout";
import { apolloClient } from "@/lib/graphql/apollo";
import { AppWideModals } from "@/lib/state/app-wide-modals";
import { WalletProvider } from "@/lib/wallet";
import { User } from "@/types/user";

import { AppLevelSideEffects } from "./_app-side-effects";

const initialUser = {
  id: "",
  isGoListed: false,
  isUsEntity: false,
  isNonUsEntity: false,
  isUsAccreditedIndividual: false,
  isUsNonAccreditedIndividual: false,
  isNonUsIndividual: false,
};

export const UserContext = createContext<{
  user?: User;
  admin?: boolean;
  setUser?: (user: User) => void;
}>({});

export default function MyApp({ Component, pageProps }: AppProps) {
  const [user, setUser] = useState(initialUser);

  return (
    <WalletProvider>
      <ApolloProvider client={apolloClient}>
        <ToastContainer position="top-center" theme="colored" />
        <Head>
          <title>Free Artists</title>
          {/* remove this if we decide we want Google to index the app pages (unlikely) */}
          <meta name="robots" content="noindex" />
        </Head>
        <UserContext.Provider value={{ user, setUser }}>
          <Layout>
            <Component {...pageProps} />
          </Layout>
        </UserContext.Provider>

        <AppWideModals />

        {process.env.NEXT_PUBLIC_NETWORK_NAME === "localhost" ||
        process.env.NEXT_PUBLIC_NETWORK_NAME === "murmuration" ? (
          <DevToolsPanel />
        ) : null}
        <AppLevelSideEffects />
      </ApolloProvider>
    </WalletProvider>
  );
}
