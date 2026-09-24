"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { GoodsReceiptForm } from "../../goods-receipt-form";
import type { FormNav } from "../../../../records/form-nav";
import { useTRPC } from "../../../../trpc/client";
import styles from "../../../../records/records.module.css";

export function EditGoodsReceipt({ id, ...nav }: { id: string } & FormNav) {
  const trpc = useTRPC();
  const t = useTranslations("purchasing");
  const receiptQuery = useQuery(trpc.goodsReceipt.byId.queryOptions({ id }));

  if (receiptQuery.isPending) return <p className={styles.muted}>{t("receipts.loading")}</p>;

  if (receiptQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {receiptQuery.error.message}
      </p>
    );
  }

  return <GoodsReceiptForm initial={receiptQuery.data} {...nav} />;
}
