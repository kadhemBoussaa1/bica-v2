"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PurchaseOrderForm } from "../../purchase-order-form";
import type { FormNav } from "../../../../records/form-nav";
import { useTRPC } from "../../../../trpc/client";
import styles from "../../../../records/records.module.css";

/** Fetches before rendering the form, so its state seeds from the record once. */
/** `nav` comes from the route modal; the full page leaves it unset. */
export function EditPurchaseOrder({ id, ...nav }: { id: string } & FormNav) {
  const trpc = useTRPC();
  const t = useTranslations("purchasing");
  const orderQuery = useQuery(trpc.purchaseOrder.byId.queryOptions({ id }));

  if (orderQuery.isPending) return <p className={styles.muted}>{t("orders.loading")}</p>;

  if (orderQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {orderQuery.error.message}
      </p>
    );
  }

  return <PurchaseOrderForm initial={orderQuery.data} {...nav} />;
}
