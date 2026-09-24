"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import {
  assetFileName,
  assetUrl,
  canAccess,
  UPLOAD_CONTENT_TYPES,
  UPLOAD_MAX_BYTES,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { CheckboxField, TextAreaField, TextField } from "@repo/ui/field";
import { FileDropzone } from "@repo/ui/file-dropzone";
import { useToast } from "@repo/ui/toast";
import { useCurrentUser } from "../../auth/use-auth";
import { formatDateTime } from "../../../i18n/formats";
import { useTRPC } from "../../trpc/client";
import {
  CUSTOMS_ICON,
  dateInput,
  DocumentCard,
  Fact,
  FactRow,
  fileKind,
  PACKING_ICON,
  RailLink,
  Section,
  SoldePill,
  TrailRow,
} from "./shipment-detail-ui";
import { formatInt, ShipmentStatusBadge } from "../shipment-ui";
import records from "../../records/records.module.css";
import styles from "../shipments.module.css";

type Shipment = inferRouterOutputs<AppRouter>["shipment"]["byId"];
type Line = Shipment["lines"][number];

/** Today as YYYY-MM-DD in local time — `toISOString` shifts the date near midnight. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole parcels, lenient: blank or garbage is 0. */
function parseParcels(value: string): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.floor(parsed) : 0;
}

interface EditableLine {
  key: string;
  line: Line;
  description: string;
  quantity: string;
}

/**
 * The editable face of a DRAFT shipment, laid out from "Shipment detail
 * v4.dc.html": a glass header carrying the readiness checklist, then the
 * truck (facts and the three header fields), the two documents as cards,
 * and what leaves; in the rail, the ink "Ship" card whose button reports
 * what is still missing, the onward links, the trail and the discard.
 *
 * The checklist gates the Ship button on the four things the handoff names
 * — the invoice, the export date, the packing list number and its scan —
 * plus the declaration's number, date and scan, which the user made
 * required after the handoff. The server enforces only the packing list number (and
 * the invoice); the rest is the page's stricter reading.
 *
 * The line carrying an order keeps its link and cannot be removed; its
 * parcel count is editable DOWN — never above what the paired invoice bills
 * nor what the order still has to ship — and the server enforces both.
 */
