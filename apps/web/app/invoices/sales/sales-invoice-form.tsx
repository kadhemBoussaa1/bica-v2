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
  toLineInput,
  type EditableLine,
} from "../invoice-lines-editor";
import { formatMoney } from "../invoice-ui";
import {
  InvoiceOrderPicker,
  orderLine,
  type InvoiceableOrder,
} from "./invoice-order-picker";
import { useTRPC } from "../../trpc/client";
import styles from "../../records/records.module.css";
import invoices from "../invoices.module.css";

/**
 * Raises a sales invoice: tick the orders it bills — of one client or of
 * several — each becoming a line at the order's parcel price and its packed
 * parcels, both editable, and type any other lines. The invoice bills the
 * ticked orders' clients; the client field is picked by hand only for an
 * invoice of typed lines alone, the ordinary case in the migrated data (47
 * of 48 name no order).
 *
 * The ticked orders ARE the order lines: the checkboxes read and write
 * `lines`, so removing a line in the table unticks its order too. Saving
 * moves every ticked order to INVOICED on the server.
 *
 * Create only, unlike the purchase form. Once the draft exists, editing it is
 * `sales-invoice-draft.tsx`'s job — it already owns the header fields, the
 * lines, and issue/discard — so duplicating an edit mode here would give the
 * same draft two editors that could disagree.
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
  // No line to start with: ticking an order adds one, "Add a line" a typed one.
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Active clients only: the server refuses an archived one, so the picker
  // must not offer it.
  const clientsQuery = useQuery(
    trpc.client.list.queryOptions({ pageSize: 100, sortBy: "name", sortDir: "asc" }),
  );
  const clients = (clientsQuery.data?.rows ?? []).filter((c) => c.active);

  // Every client's orders ready for invoicing: one invoice may bill several.
  const ordersQuery = useQuery(trpc.salesInvoice.invoiceableOrders.queryOptions({}));
  const orders = ordersQuery.data?.orders ?? [];
  const selected = new Set(lines.flatMap((line) => (line.orderId ? [line.orderId] : [])));
  const nextKey = () => lines.reduce((max, line) => Math.max(max, line.key), 0) + 1;

  // Whom the invoice bills once orders are ticked: their clients, in line
  // order — the server derives the same, and the client field follows.
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const billed = [
    ...new Map(
      lines.flatMap((line) => {
        const client = line.orderId ? orderById.get(line.orderId)?.client : null;
        return client ? [[client.id, client] as const] : [];
      }),
    ).values(),
  ];
  const billsOrders = selected.size > 0;
  const billedNames = billed.map((client) => client.name).join(", ");

  const toggle = (order: InvoiceableOrder, checked: boolean) => {
    setLines((current) =>
      checked
        ? [...current, orderLine(order, nextKey())]
        : current.filter((line) => line.orderId !== order.id),
    );
    // The client's usual currency, unless one was already chosen.
    if (checked && currency === "" && order.clientCurrency) setCurrency(order.clientCurrency);
  };

  const create = useMutation(
    trpc.salesInvoice.create.mutationOptions({
      onSuccess: async (created) => {
        // No number yet — it is assigned at issue — so the toast names the
        // client instead.
        push({
          title: t("sales.draftCreated", {
            client: billsOrders
              ? billedNames
              : (clients.find((c) => c.id === created.clientId)?.name ?? ""),
          }),
          tone: "success",
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.salesInvoice.list.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.salesInvoice.byId.queryKey() }),
          queryClient.invalidateQueries({
            queryKey: trpc.salesInvoice.invoiceableOrders.queryKey(),
          }),
          // The ticked orders are INVOICED now.
          queryClient.invalidateQueries({ queryKey: trpc.order.byId.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.order.list.queryKey() }),
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
    if (lines.length === 0) {
      setError(t("sales.form.noLines"));
      return;
    }
    if (!billsOrders && clientId === "") {
      setError(t("sales.form.noClient"));
      return;
    }

    const parsed = createSalesInvoiceInput.safeParse({
      // Ignored by the server once an order is ticked: it bills the orders' clients.
      clientId: billsOrders ? null : clientId,
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
        {billsOrders ? (
          // Follows the ticked orders: the invoice bills their clients.
          <div>
            <SelectField
              label={billed.length > 1 ? t("sales.form.clients") : t("fields.client")}
              value="billed"
              options={[{ value: "billed", label: billedNames }]}
              disabled
            />
            <p className={styles.hint}>
              {billed.length > 1
                ? t("sales.form.severalClientsHint")
                : t("sales.form.clientFromOrders")}
            </p>
          </div>
        ) : (
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
        )}
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

        <span className={styles.formSection}>{t("sales.form.ordersSection")}</span>
        <div className={styles.formWide}>
          {/* Keyed on the client picked above, so the filter starts on it. */}
          <InvoiceOrderPicker
            key={clientId}
            orders={orders}
            pending={ordersQuery.isPending}
            selected={selected}
            currency={shownCurrency}
            busy={busy}
            initialClientId={clientId}
            onToggle={toggle}
          />
        </div>

        <span className={styles.formSection}>{t("sales.form.linesSection")}</span>
        <div className={styles.formWide}>
          {lines.length === 0 && <p className={styles.muted}>{t("sales.form.noLinesYet")}</p>}
          <InvoiceLinesEditor
            lines={lines}
            onChange={setLines}
            currency={shownCurrency}
            busy={busy}
            maxLines={50}
            allowEmpty
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
