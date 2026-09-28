"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "@repo/ui/dialog";
import { AddSquareIcon, ShareIcon } from "./pwa-icons";
import styles from "./pwa.module.css";

/**
 * "Add to Home Screen", step by step, for iOS — which has no install
 * prompt, so the sidebar's row and the bell's push hint open this instead.
 *
 * The note matters: the Home Screen app keeps its own cookies, apart from
 * Safari's, so the first launch asks for a sign-in again. Said up front, it
 * reads as expected rather than as a bug. Push works only in that app.
 */
export function InstallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("shell");
  const key = (icon: ReactNode) => (chunks: ReactNode) => (
    <strong className={styles.key}>
      {icon}
      {chunks}
    </strong>
  );

  return (
    <Dialog
      open={open}
      title={t("install.title")}
      confirmLabel={t("install.done")}
      onConfirm={onClose}
      onClose={onClose}
    >
      <ol className={styles.steps}>
        <li>{t.rich("install.step1", { key: key(<ShareIcon />) })}</li>
        <li>{t.rich("install.step2", { key: key(<AddSquareIcon />) })}</li>
        <li>{t.rich("install.step3", { key: key(null) })}</li>
      </ol>
      <p className={styles.note}>{t("install.note")}</p>
    </Dialog>
  );
}
