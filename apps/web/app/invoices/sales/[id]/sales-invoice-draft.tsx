"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { CURRENCIES, PAYMENT_METHODS, invoiceTotals } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { SelectField, TextField } from "@repo/ui/field";
import { useToast } from "@repo/ui/toast";
import {
  InvoiceLinesEditor,
  parseNum,
  toEditable,
  toLineInput,
  type EditableLine,
} from "../../invoice-lines-editor";
import { formatMoney } from "../../invoice-ui";
import { Panel, Row } from "../../../records/record-ui";
import { PdfCanvas } from "../../../documents/pdf-canvas";
import { usePdfPreview } from "../../../documents/use-pdf-preview";
import { API_URL } from "../../../api-url";
import { useTRPC } from "../../../trpc/client";
import records from "../../../records/records.module.css";
import styles from "../../invoices.module.css";

type Invoice = inferRouterOutputs<AppRouter>["salesInvoice"]["byId"];

const amount = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});
const int = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** Today as YYYY-MM-DD in local time — `toISOString` shifts the date near midnight. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `@db.Date` arrives as an ISO timestamp at UTC midnight; the input wants its date part. */
function dateInput(value: string | Date | null): string {
  return value === null ? "" : new Date(value).toISOString().slice(0, 10);
}

/**
 * The editable face of a DRAFT sales invoice — docs/sales-invoice-plan.md
 * §7. Header fields, the lines, live totals from the same
 * `invoiceTotals` the server writes with, and the three actions: save,
 * issue (which saves first if anything is dirty), discard.
 *
 * The line billing an order keeps its link and cannot be removed — the
 * server refuses both, so the editor does not offer them; the quantity and
 * price on it are editable, since the snapshot is what the business signs
 * off, not what the engine computed.
 */
