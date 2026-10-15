"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import { useToast } from "@repo/ui/toast";
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
import { BilledClients, billedClients } from "../billed-clients";
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
  const queryClient = useQueryClient();
  const router = useRouter();
  const { push } = useToast();
  const [actionError, setActionError] = useState<string | null>(null);

  // One truck per invoice: the shipment carries every order the invoice bills.
  const createShipment = useMutation(
    trpc.shipment.createFromInvoice.mutationOptions({
      onSuccess: async (created) => {
        push({ title: t("sales.shipmentCreated"), tone: "success" });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.salesInvoice.byId.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.shipment.list.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.order.byId.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.order.list.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.nav.counts.queryKey() }),
        ]);
        router.push(`/shipments/${created.id}`);
      },
      onError: (cause) => setActionError(cause.message),
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

  if (inv.status === "DRAFT") {
    // Keyed on the update stamp so a server-side rewrite of the lines
    // (refresh from packaging) re-seeds the editor's local copy.
    return <SalesInvoiceDraft key={`${inv.id}:${inv.lineCount}:${inv.totalTtc}`} invoice={inv} />;
  }

  const orders = inv.lines.flatMap((line) => (line.order ? [line.order] : []));
  // Issued, billing orders, and not yet on a truck — the server re-checks
  // every order and says why if one is not ready.
  const shippable = orders.length > 0 && inv.shipments.length === 0;

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
          <BilledClients clients={billedClients(inv)} />
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
        {shippable && (
          <Row label={t("fields.shipment")}>
            <Button
              size="dense"
              variant="primary"
              busy={createShipment.isPending}
              onClick={() => {
                setActionError(null);
                createShipment.mutate({ invoiceId: inv.id });
              }}
            >
              {t("sales.createShipment")}
            </Button>
          </Row>
        )}
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

  const notice = actionError && (
    <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
      {actionError}
    </p>
  );

  if (!generated || inv.numero === null) {
    return (
      <div className={styles.detailStack}>
        {notice}
        {record}
        {lines}
      </div>
    );
  }

  // The lines go full width under the two columns: beside the PDF they could
  // only scroll sideways, and the PDF already shows them.
  return (
    <div className={styles.detailStack}>
      {notice}
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
