"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import {
  assetFileName,
  assetUrl,
  PAYMENT_METHODS,
  plantDay,
  UPLOAD_CONTENT_TYPES,
  UPLOAD_MAX_BYTES,
  type PaymentMethod,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { DateField } from "@repo/ui/date-field";
import { Dialog } from "@repo/ui/dialog";
import { SelectField } from "@repo/ui/field";
import { useFileUpload } from "@repo/ui/file-upload";
import { useToast } from "@repo/ui/toast";
import { numberFormat } from "../../../../i18n/formats";
import { initials } from "../../../nav/initials";
import { useTRPC } from "../../../trpc/client";
import {
  daysUntil,
  formatAmount,
  formatDay,
  PURCHASE_STATE_TONE,
  purchaseState,
} from "../../invoice-ui";
import records from "../../../records/records.module.css";
import shell from "../../../records/banded-list.module.css";
import styles from "./purchase-invoice-detail.module.css";

/*
 * From `Facture Achat Detail.dc.html` (project "Kraft paper bag ERP
 * toolkit"). The header names the invoice, its payment state, the supplier
 * and the receipt it bills; a strip of figures leads with what is still to
 * pay; the lines, the details and the payment sit on the left, and the
 * supplier's own scan on the right, sticky, so the two are read side by side.
 *
 * Wired where the handoff is a mock: "+ Ajouter" on a detail opens the edit
 * form (the full form, which already writes every field); "Enregistrer le
 * paiement" records the date and the method through its own procedure; the
 * scan's "Page 1 / 1" becomes the document's place among the invoice's
 * scans (a PDF's own pages are the browser viewer's), and "Joindre un
 * document" uploads one more. "Imprimer" and "Dupliquer" are not ported —
 * the scan prints from that viewer, and nothing duplicates a supplier's
 * numbered invoice — so the overflow menu holds the delete.
 */

type Invoice = inferRouterOutputs<AppRouter>["purchaseInvoice"]["byId"];

/** The viewer's zoom steps, in percent of the box's width. */
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 25;

/** A dash for "never recorded", so absent never reads as zero. */
function money(value: number | null): string {
  return value === null ? "—" : formatAmount(value);
}

/** The module's header while the invoice is loading or failed to. */
function RouteHeader() {
  const t = useTranslations("invoices");
  return (
    <header className={records.header}>
      <div className={records.heading}>
        <span className={records.eyebrow}>{t("eyebrow")}</span>
        <h1 className={records.title}>{t("purchases.detailTitle")}</h1>
      </div>
      <p className={records.subtitle}>{t("purchases.detailSubtitle")}</p>
    </header>
  );
}

export function PurchaseInvoiceDetail({ id }: { id: string }) {
  const trpc = useTRPC();
  const t = useTranslations("invoices");
  const invoiceQuery = useQuery(trpc.purchaseInvoice.byId.queryOptions({ id }));

  if (invoiceQuery.isPending) {
    return (
      <>
        <RouteHeader />
        <p className={records.muted}>{t("loadingInvoice")}</p>
      </>
    );
  }

  if (invoiceQuery.isError) {
    return (
      <>
        <RouteHeader />
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {invoiceQuery.error.message}
        </p>
      </>
    );
  }

  return <InvoiceRecord invoice={invoiceQuery.data} />;
}

