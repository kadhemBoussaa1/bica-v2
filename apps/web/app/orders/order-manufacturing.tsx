"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { manufacturingOrderNumero, type ManufacturingOrderStatus } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { SelectField } from "@repo/ui/field";
import { invalidateManufacturingQueries } from "../manufacturing-orders/manufacturing-queries";
import { OrderStatusPill } from "../manufacturing-orders/manufacturing-ui";
import records from "../records/records.module.css";
import { useTRPC } from "../trpc/client";
import styles from "./order-detail.module.css";

interface OrderManufacturingProps {
  orderId: string;
  numero: string;
  manufacturingOrder: { id: string; numero: string; status: ManufacturingOrderStatus } | null;
}

/**
 * The order's OF, on the rail: a link to it with its status, or "Create OF".
 * The pipeline itself lives on the OF's own page
 * (docs/manufacturing-orders-plan.md). Rendered for ADMIN and above, on an
 * order — never a quote; the server refuses both anyway.
 */
export function OrderManufacturing({ orderId, numero, manufacturingOrder }: OrderManufacturingProps) {
  const t = useTranslations("manufacturing");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const templatesQuery = useQuery(
    trpc.manufacturingTemplate.list.queryOptions(undefined, { enabled: creating }),
  );
  const create = useMutation(
    trpc.manufacturing.create.mutationOptions({
      onSuccess: async (created) => {
        await invalidateManufacturingQueries(queryClient, trpc);
        router.push(`/manufacturing-orders/${created.id}`);
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  // What the server will number it: the OF takes the order's CMD-<n>.
  const preview = manufacturingOrderNumero(numero, new Date().getUTCFullYear());

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>{t("orderCard.title")}</h2>
      {manufacturingOrder ? (
        <div className={styles.invoiceRow}>
          <Link className={records.inlineLink} href={`/manufacturing-orders/${manufacturingOrder.id}`}>
            {manufacturingOrder.numero}
          </Link>
          <OrderStatusPill status={manufacturingOrder.status} />
        </div>
      ) : (
        <>
          <p className={styles.hint}>{preview === null ? t("orderCard.needsNumber") : t("orderCard.none")}</p>
          <div className={styles.railActions}>
            <Button
              disabled={preview === null}
              onClick={() => {
                setError(null);
                setTemplateId("");
                setCreating(true);
              }}
            >
              {t("orderCard.create")}
            </Button>
          </div>
        </>
      )}

      <Dialog
        open={creating}
        title={t("orderCard.createTitle", { numero })}
        confirmLabel={t("orderCard.createConfirm")}
        busy={create.isPending}
        onConfirm={() => create.mutate({ orderId, templateId: templateId || undefined })}
        onClose={() => setCreating(false)}
      >
        {error && (
          <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
            {error}
          </p>
        )}
        <SelectField
          label={t("orderCard.template")}
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value)}
          placeholder={t("orderCard.noTemplate")}
          allowEmpty
          options={(templatesQuery.data ?? [])
            .filter((template) => template.active)
            .map((template) => ({ value: template.id, label: template.name }))}
          disabled={create.isPending}
        />
        {preview !== null && <p className={styles.hint}>{t("orderCard.numberHint", { numero: preview })}</p>}
      </Dialog>
    </section>
  );
}
