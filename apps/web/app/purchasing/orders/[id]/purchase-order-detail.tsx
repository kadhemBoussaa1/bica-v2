"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useToast } from "@repo/ui/toast";
import { formatDay, formatMoney } from "../../../invoices/invoice-ui";
import { Panel, Row, Val } from "../../../records/record-ui";
import { DocumentPreview } from "../../document-preview";
import {
  CategoryBadge,
  formatQty,
  FulfilmentBadge,
  OrderLines,
  ReceiptStatusBadge,
} from "../../purchasing-ui";
import { useTRPC } from "../../../trpc/client";
import styles from "../../../records/records.module.css";
import invoices from "../../../invoices/invoices.module.css";
import purchasing from "../../purchasing.module.css";

/*
 * The record on the left, the document on the right.
 *
 * The left column stacks what the order is — its facts and supplier link, its
 * lines, and what has been received against it. The right column is the
 * generated PDF, sticky so it stays in view while the left column scrolls:
 * checking the lines against the printed page is the reason to put them side
 * by side. Both wrap to one column under 1100px.
 *
 * Follows `Purchasing v3.dc.html` for the panels and their content; the
 * handoff itself drew a narrow facts rail, which the wider document column
 * replaces. Two of its buttons are not built — "Receive goods" would be a
 * second way to create a receipt, and every order is now born with exactly
 * one, so the empty state links to that receipt instead — and its stat tiles
 * are left out for want of server aggregates behind them.
 */
