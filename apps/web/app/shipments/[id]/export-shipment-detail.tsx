"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  withMention,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/field";
import { FileDropzone } from "@repo/ui/file-dropzone";
import { useToast } from "@repo/ui/toast";
import { useCurrentUser } from "../../auth/use-auth";
import { formatDateTime, formatDay } from "../../../i18n/formats";
import { useTRPC } from "../../trpc/client";
import { ExportShipmentDraft } from "./export-shipment-draft";
import {
  CUSTOMS_ICON,
  dateInput,
  DocRefs,
  DocumentCard,
  FactRow,
  fileKind,
  PACKING_ICON,
  RailLink,
  Section,
  SoldePill,
  TrailRow,
} from "./shipment-detail-ui";
import { formatInt, ShipmentKindBadge, ShipmentStatusBadge } from "../shipment-ui";
import records from "../../records/records.module.css";
import styles from "../shipments.module.css";

type Shipment = inferRouterOutputs<AppRouter>["shipment"]["byId"];

/** The module's page header, while the shipment is still loading or failed to. */
function RouteHeader() {
  const t = useTranslations("shipments");
  return (
    <header className={records.header}>
      <div className={records.heading}>
        <span className={records.eyebrow}>{t("eyebrow")}</span>
        <h1 className={records.title}>{t("detailTitle")}</h1>
      </div>
      <p className={records.subtitle}>{t("detailSubtitle")}</p>
    </header>
  );
}

/**
 * A DRAFT renders the editor; a SHIPPED shipment the read-only record plus
 * the one form it still accepts, the customs declaration. The split is on
 * `status`, which the server decides — the handoff's Brouillon / Expédiée
 * toggle is a preview affordance and is not ported.
 */
export function ExportShipmentDetail({ id }: { id: string }) {
  const t = useTranslations("shipments");
  const trpc = useTRPC();
  const shipmentQuery = useQuery(trpc.shipment.byId.queryOptions({ id }));

  if (shipmentQuery.isPending) {
    return (
      <>
        <RouteHeader />
        <p className={records.muted}>{t("loading")}</p>
      </>
    );
  }

  if (shipmentQuery.isError) {
    return (
      <>
        <RouteHeader />
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {shipmentQuery.error.message}
        </p>
      </>
    );
  }

  const s = shipmentQuery.data;

  if (s.status === "DRAFT") {
    // Keyed on the update stamp so a server-side rewrite re-seeds the editor.
    return <ExportShipmentDraft key={`${s.id}:${String(s.updatedAt)}`} shipment={s} />;
  }

  return <ShippedRecord key={`${s.id}:${String(s.updatedAt)}`} shipment={s} />;
}

/**
 * The shipped record, from the "Expédiée" phase of "Shipment detail
 * v4.dc.html": the same glass header as the draft, with the number, the two
 * pills and four figures; the two papers as cards — the packing list frozen,
 * the declaration still editable in place; what left, with a balance pill
 * per line; and the rail's facts, links, trail and "frozen" notice.
 *
 * Two header buttons of the handoff are absent: "Bon de livraison" (there is
 * no print route) and "Tout télécharger" (no bundling endpoint — each card
 * has its own Download). A customs upload here saves at once, rather than
 * waiting for the form's Save: on a shipped record the scan is the whole
 * act, and a file left unsaved is what made "0/2" a support question.
 */
