"use client";

import Link from "next/link";
import { useCurrentUser } from "../../auth/use-auth";

/**
 * The reel page's back link. The stock list is an office screen (ADMIN in the
 * sidebar); the warehouse reaches a reel by scanning it, so its way back is
 * the scan screen. Exact role, not a rank test: PRODUCTION reaches reels from
 * an order's paper panel and keeps the list.
 */
export function RollBackLink({
  className,
  stockLabel,
  scanLabel,
}: {
  className: string | undefined;
  stockLabel: string;
  scanLabel: string;
}) {
  const { user } = useCurrentUser();
  const toScan = user?.role === "MAGASINIER";
  return (
    <Link className={className} href={toScan ? "/stock/scan" : "/stock"}>
      {toScan ? scanLabel : stockLabel}
    </Link>
  );
}