function InvoiceRecord({ invoice: inv }: { invoice: Invoice }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { push } = useToast();
  const t = useTranslations("invoices");
  const common = useTranslations("common");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = purchaseState(inv);
  const unpaid = inv.paidAt === null;
  const editHref = `/invoices/purchases/${inv.id}/edit`;

  const removeMutation = useMutation(
    trpc.purchaseInvoice.remove.mutationOptions({
      onSuccess: async () => {
        push({ title: t("purchases.deleted"), tone: "success" });
        await queryClient.invalidateQueries({ queryKey: trpc.purchaseInvoice.list.queryKey() });
        router.replace("/invoices/purchases");
      },
      onError: (cause) => {
        setConfirmDelete(false);
        setError(cause.message);
      },
    }),
  );

  return (
    <>
      <header className={[records.header, styles.hero].filter(Boolean).join(" ")}>
        <div className={styles.heroMain}>
          <span className={records.eyebrow}>{t("eyebrow")}</span>
          <div className={styles.titleRow}>
            <h1 className={records.title}>
              {t.rich("purchases.detail.title", {
                numero: inv.numero,
                no: (chunks) => <bdi className={styles.titleNo}>{chunks}</bdi>,
              })}
            </h1>
            <span className={[shell.pill, PURCHASE_STATE_TONE[state]].filter(Boolean).join(" ")}>
              <i className={shell.pillDot} aria-hidden />
              {state === "paid" && inv.paidAt !== null
                ? t("purchases.detail.paidOn", { date: formatDay(inv.paidAt) ?? "" })
                : t(`purchases.state.${state}`)}
            </span>
          </div>
          <div className={styles.meta}>
            <Link className={styles.supplier} href={`/suppliers/${inv.supplier.id}`}>
              <span className={styles.avatar} aria-hidden>
                {initials(inv.supplier.name)}
              </span>
              {inv.supplier.name}
            </Link>
            {!inv.supplier.active && <span className={records.archivedTag}>{t("archived")}</span>}
            {inv.issuedAt !== null && (
              <span className={styles.metaPart}>
                {t.rich("purchases.detail.issuedOn", {
                  date: formatDay(inv.issuedAt) ?? "",
                  b: (chunks) => <bdi className={styles.metaFigure}>{chunks}</bdi>,
                })}
              </span>
            )}
            {/*
              The goods receipt this was raised against. Resolved for 135 of
              the 136 invoices that name one; the last points at a legacy
              receipt that no longer exists, so its reference is shown as-is.
            */}
            {inv.receipt ? (
              <span className={styles.metaPart}>
                {t.rich("purchases.detail.receipt", {
                  numero: inv.receipt.numero,
                  link: (chunks) => (
                    <Link className={styles.metaLink} href={`/purchasing/receipts/${inv.receipt?.id ?? ""}`}>
                      <bdi>{chunks}</bdi>
                    </Link>
                  ),
                })}
              </span>
            ) : (
              inv.legacyReceiptType && (
                <span className={styles.metaPart}>
                  {t.rich("purchases.detail.legacyReceipt", {
                    ref: `${inv.legacyReceiptType}${inv.legacyReceiptId !== null ? ` #${inv.legacyReceiptId}` : ""}`,
                    b: (chunks) => <bdi className={styles.metaFigure}>{chunks}</bdi>,
                  })}
                </span>
              )
            )}
          </div>
        </div>

        <div className={styles.heroActions}>
          <Link href={editHref}>
            <Button variant="secondary">{common("edit")}</Button>
          </Link>
          {unpaid && (
            <Button variant="primary" onClick={() => setPaying(true)}>
              {t("purchases.detail.recordPayment")}
            </Button>
          )}
          <MoreMenu onDelete={() => setConfirmDelete(true)} />
        </div>
      </header>

      {error && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <Figures invoice={inv} />

      <div className={[records.detailLayout, styles.layout].filter(Boolean).join(" ")}>
        <div className={[records.detailMain, styles.main].filter(Boolean).join(" ")}>
          <Lines invoice={inv} />
          <div className={styles.cards}>
            <DetailsCard invoice={inv} editHref={editHref} />
            <PaymentCard invoice={inv} onPay={() => setPaying(true)} />
          </div>
        </div>
        <aside className={[records.detailRail, styles.rail].filter(Boolean).join(" ")}>
          <ScanViewer invoiceId={inv.id} documents={inv.documents} />
        </aside>
      </div>

      {paying && <PaymentDialog invoice={inv} onClose={() => setPaying(false)} />}

      <Dialog
        open={confirmDelete}
        title={t("purchases.deleteTitle", { numero: inv.numero })}
        confirmLabel={common("delete")}
        destructive
        busy={removeMutation.isPending}
        onConfirm={() => removeMutation.mutate({ id: inv.id })}
        onClose={() => !removeMutation.isPending && setConfirmDelete(false)}
      >
        <p className={records.muted}>{t("purchases.deleteBody", { count: inv.lineCount })}</p>
      </Dialog>
    </>
  );
}

/**
 * The "⋯" button and its menu. Only the delete lives here — tucked away, as
 * the handoff has it, rather than a red button beside "Modifier". Closes on
 * Escape and on any press outside it.
 */
function MoreMenu({ onDelete }: { onDelete: () => void }) {
  const t = useTranslations("invoices");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.more} ref={ref}>
      <button
        type="button"
        className={styles.moreButton}
        aria-label={t("purchases.detail.moreActions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ⋯
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <button
            type="button"
            role="menuitem"
            className={[styles.menuItem, styles.menuDanger].filter(Boolean).join(" ")}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            {t("purchases.detail.deleteInvoice")}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * What it still costs us, then the figures it is made of. The handoff's
 * "Retenue" figure is gone with the withholding itself (never used), so the
 * net to pay is the total incl. VAT.
 */
function Figures({ invoice: inv }: { invoice: Invoice }) {
  const t = useTranslations("invoices");
  const enums = useTranslations("enums");
  const state = purchaseState(inv);

  let line: string;
  if (state === "paid" && inv.paidAt !== null) {
    const date = formatDay(inv.paidAt) ?? "";
    line = inv.paymentMethod
      ? t("purchases.detail.payLine.paidWith", { date, method: enums(`paymentMethod.${inv.paymentMethod}`) })
      : t("purchases.detail.payLine.paid", { date });
  } else if (inv.dueAt === null) {
    line = t("purchases.detail.payLine.nodate");
  } else {
    const days = daysUntil(inv.dueAt);
    const date = formatDay(inv.dueAt) ?? "";
    line =
      days < 0
        ? t("purchases.detail.payLine.late", { date, when: t("purchases.row.late", { count: -days }) })
        : t("purchases.detail.payLine.due", {
            date,
            when: days === 0 ? t("purchases.row.dueToday") : t("purchases.row.dueIn", { count: days }),
          });
  }

  return (
    <section className={styles.figures} aria-label={t("panels.amounts")}>
      <div className={[styles.figure, styles.figureLead].filter(Boolean).join(" ")}>
        <span className={styles.figureLabel}>{t("fields.netPayable")}</span>
        <span className={styles.leadValue}>
          <bdi>{money(inv.netPayable)}</bdi>
          {inv.currency && <span className={styles.leadUnit}>{inv.currency}</span>}
        </span>
        <span className={[styles.leadLine, state === "late" ? styles.leadLate : null].filter(Boolean).join(" ")}>
          {line}
        </span>
      </div>
      <Figure label={t("fields.exclVat")} value={inv.totalHt} />
      <Figure label={t("fields.vat")} value={inv.vatAmount} quiet />
      <Figure label={t("fields.inclVat")} value={inv.totalTtc} strong />
    </section>
  );
}

/** One figure of the strip; a zero tax reads quieter. */
function Figure({
  label,
  value,
  quiet,
  strong,
}: {
  label: string;
  value: number | null;
  quiet?: boolean;
  strong?: boolean;
}) {
  return (
    <div className={styles.figure}>
      <span className={styles.figureLabel}>{label}</span>
      <bdi
        className={[
          styles.figureValue,
          quiet && !value ? styles.figureQuiet : null,
          strong ? styles.figureStrong : null,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {money(value)}
      </bdi>
    </div>
  );
}

const quantity = () => numberFormat({ maximumFractionDigits: 3 });
const percent = () => numberFormat({ maximumFractionDigits: 2 });

/**
 * The lines as printed on the document, then their sum against the total.
 *
 * A line's total is tax-inclusive (see the model), so the sum is checked
 * against the TTC figure. It matches on every migrated invoice and on every
 * one written here, since the service derives the totals from the lines; the
 * mismatch state is for a row edited behind the app's back, and says by how
 * much rather than hiding it.
 */
function Lines({ invoice: inv }: { invoice: Invoice }) {
  const t = useTranslations("invoices");
  const sum = inv.lines.reduce((total, line) => total + (line.total ?? 0), 0);
  // Millimes: anything under half of one is rounding, not a gap.
  const gap = inv.totalTtc === null ? null : sum - inv.totalTtc;
  const matches = gap !== null && Math.abs(gap) < 0.0005;

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>
          {t("purchases.detail.lines")} <span className={styles.cardCount}>{inv.lineCount}</span>
        </h2>
        <span className={styles.cardMeta}>
          {inv.currency
            ? t("purchases.detail.amountsIn", { currency: inv.currency })
            : t("purchases.detail.noCurrency")}
        </span>
      </div>

      {inv.lines.length === 0 ? (
        <p className={[records.muted, styles.cardBody].filter(Boolean).join(" ")}>{t("noLines")}</p>
      ) : (
        <div className={styles.linesScroll}>
          <table className={styles.lines}>
            <thead>
              <tr>
                <th>{t("purchases.detail.article")}</th>
                <th className={styles.num}>{t("lines.qty")}</th>
                <th className={styles.num}>{t("purchases.detail.unitPrice")}</th>
                <th className={styles.num}>{t("purchases.detail.discount")}</th>
                <th className={styles.num}>{t("lines.vat")}</th>
                <th className={styles.num}>{t("lines.total")}</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((line) => {
                // 881 legacy lines carry no product code: the description is the name
                // then. Many others repeat the code as the description; say it once.
                const name = line.product ?? line.description;
                const sub =
                  line.product && line.description?.trim().toLowerCase() !== line.product.trim().toLowerCase()
                    ? line.description
                    : null;
                return (
                  <tr key={line.id}>
                    <td>
                      <span className={styles.article}>{name ?? "—"}</span>
                      {sub && <span className={styles.articleSub}>{sub}</span>}
                    </td>
                    <td className={styles.num}>
                      {line.quantity === null ? <Dash /> : quantity().format(line.quantity)}
                    </td>
                    <td className={styles.num}>
                      {line.unitPrice === null ? <Dash /> : formatAmount(line.unitPrice)}
                    </td>
                    <td className={styles.num}>
                      {line.discountPct ? `${percent().format(line.discountPct)} %` : <Dash />}
                    </td>
                    <td className={styles.num}>
                      {line.taxPct ? `${percent().format(line.taxPct)} %` : <Dash />}
                    </td>
                    <td className={[styles.num, styles.lineTotal].filter(Boolean).join(" ")}>
                      {line.total === null ? <Dash /> : formatAmount(line.total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.sum}>
        <span className={styles.sumLabel}>{t("lines.sum")}</span>
        <bdi className={styles.sumValue}>{formatAmount(sum)}</bdi>
        {gap !== null && (
          <span className={[styles.sumCheck, matches ? styles.sumOk : styles.sumOff].filter(Boolean).join(" ")}>
            {matches
              ? t("purchases.detail.sumMatches")
              : t("purchases.detail.sumDiffers", { amount: formatAmount(Math.abs(gap)) })}
          </span>
        )}
      </div>
    </section>
  );
}

function Dash() {
  return <span className={styles.dash}>—</span>;
}

/** A label and its value, or what to do about a missing one. */
function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      {children}
    </div>
  );
}

/**
 * The invoice's own facts. A missing one offers to add it, which opens the
 * edit form: that form writes every field already, and a second, per-field
 * write path would be one more place for the rules to drift. The exchange
 * rate is asked of a foreign-currency invoice only — a rate on a dinar
 * invoice means nothing.
 */
function DetailsCard({ invoice: inv, editHref }: { invoice: Invoice; editHref: string }) {
  const t = useTranslations("invoices");
  const foreign = (inv.currency !== null && inv.currency !== "TND") || inv.exchangeRate !== null;
  const rows: { key: string; label: string; value: string | null }[] = [
    { key: "number", label: t("fields.number"), value: inv.numero },
    { key: "due", label: t("fields.due"), value: formatDay(inv.dueAt) },
    { key: "category", label: t("fields.category"), value: inv.category },
    {
      key: "forProduction",
      label: t("fields.forProduction"),
      value: inv.forProduction === null ? null : inv.forProduction ? t("yes") : t("no"),
    },
    { key: "currency", label: t("fields.currency"), value: inv.currency },
    ...(foreign
      ? [
          {
            key: "rate",
            label: t("fields.exchangeRate"),
            value: inv.exchangeRate === null ? null : quantity().format(inv.exchangeRate),
          },
        ]
      : []),
  ];

  return (
    <section className={[styles.card, styles.factCard].filter(Boolean).join(" ")}>
      <h2 className={styles.cardTitle}>{t("purchases.detail.details")}</h2>
      {rows.map((row) => (
        <FactRow key={row.key} label={row.label}>
          {row.value !== null ? (
            <bdi className={styles.factValue}>{row.value}</bdi>
          ) : (
            <Link className={styles.addLink} href={editHref}>
              {t("purchases.detail.add")}
            </Link>
          )}
        </FactRow>
      ))}
    </section>
  );
}

function PaymentCard({ invoice: inv, onPay }: { invoice: Invoice; onPay: () => void }) {
  const t = useTranslations("invoices");
  const enums = useTranslations("enums");
  const notSet = <span className={styles.factMissing}>{t("notSet")}</span>;

  return (
    <section className={[styles.card, styles.factCard].filter(Boolean).join(" ")}>
      <h2 className={styles.cardTitle}>{t("panels.payment")}</h2>
      <FactRow label={t("fields.paidOn")}>
        {inv.paidAt === null ? notSet : <bdi className={styles.factValue}>{formatDay(inv.paidAt)}</bdi>}
      </FactRow>
      <FactRow label={t("fields.method")}>
        {inv.paymentMethod === null ? (
          notSet
        ) : (
          <span className={styles.factValue}>{enums(`paymentMethod.${inv.paymentMethod}`)}</span>
        )}
      </FactRow>
      <FactRow label={t("fields.netPayable")}>
        {inv.netPayable === null ? (
          notSet
        ) : (
          <bdi className={styles.factValue}>
            {formatAmount(inv.netPayable)}
            {inv.currency ? ` ${inv.currency}` : ""}
          </bdi>
        )}
      </FactRow>
      {inv.paidAt === null && (
        <Button variant="secondary" className={styles.payButton} onClick={onPay}>
          {t("purchases.detail.recordPayment")}
        </Button>
      )}
    </section>
  );
}

/**
 * Records the payment: the day (today by default, never later) and how.
 * The method is required — a payment recorded without one is the legacy
 * blank, not something to add to.
 */
function PaymentDialog({ invoice: inv, onClose }: { invoice: Invoice; onClose: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const t = useTranslations("invoices");
  const enums = useTranslations("enums");
  const [paidAt, setPaidAt] = useState(plantDay());
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [error, setError] = useState<string | null>(null);

  const payMutation = useMutation(
    trpc.purchaseInvoice.recordPayment.mutationOptions({
      onSuccess: async () => {
        push({
          title: t("purchases.detail.paymentRecorded", {
            amount:
              inv.netPayable === null
                ? inv.numero
                : `${formatAmount(inv.netPayable)}${inv.currency ? ` ${inv.currency}` : ""}`,
          }),
          tone: "success",
        });
        onClose();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.purchaseInvoice.byId.queryKey({ id: inv.id }) }),
          queryClient.invalidateQueries({ queryKey: trpc.purchaseInvoice.list.queryKey() }),
        ]);
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  const submit = () => {
    setError(null);
    if (paidAt === "") return setError(t("purchases.detail.payDialog.dateRequired"));
    if (paidAt > plantDay()) return setError(t("purchases.detail.payDialog.future"));
    if (method === "") return setError(t("purchases.detail.payDialog.methodRequired"));
    payMutation.mutate({ id: inv.id, paidAt, paymentMethod: method });
  };

  return (
    <Dialog
      open
      title={t("purchases.detail.payDialog.title", { numero: inv.numero })}
      confirmLabel={t("purchases.detail.payDialog.confirm")}
      busy={payMutation.isPending}
      onConfirm={submit}
      onClose={() => !payMutation.isPending && onClose()}
    >
      <div className={styles.payForm}>
        {error && (
          <p className={[records.notice, records.error, styles.payError].filter(Boolean).join(" ")} role="alert">
            {error}
          </p>
        )}
        <DateField
          label={t("fields.paidOn")}
          value={paidAt}
          onChange={setPaidAt}
          max={plantDay()}
          disabled={payMutation.isPending}
        />
        <SelectField
          label={t("fields.paymentMethod")}
          value={method}
          onChange={(event) => setMethod(event.target.value as PaymentMethod)}
          placeholder={t("purchases.detail.payDialog.chooseMethod")}
          options={PAYMENT_METHODS.map((value) => ({ value, label: enums(`paymentMethod.${value}`) }))}
          disabled={payMutation.isPending}
        />
      </div>
    </Dialog>
  );
}

/** How the viewer can draw a stored file, read off its extension. */
function viewKind(url: string): "pdf" | "image" | "other" {
  const path = url.split(/[?#]/)[0] ?? "";
  if (/\.pdf$/i.test(path)) return "pdf";
  // HEIC and TIFF are accepted uploads but Chrome cannot draw them.
  if (/\.(jpe?g|png|webp|gif)$/i.test(path)) return "image";
  return "other";
}

/**
 * The supplier's scan, beside the record. One document at a time, with the
 * invoice's others a step away — 609 migrated invoices carry at least one
 * and a few carry seven, so the handoff's single page becomes a place in
 * that list.
 *
 * A PDF stays in an iframe, as every scan in the app does: the legacy bucket
 * sends no CORS headers, so a fetch-based renderer would fail. The
 * browser's viewer then brings its own zoom, page count and print, so the
 * handoff's zoom control is drawn for an image only — over a PDF it would be
 * a second zoom fighting the first. "Joindre un document" uploads to the
 * bucket and files the URL after the others.
 */
function ScanViewer({ invoiceId, documents }: { invoiceId: string; documents: string[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const t = useTranslations("invoices");
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(100);
  const input = useRef<HTMLInputElement>(null);

  const ticket = useMutation(trpc.purchaseInvoice.createDocumentUpload.mutationOptions());
  const attach = useMutation(
    trpc.purchaseInvoice.addDocument.mutationOptions({
      onSuccess: async (saved) => {
        push({ title: t("purchases.detail.attached"), tone: "success" });
        setIndex(saved.documents.length - 1);
        await queryClient.invalidateQueries({ queryKey: trpc.purchaseInvoice.byId.queryKey({ id: invoiceId }) });
      },
    }),
  );
  const upload = useFileUpload({
    onChange: (url) => url && attach.mutate({ id: invoiceId, url }),
    onRequestUpload: (file) =>
      ticket.mutateAsync({
        id: invoiceId,
        filename: file.name,
        contentType: file.type as (typeof UPLOAD_CONTENT_TYPES)[number],
        size: file.size,
      }),
    contentTypes: UPLOAD_CONTENT_TYPES,
    maxBytes: UPLOAD_MAX_BYTES,
    strings: {
      failed: t("purchases.detail.upload.failed"),
      tooLarge: t("purchases.detail.upload.tooLarge"),
      wrongType: t("purchases.detail.upload.wrongType"),
    },
  });
  const busy = upload.busy || attach.isPending;
  const uploadError = upload.error ?? attach.error?.message ?? null;

  const current = Math.min(index, documents.length - 1);
  const stored = documents[current];
  const url = stored === undefined ? null : (assetUrl(stored) ?? stored);
  const kind = url === null ? null : viewKind(url);

  const attachButton = (
    <>
      <input
        ref={input}
        type="file"
        hidden
        accept={UPLOAD_CONTENT_TYPES.join(",")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload.upload(file);
        }}
      />
      <button
        type="button"
        className={styles.attach}
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? t("purchases.detail.uploading") : t("purchases.detail.attach")}
      </button>
    </>
  );

  return (
    <section className={[styles.card, styles.scan].filter(Boolean).join(" ")}>
      <div className={styles.scanHead}>
        <div className={styles.scanTitle}>
          <h2 className={styles.cardTitle}>{t("panels.scan")}</h2>
          {/* Isolated: in Arabic the name's digits and underscores would reorder. */}
          {stored !== undefined && (
            <span className={styles.scanFile}>
              <bdi>{assetFileName(stored)}</bdi>
            </span>
          )}
        </div>
        {kind === "image" && (
          <div className={styles.zoom}>
            <button
              type="button"
              className={styles.zoomButton}
              aria-label={t("purchases.detail.zoomOut")}
              disabled={zoom <= ZOOM_MIN}
              onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value - ZOOM_STEP))}
            >
              −
            </button>
            <bdi className={styles.zoomLabel}>{zoom} %</bdi>
            <button
              type="button"
              className={styles.zoomButton}
              aria-label={t("purchases.detail.zoomIn")}
              disabled={zoom >= ZOOM_MAX}
              onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value + ZOOM_STEP))}
            >
              +
            </button>
          </div>
        )}
        {url !== null && (
          <a
            className={styles.openLink}
            href={url}
            target="_blank"
            rel="noreferrer"
            title={t("purchases.detail.openTab")}
          >
            {t("purchases.detail.open")}
          </a>
        )}
      </div>

      <div className={styles.scanBody}>
        {url === null ? (
          <div className={styles.scanEmpty}>
            <strong>{t("noScan")}</strong>
            <span>{t("purchases.detail.noScanHint")}</span>
          </div>
        ) : kind === "pdf" ? (
          <iframe key={url} className={styles.scanFrame} src={url} title={t("panels.scan")} />
        ) : kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- a stored scan on the bucket, not a page asset
          <img className={styles.scanImage} src={url} alt={t("panels.scan")} style={{ width: `${zoom}%` }} />
        ) : (
          <div className={styles.scanEmpty}>
            <span>{t("purchases.detail.noPreview")}</span>
          </div>
        )}
      </div>

      <div className={styles.scanFoot}>
        {documents.length > 1 ? (
          <span className={styles.pager}>
            <button
              type="button"
              className={styles.zoomButton}
              aria-label={t("purchases.detail.previous")}
              disabled={current === 0}
              onClick={() => setIndex(current - 1)}
            >
              ‹
            </button>
            <span>{t("purchases.detail.documentOf", { n: current + 1, count: documents.length })}</span>
            <button
              type="button"
              className={styles.zoomButton}
              aria-label={t("purchases.detail.next")}
              disabled={current === documents.length - 1}
              onClick={() => setIndex(current + 1)}
            >
              ›
            </button>
          </span>
        ) : (
          <span>{t("purchases.detail.documentCount", { count: documents.length })}</span>
        )}
        {attachButton}
      </div>
      {uploadError && (
        <p className={[records.notice, records.error, styles.scanError].filter(Boolean).join(" ")} role="alert">
          {uploadError}
        </p>
      )}
    </section>
  );
}
