"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { SupplierForm } from "../supplier-form";
import type { FormNav } from "../../records/form-nav";
import { useTRPC } from "../../trpc/client";
import styles from "../../records/records.module.css";

/** Fetches before rendering the form — see EditClient for why. */
/** `nav` comes from the route modal; the full page leaves it unset. */
export function EditSupplier({ id, ...nav }: { id: string } & FormNav) {
  const t = useTranslations("suppliers");
  const trpc = useTRPC();
  const supplierQuery = useQuery(trpc.supplier.byId.queryOptions({ id }));

  if (supplierQuery.isPending) {
    return <p className={styles.muted}>{t("loadingSupplier")}</p>;
  }

  if (supplierQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {supplierQuery.error.message}
      </p>
    );
  }

  return <SupplierForm initial={supplierQuery.data} {...nav} />;
}
