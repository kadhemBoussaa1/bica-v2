"use client";

import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { CheckboxField, SelectField } from "@repo/ui/field";
import type { EditableLine } from "../invoice-lines-editor";
import { formatMoney } from "../invoice-ui";
import records from "../../records/records.module.css";
import styles from "../invoices.module.css";
import { numberFormat } from "../../../i18n/formats";

export type InvoiceableOrder =
  inferRouterOutputs<AppRouter>["salesInvoice"]["invoiceableOrders"]["orders"][number];

/** The line an order starts as on the invoice, as the editor holds it. */
export function orderLine(order: InvoiceableOrder, key: number): EditableLine {
  const { line } = order;
  return {
    key,
    orderId: line.orderId,
    orderNumero: order.numero,
    mention: null,
    product: line.product,
    description: line.description,
    quantity: String(line.quantity),
    unitPrice: String(Number(line.unitPrice.toFixed(6))),
    discountPct: String(line.discountPct),
    taxPct: String(line.taxPct),
  };
}

/** The value of the filter's "every client" choice. */
const ALL = "";
/** The group of orders with no client, which cannot be billed until they have one. */
const NO_CLIENT = "-";

/**
 * The orders an invoice can bill, one checkbox each — the new-invoice
 * dialog and the draft's "Add an order". Every client's, grouped by client,
 * since one invoice may bill several; the filter narrows to one. Ticking an
 * order adds its line (the order's parcel price, its packed parcels),
 * unticking removes it; the caller owns the lines, so this only reports the
 * toggle.
 *
 * An order that cannot be billed stays listed, disabled, with the reason:
 * a missing order is a question somebody would otherwise have to ask.
 */
export function InvoiceOrderPicker({
  orders,
  pending,
  selected,
  onToggle,
  currency,
  busy,
  initialClientId = ALL,
}: {
  orders: readonly InvoiceableOrder[];
  pending: boolean;
  /** The order ids already on the invoice's lines. */
  selected: ReadonlySet<string>;
  onToggle: (order: InvoiceableOrder, checked: boolean) => void;
  currency: string | null;
  busy: boolean;
  /** The client the filter starts on; every client when omitted. */
  initialClientId?: string;
}) {
  const t = useTranslations("invoices");
  const int = numberFormat({ maximumFractionDigits: 0 });
  const [clientId, setClientId] = useState(initialClientId);

  if (pending) return <p className={records.muted}>{t("sales.orders.loading")}</p>;
  if (orders.length === 0) return <p className={records.muted}>{t("sales.orders.none")}</p>;

  // The clients present, in the server's order (by name).
  const clients = [
    ...new Map(
      orders.map((order) => [order.client?.id ?? NO_CLIENT, order.client?.name ?? null] as const),
    ),
  ];
  // A filter left on a client with nothing ready shows everyone instead.
  const filter = clients.some(([id]) => id === clientId) ? clientId : ALL;
  const shown = clients.filter(([id]) => filter === ALL || id === filter);

  return (
    <div className={styles.orderPickerWrap}>
      {clients.length > 1 && (
        <div className={styles.orderPickerFilter}>
          <SelectField
            label={t("sales.orders.filter")}
            size="dense"
            value={filter}
            onChange={(e) => setClientId(e.target.value)}
            options={[
              { value: ALL, label: t("sales.orders.allClients", { count: clients.length }) },
              ...clients.map(([id, name]) => ({
                value: id,
                label: name ?? t("sales.orders.noClientGroup"),
              })),
            ]}
            disabled={busy}
          />
        </div>
      )}
      {shown.map(([groupId, groupName]) => (
        <Fragment key={groupId}>
          {clients.length > 1 && (
            <span className={styles.orderPickerGroup}>
              {groupName ?? t("sales.orders.noClientGroup")}
            </span>
          )}
          <div className={styles.orderPicker}>
            {orders
              .filter((order) => (order.client?.id ?? NO_CLIENT) === groupId)
              .map((order) => {
                const facts = [
                  order.planned === null
                    ? null
                    : order.packed > 0
                      ? t("sales.orders.packedOf", {
                          packed: int.format(order.packed),
                          planned: int.format(order.planned),
                        })
                      : t("sales.orders.nothingPacked", { planned: int.format(order.planned) }),
                  order.invoicedBefore > 0
                    ? t("sales.orders.invoicedBefore", { count: int.format(order.invoicedBefore) })
                    : null,
                  order.blocked === null
                    ? t("sales.orders.perParcel", {
                        price: formatMoney(order.line.unitPrice, currency) ?? "",
                      })
                    : null,
                ].filter((fact): fact is string => fact !== null);
                return (
                  <CheckboxField
                    key={order.id}
                    label={`${order.numero} · ${order.line.product}`}
                    hint={
                      order.blocked === null
                        ? facts.join(" · ")
                        : t(`sales.orders.blocked.${order.blocked}`)
                    }
                    checked={selected.has(order.id)}
                    disabled={busy || (order.blocked !== null && !selected.has(order.id))}
                    onChange={(e) => onToggle(order, e.target.checked)}
                  />
                );
              })}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
