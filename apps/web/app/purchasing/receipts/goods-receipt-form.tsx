"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import {
  UPLOAD_CONTENT_TYPES,
  UPLOAD_MAX_BYTES,
  assetUrl,
  updateGoodsReceiptInput,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/field";
import { DateField } from "@repo/ui/date-field";
import { FileDropzone } from "@repo/ui/file-dropzone";
import { useToast } from "@repo/ui/toast";
import {
  ReceiptLinesEditor,
  toReceiptLineInput,
  type EditableReceiptLine,
  type ReceivableLine,
} from "../purchasing-lines-editor";
import { useTRPC } from "../../trpc/client";
import styles from "../../records/records.module.css";
import purchasing from "../purchasing.module.css";
import type { FormNav } from "../../records/form-nav";

type GoodsReceipt = inferRouterOutputs<AppRouter>["goodsReceipt"]["byId"];

function dateInput(value: string | Date | null): string {
  return value === null ? "" : new Date(value).toISOString().slice(0, 10);
}

/**
 * Recording what arrived against an order.
 *
 * Edit only — there is no create path. Every goods receipt is born with its
 * purchase order, already carrying a line per order line at zero received, so
 * this form is where an existing receipt gets filled in rather than where one
 * is raised. `initial` is therefore required, not optional.
 *
 * The order it belongs to is shown, not chosen: moving a receipt to another
 * order would strand the received quantities on the old order's lines, and
 * the server refuses it.
 */
