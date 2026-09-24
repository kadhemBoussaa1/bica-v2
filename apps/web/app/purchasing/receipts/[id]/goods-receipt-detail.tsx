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
import { formatDay, formatMoney } from "../../../invoices/invoice-ui";
import { Panel, Row, Val } from "../../../records/record-ui";
import { DocumentPreview, ScanPreview } from "../../document-preview";
import { CategoryBadge, formatQty, ReceiptStatusBadge } from "../../purchasing-ui";
import { useTRPC } from "../../../trpc/client";
import styles from "../../../records/records.module.css";
import invoices from "../../../invoices/invoices.module.css";
import purchasing from "../../purchasing.module.css";

/*
 * From `Goods receipts v3.dc.html`: the record on the left — its lines against
 * the order, and whether an invoice names it — beside a rail carrying the
 * facts, the onward links, and the delivery note itself.
 *
 * Three parts of the handoff are not built, each for want of anything behind
 * it. Its per-line unit ("in sacks", "in rolls") has no column on either the
 * receipt or the order line, and with it goes the whole mixed-unit branch that
 * switched the aggregates to "lines complete". Its Trail timeline restated
 * facts already in the panels, so the rail keeps the Activity link the handoff
 * also drew and drops the list — the same call docs/toolkit-v3.md records for
 * the shipment handoff. Its "Record arrival" / "Validate receipt" buttons are
 * the edit form, which owns those quantities and derives `validated` from
 * them.
 */