export function SalesInvoiceDraft({ invoice }: { invoice: Invoice }) {
  const trpc = useTRPC();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { push } = useToast();
  const t = useTranslations("invoices");
  const enums = useTranslations("enums");

  const [currency, setCurrency] = useState(invoice.currency ?? "");
  const [dueAt, setDueAt] = useState(dateInput(invoice.dueAt));
  const [paymentMethod, setPaymentMethod] = useState(invoice.paymentMethod ?? "");
  const [category, setCategory] = useState(invoice.category ?? "");
  const [lines, setLines] = useState<EditableLine[]>(() =>
    invoice.lines.map((line, index) => toEditable(line, index + 1)),
  );
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"issue" | "discard" | null>(null);
  const [issuedAt, setIssuedAt] = useState(today());
  const [note, setNote] = useState("");

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.salesInvoice.byId.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.salesInvoice.list.queryKey(),
      }),
      queryClient.invalidateQueries({ queryKey: trpc.order.byId.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.order.list.queryKey() }),
    ]);

  const saveMutation = useMutation(
    trpc.salesInvoice.updateDraft.mutationOptions({
      onSuccess: async () => {
        setDirty(false);
        await invalidate();
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const issueMutation = useMutation(
    trpc.salesInvoice.issue.mutationOptions({
      onSuccess: async (issued) => {
        setDialog(null);
        push({
          title: t("sales.issuedToast", { numero: issued.numero ?? issued.id }),
          tone: "success",
        });
        await invalidate();
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const discardMutation = useMutation(
    trpc.salesInvoice.discardDraft.mutationOptions({
      onSuccess: async (result) => {
        setDialog(null);
        push({ title: t("sales.discardedToast"), tone: "success" });
        await invalidate();
        const orderId = result.orderIds[0];
        router.replace(orderId ? `/orders/${orderId}` : "/invoices/sales");
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const refreshMutation = useMutation(
    trpc.salesInvoice.refreshFromPackaging.mutationOptions({
      onSuccess: async (result) => {
        push({
          title: result.changed === 0 ? t("sales.nothingToRefresh") : t("sales.quantityUpdated"),
          tone: result.changed === 0 ? "info" : "success",
        });
        await invalidate();
        // The server rewrote the lines; the editor's copy is stale.
        router.refresh();
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  const busy =
    saveMutation.isPending ||
    issueMutation.isPending ||
    discardMutation.isPending ||
    refreshMutation.isPending;

  const inputs = lines.map((line, index) => toLineInput(line, index + 1));
  const totals = invoiceTotals(inputs);
  const shownCurrency = currency || null;

  const payload = () => ({
    id: invoice.id,
    currency: currency === "" ? null : (currency as (typeof CURRENCIES)[number]),
    dueAt: dueAt === "" ? null : dueAt,
    paymentMethod:
      paymentMethod === "" ? null : (paymentMethod as (typeof PAYMENT_METHODS)[number]),
    category: category.trim() === "" ? null : category.trim(),
    lines: inputs,
  });

  // The live preview: the unsaved form, printed by the same renderer as the
  // real invoice. A string so the hook can tell a change by `!==`.
  const preview = usePdfPreview(
    `${API_URL}/documents/sales-invoice/preview.pdf`,
    JSON.stringify({ source: "draft", lang: locale, ...payload() }),
  );

  const save = () => {
    setError(null);
    saveMutation.mutate(payload());
  };

  const issue = async () => {
    setError(null);
    try {
      if (dirty) await saveMutation.mutateAsync(payload());
      issueMutation.mutate({ id: invoice.id, issuedAt });
    } catch {
      // saveMutation's onError has shown the message; keep the dialog open.
    }
  };

  // Hints per order-linked line: whether the quantity is packed or planned,
  // and whether packaging or the order's price has moved since (plan §8).
  const orderHints = invoice.lines.flatMap((line) => {
    if (!line.order) return [];
    const edited = lines.find((l) => l.orderId === line.orderId);
    const quantity = edited ? parseNum(edited.quantity) : (line.quantity ?? 0);
    const unitPrice = edited ? parseNum(edited.unitPrice) : (line.unitPrice ?? 0);
    const packed = line.packed ?? 0;
    const planned = line.planned;
    const messages: string[] = [];
    // A later cycle after a partial export: say what earlier invoices bill.
    if (line.invoicedBefore && planned !== null) {
      messages.push(
        t("sales.hints.alreadyInvoiced", {
          invoiced: int.format(line.invoicedBefore),
          planned: int.format(planned),
          remaining: int.format(Math.max(0, planned - line.invoicedBefore)),
        }),
      );
    }
    if (packed > 0) {
      messages.push(
        planned !== null
          ? t("sales.hints.packedPlanned", {
              packed: int.format(packed),
              planned: int.format(planned),
            })
          : t("sales.hints.packed", { packed: int.format(packed) }),
      );
      if (packed !== quantity) {
        messages.push(
          t("sales.hints.mismatch", {
            packed: int.format(packed),
            quantity: int.format(quantity),
          }),
        );
      }
    } else {
      messages.push(
        planned !== null
          ? t("sales.hints.noPackagingPlanned", {
              planned: int.format(planned),
            })
          : t("sales.hints.noPackaging"),
      );
    }
    // Tolerance, not equality: the editor seeds the price rounded to six
    // decimals, and a snapshot straight off the engine has fifteen.
    if (
      line.order.finalParcelPrice !== null &&
      Math.abs(line.order.finalParcelPrice - unitPrice) > 1e-6
    ) {
      messages.push(
        t("sales.hints.priceChanged", {
          price: amount.format(line.order.finalParcelPrice),
        }),
      );
    }
    return [{ order: line.order, packed, messages }];
  });

  return (
    <>
      <p className={[records.notice, styles.draftBanner].filter(Boolean).join(" ")}>
        {t.rich("sales.draftBanner", {
          strong: (chunks) => <strong>{chunks}</strong>,
          yy: String(new Date().getFullYear() % 100).padStart(2, "0"),
        })}
      </p>

      {error && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <div className={records.detailStack}>
        {/*
          The lines get the full width: the table needs about 1100px, and in
          the half column beside the preview it could only scroll sideways.
          The preview sits directly below, beside the header fields.
        */}
        <Panel title={t("panels.lines", { count: lines.length })} wide>
          <InvoiceLinesEditor
            lines={lines}
            onChange={(next) => {
              setLines(next);
              setDirty(true);
            }}
            currency={shownCurrency}
            busy={busy}
            maxLines={50}
          />
          {orderHints.map(({ order, messages }) => (
            <ul key={order.id} className={styles.hints}>
              {messages.map((message) => (
                <li key={message}>
                  <span className={records.mono}>{order.numero}</span> · {message}
                </li>
              ))}
            </ul>
          ))}
        </Panel>
        <div className={records.detailLayout}>
          <div className={records.detailMain}>
            <div className={records.detailGrid}>
              <Panel title={t("panels.invoice")}>
                <Row label={t("fields.client")}>
                  {invoice.client ? (
                    <Link className={records.inlineLink} href={`/clients/${invoice.client.id}`}>
                      {invoice.client.name}
                    </Link>
                  ) : (
                    <span className={records.muted}>{t("noClient")}</span>
                  )}
                </Row>
                {orderHints.map(({ order }) => (
                  <Row key={order.id} label={t("fields.order")}>
                    <Link className={records.inlineLink} href={`/orders/${order.id}`}>
                      {order.numero}
                    </Link>
                  </Row>
                ))}
                <Row label={t("fields.draftedBy")}>{invoice.createdBy?.name ?? "—"}</Row>
                <div className={styles.headerFields}>
                  <SelectField
                    label={t("fields.currency")}
                    size="dense"
                    options={[...CURRENCIES]}
                    placeholder={t("notSet")}
                    allowEmpty
                    value={currency}
                    onChange={(e) => {
                      setCurrency(e.target.value);
                      setDirty(true);
                    }}
                    disabled={busy}
                  />
                  <TextField
                    label={t("fields.due")}
                    size="dense"
                    type="date"
                    value={dueAt}
                    onChange={(e) => {
                      setDueAt(e.target.value);
                      setDirty(true);
                    }}
                    disabled={busy}
                  />
                  <SelectField
                    label={t("fields.paymentMethod")}
                    size="dense"
                    options={PAYMENT_METHODS.map((m) => ({
                      value: m,
                      label: enums(`paymentMethod.${m}`),
                    }))}
                    placeholder={t("notSet")}
                    allowEmpty
                    value={paymentMethod}
                    onChange={(e) => {
                      setPaymentMethod(e.target.value);
                      setDirty(true);
                    }}
                    disabled={busy}
                  />
                  <TextField
                    label={t("fields.category")}
                    size="dense"
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      setDirty(true);
                    }}
                    disabled={busy}
                  />
                </div>
              </Panel>

              <Panel title={t("panels.amounts")}>
                <Row label={t("fields.exclVat")}>{formatMoney(totals.totalHt, shownCurrency)}</Row>
                <Row label={t("fields.vat")}>{formatMoney(totals.vatAmount, shownCurrency)}</Row>
                <Row label={t("fields.inclVat")}>
                  <span className={records.detailTotal}>
                    {formatMoney(totals.totalTtc, shownCurrency)}
                  </span>
                </Row>
                {!currency && <p className={records.hint}>{t("sales.currencyRequired")}</p>}
              </Panel>

              <Panel title={t("panels.actions")}>
                <div className={styles.draftActions}>
                  <Button
                    variant="primary"
                    busy={issueMutation.isPending}
                    disabled={busy && !issueMutation.isPending}
                    onClick={() => {
                      setError(null);
                      setIssuedAt(today());
                      setDialog("issue");
                    }}
                  >
                    {t("sales.issue")}
                  </Button>
                  <Button
                    variant="secondary"
                    busy={saveMutation.isPending}
                    disabled={!dirty || (busy && !saveMutation.isPending)}
                    onClick={save}
                  >
                    {dirty ? t("sales.saveDraft") : t("sales.savedState")}
                  </Button>
                  {orderHints.length > 0 && (
                    <Button
                      variant="secondary"
                      busy={refreshMutation.isPending}
                      disabled={dirty || (busy && !refreshMutation.isPending)}
                      onClick={() => {
                        setError(null);
                        refreshMutation.mutate({ id: invoice.id });
                      }}
                    >
                      {t("sales.refresh")}
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setNote("");
                      setDialog("discard");
                    }}
                  >
                    {t("sales.discard")}
                  </Button>
                </div>
                {dirty && orderHints.length > 0 && (
                  <p className={records.hint}>{t("sales.saveBeforeRefresh")}</p>
                )}
              </Panel>
            </div>
          </div>

          {/*
          The document sticks while the form scrolls, as on the purchasing
          pages — so the line being typed and the page it prints on stay side
          by side.
        */}
          <aside className={records.detailRail}>
            <Panel title={t("panels.preview")}>
              <PdfCanvas
                data={preview.data}
                stale={preview.pending}
                label={t("sales.previewPage", { page: "{page}" })}
                errorLabel={t("sales.previewError")}
              />
              <p className={records.hint} aria-live="polite">
                {preview.error ?? t("sales.previewHint")}
              </p>
            </Panel>
          </aside>
        </div>
      </div>

      <Dialog
        open={dialog === "issue"}
        title={t("sales.issue")}
        confirmLabel={t("sales.issueConfirm")}
        busy={issueMutation.isPending || saveMutation.isPending}
        onConfirm={() => void issue()}
        onClose={() => !busy && setDialog(null)}
      >
        <p className={records.muted}>
          {t("sales.issueBody", { year: issuedAt.slice(0, 4) })}
          {dirty && ` ${t("sales.unsavedSavedFirst")}`}
        </p>
        <TextField
          label={t("fields.issueDate")}
          type="date"
          value={issuedAt}
          onChange={(e) => setIssuedAt(e.target.value)}
          disabled={busy}
        />
      </Dialog>

      <Dialog
        open={dialog === "discard"}
        title={t("sales.discardTitle")}
        confirmLabel={t("sales.discardConfirm")}
        destructive
        busy={discardMutation.isPending}
        onConfirm={() => discardMutation.mutate({ id: invoice.id, note })}
        onClose={() => !busy && setDialog(null)}
      >
        <p className={records.muted}>{t("sales.discardBody")}</p>
        <TextField
          label={t("fields.note")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
      </Dialog>
    </>
  );
}
