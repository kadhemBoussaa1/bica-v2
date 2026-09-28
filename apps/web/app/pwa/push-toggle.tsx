"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import { InstallDialog } from "./install-dialog";
import { usePush } from "./use-push";
import styles from "./pwa.module.css";

/**
 * "Notifications on this device", under the bell panel's head —
 * docs/pwa-plan.md step 16. Hidden while push is off on the server and in a
 * browser that cannot do it. On an iPhone in Safari it explains that only
 * the Home Screen app can, and links to the steps.
 */
export function PushToggle({ userId }: { userId: string }) {
  const t = useTranslations("notifications");
  const { state, busy, failed, enable, disable } = usePush(userId);
  const [steps, setSteps] = useState(false);

  if (state === "hidden" || state === "unsupported") return null;

  const hint = failed
    ? t("push.failed")
    : {
        "install-first": t("push.installFirst"),
        denied: t("push.denied"),
        on: t("push.on"),
        off: t("push.off"),
      }[state];

  return (
    <div className={styles.pushRow}>
      <span className={styles.pushText}>
        <span className={styles.pushLabel}>{t("push.row")}</span>
        {hint && (
          <span className={failed ? styles.pushHintError : styles.pushHint} role={failed ? "alert" : undefined}>
            {hint}
          </span>
        )}
      </span>
      {state === "install-first" ? (
        <>
          <Button size="dense" variant="secondary" onClick={() => setSteps(true)}>
            {t("push.installHow")}
          </Button>
          <InstallDialog open={steps} onClose={() => setSteps(false)} />
        </>
      ) : state === "on" ? (
        <Button size="dense" variant="secondary" busy={busy} onClick={() => void disable()}>
          {t("push.turnOff")}
        </Button>
      ) : state === "off" ? (
        <Button size="dense" variant="primary" busy={busy} onClick={() => void enable()}>
          {t("push.turnOn")}
        </Button>
      ) : null}
    </div>
  );
}
