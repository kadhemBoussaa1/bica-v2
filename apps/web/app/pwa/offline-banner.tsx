"use client";

import { useOffline } from "next/offline";
import { useTranslations } from "next-intl";
import { OfflineIcon } from "./pwa-icons";
import styles from "./pwa.module.css";

/**
 * "You're offline", hung under the top bar while the connection is down —
 * docs/pwa-plan.md step 7.
 *
 * `useOffline` (experimental.useOffline in next.config.js) flips on the
 * browser's `offline` event and on a failed navigation or prefetch, which
 * catches Wi-Fi with no internet behind it that `navigator.onLine` misses;
 * Next retries the blocked navigation itself once the network is back.
 *
 * The live region is always in the DOM and only its text comes and goes:
 * a region inserted already filled is not announced.
 */
export function OfflineBanner() {
  const offline = useOffline();
  const t = useTranslations("shell");
  return (
    <div className={styles.offlineSlot} role="status">
      {offline && (
        <p className={styles.offlineBanner}>
          <OfflineIcon />
          <span>{t("offline.banner")}</span>
        </p>
      )}
    </div>
  );
}
