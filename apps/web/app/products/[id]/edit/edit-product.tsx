"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ProductForm } from "../../product-form";
import type { FormNav } from "../../../records/form-nav";
import { useTRPC } from "../../../trpc/client";
import styles from "../../../records/records.module.css";

/** Fetches before rendering the form — see EditSupplier for why. */
/** `nav` comes from the route modal; the full page leaves it unset. */
export function EditProduct({ id, ...nav }: { id: string } & FormNav) {
  const trpc = useTRPC();
  const t = useTranslations("products");
  const productQuery = useQuery(trpc.product.byId.queryOptions({ id }));

  if (productQuery.isPending) {
    return <p className={styles.muted}>{t("loadingProduct")}</p>;
  }

  if (productQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {productQuery.error.message}
      </p>
    );
  }

  return <ProductForm initial={productQuery.data} {...nav} />;
}