export function GoodsReceiptForm({
  initial,
  onDone,
  onCancel,
}: { initial: GoodsReceipt } & FormNav) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const go = (target: string) => (onDone ? onDone(target) : router.push(target));
  const cancel = (target: string) => (onCancel ? onCancel(target) : router.push(target));
  const { push } = useToast();
  const t = useTranslations("purchasing");
  const common = useTranslations("common");

  const [issuedAt, setIssuedAt] = useState(
    dateInput(initial.issuedAt) || new Date().toISOString().slice(0, 10),
  );
  const [receivedAt, setReceivedAt] = useState(dateInput(initial.receivedAt));
  const [invoiceNumber, setInvoiceNumber] = useState(initial.invoiceNumber ?? "");
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(initial.invoiceUrl);
  const [lines, setLines] = useState<EditableReceiptLine[]>(() =>
    initial.lines.map((line, index) => ({
      key: index + 1,
      orderLineId: line.orderLine?.id ?? "",
      receivedQuantity: line.receivedQuantity === null ? "" : String(line.receivedQuantity),
      unitPrice: line.unitPrice === null ? "" : String(line.unitPrice),
      notes: "",
    })),
  );
  const [error, setError] = useState<string | null>(null);

  // The order's lines, with what has already arrived on each, so the editor
  // can show what remains before the server has to refuse an over-receipt.
  const orderQuery = useQuery(trpc.purchaseOrder.byId.queryOptions({ id: initial.orderId }));
  const orderLines: readonly ReceivableLine[] = (orderQuery.data?.lines ?? []).map((line) => ({
    id: line.id,
    position: line.position,
    designation: line.designation,
    quantity: line.quantity,
    receivedQuantity: line.receivedQuantity,
  }));
  const transport = initial.category === "TRANSPORT";
  // Confirmed: the purchase invoice was built from these lines, and the
  // server refuses to change them until the receipt is reopened.
  const locked = initial.validated;
  const ticket = useMutation(trpc.goodsReceipt.createInvoiceUpload.mutationOptions());

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.goodsReceipt.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.goodsReceipt.byId.queryKey() }),
      // The order's received figures and its fulfilment badge move with this.
      queryClient.invalidateQueries({ queryKey: trpc.purchaseOrder.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.purchaseOrder.byId.queryKey() }),
    ]);

  const update = useMutation(
    trpc.goodsReceipt.update.mutationOptions({
      onSuccess: async (saved) => {
        push({ title: t("receipts.saved", { numero: saved.numero }), tone: "success" });
        await invalidate();
        await go(`/purchasing/receipts/${saved.id}`);
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const busy = update.isPending;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = updateGoodsReceiptInput.safeParse({
      id: initial.id,
      orderId: initial.orderId,
      issuedAt,
      receivedAt: receivedAt || null,
      invoiceNumber: invoiceNumber.trim() || null,
      invoiceUrl,
      lines: lines.map((line, index) => toReceiptLineInput(line, index + 1)),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue ? `${issue.path.join(".")}: ${issue.message}` : common("checkForm"));
      return;
    }
    update.mutate(parsed.data);
  }

  return (
    <form
      className={[styles.formPanel, styles.formPanelWide].filter(Boolean).join(" ")}
      onSubmit={handleSubmit}
      noValidate
    >
      {error && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      {/*
        Three groups, each a row: the delivery (which order, when raised,
        when it arrived), the supplier's invoice, then the lines. No
        "validated" control — confirming is the detail page's "Confirm
        reception" — and no notes or last-editor box (2026-10-24): the
        server records who saved.
      */}
      <div className={styles.formGrid}>
        <span className={styles.formSection}>{t("receipts.form.detailsSection")}</span>

        {/* Shown rather than picked: a receipt belongs to its order for life. */}
        <div className={purchasing.staticField}>
          <span className={purchasing.staticLabel}>{t("fields.order")}</span>
          <span className={purchasing.staticValue}>
            <Link className={styles.inlineLink} href={`/purchasing/orders/${initial.orderId}`}>
              {initial.order.numero}
            </Link>
          </span>
          <p className={styles.hint}>{t("receipts.form.orderLocked")}</p>
        </div>
        <DateField
          label={t("fields.raised")}
          value={issuedAt}
          onChange={setIssuedAt}
          disabled={busy}
        />
        <DateField
          label={t("fields.received")}
          value={receivedAt}
          onChange={setReceivedAt}
          disabled={busy}
        />

        {/* Number and scan: confirming the reception records the purchase invoice from both. */}
        <span className={styles.formSection}>{t("receipts.form.invoiceSection")}</span>

        <div>
          <TextField
            label={t("fields.invoiceOnNote")}
            format="mono"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
          <p className={styles.hint}>{t("receipts.form.invoiceNumberHint")}</p>
        </div>
        <div className={[purchasing.staticField, purchasing.invoiceScan].filter(Boolean).join(" ")}>
          <span className={purchasing.staticLabel}>{t("receipts.form.invoiceFile")}</span>
          <FileDropzone
            label={t("receipts.form.invoiceFile")}
            value={assetUrl(invoiceUrl)}
            onChange={setInvoiceUrl}
            onRequestUpload={(file) =>
              ticket.mutateAsync({
                id: initial.id,
                filename: file.name,
                contentType: file.type as (typeof UPLOAD_CONTENT_TYPES)[number],
                size: file.size,
              })
            }
            contentTypes={UPLOAD_CONTENT_TYPES}
            maxBytes={UPLOAD_MAX_BYTES}
            strings={{
              drop: t("receipts.form.upload.drop"),
              choose: t("receipts.form.upload.choose"),
              open: t("receipts.form.upload.open"),
              download: t("receipts.form.upload.download"),
              remove: t("receipts.form.upload.remove"),
              uploading: t("receipts.form.upload.uploading"),
              failed: t("receipts.form.upload.failed"),
              tooLarge: t("receipts.form.upload.tooLarge"),
              wrongType: t("receipts.form.upload.wrongType"),
            }}
            // The file is saved with the form, not on upload.
            meta={
              invoiceUrl === initial.invoiceUrl
                ? t("receipts.form.upload.saved")
                : t("receipts.form.upload.unsaved")
            }
            disabled={busy}
          />
        </div>

        <span className={styles.formSection}>{t("receipts.form.linesSection")}</span>
        <div className={styles.formWide}>
          {locked && <p className={styles.hint}>{t("receipts.form.linesLocked")}</p>}
          {orderQuery.isPending ? (
            <p className={styles.muted}>{common("loading")}</p>
          ) : (
            <ReceiptLinesEditor
              lines={lines}
              orderLines={orderLines}
              transport={transport}
              onChange={setLines}
              busy={busy || locked}
            />
          )}
        </div>
      </div>

      <div className={styles.formActions}>
        <Button
          variant="secondary"
          onClick={() => cancel(`/purchasing/receipts/${initial.id}`)}
          disabled={busy}
        >
          {common("cancel")}
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          {common("saveChanges")}
        </Button>
      </div>
    </form>
  );
}
