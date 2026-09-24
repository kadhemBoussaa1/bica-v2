"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { assetUrl, canAccess } from "@repo/api-contract";
import { FileLink } from "@repo/ui/file-link";
import { ShipmentRolls } from "./shipment-rolls";
import { useCurrentUser } from "../../../auth/use-auth";
import { useTRPC } from "../../../trpc/client";
import { Panel, Row, Val } from "../../../records/record-ui";
import styles from "../../../records/records.module.css";
import { dateFormat } from "../../../../i18n/formats";

const kg = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const day = () => dateFormat({ dateStyle: "medium" });

export function ShipmentDetail({ id }: { id: string }) {
  const t = useTranslations("stock");
  const trpc = useTRPC();
  const { user: me } = useCurrentUser();
  // Mirrors `StockService.canReadPricing` — UX only; the columns are absent
  // from the response for anyone below ADMIN, not merely hidden here.
  const canReadMoney = me ? canAccess(me.role, "ADMIN") : false;
  const shipmentQuery = useQuery(trpc.stock.shipmentById.queryOptions({ id }));

  if (shipmentQuery.isPending) return <p className={styles.muted}>{t("shipments.loading")}</p>;

  if (shipmentQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {shipmentQuery.error.message}
      </p>
    );
  }

  const s = shipmentQuery.data;
  // The columns are absent from the response below ADMIN, so this view of the
  // row is only read inside the `canReadMoney` branch; the cast is confined
  // here, as `rollMoney` does for reels.
  const cost = s as typeof s & {
    price?: number | null;
    priceTotal?: number | null;
    currency?: string | null;
    transportPrice?: number | null;
  };

  return (
    <div className={styles.detailGrid}>
      <Panel title={t("shipments.detail.shipmentPanel")}>
        <Row label={t("shipments.detail.number")}>
          {s.numeroImport}
          {!s.active && <span className={styles.archivedTag}>{t("archivedTag")}</span>}
        </Row>
        <Row label={t("shipments.detail.arrived")}>
          <Val value={s.dateImport ? day().format(new Date(s.dateImport)) : null} />
        </Row>
        <Row label={t("shipments.detail.supplier")}>
          <Link className={styles.inlineLink} href={`/suppliers/${s.supplier.id}`}>
            {s.supplier.name}
          </Link>
          {!s.supplier.active && <span className={styles.archivedTag}>{t("archivedTag")}</span>}
        </Row>
        <Row label={t("shipments.detail.paper")}><Val value={s.productName} /></Row>
        <Row label={t("shipments.detail.rolls")}>{s.rollCount}</Row>
      </Panel>

      {/*
        Money only for ADMIN+. The server did not select it for anyone else
        (`SHIPMENT_SELECT` vs `SHIPMENT_SELECT_PRICED`), so this mirrors the
        same rank test rather than rendering empty rows to the warehouse.
        Length is not money and stays on the shipment panel's own terms.
      */}
      {canReadMoney ? (
        <Panel title={t("shipments.detail.costPanel")}>
          <Row label={t("shipments.detail.total")}>
            <span className={styles.detailTotal}>
              <Val
                value={
                  cost.priceTotal === null || cost.priceTotal === undefined
                    ? null
                    : money.format(cost.priceTotal)
                }
                suffix={cost.currency ?? undefined}
              />
            </span>
          </Row>
          <Row label={t("shipments.detail.unitPrice")}>
            <Val
              value={
                cost.price === null || cost.price === undefined
                  ? null
                  : money.format(cost.price)
              }
            />
          </Row>
          <Row label={t("shipments.detail.transportIncluded")}>
            {s.transportIncluded ? t("yes") : t("no")}
          </Row>
          <Row label={t("shipments.detail.transport")}>
            <Val
              value={
                cost.transportPrice === null || cost.transportPrice === undefined
                  ? null
                  : money.format(cost.transportPrice)
              }
            />
          </Row>
          <Row label={t("shipments.detail.totalLength")}>
            <Val value={s.totalMetrage === null ? null : kg.format(s.totalMetrage)} suffix="m" />
          </Row>
        </Panel>
      ) : (
        <Panel title={t("shipments.detail.shipmentPanel")}>
          <Row label={t("shipments.detail.totalLength")}>
            <Val value={s.totalMetrage === null ? null : kg.format(s.totalMetrage)} suffix="m" />
          </Row>
        </Panel>
      )}

      <Panel title={t("shipments.detail.documentsPanel")}>
        {/*
          `certificate` holds the file, `hasCertificate` the legacy roster flag —
          a shipment can be marked as certified without the scan ever being
          uploaded, so fall back to Yes/No rather than showing an empty link.
        */}
        <Row label={t("shipments.detail.certificate")}>
          {s.certificate ? (
            <FileLink href={assetUrl(s.certificate)} />
          ) : (
            (s.hasCertificate ? t("yes") : t("no"))
          )}
        </Row>
        <Row label={t("shipments.detail.packingList")}><FileLink href={assetUrl(s.packingList)} /></Row>
        <Row label={t("shipments.detail.importFile")}><FileLink href={assetUrl(s.importFile)} /></Row>
      </Panel>

      {s.observations && (
        <Panel title={t("shipments.detail.observationsPanel")} wide>
          <p className={styles.text}>{s.observations}</p>
        </Panel>
      )}

      {/*
        Searchable and paged rather than a plain list: one delivery carries 136
        reels in the migrated data, 47.8 on average. Its own query, so finding
        a reel by number does not mean holding every reel in the page.
      */}
      <Panel title={t("shipments.detail.reelsPanel", { count: s.rollCount })} wide>
        <ShipmentRolls shipmentId={s.id} />
      </Panel>
    </div>
  );
}
