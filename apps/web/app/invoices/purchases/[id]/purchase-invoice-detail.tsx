"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { assetUrl } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useToast } from "@repo/ui/toast";
import { ScanPreview } from "../../../purchasing/document-preview";
import {
  Documents,
  formatDay,
  formatMoney,
  InvoiceLines,
} from "../../invoice-ui";
import { Panel, Row, Val } from "../../../records/record-ui";
import { useTRPC } from "../../../trpc/client";
import styles from "../../../records/records.module.css";
import invoices from "../../invoices.module.css";

export function PurchaseInvoiceDetail({ id }: { id: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { push } = useToast();
  const t = useTranslations("invoices");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const invoiceQuery = useQuery(trpc.purchaseInvoice.byId.queryOptions({ id }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removeMutation = useMutation(
    trpc.purchaseInvoice.remove.mutationOptions({
      onSuccess: async () => {
        push({ title: t("purchases.deleted"), tone: "success" });
        await queryClient.invalidateQueries({ queryKey: trpc.purchaseInvoice.list.queryKey() });
        router.replace("/invoices/purchases");
      },
      onError: (cause) => {
        setConfirmDelete(false);
        setError(cause.message);
      },
    }),
  );

  if (invoiceQuery.isPending) return <p className={styles.muted}>{t("loadingInvoice")}</p>;

  if (invoiceQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {invoiceQuery.error.message}
      </p>
    );
  }

  const inv = invoiceQuery.data;

  return (
    <>
      {error && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}
      <div className={invoices.detailActions}>
        <Link href={`/invoices/purchases/${inv.id}/edit`}>
          <Button variant="secondary">{common("edit")}</Button>
        </Link>
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          {common("delete")}
        </Button>
      </div>

    <div className={styles.detailGrid}>
      <Panel title={t("panels.invoice")}>
        <Row label={t("fields.number")}>
          <span className={styles.mono}>{inv.numero}</span>
        </Row>
        <Row label={t("fields.supplier")}>
          <Link className={styles.inlineLink} href={`/suppliers/${inv.supplier.id}`}>
            {inv.supplier.name}
          </Link>
          {!inv.supplier.active && <span className={styles.archivedTag}>{t("archived")}</span>}
        </Row>
        <Row label={t("fields.issued")}><Val value={formatDay(inv.issuedAt)} /></Row>
        <Row label={t("fields.due")}><Val value={formatDay(inv.dueAt)} /></Row>
        <Row label={t("fields.category")}><Val value={inv.category} /></Row>
        <Row label={t("fields.forProduction")}>
          {inv.forProduction === null ? <span className={styles.absent} /> : inv.forProduction ? t("yes") : t("no")}
        </Row>
        {/*
          The goods receipt this was raised against. Resolved for 135 of the
          136 invoices that name one; the last points at a legacy receipt
          that no longer exists, so its reference is shown as-is instead.
        */}
        {inv.receipt ? (
          <Row label={t("fields.goodsReceipt")}>
            <Link className={styles.inlineLink} href={`/purchasing/receipts/${inv.receipt.id}`}>
              <span className={styles.mono}>{inv.receipt.numero}</span>
            </Link>
          </Row>
        ) : (
          inv.legacyReceiptType && (
            <Row label={t("fields.legacyReceipt")}>
              <span className={styles.mono}>
                {inv.legacyReceiptType}
                {inv.legacyReceiptId !== null ? ` #${inv.legacyReceiptId}` : ""}
              </span>
            </Row>
          )
        )}
      </Panel>

      <Panel title={t("panels.payment")}>
        <Row label={t("fields.paidOn")}><Val value={formatDay(inv.paidAt)} /></Row>
        <Row label={t("fields.method")}>
          <Val value={inv.paymentMethod ? enums(`paymentMethod.${inv.paymentMethod}`) : null} />
        </Row>
        <Row label={t("fields.netPayable")}>
          <span className={styles.detailTotal}>
            <Val value={formatMoney(inv.netPayable, inv.currency)} />
          </span>
        </Row>
      </Panel>

      <Panel title={t("panels.amounts")}>
        <Row label={t("fields.exclVat")}><Val value={formatMoney(inv.totalHt, inv.currency)} /></Row>
        <Row label={t("fields.vat")}><Val value={formatMoney(inv.vatAmount, inv.currency)} /></Row>
        <Row label={t("fields.inclVat")}>
          <span className={styles.detailTotal}>
            <Val value={formatMoney(inv.totalTtc, inv.currency)} />
          </span>
        </Row>
        <Row label={t("fields.withholding")}><Val value={formatMoney(inv.withholdingTax, inv.currency)} /></Row>
        <Row label={t("fields.currency")}><Val value={inv.currency} /></Row>
        <Row label={t("fields.exchangeRate")}><Val value={inv.exchangeRate} /></Row>
      </Panel>

      <Panel title={t("panels.documents", { count: inv.documents.length })}>
        <Documents documents={inv.documents} />
      </Panel>

      {/*
        The scan itself, not just a link to it. 609 of the 614 migrated
        invoices carry one and every stored file is a PDF, so the first is
        previewed inline; the rest stay as links in the panel above, since an
        invoice with seven attachments should not be seven iframes.
      */}
      {inv.documents[0] !== undefined && (
        <Panel title={t("panels.scan")} wide>
          <ScanPreview
            url={assetUrl(inv.documents[0]) ?? inv.documents[0]}
            label={t("panels.scan")}
          />
        </Panel>
      )}

      <Panel title={t("panels.lines", { count: inv.lineCount })} wide>
        <InvoiceLines lines={inv.lines} currency={inv.currency} />
      </Panel>
    </div>

      <Dialog
        open={confirmDelete}
        title={t("purchases.deleteTitle", { numero: inv.numero })}
        confirmLabel={common("delete")}
        destructive
        busy={removeMutation.isPending}
        onConfirm={() => removeMutation.mutate({ id: inv.id })}
        onClose={() => !removeMutation.isPending && setConfirmDelete(false)}
      >
        <p className={styles.muted}>{t("purchases.deleteBody", { count: inv.lineCount })}</p>
      </Dialog>
    </>
  );
}
