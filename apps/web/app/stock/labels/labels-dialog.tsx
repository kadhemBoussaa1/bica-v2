"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { RouteModal } from "../../@modal/route-modal";
import { LABELS_PRINT_MESSAGE, LabelsSheet } from "./labels-sheet";
import records from "../../records/records.module.css";
import styles from "./labels.module.css";

/**
 * The label sheet as a dialog over the reel, shipment or cut it was opened
 * from — `@modal/(.)stock/labels` intercepts the in-app link; a hard load of
 * the same URL still renders the full page.
 *
 * Print does not print this window: that would print the page under the
 * dialog, and a top-layer dialog does not paginate, so a shipment's thirty
 * stickers would come out as one. It loads the full label page into a hidden
 * frame with `print=1` instead — the page whose `@page` and print rules are
 * already right — which prints itself and reports back with a message.
 * The frame is same-origin and carries the session cookie like any page.
 */
export function LabelsModal({
  shipmentId,
  rollIds,
}: {
  shipmentId?: string;
  rollIds?: readonly string[];
}) {
  const t = useTranslations("stock");
  return (
    <RouteModal path="/stock/labels" eyebrow={t("eyebrow")} title={t("labels.title")}>
      {(nav) => <LabelsDialog shipmentId={shipmentId} rollIds={rollIds} onClose={nav.onCancel} />}
    </RouteModal>
  );
}

function LabelsDialog({
  shipmentId,
  rollIds,
  onClose,
}: {
  shipmentId?: string;
  rollIds?: readonly string[];
  onClose: () => void;
}) {
  const t = useTranslations("stock");
  // Each Print loads a fresh frame (`key`). A finished frame stays mounted:
  // a browser that returns from `print()` early may still be printing it.
  const [job, setJob] = useState(0);
  const [printing, setPrinting] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!printing) return;
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (typeof data !== "object" || data === null) return;
      if (!("type" in data) || data.type !== LABELS_PRINT_MESSAGE) return;
      setPrinting(false);
      setFailed("outcome" in data && data.outcome === "failed");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [printing]);

  const query = new URLSearchParams(
    shipmentId ? { shipment: shipmentId } : { rolls: (rollIds ?? []).join(",") },
  );
  query.set("print", "1");

  return (
    <div className={styles.preview}>
      {failed && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {t("labels.printFailed")}
        </p>
      )}
      <LabelsSheet
        shipmentId={shipmentId}
        rollIds={rollIds}
        printing={printing}
        onClose={onClose}
        onPrint={() => {
          setFailed(false);
          setPrinting(true);
          setJob((n) => n + 1);
        }}
      />
      {job > 0 && (
        <iframe
          key={job}
          className={styles.printFrame}
          src={`/stock/labels?${query.toString()}`}
          title={t("labels.print")}
          aria-hidden="true"
          tabIndex={-1}
        />
      )}
    </div>
  );
}
