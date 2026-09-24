"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import {
  createPurchaseInvoiceInput,
  CURRENCIES,
  invoiceTotals,
  PAYMENT_METHODS,
  updatePurchaseInvoiceInput,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { SelectField, TextField } from "@repo/ui/field";
import { useToast } from "@repo/ui/toast";
import {
  InvoiceLinesEditor,
  newEditableLine,
  toEditable,
  toLineInput,
  type EditableLine,
} from "../invoice-lines-editor";
import { formatDay } from "../../../i18n/formats";
import { formatMoney } from "../invoice-ui";
import { useTRPC } from "../../trpc/client";
import styles from "../../records/records.module.css";
import invoices from "../invoices.module.css";

type PurchaseInvoice = inferRouterOutputs<AppRouter>["purchaseInvoice"]["byId"];

/** `@db.Date` arrives as an ISO timestamp at UTC midnight; the input wants its date part. */
function dateInput(value: string | Date | null): string {
  return value === null ? "" : new Date(value).toISOString().slice(0, 10);
}

/**
 * Create and edit for a supplier's invoice — one form, like the shipment
 * form. Every field is written on save (create-or-replace on the server),
 * so a blank here clears the column; the scanned documents are not part of
 * the form and survive an edit untouched.
 *
 * The goods-receipt picker is scoped to the chosen supplier: the server
 * refuses a receipt from another supplier, so the form never offers one.
 */