export function PurchaseOrderDetail({ id }: { id: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { push } = useToast();
  const t = useTranslations("purchasing");
  const common = useTranslations("common");
  const orderQuery = useQuery(trpc.purchaseOrder.byId.queryOptions({ id }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removeMutation = useMutation(
    trpc.purchaseOrder.remove.mutationOptions({
      onSuccess: async () => {
        push({ title: t("orders.deleted"), tone: "success" });
        await queryClient.invalidateQueries({ queryKey: trpc.purchaseOrder.list.queryKey() });
        router.replace("/purchasing/orders");
      },
      // The server refuses an order that has receipts; show why rather than
      // leaving a spinner on a dead button.
      onError: (cause) => {
        setConfirmDelete(false);
        setError(cause.message);
      },
    }),
  );

  if (orderQuery.isPending) return <p className={styles.muted}>{t("orders.loading")}</p>;

  if (orderQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {orderQuery.error.message}
      </p>
    );
  }

  const order = orderQuery.data;
  const linesTotal = order.lines.reduce((sum, line) => sum + line.total, 0);
  // Born with the order, so there is normally exactly one.
  const receipt = order.receipts[0];

  return (
    <>
      {error && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      {/*
        The badges sit in their own start-aligned row: `.detailActions` is
        end-justified for buttons, and the route's `page.tsx` owns the title
        they would otherwise sit beside.
      */}
      <div className={purchasing.detailBadges}>
        <FulfilmentBadge fulfilment={order.fulfilment} />
        <CategoryBadge category={order.category} />
      </div>

      <div className={invoices.detailActions}>
        <Link href={`/purchasing/orders/${order.id}/edit`}>
          <Button variant="secondary">{common("edit")}</Button>
        </Link>
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          {common("delete")}
        </Button>
      </div>

      <div className={styles.detailLayout}>
        <div className={styles.detailMain}>
          <Panel title={t("orders.panel")}>
            <div className={purchasing.facts}>
              <div className={purchasing.fact}>
                <span className={purchasing.factLabel}>{t("fields.number")}</span>
                <span className={[purchasing.factValue, styles.mono].filter(Boolean).join(" ")}>
                  {order.numero}
                </span>
              </div>
              <div className={purchasing.fact}>
                <span className={purchasing.factLabel}>{t("fields.issued")}</span>
                <span className={purchasing.factValue}>
                  <Val value={formatDay(order.issuedAt)} />
                </span>
              </div>
              <div className={purchasing.fact}>
                <span className={purchasing.factLabel}>{t("fields.expected")}</span>
                <span className={purchasing.factValue}>
                  <Val value={formatDay(order.expectedAt)} />
                </span>
              </div>
              <div className={purchasing.fact}>
                <span className={purchasing.factLabel}>{t("fields.raisedBy")}</span>
                <span className={purchasing.factValue}>
                  <Val value={order.createdByName} />
                </span>
              </div>
              <div className={purchasing.fact}>
                <span className={purchasing.factLabel}>{t("fields.deliveryTo")}</span>
                <span className={purchasing.factValue}>
                  <Val value={order.address} />
                </span>
              </div>
              <div className={purchasing.fact}>
                <span className={purchasing.factLabel}>{t("fields.currency")}</span>
                <span className={purchasing.factValue}>{order.currency}</span>
              </div>
              <div className={purchasing.fact}>
                <span className={purchasing.factLabel}>{t("fields.quantityOrdered")}</span>
                <span className={purchasing.factValue}>
                  <Val value={formatQty(order.totalQuantity)} />
                </span>
              </div>
              <div className={purchasing.fact}>
                <span className={purchasing.factLabel}>{t("fields.notes")}</span>
                <span className={purchasing.factValue}>
                  <Val value={order.notes} />
                </span>
              </div>
            </div>

            <Link className={purchasing.railLink} href={`/suppliers/${order.supplier.id}`}>
              <span>
                {order.supplier.name}
                {!order.supplier.active && (
                  <span className={styles.archivedTag}>{t("archived")}</span>
                )}
              </span>
              <span className={purchasing.railLinkArrow} aria-hidden="true">
                →
              </span>
            </Link>
          </Panel>

          <Panel title={t("orders.linesPanel")}>
            <OrderLines lines={order.lines} currency={order.currency} hideTotal />
            <div className={purchasing.linesTotal}>
              <span className={purchasing.linesTotalLabel}>{t("lines.totalExclVat")}</span>
              <span className={purchasing.linesTotalValue}>
                <span className={purchasing.linesTotalFigure}>
                  {formatMoney(order.totalHt ?? linesTotal, null)}
                </span>
                <span className={purchasing.amountUnit}>{order.currency}</span>
              </span>
            </div>
          </Panel>

          <Panel title={t("orders.receiptsPanel", { count: order.receiptCount })}>
            {order.receipts.length === 0 ? (
              // Only the five legacy orders that were migrated without one.
              <p className={styles.muted}>{t("orders.noReceipts")}</p>
            ) : order.fulfilment === "PENDING" && receipt !== undefined ? (
              <div className={purchasing.emptyWell}>
                <div className={purchasing.emptyWellTitle}>{t("orders.nothingReceived")}</div>
                <p className={purchasing.emptyWellBody}>{t("orders.nothingReceivedBody")}</p>
                <p>
                  <Link href={`/purchasing/receipts/${receipt.id}`}>
                    <Button variant="primary">{t("orders.openReceipt")}</Button>
                  </Link>
                </p>
              </div>
            ) : (
              order.receipts.map((row) => (
                <Row key={row.id} label={formatDay(row.receivedAt ?? row.issuedAt) ?? ""}>
                  <Link className={styles.inlineLink} href={`/purchasing/receipts/${row.id}`}>
                    <span className={styles.mono}>{row.numero}</span>
                  </Link>{" "}
                  <ReceiptStatusBadge status={row.status} />
                  {row.receivedQuantity !== null && (
                    <span className={styles.muted}> · {formatQty(row.receivedQuantity)}</span>
                  )}
                </Row>
              ))
            )}
          </Panel>
        </div>

        {/*
          The document owns the right-hand column and sticks while the record
          on the left scrolls — the arrangement that makes checking the lines
          against the printed page worth doing side by side.
        */}
        <aside className={styles.detailRail}>
          <Panel title={t("orders.documentPanel")}>
            <DocumentPreview kind="purchase-order" id={order.id} numero={order.numero} />
          </Panel>
        </aside>
      </div>

      <Dialog
        open={confirmDelete}
        title={t("orders.deleteTitle", { numero: order.numero })}
        confirmLabel={common("delete")}
        destructive
        busy={removeMutation.isPending}
        onConfirm={() => removeMutation.mutate({ id: order.id })}
        onClose={() => !removeMutation.isPending && setConfirmDelete(false)}
      >
        <p className={styles.muted}>{t("orders.deleteBody", { count: order.lineCount })}</p>
      </Dialog>
    </>
  );
}
