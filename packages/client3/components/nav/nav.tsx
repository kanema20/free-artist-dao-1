import clsx from "clsx";
import NextLink from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";

import { Link, FreeArtistsLogo, Icon } from "@/components/design-system";

import { WalletButton } from "../design-system/wallet-button/wallet-button";
import { MobileNav } from "./mobile-nav";
import { NAV_ITEMS } from "./nav-items";
import { SecondaryMenu } from "./secondary-menu";

export function Nav() {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  return (
    <>
      <div className="border-sand-100 flex flex-row border-b px-6 md:px-10">
        <div className="self-center md:hidden">
          <button className="p-1" onClick={() => setIsMobileNavOpen(true)}>
            <Icon name="Menu" size="md" />
          </button>
        </div>

        <div className="flex flex-1">
          <NextLink href="/" passHref>
            <a className="flex items-center justify-center p-3">
              <FreeArtistsLogo className="h-7 w-7" />
            </a>
          </NextLink>
        </div>

        <nav className="hidden flex-1 flex-row justify-center md:flex">
          {NAV_ITEMS.map(({ label, href }) => (
            <NavLink key={`${label}-${href}`} href={href}>
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="flex flex-1 flex-row justify-end gap-3 self-center py-4">
          <WalletButton />
          <SecondaryMenu />
        </div>
      </div>
      <MobileNav
        isOpen={isMobileNavOpen}
        onClose={() => setIsMobileNavOpen(false)}
      />
    </>
  );
}

export function NavLink({
  children,
  href,
  className,
}: {
  children: string;
  href: string;
  className?: string;
}) {
  const router = useRouter();
  const isCurrentPage = router.pathname === href;
  return (
    <Link
      className={clsx(
        "flex items-center border-b-2 px-5 text-sm font-medium !no-underline",
        isCurrentPage
          ? "border-eggplant-600 text-sand-900"
          : "text-sand-700 hover:border-eggplant-600 border-transparent",
        className
      )}
      href={href}
    >
      {children}
    </Link>
  );
}
