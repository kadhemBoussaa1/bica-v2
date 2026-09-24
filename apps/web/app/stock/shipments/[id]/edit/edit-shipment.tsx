"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ShipmentForm } from "../../shipment-form";
import type { FormNav } from "../../../../records/form-nav";
import { useTRPC } from "../../../../trpc/client";
import styles from "../../../../records/records.module.css";

/** Fetches before rendering the form — see EditSupplier for why. */
/** `nav` comes from the route modal; the full page leaves it unset. */
export function EditShipment({ id, ...nav }: { id: string } & FormNav) {
  const t = useTranslations("stock");
  const trpc = useTRPC();
  const shipmentQuery = useQuery(trpc.stock.shipmentById.queryOptions({ id }));

  if (shipmentQuery.isPending) {
    return <p className={styles.muted}>{t("shipments.loading")}</p>;
  }

  if (shipmentQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {shipmentQuery.error.message}
      </p>
    );
  }

  return <ShipmentForm initial={shipmentQuery.data} {...nav} />;
}