export function PurchaseInvoiceForm({
  initial,
  onDone,
  onCancel,
}: {
  onDone?: (target: string) => void | Promise<void>;
  onCancel?: (target: string) => void;
  initial?: PurchaseInvoice;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  // The route modal passes both; the full page falls through to navigation.
  const go = (target: string) => (onDone ? onDone(target) : router.push(target));
  const cancel = (target: string) => (onCancel ? onCancel(target) : router.push(target));
  const { push } = useToast();
  const t = useTranslations("invoices");
  const common = useTranslations("common");
  const enums = useTranslations("enums");

  const [numero, setNumero] = useState(initial?.numero ?? "");
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [issuedAt, setIssuedAt] = useState(dateInput(initial?.issuedAt ?? null));
  const [dueAt, setDueAt] = useState(dateInput(initial?.dueAt ?? null));
  const [paidAt, setPaidAt] = useState(dateInput(initial?.paidAt ?? null));
  const [paymentMethod, setPaymentMethod] = useState(initial?.paymentMethod ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [forProduction, setForProduction] = useState(
    initial?.forProduction === null || initial?.forProduction === undefined
      ? ""
      : initial.forProduction
        ? "yes"
        : "no",
  );
  const [currency, setCurrency] = useState(initial?.currency ?? "");
  const [exchangeRate, setExchangeRate] = useState(
    initial?.exchangeRate === null || initial?.exchangeRate === undefined
      ? ""
      : String(initial.exchangeRate),
  );
  const [withholdingTax, setWithholdingTax] = useState(
    initial?.withholdingTax === null || initial?.withholdingTax === undefined
      ? ""
      : String(initial.withholdingTax),
  );
  const [receiptId, setReceiptId] = useState(initial?.receipt?.id ?? "");
  const [lines, setLines] = useState<EditableLine[]>(() =>
    initial && initial.lines.length > 0
      ? initial.lines.map((line, index) => toEditable(line, index + 1))
      : [newEditableLine(1, 19)],
  );
  const [error, setError] = useState<string | null>(null);

  // Active suppliers only: the picker must not offer one the API would
  // reject. An archived supplier already on this invoice is appended below.
  const suppliersQuery = useQuery(
    trpc.supplier.list.queryOptions({ pageSize: 100, sortBy: "name", sortDir: "asc" }),
  );
  const suppliers = (suppliersQuery.data?.rows ?? []).filter((s) => s.active);
  const supplierName =
    suppliers.find((s) => s.id === supplierId)?.name ?? initial?.supplier.name ?? "";

  // The list searches supplier name, which is the only scoping it offers;
  // the rows are then narrowed to the exact supplier client-side.
  const receiptsQuery = useQuery({
    ...trpc.goodsReceipt.list.queryOptions({
      pageSize: 100,
      sortBy: "issuedAt",
      sortDir: "desc",
      search: supplierName,
    }),
    enabled: supplierName !== "",
  });
  const receipts = (receiptsQuery.data?.rows ?? []).filter((r) => r.supplierId === supplierId);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.purchaseInvoice.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.purchaseInvoice.byId.queryKey() }),
    ]);

  const create = useMutation(
    trpc.purchaseInvoice.create.mutationOptions({
      onSuccess: async (created) => {
        push({ title: t("purchases.recorded", { numero: created.numero }), tone: "success" });
        await invalidate();
        await go(`/invoices/purchases/${created.id}`);
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const update = useMutation(
    trpc.purchaseInvoice.update.mutationOptions({
      onSuccess: async (updated) => {
        push({ title: t("purchases.saved", { numero: updated.numero }), tone: "success" });
        await invalidate();
        await go(`/invoices/purchases/${updated.id}`);
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const busy = create.isPending || update.isPending;

  const inputs = lines.map((line, index) => toLineInput(line, index + 1));
  const totals = invoiceTotals(inputs);
  const shownCurrency = currency || null;
  const withholding = Number(withholdingTax.replace(",", ".")) || 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const num = (label: string, value: string): number | null => {
      const trimmed = value.trim().replace(",", ".");
      if (trimmed === "") return null;
      const parsed = Number(trimmed);
      if (Number.isNaN(parsed)) throw new Error(t("purchases.form.mustBeNumber", { label }));
      return parsed;
    };

    let raw: Record<string, unknown>;
    try {
      raw = {
        numero,
        supplierId,
        issuedAt: issuedAt || null,
        dueAt: dueAt || null,
        paidAt: paidAt || null,
        paymentMethod: paymentMethod || null,
        category: category || null,
        forProduction: forProduction === "" ? null : forProduction === "yes",
        currency: currency || null,
        exchangeRate: num(t("fields.exchangeRate"), exchangeRate),
        withholdingTax: num(t("fields.withholdingTax"), withholdingTax),
        receiptId: receiptId || null,
        lines: inputs,
      };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : common("checkForm"));
      return;
    }

    const schema = initial ? updatePurchaseInvoiceInput : createPurchaseInvoiceInput;
    const parsed = schema.safeParse(initial ? { ...raw, id: initial.id } : raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue ? `${issue.path.join(".")}: ${issue.message}` : common("checkForm"));
      return;
    }
    if (initial) update.mutate({ ...parsed.data, id: initial.id });
    else create.mutate(parsed.data);
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

      <div className={styles.formGrid}>
        <TextField
          label={t("fields.supplierNumber")}
          format="mono"
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <div>
          <SelectField
            label={t("fields.supplier")}
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              setReceiptId("");
            }}
            disabled={busy || suppliersQuery.isPending}
            options={[
              ...suppliers.map((s) => ({ value: s.id, label: s.name })),
              ...(initial && !suppliers.some((s) => s.id === initial.supplierId)
                ? [{ value: initial.supplierId, label: t("purchases.form.archivedOption", { name: initial.supplier.name }) }]
                : []),
            ]}
            placeholder={suppliersQuery.isPending ? t("loading") : t("purchases.form.chooseSupplier")}
          />
          <p className={styles.hint}>
            {t.rich("purchases.form.supplierHint", {
              link: (chunks) => (
                <Link className={styles.inlineLink} href="/suppliers/new">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>

        <TextField
          label={t("fields.issued")}
          type="date"
          format="mono"
          value={issuedAt}
          onChange={(e) => setIssuedAt(e.target.value)}
          disabled={busy}
        />
        <TextField
          label={t("fields.due")}
          type="date"
          format="mono"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          disabled={busy}
        />

        <div>
          <SelectField
            label={t("fields.goodsReceipt")}
            value={receiptId}
            onChange={(e) => setReceiptId(e.target.value)}
            disabled={busy || supplierId === "" || receiptsQuery.isFetching}
            options={[
              ...receipts.map((r) => ({
                value: r.id,
                label: `${r.numero}${r.receivedAt ? ` · ${formatDay(r.receivedAt)}` : ""}`,
              })),
              ...(initial?.receipt && !receipts.some((r) => r.id === initial.receipt?.id)
                ? [{ value: initial.receipt.id, label: initial.receipt.numero }]
                : []),
            ]}
            placeholder={
              supplierId === ""
                ? t("purchases.form.chooseSupplierFirst")
                : receiptsQuery.isFetching
                  ? t("loading")
                  : receipts.length === 0
                    ? t("purchases.form.noReceipt")
                    : t("purchases.form.none")
            }
            allowEmpty
          />
          <p className={styles.hint}>{t("purchases.form.receiptHint")}</p>
        </div>
        <TextField
          label={t("fields.category")}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <SelectField
          label={t("fields.forProduction")}
          value={forProduction}
          onChange={(e) => setForProduction(e.target.value)}
          options={[
            { value: "yes", label: t("yes") },
            { value: "no", label: t("no") },
          ]}
          placeholder={common("notRecorded")}
          allowEmpty
          disabled={busy}
        />

        <span className={styles.formSection}>{t("purchases.form.amountsSection")}</span>

        <SelectField
          label={t("fields.currency")}
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          options={[...CURRENCIES]}
          placeholder={t("notSet")}
          allowEmpty
          disabled={busy}
        />
        <TextField
          label={t("fields.exchangeRate")}
          format="numeric"
          value={exchangeRate}
          onChange={(e) => setExchangeRate(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("fields.withholdingTax")}
          format="numeric"
          value={withholdingTax}
          onChange={(e) => setWithholdingTax(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <div />
        <TextField
          label={t("fields.paidOn")}
          type="date"
          format="mono"
          value={paidAt}
          onChange={(e) => setPaidAt(e.target.value)}
          disabled={busy}
        />
        <SelectField
          label={t("fields.paymentMethod")}
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          options={PAYMENT_METHODS.map((m) => ({ value: m, label: enums(`paymentMethod.${m}`) }))}
          placeholder={t("notSet")}
          allowEmpty
          disabled={busy}
        />

        <span className={styles.formSection}>{t("purchases.form.linesSection")}</span>
        <div className={styles.formWide}>
          <InvoiceLinesEditor
            lines={lines}
            onChange={setLines}
            currency={shownCurrency}
            busy={busy}
            newLineTaxPct={19}
          />
        </div>

        <div className={[styles.formWide, invoices.formTotals].filter(Boolean).join(" ")}>
          <span>
            {t("purchases.form.totals.exclVat", {
              amount: formatMoney(totals.totalHt, shownCurrency) ?? "",
            })}
          </span>
          <span>
            {t("purchases.form.totals.vat", {
              amount: formatMoney(totals.vatAmount, shownCurrency) ?? "",
            })}
          </span>
          <span>
            {t("purchases.form.totals.inclVat", {
              amount: formatMoney(totals.totalTtc, shownCurrency) ?? "",
            })}
          </span>
          <strong>
            {t("purchases.form.totals.netPayable", {
              amount: formatMoney(totals.totalTtc - withholding, shownCurrency) ?? "",
            })}
          </strong>
        </div>
      </div>

      <div className={styles.formActions}>
        <Button
          variant="secondary"
          onClick={() => cancel(initial ? `/invoices/purchases/${initial.id}` : "/invoices/purchases")}
          disabled={busy}
        >
          {common("cancel")}
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          {initial ? common("saveChanges") : t("purchases.form.submit")}
        </Button>
      </div>
    </form>
  );
}
