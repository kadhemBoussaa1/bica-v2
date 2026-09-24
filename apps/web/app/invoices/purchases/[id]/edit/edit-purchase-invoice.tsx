"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PurchaseInvoiceForm } from "../../purchase-invoice-form";
import type { FormNav } from "../../../../records/form-nav";
import { useTRPC } from "../../../../trpc/client";
import styles from "../../../../records/records.module.css";

/** Fetches before rendering the form, so its state seeds from the record once. */
/** `nav` comes from the route modal; the full page leaves it unset. */
export function EditPurchaseInvoice({ id, ...nav }: { id: string } & FormNav) {
  const trpc = useTRPC();
  const t = useTranslations("invoices");
  const invoiceQuery = useQuery(trpc.purchaseInvoice.byId.queryOptions({ id }));

  if (invoiceQuery.isPending) return <p className={styles.muted}>{t("loadingInvoice")}</p>;

  if (invoiceQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {invoiceQuery.error.message}
      </p>
    );
  }

  return <PurchaseInvoiceForm initial={invoiceQuery.data} {...nav} />;
}
