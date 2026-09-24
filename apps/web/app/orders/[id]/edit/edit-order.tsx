"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { OrderForm } from "../../order-form";
import type { FormNav } from "../../../records/form-nav";
import { useTRPC } from "../../../trpc/client";
import styles from "../../../records/records.module.css";

/** Fetches before rendering the form — see EditClient for why. */
/** `nav` comes from the route modal; the full page leaves it unset. */
export function EditOrder({ id, ...nav }: { id: string } & FormNav) {
  const trpc = useTRPC();
  const t = useTranslations("orders");
  const orderQuery = useQuery(trpc.order.byId.queryOptions({ id }));

  if (orderQuery.isPending)
    return <p className={styles.muted}>{t("loadingOrder")}</p>;

  if (orderQuery.isError) {
    return (
      <p
        className={[styles.notice, styles.error].filter(Boolean).join(" ")}
        role="alert"
      >
        {orderQuery.error.message}
      </p>
    );
  }

  // `order.byId` returns a union: the money columns are absent for callers
  // who may not read pricing. This route is ADMIN-gated, so the priced branch
  // is what actually arrives — but the type does not know that, and editing
  // an order without its pricing inputs would blank them on save. Checking
  // rather than casting means a future permissions change surfaces here as a
  // visible message instead of silently wiping prices.
  if (!("orderTotal" in orderQuery.data)) {
    return (
      <p
        className={[styles.notice, styles.error].filter(Boolean).join(" ")}
        role="alert"
      >
        {t("noPricingPermission")}
      </p>
    );
  }

  return <OrderForm initial={orderQuery.data} {...nav} />;
}