export function GoodsReceiptDetail({ id }: { id: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { push } = useToast();
  const t = useTranslations("purchasing");
  const common = useTranslations("common");
  const receiptQuery = useQuery(trpc.goodsReceipt.byId.queryOptions({ id }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removeMutation = useMutation(
    trpc.goodsReceipt.remove.mutationOptions({
      onSuccess: async () => {
        push({ title: t("receipts.deleted"), tone: "success" });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.goodsReceipt.list.queryKey() }),
          // The order's received figures and fulfilment drop back with this.
          queryClient.invalidateQueries({ queryKey: trpc.purchaseOrder.list.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.purchaseOrder.byId.queryKey() }),
        ]);
        router.replace("/purchasing/receipts");
      },
      // Refused while an invoice names it — show why rather than spinning.
      onError: (cause) => {
        setConfirmDelete(false);
        setError(cause.message);
      },
    }),
  );

  if (receiptQuery.isPending) return <p className={styles.muted}>{t("receipts.loading")}</p>;

  if (receiptQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {receiptQuery.error.message}
      </p>
    );
  }

  const receipt = receiptQuery.data;

  /*
   * Ordered and received across the lines, and what is still owed.
   *
   * Only lines still attached to an order line can be measured: `orderLineId`
   * is `SetNull`, so a receipt outlives an edit to its order and a detached
   * line has no ordered figure to compare against. Those lines show an absent
   * marker rather than a guess, exactly as the lines table does.
   */
  const measurable = receipt.lines.filter((line) => line.orderLine !== null);
  const ordered = measurable.reduce((sum, line) => sum + (line.orderLine?.quantity ?? 0), 0);
  const received = measurable.reduce((sum, line) => sum + (line.receivedQuantity ?? 0), 0);
  const outstanding = Math.max(0, ordered - received);
  const short = measurable.filter(
    (line) => (line.receivedQuantity ?? 0) < (line.orderLine?.quantity ?? 0) - 0.01,
  );
  const settled = measurable.length > 0 && short.length === 0;

  return (
    <>
      {error && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <div className={purchasing.detailBadges}>
        <ReceiptStatusBadge status={receipt.status} />
        <CategoryBadge category={receipt.category} />
      </div>

      <div className={invoices.detailActions}>
        <Link href={`/purchasing/receipts/${receipt.id}/edit`}>
          <Button variant="secondary">{common("edit")}</Button>
        </Link>
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          {common("delete")}
        </Button>
      </div>

      <div className={styles.detailLayout}>
        <div className={styles.detailMain}>
          <Panel title={t("receipts.detail.linesPanel")}>
            <div className={invoices.linesScroll}>
              <table className={invoices.lines}>
                <thead>
                  <tr>
                    <th className={invoices.num}>#</th>
                    <th>{t("lines.designation")}</th>
                    <th className={invoices.num}>{t("receipts.detail.ordered")}</th>
                    <th className={invoices.num}>{t("receipts.detail.received")}</th>
                    <th>{t("receipts.detail.against")}</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.lines.map((line) => {
                    const orderedQty = line.orderLine?.quantity ?? null;
                    const receivedQty = line.receivedQuantity ?? 0;
                    // A detached line, or a transport line with no quantity:
                    // no denominator, so no bar.
                    const measured = orderedQty !== null && orderedQty > 0;
                    const pct = measured
                      ? Math.min(100, Math.round((receivedQty / orderedQty) * 100))
                      : 0;
                    const left = measured ? Math.max(0, orderedQty - receivedQty) : 0;
                    const done = measured && left <= 0.01;
                    return (
                      <tr key={line.id}>
                        <td className={invoices.num}>{line.position}</td>
                        <td className={invoices.description}>{line.designation}</td>
                        <td className={invoices.num}>
                          {orderedQty === null ? (
                            <span className={styles.absent} />
                          ) : (
                            formatQty(orderedQty)
                          )}
                        </td>
                        <td
                          className={[
                            invoices.num,
                            line.receivedQuantity === null
                              ? purchasing.recNone
                              : done
                                ? purchasing.recDone
                                : receivedQty === 0
                                  ? purchasing.recNone
                                  : purchasing.recShort,
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {line.receivedQuantity === null ? (
                            <span className={styles.absent} />
                          ) : (
                            formatQty(receivedQty)
                          )}
                        </td>
                        <td>
                          {measured ? (
                            <span className={purchasing.progress}>
                              <span className={purchasing.progressHead}>
                                <span className={purchasing.progressLeft}>
                                  {done
                                    ? t("receipts.detail.complete")
                                    : t("receipts.detail.left", { n: formatQty(left) ?? "" })}
                                </span>
                                <span
                                  className={[
                                    purchasing.progressPct,
                                    done ? purchasing.recDone : purchasing.recShort,
                                  ]
                                    .filter(Boolean)
                                    .join(" ")}
                                >
                                  {pct}%
                                </span>
                              </span>
                              <span className={purchasing.progressTrack}>
                                <span
                                  className={[
                                    purchasing.progressBar,
                                    done ? purchasing.progressBarDone : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" ")}
                                  style={{ width: `${pct}%` }}
                                />
                              </span>
                            </span>
                          ) : (
                            <span className={styles.absent} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {measurable.length > 0 && (
              <div className={purchasing.linesFoot}>
                <span className={purchasing.linesTotalLabel}>
                  {settled
                    ? t("receipts.detail.fullyReceived")
                    : t("receipts.detail.outstanding")}
                </span>
                <span className={purchasing.linesTotalValue}>
                  <span
                    className={[
                      purchasing.linesTotalFigure,
                      settled ? purchasing.linesFootDone : purchasing.linesFootShort,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {formatQty(settled ? received : outstanding)}
                  </span>
                </span>
              </div>
            )}
          </Panel>

          <Panel title={t("receipts.invoicingPanel")}>
            {/*
              Two views of the same link, as before: the number typed on the
              note, and the invoices that structurally name this receipt.
            */}
            <Row label={t("fields.invoiceOnNote")}>
              <Val value={receipt.invoiceNumber} />
            </Row>
            {receipt.invoices.length === 0 ? (
              <div className={purchasing.emptyWell}>
                <div className={purchasing.emptyWellTitle}>
                  {t("receipts.detail.notInvoiced")}
                </div>
                <p className={purchasing.emptyWellBody}>
                  {t("receipts.detail.notInvoicedBody")}
                </p>
              </div>
            ) : (
              receipt.invoices.map((invoice) => (
                <Row key={invoice.id} label={formatDay(invoice.issuedAt) ?? t("fields.invoice")}>
                  <Link className={styles.inlineLink} href={`/invoices/purchases/${invoice.id}`}>
                    <span className={styles.mono}>{invoice.numero}</span>
                  </Link>
                  {invoice.totalTtc !== null && (
                    <span className={styles.muted}>
                      {" "}
                      · {formatMoney(invoice.totalTtc, invoice.currency)}
                    </span>
                  )}
                </Row>
              ))
            )}
          </Panel>
        </div>

        <aside className={styles.detailRail}>
          <Panel title={t("receipts.panel")}>
            <div className={purchasing.facts}>
              <div className={purchasing.fact}>
                <span className={purchasing.factLabel}>{t("fields.number")}</span>
                <span className={[purchasing.factValue, styles.mono].filter(Boolean).join(" ")}>
                  {receipt.numero}
                </span>
              </div>
              <div className={purchasing.fact}>
                <span className={purchasing.factLabel}>{t("fields.raised")}</span>
                <span className={purchasing.factValue}>
                  <Val value={formatDay(receipt.issuedAt)} />
                </span>
              </div>
              <div className={purchasing.fact}>
                <span className={purchasing.factLabel}>{t("fields.received")}</span>
                <span className={purchasing.factValue}>
                  <Val value={formatDay(receipt.receivedAt)} />
                </span>
              </div>
              <div className={purchasing.fact}>
                <span className={purchasing.factLabel}>{t("fields.validated")}</span>
                <span className={purchasing.factValue}>
                  {receipt.validated ? t("yes") : t("no")}
                </span>
              </div>
              <div className={purchasing.fact}>
                <span className={purchasing.factLabel}>{t("fields.quantityReceived")}</span>
                <span className={purchasing.factValue}>
                  <Val value={formatQty(receipt.receivedQuantity)} />
                </span>
              </div>
              <div className={purchasing.fact}>
                <span className={purchasing.factLabel}>{t("fields.lastUpdatedBy")}</span>
                <span className={purchasing.factValue}>
                  <Val value={receipt.updatedByName} />
                </span>
              </div>
              <div className={purchasing.fact}>
                <span className={purchasing.factLabel}>{t("fields.notes")}</span>
                <span className={purchasing.factValue}>
                  <Val value={receipt.notes} />
                </span>
              </div>
            </div>

            {/* The two documents this note sits between, and its own trail. */}
            <Link className={purchasing.railLink} href={`/purchasing/orders/${receipt.order.id}`}>
              <span>
                {t("fields.order")} <span className={styles.mono}>{receipt.order.numero}</span>
              </span>
              <span className={purchasing.railLinkArrow} aria-hidden="true">
                →
              </span>
            </Link>
            <Link className={purchasing.railLink} href={`/suppliers/${receipt.supplier.id}`}>
              <span>
                {receipt.supplier.name}
                {!receipt.supplier.active && (
                  <span className={styles.archivedTag}>{t("archived")}</span>
                )}
              </span>
              <span className={purchasing.railLinkArrow} aria-hidden="true">
                →
              </span>
            </Link>
            <Link
              className={purchasing.railLink}
              href={`/settings/activity?entity=${encodeURIComponent(receipt.id)}`}
            >
              <span>{t("receipts.detail.activityLink")}</span>
              <span className={purchasing.railLinkArrow} aria-hidden="true">
                →
              </span>
            </Link>
          </Panel>

          <Panel title={t("preview.panel")}>
            <DocumentPreview kind="goods-receipt" id={receipt.id} numero={receipt.numero} />
          </Panel>

          <Panel title={t("preview.scanPanel")}>
            {receipt.invoiceUrl ? (
              <ScanPreview
                url={assetUrl(receipt.invoiceUrl) ?? receipt.invoiceUrl}
                label={t("preview.scanPanel")}
              />
            ) : (
              <div className={purchasing.emptyWell}>
                <div className={purchasing.emptyWellTitle}>{t("receipts.detail.noScan")}</div>
                <p className={purchasing.emptyWellBody}>{t("receipts.detail.noScanBody")}</p>
              </div>
            )}
          </Panel>
        </aside>
      </div>

      <Dialog
        open={confirmDelete}
        title={t("receipts.deleteTitle", { numero: receipt.numero })}
        confirmLabel={common("delete")}
        destructive
        busy={removeMutation.isPending}
        onConfirm={() => removeMutation.mutate({ id: receipt.id })}
        onClose={() => !removeMutation.isPending && setConfirmDelete(false)}
      >
        <p className={styles.muted}>{t("receipts.deleteBody", { count: receipt.lineCount })}</p>
      </Dialog>
    </>
  );
}