export function ExportShipmentDraft({ shipment }: { shipment: Shipment }) {
  const t = useTranslations("shipments");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { push } = useToast();
  const { user } = useCurrentUser();
  const isAdmin = user !== null && canAccess(user.role, "ADMIN");

  const [exportDate, setExportDate] = useState(dateInput(shipment.exportDate));
  const [packingListNumber, setPackingListNumber] = useState(shipment.packingListNumber ?? "");
  const [packingListDocument, setPackingListDocument] = useState(
    shipment.packingListDocument ?? "",
  );
  const [customsNumber, setCustomsNumber] = useState(shipment.customsDeclarationNumber ?? "");
  const [customsDate, setCustomsDate] = useState(dateInput(shipment.customsDeclarationDate));
  const [customsDocument, setCustomsDocument] = useState(
    shipment.customsDeclarationDocument ?? "",
  );
  const [note, setNote] = useState(shipment.note ?? "");
  const [lines, setLines] = useState<EditableLine[]>(() =>
    shipment.lines.map((line) => ({
      key: line.id,
      line,
      description: line.description ?? "",
      quantity: String(line.quantity),
    })),
  );
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"ship" | "discard" | null>(null);
  const [shipDate, setShipDate] = useState(today());
  const [closeOrder, setCloseOrder] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const [discardNote, setDiscardNote] = useState("");

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.shipment.byId.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.shipment.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.order.byId.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.order.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.nav.counts.queryKey() }),
    ]);

  const saveMutation = useMutation(
    trpc.shipment.updateDraft.mutationOptions({
      onSuccess: async () => {
        setDirty(false);
        await invalidate();
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const shipMutation = useMutation(
    trpc.shipment.ship.mutationOptions({
      onSuccess: async (shipped) => {
        setDialog(null);
        const closed = shipped.orders.filter((o) => o.status === "COMPLETED");
        const reopened = shipped.orders.filter((o) => o.status === "INVOICEABLE");
        push({
          title: t("toasts.shipped", { numero: shipped.numero }),
          text: [
            closed.length > 0
              ? t("toasts.exported", { orders: closed.map((o) => o.numero).join(", ") })
              : null,
            reopened.length > 0
              ? t("toasts.backToInvoicing", {
                  orders: reopened
                    .map((o) =>
                      t("toasts.remainingLeft", { numero: o.numero, remaining: o.remaining }),
                    )
                    .join(", "),
                })
              : null,
          ]
            .filter(Boolean)
            .join(" · "),
          tone: "success",
        });
        await invalidate();
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const discardMutation = useMutation(
    trpc.shipment.discardDraft.mutationOptions({
      onSuccess: async (result) => {
        setDialog(null);
        push({ title: t("toasts.discarded"), tone: "success" });
        await invalidate();
        const orderId = result.orderIds[0];
        router.replace(orderId ? `/orders/${orderId}` : "/shipments");
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  /**
   * Mint the presigned PUTs. Their own mutations rather than part of `save`:
   * they write nothing to the shipment, and the server re-checks that the
   * draft still accepts a packing list before handing out a capability. The
   * customs scan has no such gate — it may arrive before or after the truck.
   */
  const uploadMutation = useMutation(
    trpc.shipment.createPackingListUpload.mutationOptions(),
  );
  const customsUploadMutation = useMutation(
    trpc.shipment.createCustomsUpload.mutationOptions(),
  );

  const busy = saveMutation.isPending || shipMutation.isPending || discardMutation.isPending;

  const clear = (value: string) => (value.trim() === "" ? null : value.trim());
  const payload = () => ({
    id: shipment.id,
    exportDate: exportDate === "" ? null : exportDate,
    packingListNumber: clear(packingListNumber),
    packingListDocument: clear(packingListDocument),
    customsDeclarationNumber: clear(customsNumber),
    customsDeclarationDate: customsDate === "" ? null : customsDate,
    customsDeclarationDocument: clear(customsDocument),
    note: clear(note),
    lines: lines.map((line, index) => ({
      position: index + 1,
      orderId: line.line.orderId,
      description: line.description.trim() || undefined,
      quantity: parseParcels(line.quantity),
    })),
  });

  const save = () => {
    setError(null);
    saveMutation.mutate(payload());
  };

  const ship = async () => {
    setError(null);
    if (closeOrder && closeNote.trim() === "") {
      setError(t("shipDialog.closeNoteRequired"));
      return;
    }
    try {
      if (dirty) await saveMutation.mutateAsync(payload());
      shipMutation.mutate({
        id: shipment.id,
        exportDate: shipDate,
        ...(closeOrder ? { closeOrder: true, note: closeNote } : {}),
      });
    } catch {
      // saveMutation's onError has shown the message; keep the dialog open.
    }
  };

  const edit = (key: string, patch: Partial<Pick<EditableLine, "description" | "quantity">>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
    setDirty(true);
  };

  // Per order-linked line: the figures beside it, from the same parcel
  // arithmetic the server enforces. `remaining` is what the order would
  // still have to ship after THIS line, at the edited quantity.
  const figures = lines.map((line) => {
    const { planned, shippedElsewhere, invoiceQuantity } = line.line;
    const quantity = parseParcels(line.quantity);
    const balance =
      planned === null || shippedElsewhere === null
        ? null
        : Math.max(0, planned - shippedElsewhere);
    const remaining = balance === null ? null : Math.max(0, balance - quantity);
    const cap =
      balance === null
        ? null
        : invoiceQuantity === null
          ? balance
          : Math.min(Math.ceil(invoiceQuantity), balance);
    return { key: line.key, quantity, planned, balance, remaining, cap, invoiceQuantity };
  });
  const parcelsShort = figures.reduce((sum, f) => sum + (f.remaining ?? 0), 0);
  const overCap = figures.some((f) => f.cap !== null && f.quantity > f.cap);
  const invoiceNumero = shipment.salesInvoice?.numero ?? null;

  // The series the truck will be numbered in: the export year's, else this year's.
  const seriesYear = (exportDate || today()).slice(0, 4);
  const prefix = `EXP${seriesYear.slice(2)}`;

  // The readiness checklist, in the handoff's order. The invoice is the one
  // item this page cannot fix — it links to the invoice instead.
  const invoiceIssued = shipment.salesInvoice?.status === "ISSUED";
  const hasPackFile = packingListDocument.trim() !== "";
  const hasCustomsFile = customsDocument.trim() !== "";
  const checks = [
    {
      key: "invoice",
      label: invoiceNumero
        ? t("editor.checks.invoiceNumbered", { numero: invoiceNumero })
        : t("editor.checks.invoice"),
      done: invoiceIssued,
    },
    { key: "date", label: t("editor.checks.exportDate"), done: exportDate !== "" },
    {
      key: "number",
      label: t("editor.checks.packingListNumber"),
      done: packingListNumber.trim() !== "",
    },
    { key: "file", label: t("editor.checks.packingListDocument"), done: hasPackFile },
    {
      key: "customsNumber",
      label: t("editor.checks.declarationNumber"),
      done: customsNumber.trim() !== "",
    },
    { key: "customsDate", label: t("editor.checks.declarationDate"), done: customsDate !== "" },
    { key: "customsFile", label: t("editor.checks.declarationDocument"), done: hasCustomsFile },
  ];
  const done = checks.filter((c) => c.done).length;
  const blocked = done < checks.length;
  const missing = checks.filter((c) => !c.done);

  const docsSummary = hasPackFile && hasCustomsFile
    ? t("editor.documents.bothAttached")
    : hasPackFile
      ? t("editor.documents.customsMissing")
      : hasCustomsFile
        ? t("editor.documents.packingMissing")
        : t("editor.documents.noneAttached");

  // What the attached file's meta line says: saved with the draft, or not yet.
  const fileMeta = (local: string, stored: string | null) => {
    const kind = fileKind(local);
    const state = local.trim() === (stored ?? "")
      ? t("editor.documents.savedMeta")
      : t("editor.documents.unsavedMeta");
    return kind ? `${kind} · ${state}` : state;
  };

  const totalParcels = figures.reduce((sum, f) => sum + f.quantity, 0);
  const unitsOf = (line: EditableLine): number | null => {
    const per =
      line.line.units !== null && line.line.quantity > 0
        ? line.line.units / line.line.quantity
        : null;
    return per === null ? null : Math.round(parseParcels(line.quantity) * per);
  };
  const totalUnits = lines.reduce((sum, line) => sum + (unitsOf(line) ?? 0), 0);
  // The orders on the truck, once each, for the meta line and the rail links.
  const orders = [
    ...new Map(
      lines.flatMap((l) => (l.line.order ? [[l.line.order.id, l.line.order] as const] : [])),
    ).values(),
  ];
  const unitLabel = (line: Line) =>
    line.order?.quantityUnit === "KILOGRAMS" ? t("units.kg") : t("units.pcs");

  const dropStrings = {
    drop: t("editor.documents.drop"),
    choose: t("editor.documents.choose"),
    open: t("upload.open"),
    download: t("upload.download"),
    remove: t("upload.remove"),
    uploading: t("upload.uploading"),
    failed: t("upload.failed"),
    tooLarge: t("upload.tooLarge"),
    wrongType: t("upload.wrongType"),
  };

  return (
    <>
      <header className={styles.draftHeader}>
        <div className={styles.draftHeading}>
          <span className={records.eyebrow}>{t("editor.eyebrow")}</span>
          <div className={styles.draftTitleRow}>
            <h1 className={styles.draftTitle}>{t("editor.title")}</h1>
            <ShipmentStatusBadge status="DRAFT" />
          </div>
          <p className={styles.draftLede}>{t("editor.lede", { prefix })}</p>
        </div>

        <div className={styles.readiness}>
          <div className={styles.readinessHead}>
            <span className={styles.readinessLabel}>{t("editor.ready")}</span>
            <span
              className={[styles.readinessCount, blocked ? null : styles.readinessCountOk]
                .filter(Boolean)
                .join(" ")}
            >
              {done} / {checks.length}
            </span>
          </div>
          <div className={styles.readinessBar} aria-hidden="true">
            <span
              className={[styles.readinessFill, blocked ? null : styles.readinessFillOk]
                .filter(Boolean)
                .join(" ")}
              style={{ width: `${Math.round((done / checks.length) * 100)}%` }}
            />
          </div>
          <ul className={styles.checks}>
            {checks.map((c) => (
              <li key={c.key} className={styles.check}>
                <span
                  className={[styles.checkMark, c.done ? styles.checkMarkDone : null]
                    .filter(Boolean)
                    .join(" ")}
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <span
                  className={[styles.checkLabel, c.done ? styles.checkLabelDone : null]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {c.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </header>

      {error && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <div className={styles.layout}>
        <div className={styles.main}>
          <Section title={t("editor.truck.title")} meta={t("editor.truck.meta")}>
            <div className={styles.facts}>
              <Fact label={t("fields.client")}>
                {isAdmin ? (
                  <Link className={records.inlineLink} href={`/clients/${shipment.client.id}`}>
                    {shipment.client.name}
                  </Link>
                ) : (
                  shipment.client.name
                )}
              </Fact>
              <Fact label={t("fields.invoice")}>
                {shipment.salesInvoice ? (
                  isAdmin ? (
                    <Link
                      className={records.inlineLink}
                      href={`/invoices/sales/${shipment.salesInvoice.id}`}
                    >
                      {shipment.salesInvoice.numero ?? t("draftInvoice")}
                    </Link>
                  ) : (
                    (shipment.salesInvoice.numero ?? t("draftInvoice"))
                  )
                ) : (
                  <span className={styles.factMuted}>{t("noInvoice")}</span>
                )}
              </Fact>
              <Fact label={t("fields.draftedBy")}>{shipment.createdBy?.name ?? "—"}</Fact>
              <Fact label={t("fields.number")}>
                <span className={styles.factMuted}>{t("editor.numberPending")}</span>
              </Fact>
            </div>

            <div className={styles.fieldGrid}>
              <TextField
                label={t("fields.exportDate")}
                unit={t("editor.required")}
                type="date"
                value={exportDate}
                onChange={(e) => {
                  setExportDate(e.target.value);
                  setDirty(true);
                }}
                disabled={busy}
                aria-invalid={exportDate === "" ? true : undefined}
              />
              <TextField
                label={t("fields.packingListNumber")}
                unit={t("editor.required")}
                value={packingListNumber}
                onChange={(e) => {
                  setPackingListNumber(e.target.value);
                  setDirty(true);
                }}
                autoComplete="off"
                disabled={busy}
                aria-invalid={packingListNumber.trim() === "" ? true : undefined}
              />
              <TextField
                label={t("fields.declarationNumber")}
                unit={t("editor.required")}
                value={customsNumber}
                onChange={(e) => {
                  setCustomsNumber(e.target.value);
                  setDirty(true);
                }}
                autoComplete="off"
                disabled={busy}
                aria-invalid={customsNumber.trim() === "" ? true : undefined}
              />
              <TextField
                label={t("fields.declarationDate")}
                unit={t("editor.required")}
                type="date"
                value={customsDate}
                onChange={(e) => {
                  setCustomsDate(e.target.value);
                  setDirty(true);
                }}
                disabled={busy}
                aria-invalid={customsDate === "" ? true : undefined}
              />
            </div>
            <div className={styles.fieldNote}>
              <TextAreaField
                label={t("editor.carrierNote")}
                unit={t("editor.optional")}
                rows={2}
                value={note}
                placeholder={t("editor.carrierNotePlaceholder")}
                onChange={(e) => {
                  setNote(e.target.value);
                  setDirty(true);
                }}
                disabled={busy}
              />
            </div>
          </Section>

          <Section
            title={t("editor.documents.title")}
            meta={docsSummary}
            metaTone={hasPackFile && hasCustomsFile ? "ok" : "warn"}
          >
            <p className={styles.sectionLede}>{t("editor.documents.lede")}</p>
            <div className={styles.docCards}>
              <DocumentCard
                title={t("panels.packingList")}
                note={t("editor.documents.packingNote")}
                attached={hasPackFile}
                required
                icon={PACKING_ICON}
              >
                <FileDropzone
                  label={t("fields.packingListDocument")}
                  value={hasPackFile ? assetUrl(packingListDocument) : null}
                  onChange={(url) => {
                    setPackingListDocument(url ?? "");
                    setDirty(true);
                  }}
                  onRequestUpload={(file) =>
                    uploadMutation.mutateAsync({
                      id: shipment.id,
                      filename: file.name,
                      contentType: file.type as (typeof UPLOAD_CONTENT_TYPES)[number],
                      size: file.size,
                    })
                  }
                  contentTypes={UPLOAD_CONTENT_TYPES}
                  maxBytes={UPLOAD_MAX_BYTES}
                  strings={dropStrings}
                  meta={fileMeta(packingListDocument, shipment.packingListDocument)}
                  required
                  disabled={busy}
                />
                {/* The file is not saved until the draft is: an upload sets
                    the column in local state, and `save` writes it with
                    everything else. */}
              </DocumentCard>

              <DocumentCard
                title={t("panels.customs")}
                note={t("editor.documents.customsNote")}
                attached={hasCustomsFile}
                required
                icon={CUSTOMS_ICON}
              >
                <FileDropzone
                  label={t("fields.documentUrl")}
                  value={hasCustomsFile ? assetUrl(customsDocument) : null}
                  onChange={(url) => {
                    setCustomsDocument(url ?? "");
                    setDirty(true);
                  }}
                  onRequestUpload={(file) =>
                    customsUploadMutation.mutateAsync({
                      id: shipment.id,
                      filename: file.name,
                      contentType: file.type as (typeof UPLOAD_CONTENT_TYPES)[number],
                      size: file.size,
                    })
                  }
                  contentTypes={UPLOAD_CONTENT_TYPES}
                  maxBytes={UPLOAD_MAX_BYTES}
                  strings={dropStrings}
                  meta={fileMeta(customsDocument, shipment.customsDeclarationDocument)}
                  required
                  disabled={busy}
                />
              </DocumentCard>
            </div>
          </Section>

          <section className={[records.detailPanel, styles.cargo].filter(Boolean).join(" ")}>
            <div className={[styles.sectionHead, styles.cargoHead].filter(Boolean).join(" ")}>
              <h2 className={styles.sectionTitle}>{t("editor.cargo.title")}</h2>
              <span className={styles.sectionMeta}>
                {t("editor.cargo.meta", { lines: lines.length, orders: orders.length })}
              </span>
            </div>
            <div className={styles.cargoBody}>
              <div className={styles.cargoCols} aria-hidden="true">
                <span className={styles.cargoMain}>{t("editor.cargo.line")}</span>
                <span className={styles.cargoParcels}>{t("lines.parcels")}</span>
                <span className={styles.cargoUnits}>{t("lines.units")}</span>
                <span className={styles.cargoSolde}>{t("lines.balance")}</span>
              </div>
              {lines.map((line, index) => {
                const f = figures[index];
                const order = line.line.order;
                const per =
                  line.line.units !== null && line.line.quantity > 0
                    ? line.line.units / line.line.quantity
                    : null;
                const units = unitsOf(line);
                const over = f !== undefined && f.cap !== null && f.quantity > f.cap;
                // The order's figures, from the same arithmetic the server checks.
                const meta = [
                  order?.numero ?? null,
                  per === null
                    ? null
                    : t("editor.cargo.perParcel", {
                        count: formatInt(Math.round(per)),
                        unit: unitLabel(line.line),
                      }),
                  f && order && f.invoiceQuantity !== null
                    ? t("hints.invoiceBills", {
                        invoice: invoiceNumero ?? "",
                        count: Math.ceil(f.invoiceQuantity),
                      })
                    : null,
                  f && order && f.planned !== null && f.balance !== null
                    ? f.remaining === 0
                      ? t("hints.takesRest")
                      : t("hints.willRemain", { count: formatInt(f.remaining ?? 0) })
                    : null,
                ].filter(Boolean);
                return (
                  <div key={line.key} className={styles.cargoRow}>
                    <span className={styles.cargoMain}>
                      <span className={styles.cargoIndex}>{index + 1}</span>
                      <span className={styles.cargoText}>
                        <input
                          className={[styles.cellInput, styles.cargoName].filter(Boolean).join(" ")}
                          value={line.description}
                          onChange={(e) => edit(line.key, { description: e.target.value })}
                          disabled={busy}
                          aria-label={t("lines.descriptionAria", { n: index + 1 })}
                        />
                        <span className={styles.cargoMeta}>
                          {meta.map((part, i) => (
                            <span key={i}>
                              {i > 0 && " · "}
                              {i === 0 && order ? (
                                <Link className={records.inlineLink} href={`/orders/${order.id}`}>
                                  <bdi>{part}</bdi>
                                </Link>
                              ) : (
                                <bdi>{part}</bdi>
                              )}
                            </span>
                          ))}
                          {line.line.mention && (
                            <span title={t("lines.mentionFromInvoice")}> — {line.line.mention}</span>
                          )}
                          {over && f && (
                            <strong className={styles.cargoOver}>
                              {" "}
                              — {t("hints.atMost", { cap: formatInt(f.cap ?? 0) })}
                            </strong>
                          )}
                        </span>
                      </span>
                    </span>
                    <span className={styles.cargoParcels}>
                      <input
                        className={[styles.cellInput, styles.cellNum].filter(Boolean).join(" ")}
                        inputMode="numeric"
                        value={line.quantity}
                        onChange={(e) => edit(line.key, { quantity: e.target.value })}
                        disabled={busy}
                        aria-label={t("lines.parcelsAria", { n: index + 1 })}
                        aria-invalid={over ? true : undefined}
                      />
                    </span>
                    <span className={styles.cargoUnits}>
                      {units === null ? (
                        <span className={records.absent} />
                      ) : (
                        <>
                          <span className={styles.cargoFigure}>{formatInt(units)}</span>
                          <span className={styles.cargoUnitLabel}>{unitLabel(line.line)}</span>
                        </>
                      )}
                    </span>
                    <span className={styles.cargoSolde}>
                      <SoldePill remaining={order ? (f?.remaining ?? null) : null} />
                    </span>
                  </div>
                );
              })}
              <div className={styles.cargoTotal}>
                <span className={styles.cargoTotalLabel}>{t("editor.cargo.total")}</span>
                <span className={styles.cargoTotalFigures}>
                  <span className={styles.cargoTotalValue}>{formatInt(totalParcels)}</span>
                  <span className={styles.cargoTotalUnit}>
                    {totalParcels === 1 ? t("tiles.parcel") : t("tiles.parcels").toLowerCase()}
                    {totalUnits > 0 && " ·"}
                  </span>
                  {totalUnits > 0 && (
                    <>
                      <span className={styles.cargoTotalValue}>{formatInt(totalUnits)}</span>
                      <span className={styles.cargoTotalUnit}>
                        {lines[0] ? unitLabel(lines[0].line) : t("units.pcs")}
                      </span>
                    </>
                  )}
                </span>
              </div>
            </div>
          </section>
        </div>

        <aside className={styles.draftRail}>
          {/* `data-surface="floor"` makes it dark: that scope already inverts
              every ink and hairline token, as the roll detail's state card. */}
          <section className={styles.shipCard} data-surface="floor">
            <h2 className={styles.shipCardTitle}>{t("editor.gate.title")}</h2>
            <p className={styles.shipCardNote}>
              {blocked ? t("editor.gate.blockedNote") : t("editor.gate.readyNote", { prefix })}
            </p>
            <div className={styles.shipCardActions}>
              <Button
                variant="primary"
                busy={shipMutation.isPending}
                disabled={blocked || overCap || (busy && !shipMutation.isPending)}
                onClick={() => {
                  setError(null);
                  setShipDate(exportDate || today());
                  setCloseOrder(false);
                  setCloseNote("");
                  setDialog("ship");
                }}
              >
                {blocked
                  ? t("editor.gate.shipBlocked", { count: missing.length })
                  : t("editor.gate.ship")}
              </Button>
              <Button
                variant="secondary"
                busy={saveMutation.isPending}
                disabled={!dirty || (busy && !saveMutation.isPending)}
                onClick={save}
              >
                {dirty ? t("actions.saveDraft") : t("actions.saved")}
              </Button>
            </div>
            {blocked && (
              <ul className={styles.shipMissing}>
                {missing.map((c) => (
                  <li key={c.key} className={styles.shipMissingRow}>
                    <i className={styles.shipMissingDot} aria-hidden="true" />
                    <span>{c.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={[records.detailPanel, styles.railCard].filter(Boolean).join(" ")}>
            <h2 className={styles.railTitle}>{t("editor.links.title")}</h2>
            <FactRow label={t("fields.number")}>
              <span className={styles.factMuted}>{t("editor.numberPending")}</span>
            </FactRow>
            <FactRow label={t("fields.client")}>{shipment.client.name}</FactRow>
            <FactRow label={t("fields.invoice")}>
              {shipment.salesInvoice ? (shipment.salesInvoice.numero ?? t("draftInvoice")) : <span className={records.absent} />}
            </FactRow>
            <FactRow label={t("fields.draftedBy")}>{shipment.createdBy?.name ?? <span className={records.absent} />}</FactRow>
            <div className={styles.linkList}>
              {orders.map((order) => (
                <RailLink key={order.id} label={t("lines.order")} value={order.numero} href={`/orders/${order.id}`} />
              ))}
              {shipment.salesInvoice && (
                <RailLink
                  label={t("fields.invoice")}
                  value={shipment.salesInvoice.numero ?? t("draftInvoice")}
                  href={isAdmin ? `/invoices/sales/${shipment.salesInvoice.id}` : null}
                />
              )}
              <RailLink
                label={t("fields.client")}
                value={shipment.client.name}
                href={isAdmin ? `/clients/${shipment.client.id}` : null}
              />
              {isAdmin && (
                <RailLink
                  label={t("editor.links.journal")}
                  value={t("activityLink")}
                  href={`/settings/activity?entity=${encodeURIComponent(shipment.id)}`}
                />
              )}
            </div>
          </section>

          <section className={[records.detailPanel, styles.railCard].filter(Boolean).join(" ")}>
            <h2 className={styles.railTitle}>{t("editor.trail.title")}</h2>
            <TrailRow
              tone="info"
              label={t("editor.trail.created")}
              meta={[shipment.createdBy?.name ?? null, formatDateTime(shipment.createdAt)].filter(
                (part): part is string => part !== null,
              )}
            />
            <TrailRow
              tone={hasPackFile ? "ok" : "warn"}
              label={hasPackFile ? t("editor.trail.packingAttached") : t("editor.trail.packingExpected")}
              meta={[hasPackFile ? assetFileName(packingListDocument) : t("editor.trail.requiredBeforeShipping")]}
            />
            <TrailRow
              tone={hasCustomsFile ? "ok" : "warn"}
              label={hasCustomsFile ? t("editor.trail.customsAttached") : t("editor.trail.customsExpected")}
              meta={[hasCustomsFile ? assetFileName(customsDocument) : t("editor.trail.requiredBeforeShipping")]}
            />
          </section>

          {isAdmin ? (
            <section className={styles.discardCard}>
              <h2 className={styles.discardTitle}>{t("editor.discard.title")}</h2>
              <p className={styles.discardBody}>{t("editor.discard.body")}</p>
              <Button
                variant="danger"
                className={styles.discardButton}
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setDiscardNote("");
                  setDialog("discard");
                }}
              >
                {t("actions.discardDraft")}
              </Button>
            </section>
          ) : (
            <p className={records.hint}>{t("actions.askAdmin")}</p>
          )}
        </aside>
      </div>

      <Dialog
        open={dialog === "ship"}
        title={t("shipDialog.title")}
        confirmLabel={t("shipDialog.confirm")}
        busy={shipMutation.isPending || saveMutation.isPending}
        onConfirm={() => void ship()}
        onClose={() => !busy && setDialog(null)}
      >
        <p className={records.muted}>
          {t("shipDialog.body", { year: shipDate.slice(0, 4) })}{" "}
          {parcelsShort > 0
            ? t("shipDialog.remain", { count: parcelsShort })
            : t("shipDialog.allOn")}
          {dirty && ` ${t("shipDialog.unsavedFirst")}`}
        </p>
        <TextField
          label={t("fields.exportDate")}
          type="date"
          value={shipDate}
          onChange={(e) => setShipDate(e.target.value)}
          disabled={busy}
        />
        {isAdmin && parcelsShort > 0 && (
          <div className={styles.closeShort}>
            <CheckboxField
              label={t("shipDialog.closeOrder", {
                parcels: t("parcelCount", { count: parcelsShort }),
              })}
              hint={t("shipDialog.closeOrderHint")}
              checked={closeOrder}
              onChange={(e) => setCloseOrder(e.target.checked)}
              disabled={busy}
            />
            {closeOrder && (
              <TextField
                label={t("fields.noteRequired")}
                value={closeNote}
                onChange={(e) => setCloseNote(e.target.value)}
                autoComplete="off"
                disabled={busy}
              />
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={dialog === "discard"}
        title={t("discardDialog.title")}
        confirmLabel={t("discardDialog.confirm")}
        destructive
        busy={discardMutation.isPending}
        onConfirm={() => discardMutation.mutate({ id: shipment.id, note: discardNote })}
        onClose={() => !busy && setDialog(null)}
      >
        <p className={records.muted}>{t("discardDialog.body")}</p>
        <TextField
          label={t("fields.noteRequired")}
          value={discardNote}
          onChange={(e) => setDiscardNote(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
      </Dialog>
    </>
  );
}
