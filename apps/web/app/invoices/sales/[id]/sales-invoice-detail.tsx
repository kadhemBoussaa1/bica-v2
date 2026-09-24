"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Documents,
  formatDay,
  formatMoney,
  InvoiceLines,
} from "../../invoice-ui";
import { Panel, Row, Val } from "../../../records/record-ui";
import { canAccess } from "@repo/api-contract";
import { DocumentPreview } from "../../../purchasing/document-preview";
import { useCurrentUser } from "../../../auth/use-auth";
import { useTRPC } from "../../../trpc/client";
import { SalesInvoiceDraft } from "./sales-invoice-draft";
import styles from "../../../records/records.module.css";

/**
 * A DRAFT renders the editor; an ISSUED invoice the read-only record. The
 * split is on `status`, which the server decides — the editor never has to
 * ask whether a field may still change.
 */
export function SalesInvoiceDetail({ id }: { id: string }) {
  const trpc = useTRPC();
  const t = useTranslations("invoices");
  const enums = useTranslations("enums");
  const { user } = useCurrentUser();
  const admin = user !== null && canAccess(user.role, "ADMIN");
  const invoiceQuery = useQuery(trpc.salesInvoice.byId.queryOptions({ id }));

  if (invoiceQuery.isPending) return <p className={styles.muted}>{t("loadingInvoice")}</p>;

  if (invoiceQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {invoiceQuery.error.message}
      </p>
    );
  }

  const inv = invoiceQuery.data;

  if (inv.status === "DRAFT") {
    // Keyed on the update stamp so a server-side rewrite of the lines
    // (refresh from packaging) re-seeds the editor's local copy.
    return <SalesInvoiceDraft key={`${inv.id}:${inv.lineCount}:${inv.totalTtc}`} invoice={inv} />;
  }

  const orders = inv.lines.flatMap((line) => (line.order ? [line.order] : []));

  // Issued here, so it has a generated PDF — loading it is also what mints
  // the stored file for this language the first time. A migrated invoice has
  // no snapshot to print from; its scan, below, is the original.
  const generated = inv.templateVersionId !== null && inv.numero !== null;

  const lines = (
    <Panel title={t("panels.lines", { count: inv.lineCount })} wide>
      <InvoiceLines lines={inv.lines} currency={inv.currency} />
    </Panel>
  );

  const record = (
    <div className={styles.detailGrid}>
      <Panel title={t("panels.invoice")}>
        <Row label={t("fields.number")}>
          <span className={styles.mono}>{inv.numero}</span>
        </Row>
        <Row label={t("fields.client")}>
          {inv.client ? (
            <>
              <Link className={styles.inlineLink} href={`/clients/${inv.client.id}`}>
                {inv.client.name}
              </Link>
              {!inv.client.active && <span className={styles.archivedTag}>{t("archived")}</span>}
            </>
          ) : (
            <span className={styles.muted}>{t("noClient")}</span>
          )}
        </Row>
        {orders.map((order) => (
          <Row key={order.id} label={t("fields.order")}>
            <Link className={styles.inlineLink} href={`/orders/${order.id}`}>
              {order.numero}
            </Link>
          </Row>
        ))}
        {/* The export this invoice travelled with (docs/export-plan.md). */}
        {inv.shipments.map((shipment) => (
          <Row key={shipment.id} label={t("fields.shipment")}>
            <Link className={styles.inlineLink} href={`/shipments/${shipment.id}`}>
              {shipment.numero ?? t("draftShipment")}
            </Link>
          </Row>
        ))}
        <Row label={t("fields.issued")}>
          <Val value={formatDay(inv.issuedAt)} />
          {inv.issuedBy && <span className={styles.muted}> · {inv.issuedBy.name}</span>}
        </Row>
        <Row label={t("fields.due")}>
          <Val value={formatDay(inv.dueAt)} />
        </Row>
        <Row label={t("fields.category")}>
          <Val value={inv.category} />
        </Row>
        {admin && (
          <Row label={t("fields.trace")}>
            <Link
              className={styles.inlineLink}
              href={`/settings/activity?entity=${encodeURIComponent(inv.id)}`}
            >
              {t("activityLink")}
            </Link>
          </Row>
        )}
      </Panel>

      {/* No status or paid-on row: nothing can record a payment on a sales
          invoice yet, so the page does not claim to know (see
          `SALES_INVOICE_FACET_KEYS`). The method is the one agreed at issue. */}
      <Panel title={t("panels.payment")}>
        <Row label={t("fields.method")}>
          <Val value={inv.paymentMethod ? enums(`paymentMethod.${inv.paymentMethod}`) : null} />
        </Row>
      </Panel>

      <Panel title={t("panels.amounts")}>
        <Row label={t("fields.exclVat")}>
          <Val value={formatMoney(inv.totalHt, inv.currency)} />
        </Row>
        <Row label={t("fields.vat")}>
          <Val value={formatMoney(inv.vatAmount, inv.currency)} />
        </Row>
        <Row label={t("fields.inclVat")}>
          <span className={styles.detailTotal}>
            <Val value={formatMoney(inv.totalTtc, inv.currency)} />
          </span>
        </Row>
        <Row label={t("fields.currency")}>
          <Val value={inv.currency} />
        </Row>
      </Panel>

      <Panel title={t("panels.documents", { count: inv.documents.length })}>
        <Documents documents={inv.documents} />
      </Panel>
    </div>
  );

  if (!generated || inv.numero === null) {
    return (
      <div className={styles.detailStack}>
        {record}
        {lines}
      </div>
    );
  }

  // The lines go full width under the two columns: beside the PDF they could
  // only scroll sideways, and the PDF already shows them.
  return (
    <div className={styles.detailStack}>
      <div className={styles.detailLayout}>
        <div className={styles.detailMain}>{record}</div>
        <aside className={styles.detailRail}>
          <Panel title={t("panels.pdf")}>
            <DocumentPreview
              kind="sales-invoice"
              id={inv.id}
              numero={inv.numero}
              hint={t("sales.pdfHint")}
            />
          </Panel>
        </aside>
      </div>
      {lines}
    </div>
  );
}
