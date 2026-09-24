"use client";

import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useTranslations } from "next-intl";
import { rollScanUrl } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { useTRPC } from "../../trpc/client";
import { labelOrigin } from "./label-origin";
import records from "../../records/records.module.css";
import styles from "./labels.module.css";

/**
 * The printable sheet.
 *
 * The QR encodes the reel id and nothing else — a URL, so a phone camera
 * opens the reel without the app being involved, and short enough to stay
 * readable at error-correction level M on a 52 mm square. Everything else on
 * the label is for a human holding a reel whose code will not scan, which is
 * also why the full id is printed in the corner.
 */
export function LabelsSheet({
  shipmentId,
  rollIds,
  title,
}: {
  shipmentId?: string;
  rollIds?: readonly string[];
  title: string;
}) {
  const t = useTranslations("stock");
  const trpc = useTRPC();

  const hasTarget = Boolean(shipmentId) !== Boolean(rollIds && rollIds.length > 0);
  const labelsQuery = useQuery({
    ...trpc.stock.rollLabels.queryOptions(
      shipmentId ? { shipmentId } : { rollIds: [...(rollIds ?? [])] },
    ),
    enabled: hasTarget,
  });

  if (!hasTarget) return <EmptyState title={t("labels.missingParams")} />;
  if (labelsQuery.isPending) return <p className={records.muted}>{t("labels.loading")}</p>;

  if (labelsQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {labelsQuery.error.message}
      </p>
    );
  }

  if (labelsQuery.data.length === 0) return <EmptyState title={t("labels.empty")} />;

  const origin = labelOrigin();

  return (
    <>
      <div className={styles.toolbar}>
        <h1>{title}</h1>
        <span className={styles.note}>
          {t("labels.count", { count: labelsQuery.data.length })} — {t("labels.sheetNote")}
        </span>
        <Button variant="primary" onClick={() => window.print()}>
          {t("labels.print")}
        </Button>
      </div>

      <div className={styles.sheet}>
        {labelsQuery.data.map((roll) => {
          const spec = [
            roll.paperGrade,
            roll.grammage === null ? null : `${roll.grammage} g/m²`,
            roll.laize === null ? null : `${roll.laize} mm`,
          ]
            .filter(Boolean)
            .join(" · ");
          const provenance = [
            roll.importShipment?.numeroImport,
            roll.importShipment?.supplier.name,
          ]
            .filter(Boolean)
            .join(" · ");

          return (
            <article key={roll.id} className={styles.label}>
              <span className={styles.numero}>{roll.numero ?? "—"}</span>
              <span className={styles.qr}>
                <QRCodeSVG value={rollScanUrl(origin, roll.id)} level="M" size={196} />
              </span>
              <span>
                <span className={styles.spec}>{spec}</span>
                <br />
                <span className={styles.provenance}>{provenance}</span>
                <br />
                <span className={styles.id}>{roll.id}</span>
              </span>
            </article>
          );
        })}
      </div>
    </>
  );
}
