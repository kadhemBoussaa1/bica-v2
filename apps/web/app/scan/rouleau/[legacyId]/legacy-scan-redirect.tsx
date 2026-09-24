"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@repo/ui/empty-state";
import { useTRPC } from "../../../trpc/client";
import styles from "../../../records/records.module.css";

/**
 * Resolves a legacy label to its reel and forwards.
 *
 * A client component because the lookup goes through tRPC with the caller's
 * own session — the legacy id means nothing without the database, and doing
 * it here keeps the redirect on the same auth path as every other read.
 * `replace` rather than `push`: the scan URL is a waypoint, and Back should
 * return to wherever the scanner was, not bounce through it again.
 */
export function LegacyScanRedirect({
  legacyId,
  loadingLabel,
}: {
  legacyId: string;
  loadingLabel: string;
}) {
  const t = useTranslations("stock");
  const trpc = useTRPC();
  const router = useRouter();

  const scanQuery = useQuery(
    trpc.stock.resolveScan.queryOptions({ code: `/scan/rouleau/${legacyId}` }),
  );

  const rollId = scanQuery.data?.id;
  useEffect(() => {
    if (rollId) router.replace(`/stock/${rollId}`);
  }, [rollId, router]);

  if (scanQuery.isError) {
    return <EmptyState title={t("receiving.notFound")} text={scanQuery.error.message} />;
  }
  return <p className={styles.muted}>{loadingLabel}</p>;
}