function ShippedRecord({ shipment: s }: { shipment: Shipment }) {
  const t = useTranslations("shipments");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const { user } = useCurrentUser();
  const commercial = user !== null && canAccess(user.role, "ADMIN");

  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState(s.customsDeclarationNumber ?? "");
  const [date, setDate] = useState(dateInput(s.customsDeclarationDate));
  const [error, setError] = useState<string | null>(null);

  const saveMutation = useMutation(
    trpc.shipment.updateCustoms.mutationOptions({
      onSuccess: async () => {
        setEditing(false);
        push({ title: t("customs.savedToast"), tone: "success" });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.shipment.byId.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.shipment.list.queryKey() }),
        ]);
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  /** Allowed on SHIPPED too — the customs declaration is the one edit that is. */
  const uploadMutation = useMutation(trpc.shipment.createCustomsUpload.mutationOptions());
  const busy = saveMutation.isPending;

  const saveCustoms = (document: string | null) => {
    setError(null);
    saveMutation.mutate({
      id: s.id,
      customsDeclarationNumber: number.trim() === "" ? null : number.trim(),
      customsDeclarationDate: date === "" ? null : date,
      customsDeclarationDocument: document,
    });
  };

  const totalParcels = s.lines.reduce((sum, line) => sum + line.quantity, 0);
  const totalUnits = s.lines.reduce((sum, line) => sum + (line.units ?? 0), 0);
  // Both lines report the same unit, so the first one that has an order
  // decides the label; mixed units cannot occur on one shipment.
  const unitLabel = (quantityUnit: string | undefined) =>
    quantityUnit === "KILOGRAMS" ? t("units.kg") : t("units.pcs");
  const totalUnit = unitLabel(s.lines.find((line) => line.order)?.order?.quantityUnit);

  const hasPackFile = s.packingListDocument !== null;
  const hasCustomsFile = s.customsDeclarationDocument !== null;
  const attachedDocs = (hasPackFile ? 1 : 0) + (hasCustomsFile ? 1 : 0);
  const docsSummary =
    attachedDocs === 2
      ? t("editor.documents.bothAttached")
      : hasPackFile
        ? t("editor.documents.customsMissing")
        : hasCustomsFile
          ? t("editor.documents.packingMissing")
          : t("editor.documents.noneAttached");

  const orders = [
    ...new Map(s.lines.flatMap((l) => (l.order ? [[l.order.id, l.order] as const] : []))).values(),
  ];
  const exportDay = s.exportDate === null ? "—" : formatDay(s.exportDate);
  const invoiceNumero = s.salesInvoice?.numero ?? null;

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
    none: t("record.noScan"),
  };
  const kindMeta = (url: string) => fileKind(url) ?? t("fields.document");

  return (
    <>
      <header className={styles.draftHeader}>
        <div className={styles.draftHeading}>
          <span className={records.eyebrow}>{t("editor.eyebrow")}</span>
          <div className={styles.draftTitleRow}>
            <h1 className={styles.draftTitle}>{s.numero}</h1>
            <ShipmentStatusBadge status={s.status} />
            <ShipmentKindBadge kind={s.kind} />
          </div>
          <p className={styles.draftLede}>
            {invoiceNumero
              ? t("record.lede", { date: exportDay, client: s.client.name, invoice: invoiceNumero })
              : t("record.ledeNoInvoice", { date: exportDay, client: s.client.name })}
          </p>
        </div>

        <div className={[styles.tiles, styles.headerTiles].filter(Boolean).join(" ")}>
          <Tile
            label={t("record.onTruck")}
            value={formatInt(totalParcels)}
            unit={totalParcels === 1 ? t("tiles.parcel") : t("tiles.parcels").toLowerCase()}
          />
          <Tile
            label={t("tiles.units")}
            value={totalUnits === 0 ? "—" : formatInt(totalUnits)}
            unit={totalUnits === 0 ? "" : totalUnit}
          />
          <Tile label={t("tiles.exportDate")} value={exportDay} unit="" />
          <Tile
            label={t("record.papers")}
            value={`${attachedDocs}/2`}
            unit={t("tiles.attached")}
            alert={attachedDocs < 2}
          />
        </div>
      </header>

      {error && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <div className={styles.layout}>
        <div className={styles.main}>
          <Section
            title={t("editor.documents.title")}
            meta={docsSummary}
            metaTone={attachedDocs === 2 ? "ok" : "warn"}
          >
            <p className={styles.sectionLede}>{t("record.docsNote")}</p>
            <div className={styles.docCards}>
              <DocumentCard
                title={t("panels.packingList")}
                note={t("record.packingLocked")}
                attached={hasPackFile}
                missing={!hasPackFile}
                icon={PACKING_ICON}
              >
                <DocRefs refs={[{ label: t("fields.number"), value: s.packingListNumber }]} />
                <FileDropzone
                  label={t("fields.packingListDocument")}
                  value={hasPackFile ? assetUrl(s.packingListDocument ?? "") : null}
                  onChange={() => undefined}
                  onRequestUpload={() => Promise.reject(new Error("locked"))}
                  contentTypes={UPLOAD_CONTENT_TYPES}
                  maxBytes={UPLOAD_MAX_BYTES}
                  strings={dropStrings}
                  meta={hasPackFile ? kindMeta(s.packingListDocument ?? "") : undefined}
                  locked
                />
              </DocumentCard>

              <DocumentCard
                title={t("panels.customs")}
                note={t("record.customsNote")}
                attached={hasCustomsFile}
                required
                editing={editing}
                icon={CUSTOMS_ICON}
              >
                <DocRefs
                  refs={[
                    { label: t("fields.declarationNumber"), value: s.customsDeclarationNumber },
                    {
                      label: t("record.declaredOn"),
                      value:
                        s.customsDeclarationDate === null ? null : formatDay(s.customsDeclarationDate),
                    },
                  ]}
                />
                <FileDropzone
                  label={t("fields.documentUrl")}
                  value={hasCustomsFile ? assetUrl(s.customsDeclarationDocument ?? "") : null}
                  // Saved at once: the scan is the whole act on a shipped record.
                  onChange={(url) => saveCustoms(url)}
                  onRequestUpload={(file) =>
                    uploadMutation.mutateAsync({
                      id: s.id,
                      filename: file.name,
                      contentType: file.type as (typeof UPLOAD_CONTENT_TYPES)[number],
                      size: file.size,
                    })
                  }
                  contentTypes={UPLOAD_CONTENT_TYPES}
                  maxBytes={UPLOAD_MAX_BYTES}
                  strings={dropStrings}
                  meta={hasCustomsFile ? kindMeta(s.customsDeclarationDocument ?? "") : undefined}
                  required
                  disabled={busy}
                  actions={
                    !editing && (
                      <Button
                        size="dense"
                        className={styles.docEditButton}
                        disabled={busy}
                        onClick={() => {
                          setNumber(s.customsDeclarationNumber ?? "");
                          setDate(dateInput(s.customsDeclarationDate));
                          setEditing(true);
                        }}
                      >
                        {t("record.edit")}
                      </Button>
                    )
                  }
                />
                {!hasCustomsFile && !editing && (
                  <div className={styles.docEditRow}>
                    <Button size="dense" disabled={busy} onClick={() => setEditing(true)}>
                      {t("record.edit")}
                    </Button>
                  </div>
                )}
                {editing && (
                  <div className={styles.docEdit}>
                    <div className={styles.docEditFields}>
                      <TextField
                        label={t("fields.declarationNumber")}
                        size="dense"
                        value={number}
                        onChange={(e) => setNumber(e.target.value)}
                        autoComplete="off"
                        disabled={busy}
                      />
                      <TextField
                        label={t("fields.declarationDate")}
                        size="dense"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        disabled={busy}
                      />
                    </div>
                    <div className={styles.docEditActions}>
                      <Button
                        variant="primary"
                        className={styles.docEditSave}
                        busy={busy}
                        onClick={() => saveCustoms(s.customsDeclarationDocument)}
                      >
                        {t("record.save")}
                      </Button>
                      <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
                        {t("record.cancel")}
                      </Button>
                    </div>
                  </div>
                )}
              </DocumentCard>
            </div>
          </Section>

          <section className={[records.detailPanel, styles.cargo].filter(Boolean).join(" ")}>
            <div className={[styles.sectionHead, styles.cargoHead].filter(Boolean).join(" ")}>
              <h2 className={styles.sectionTitle}>{t("record.cargoTitle")}</h2>
              <span className={styles.sectionMeta}>
                {t("editor.cargo.meta", { lines: s.lines.length, orders: orders.length })}
              </span>
            </div>
            <div className={styles.cargoBody}>
              <div className={styles.cargoCols} aria-hidden="true">
                <span className={styles.cargoMain}>{t("editor.cargo.line")}</span>
                <span className={styles.cargoParcels}>{t("lines.parcels")}</span>
                <span className={styles.cargoUnits}>{t("lines.units")}</span>
                <span className={styles.cargoSolde}>{t("lines.balance")}</span>
              </div>
              {s.lines.map((line) => {
                const per =
                  line.units !== null && line.quantity > 0 ? line.units / line.quantity : null;
                const meta = [
                  line.order?.numero ?? null,
                  per === null
                    ? null
                    : t("editor.cargo.perParcel", {
                        count: formatInt(Math.round(per)),
                        unit: unitLabel(line.order?.quantityUnit),
                      }),
                  line.planned === null || line.balanceAfter === null
                    ? null
                    : line.balanceAfter === 0
                      ? t("lines.allShipped", { planned: formatInt(line.planned) })
                      : t("lines.stillToShip", {
                          balance: formatInt(line.balanceAfter),
                          planned: formatInt(line.planned),
                        }),
                ].filter((part): part is string => part !== null);
                return (
                  <div key={line.id} className={styles.cargoRow}>
                    <span className={styles.cargoMain}>
                      <span className={styles.cargoIndex}>{line.position}</span>
                      <span className={styles.cargoText}>
                        <span className={styles.cargoStatic}>
                          {withMention(line.description, line.mention) || <span className={records.absent} />}
                        </span>
                        <span className={styles.cargoMeta}>
                          {meta.map((part, i) => (
                            <span key={i}>
                              {i > 0 && " · "}
                              <bdi>{part}</bdi>
                            </span>
                          ))}
                        </span>
                      </span>
                    </span>
                    <span className={[styles.cargoParcels, styles.cargoFigure].filter(Boolean).join(" ")}>
                      {formatInt(line.quantity)}
                    </span>
                    <span className={styles.cargoUnits}>
                      {line.units === null ? (
                        <span className={records.absent} />
                      ) : (
                        <>
                          <span className={styles.cargoFigure}>{formatInt(line.units)}</span>
                          <span className={styles.cargoUnitLabel}>{unitLabel(line.order?.quantityUnit)}</span>
                        </>
                      )}
                    </span>
                    <span className={styles.cargoSolde}>
                      <SoldePill remaining={line.order ? line.balanceAfter : null} />
                    </span>
                  </div>
                );
              })}
              <div className={styles.cargoTotal}>
                <span className={styles.cargoTotalLabel}>{t("record.totalLeft")}</span>
                <span className={styles.cargoTotalFigures}>
                  <span className={styles.cargoTotalValue}>{formatInt(totalParcels)}</span>
                  <span className={styles.cargoTotalUnit}>
                    {totalParcels === 1 ? t("tiles.parcel") : t("tiles.parcels").toLowerCase()}
                    {totalUnits > 0 && " ·"}
                  </span>
                  {totalUnits > 0 && (
                    <>
                      <span className={styles.cargoTotalValue}>{formatInt(totalUnits)}</span>
                      <span className={styles.cargoTotalUnit}>{totalUnit}</span>
                    </>
                  )}
                </span>
              </div>
            </div>
          </section>
        </div>

        <aside className={styles.draftRail}>
          <section className={[records.detailPanel, styles.railCard].filter(Boolean).join(" ")}>
            <h2 className={styles.railTitle}>{t("editor.links.title")}</h2>
            <FactRow label={t("fields.number")}>{s.numero}</FactRow>
            <FactRow label={t("fields.client")}>
              {s.client.name}
              {!s.client.active && <span className={records.archivedTag}>{t("archived")}</span>}
            </FactRow>
            <FactRow label={t("fields.exportDate")}>{exportDay}</FactRow>
            <FactRow label={t("fields.invoice")}>
              {invoiceNumero ?? (s.salesInvoice ? t("draftInvoice") : <span className={records.absent} />)}
            </FactRow>
            <FactRow label={t("fields.shippedBy")}>
              {s.shippedBy?.name ?? <span className={records.absent} />}
            </FactRow>
            <FactRow label={t("fields.draftedBy")}>
              {s.createdBy?.name ?? <span className={records.absent} />}
            </FactRow>
            {s.note && <FactRow label={t("fields.note")}>{s.note}</FactRow>}
            <div className={styles.linkList}>
              {orders.map((order) => (
                <RailLink key={order.id} label={t("lines.order")} value={order.numero} href={`/orders/${order.id}`} />
              ))}
              {s.salesInvoice && (
                <RailLink
                  label={t("fields.invoice")}
                  value={invoiceNumero ?? t("draftInvoice")}
                  href={commercial ? `/invoices/sales/${s.salesInvoice.id}` : null}
                />
              )}
              <RailLink
                label={t("fields.client")}
                value={s.client.name}
                href={commercial ? `/clients/${s.client.id}` : null}
              />
              {commercial && (
                <RailLink
                  label={t("editor.links.journal")}
                  value={t("activityLink")}
                  href={`/settings/activity?entity=${encodeURIComponent(s.id)}`}
                />
              )}
            </div>
          </section>

          <section className={[records.detailPanel, styles.railCard].filter(Boolean).join(" ")}>
            <h2 className={styles.railTitle}>{t("editor.trail.title")}</h2>
            <TrailRow
              tone="info"
              label={t("editor.trail.created")}
              meta={[s.createdBy?.name ?? null, formatDateTime(s.createdAt)].filter(
                (part): part is string => part !== null,
              )}
            />
            {s.customsDeclarationNumber ? (
              <TrailRow
                tone="ok"
                label={t("record.trailDeclared", { numero: s.customsDeclarationNumber })}
                meta={[
                  s.customsDeclarationDate === null
                    ? null
                    : t("record.trailDeclaredOn", { date: formatDay(s.customsDeclarationDate) }),
                  hasCustomsFile ? assetFileName(s.customsDeclarationDocument ?? "") : null,
                ].filter((part): part is string => part !== null)}
              />
            ) : (
              <TrailRow
                tone="warn"
                label={t("editor.trail.customsExpected")}
                meta={[t("record.customsNote")]}
              />
            )}
            <TrailRow
              tone="ok"
              label={t("record.trailShipped")}
              meta={[s.shippedBy?.name ?? null, exportDay, t("record.trailNumber", { numero: s.numero ?? "" })].filter(
                (part): part is string => part !== null,
              )}
            />
          </section>

          <section className={styles.frozenCard}>
            <h2 className={styles.frozenTitle}>{t("record.frozenTitle")}</h2>
            <p className={styles.frozenBody}>{t("record.frozenBody")}</p>
          </section>
        </aside>
      </div>
    </>
  );
}

function Tile({
  label,
  value,
  unit,
  alert,
}: {
  label: string;
  value: string;
  unit: string;
  alert?: boolean;
}) {
  return (
    <div className={styles.tile}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={styles.tileFigure}>
        <span
          className={[styles.tileValue, alert ? styles.tileValueAlert : null]
            .filter(Boolean)
            .join(" ")}
        >
          {value}
        </span>
        {unit !== "" && <span className={styles.tileUnit}>{unit}</span>}
      </div>
    </div>
  );
}
