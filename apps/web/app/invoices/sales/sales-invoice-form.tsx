"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  createSalesInvoiceInput,
  CURRENCIES,
  invoiceTotals,
  PAYMENT_METHODS,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { SelectField, TextField } from "@repo/ui/field";
import { useToast } from "@repo/ui/toast";
import {
  InvoiceLinesEditor,
  newEditableLine,
  toLineInput,
  type EditableLine,
} from "../invoice-lines-editor";
import { formatMoney } from "../invoice-ui";
import { useTRPC } from "../../trpc/client";
import styles from "../../records/records.module.css";
import invoices from "../invoices.module.css";

/**
 * Raises a sales invoice for something other than a job order — the ordinary
 * case, not an exception: 47 of the 48 migrated invoices name no order.
 *
 * Create only, unlike the purchase form. Once the draft exists, editing it is
 * `sales-invoice-draft.tsx`'s job — it already owns the header fields, the
 * lines, and issue/discard — so duplicating an edit mode here would give the
 * same draft two editors that could disagree.
 *
 * `toLineInput` carries an `orderId`, always null for lines typed here;
 * `createSalesInvoiceInput` builds on the plain `invoiceLineInput`, whose Zod
 * object strips the key, which is what keeps this path out of the
 * order-billing lifecycle. Same helper, same stripping as the purchase form.
 */
export function SalesInvoiceForm({
  onDone,
  onCancel,
}: {
  onDone?: (target: string) => void | Promise<void>;
  onCancel?: (target: string) => void;
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

  const [clientId, setClientId] = useState("");
  const [currency, setCurrency] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [category, setCategory] = useState("");
  const [lines, setLines] = useState<EditableLine[]>(() => [newEditableLine(1)]);
  const [error, setError] = useState<string | null>(null);

  // Active clients only: the server refuses an archived one, so the picker
  // must not offer it.
  const clientsQuery = useQuery(
    trpc.client.list.queryOptions({ pageSize: 100, sortBy: "name", sortDir: "asc" }),
  );
  const clients = (clientsQuery.data?.rows ?? []).filter((c) => c.active);

  const create = useMutation(
    trpc.salesInvoice.create.mutationOptions({
      onSuccess: async (created) => {
        // No number yet — it is assigned at issue — so the toast names the
        // client instead.
        push({
          title: t("sales.draftCreated", {
            client: clients.find((c) => c.id === created.clientId)?.name ?? "",
          }),
          tone: "success",
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.salesInvoice.list.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.salesInvoice.byId.queryKey() }),
        ]);
        await go(`/invoices/sales/${created.id}`);
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const busy = create.isPending;

  const inputs = lines.map((line, index) => toLineInput(line, index + 1));
  const totals = invoiceTotals(inputs);
  const shownCurrency = currency || null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = createSalesInvoiceInput.safeParse({
      clientId,
      currency: currency || null,
      dueAt: dueAt || null,
      paymentMethod: paymentMethod || null,
      category: category.trim() || null,
      lines: inputs,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue ? `${issue.path.join(".")}: ${issue.message}` : common("checkForm"));
      return;
    }
    create.mutate(parsed.data);
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
        <div>
          <SelectField
            label={t("fields.client")}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={busy || clientsQuery.isPending}
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            placeholder={clientsQuery.isPending ? t("loading") : t("sales.form.chooseClient")}
          />
          <p className={styles.hint}>
            {t.rich("sales.form.clientHint", {
              link: (chunks) => (
                <Link className={styles.inlineLink} href="/clients/new">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
        <TextField
          label={t("fields.category")}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />

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
          label={t("fields.due")}
          type="date"
          format="mono"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
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
        <div />

        <span className={styles.formSection}>{t("sales.form.linesSection")}</span>
        <div className={styles.formWide}>
          <InvoiceLinesEditor
            lines={lines}
            onChange={setLines}
            currency={shownCurrency}
            busy={busy}
            maxLines={50}
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
          <strong>
            {t("purchases.form.totals.inclVat", {
              amount: formatMoney(totals.totalTtc, shownCurrency) ?? "",
            })}
          </strong>
        </div>
      </div>

      <div className={styles.formActions}>
        <Button variant="secondary" onClick={() => cancel("/invoices/sales")} disabled={busy}>
          {common("cancel")}
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          {t("sales.form.submit")}
        </Button>
      </div>
    </form>
  );
}
