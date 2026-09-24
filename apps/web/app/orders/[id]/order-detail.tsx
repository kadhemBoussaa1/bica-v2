"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import {
  assetUrl,
  canAccess,
  parcelBalance,
  plannedParcels,
  type OrderKind,
  type OrderStatus,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TableSkeleton } from "@repo/ui/skeleton";
import { Thumbnail } from "@repo/ui/thumbnail";
import { useCurrentUser } from "../../auth/use-auth";
import { useTRPC } from "../../trpc/client";
import { OrderColours } from "../order-colours";
import { OrderInks } from "../order-inks";
import { OrderPaper } from "../order-paper";
import { OrderProduction, runHeadline } from "../order-production";
import { OrderStatusBadge } from "../order-status";
import { OrderTransitions } from "../order-transitions";
import records from "../../records/records.module.css";
import styles from "../order-detail.module.css";
import { dateFormat, numberFormat } from "../../../i18n/formats";

/**
 * The `order.byId` payload — a UNION: the server picks a narrower select for
 * callers who may not read pricing, so the money columns are absent rather
 * than nulled. Derived from the router, never hand-written.
 */
type OrderDetailData = inferRouterOutputs<AppRouter>["order"]["byId"];
type Run = inferRouterOutputs<AppRouter>["production"]["forOrder"][number];

const int = () => numberFormat({ maximumFractionDigits: 0 });
const money = () => numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Unit prices run to 6+ decimals in the legacy data; rounding would misreport. */
const unit = () => numberFormat({ maximumFractionDigits: 6 });
const day = () => dateFormat({ dateStyle: "medium" });

/** A label / value row inside a spec block. An absent value says so in words. */
function Spec({
  label,
  value,
  unit: u,
}: {
  label: string;
  value: ReactNode | null;
  unit?: string;
}) {
  const absent = value === null || value === "";
  return (
    <div className={styles.specRow}>
      <span className={styles.specLabel}>{label}</span>
      <span
        className={[styles.specValue, absent ? styles.absent : null]
          .filter(Boolean)
          .join(" ")}
      >
        {absent ? "—" : value}
        {!absent && u && <span className={styles.unit}> {u}</span>}
      </span>
    </div>
  );
}

function Card({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={[styles.card, className].filter(Boolean).join(" ")}>
      {title && <h2 className={styles.cardTitle}>{title}</h2>}
      {children}
    </section>
  );
}

/** The rail's status dot takes the badge's tone, as a colour only. */
const STATUS_DOT: Record<OrderStatus, string> = {
  DRAFT: "var(--bp-neutral-400)",
  IN_PRODUCTION: "var(--bp-orange-500)",
  PRODUCED: "var(--bp-info)",
  INVOICEABLE: "var(--bp-warning)",
  INVOICED: "var(--bp-info)",
  READY_FOR_EXPORT: "var(--bp-warning)",
  COMPLETED: "var(--bp-success)",
  CANCELLED: "var(--bp-danger)",
};

/** A quote has no lifecycle of its own yet, so it reads as its kind. */
function statusLabel(
  enums: (key: string) => string,
  kind: OrderKind,
  status: OrderStatus,
): string {
  return kind === "QUOTE" ? enums("orderKind.QUOTE") : enums(`orderStatus.${status}`);
}

/** Pieces the producer station has recorded, with the daily view's fallback. */
function producedFrom(runs: Run[]): number {
  return runs
    .filter((run) => run.stage === "PRODUCER")
    .reduce((sum, run) => sum + (run.piecesProduced ?? run.quantite), 0);
}

/** Parcels the packaging station has closed — what a sales invoice bills. */
function packedFrom(runs: Run[]): number {
  return runs
    .filter((run) => run.stage === "PACKAGING")
    .reduce((sum, run) => sum + (run.parcelsClosed ?? 0), 0);
}

export function OrderDetail({ id }: { id: string }) {
  const trpc = useTRPC();
  const t = useTranslations("orders");
  const enums = useTranslations("enums");
  const { user } = useCurrentUser();
  const orderQuery = useQuery(trpc.order.byId.queryOptions({ id }));
  // The same query the production panel below runs, so it is fetched once
  // and both the header's figures and the entries list read one answer.
  const runsQuery = useQuery(
    trpc.production.forOrder.queryOptions({ orderId: id }),
  );

  if (orderQuery.isPending) return <TableSkeleton rows={8} />;

  if (orderQuery.isError) {
    return (
      <p
        className={[records.notice, records.error].filter(Boolean).join(" ")}
        role="alert"
      >
        {orderQuery.error.message}
      </p>
    );
  }

  const o = orderQuery.data;
  const p = o.product;
  const runs = runsQuery.data ?? [];
  const num = (v: number | null) => (v === null ? null : unit().format(v));
  const cash = (v: number | null) => (v === null ? null : money().format(v));
  const canWrite = user !== null && canAccess(user.role, "ADMIN");

  const unitLabel = o.quantityUnit === "KILOGRAMS" ? "kg" : "pcs";
  const produced = producedFrom(runs);
  const pct =
    o.quantite > 0
      ? Math.min(100, Math.round((produced / o.quantite) * 100))
      : 0;
  const dims =
    p.typeSac === "SOUS_PLAT"
      ? `${p.widthCm}×${p.lengthCm}`
      : `${p.widthCm}×${p.lengthCm}×${p.gussetCm ?? 0}`;
  // Newest by the day the work happened, then by when it was typed in.
  const lastRun = [...runs].sort(
    (a, b) =>
      new Date(b.dateProduction).getTime() -
        new Date(a.dateProduction).getTime() ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
  const photo = assetUrl(p.images[0]);
  const priced = hasPricing(o) ? o : null;
  const packed = packedFrom(runs);
  // Several invoices and shipments after a partial export
  // (docs/export-plan.md): one pair per cycle. The invoices ride the priced
  // select (money), the shipments the unpriced one (the warehouse reads it).
  const invoices = priced
    ? priced.invoiceLines.map((line) => ({ ...line.invoice, quantity: line.quantity }))
    : undefined;
  const draftInvoice = invoices ? (invoices.find((inv) => inv.status === "DRAFT") ?? null) : undefined;
  const shipments = o.shipmentLines.map((line) => ({ ...line.shipment, quantity: line.quantity }));
  const draftShipment = shipments.find((s) => s.status === "DRAFT") ?? null;
  const planned = plannedParcels(o.parcelCount);
  const toInvoice =
    planned === null || !invoices
      ? null
      : parcelBalance(planned, invoices.filter((inv) => inv.status === "ISSUED"));
  const toShip = planned === null ? null : parcelBalance(planned, shipments);

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        {/* Identity, and the four figures that summarise the job. */}
        <Card>
          <div className={styles.headRow}>
            <div className={styles.thumb}>
              {photo ? (
                // S3 URL from the legacy bucket, already sized: next/image would re-proxy it.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt="" />
              ) : (
                <span>{t("detail.artworkPlaceholder")}</span>
              )}
            </div>
            <div className={styles.headMeta}>
              <div className={styles.noRow}>
                <span className={styles.no}>{o.numero}</span>
                <OrderStatusBadge kind={o.kind} status={o.status} />
                {!o.active && (
                  <span className={records.archivedTag}>{t("archivedTag")}</span>
                )}
              </div>
              <div className={styles.productName}>
                <Link href={`/products/${p.id}`}>{p.name}</Link>
                {!p.active && (
                  <span className={records.archivedTag}>{t("archivedTag")}</span>
                )}
              </div>
              <div className={styles.clientName}>
                {o.client?.name ?? t("noClient")}
              </div>
              <div className={styles.lastEntry}>
                <span className={styles.k}>{t("detail.lastEntry")}</span>
                {lastRun
                  ? `${enums(`workshopStage.${lastRun.stage}`)} · ${runHeadline(lastRun, t)} · ${day().format(new Date(lastRun.dateProduction))}`
                  : t("detail.nothingRecordedYet")}
              </div>
            </div>
          </div>
          <div className={styles.headline}>
            <div className={styles.headlineCell}>
              <div className={styles.headlineLabel}>{t("detail.ordered")}</div>
              <div className={styles.headlineFigure}>
                <span className={styles.headlineValue}>
                  {int().format(o.quantite)}
                </span>
                <span className={styles.unit}>{unitLabel}</span>
              </div>
            </div>
            <div className={styles.headlineCell}>
              <div className={styles.headlineLabel}>{t("detail.produced")}</div>
              <div className={styles.headlineFigure}>
                <span className={styles.headlineValue}>
                  {int().format(produced)}
                </span>
                <span className={styles.unit}>pcs</span>
              </div>
            </div>
            <div className={styles.headlineCell}>
              <div className={styles.headlineLabel}>{t("detail.spec")}</div>
              <div className={styles.headlineFigure}>
                <span className={styles.headlineValue}>{dims}</span>
                <span className={styles.unit}>cm</span>
              </div>
            </div>
            <div className={styles.headlineCell}>
              <div className={styles.headlineLabel}>{t("detail.grammage")}</div>
              <div className={styles.headlineFigure}>
                <span className={styles.headlineValue}>
                  {p.grammage ?? "—"}
                </span>
                <span className={styles.unit}>g/m²</span>
              </div>
            </div>
          </div>
        </Card>

        <Card title={t("detail.orderCard")}>
          <div className={styles.specGrid}>
            <Spec label={t("detail.client")} value={o.client?.name ?? null} />
            <Spec
              label={t("detail.quantity")}
              value={int().format(o.quantite)}
              unit={unitLabel}
            />
            <Spec
              label={t("detail.export")}
              value={o.exportStatus ? enums(`exportStatus.${o.exportStatus}`) : null}
            />
            {/* Only a quote-born order carries an acceptance stamp. */}
            {o.acceptedAt && (
              <Spec
                label={t("detail.accepted")}
                value={`${day().format(new Date(o.acceptedAt))}${o.acceptedBy ? ` · ${o.acceptedBy.name}` : ""}`}
              />
            )}
            <Spec label={t("detail.created")} value={day().format(new Date(o.createdAt))} />
          </div>
        </Card>

        <Card title={t("detail.productSpecification")}>
          <div className={styles.specGrid}>
            <Spec label={t("spec.type")} value={enums(`typeSac.${p.typeSac}`)} />
            <Spec label={t("spec.width")} value={p.widthCm} unit="cm" />
            <Spec label={t("spec.length")} value={p.lengthCm} unit="cm" />
            {p.typeSac !== "SOUS_PLAT" && (
              <>
                <Spec label={t("spec.gusset")} value={p.gussetCm} unit="cm" />
                <Spec label={t("spec.foldWidth")} value={p.pleatWidthCm} unit="cm" />
                <Spec label={t("spec.foldLength")} value={p.pleatLengthCm} unit="cm" />
              </>
            )}
            <Spec label={t("spec.grammage")} value={p.grammage} unit="g/m²" />
            <Spec
              label={t("spec.paper")}
              value={p.paperType ? enums(`paperType.${p.paperType}`) : null}
            />
            <Spec
              label={t("spec.handle")}
              value={
                p.hasHandle
                  ? t("spec.handleYes", { weight: p.handleWeightG ?? 0 })
                  : t("spec.handleNo")
              }
            />
          </div>
        </Card>

        <Card title={t("detail.computedDimensions")}>
          <div className={styles.specGrid}>
            <Spec
              label={t("spec.productionWidth")}
              value={num(o.productionWidthCm)}
              unit="cm"
            />
            <Spec
              label={t("spec.cuttingLength")}
              value={num(o.cuttingLengthCm)}
              unit="cm"
            />
            <Spec label={t("spec.unitWeight")} value={num(o.unitWeightG)} unit="g" />
            <Spec
              label={t("pricing.paperNeeded")}
              value={num(o.metrageNecessaire)}
              unit="m"
            />
          </div>
        </Card>

        {/*
          Everything the shop floor does not work from renders only when the
          API actually sent those columns — a render guard over a narrowed
          type, not a role check: below ADMIN the columns are simply absent.
        */}
        {priced && (
          <>
            <Card title={t("detail.gluePaperPrinting")}>
              <div className={styles.specGrid}>
                {p.hasHandle && (
                  <Spec
                    label={t("pricing.handleGlue")}
                    value={
                      priced.handleGlueKiloPrice !== null ||
                      priced.handleGlueWeightG !== null
                        ? `${num(priced.handleGlueKiloPrice) ?? "—"}/kg · ${num(priced.handleGlueWeightG) ?? "—"} g`
                        : null
                    }
                  />
                )}
                <Spec
                  label={t("pricing.sideGlue")}
                  value={
                    priced.sideGlueKiloPrice !== null ||
                    priced.sideGlueWeightG !== null
                      ? `${num(priced.sideGlueKiloPrice) ?? "—"}/kg · ${num(priced.sideGlueWeightG) ?? "—"} g`
                      : null
                  }
                />
                <Spec
                  label={t("pricing.baseAdhesive")}
                  value={
                    priced.baseAdhesiveKiloPrice !== null ||
                    priced.baseAdhesiveWeightG !== null
                      ? `${num(priced.baseAdhesiveKiloPrice) ?? "—"}/kg · ${num(priced.baseAdhesiveWeightG) ?? "—"} g`
                      : null
                  }
                />
                <Spec
                  label={t("pricing.paperPrice")}
                  value={num(priced.paperKiloPrice)}
                  unit="/kg"
                />
                <Spec
                  label={t("pricing.printing")}
                  value={
                    priced.typeImpression
                      ? enums(`typeImpression.${priced.typeImpression}`)
                      : null
                  }
                />
              </div>
              {priced.legacyGlueCostPerUnit !== null && (
                <p className={styles.hint}>
                  {t("detail.legacyGluePerUnit", {
                    value: num(priced.legacyGlueCostPerUnit) ?? "",
                  })}{" "}
                  {priced.handleGlueKiloPrice === null &&
                  priced.sideGlueKiloPrice === null &&
                  priced.baseAdhesiveKiloPrice === null
                    ? t("detail.legacyInEffect")
                    : t("detail.legacyReplaced")}
                </p>
              )}
            </Card>

            <Card title={t("detail.packing")}>
              <div className={styles.specGrid}>
                <Spec
                  label={
                    o.quantityUnit === "KILOGRAMS"
                      ? t("pricing.kilosPerParcel")
                      : t("pricing.piecesPerParcel")
                  }
                  value={num(
                    o.quantityUnit === "KILOGRAMS"
                      ? priced.kilosPerParcel
                      : priced.piecesPerParcel,
                  )}
                />
                <Spec
                  label={t("pricing.parcelBase")}
                  value={cash(priced.baseParcelPrice)}
                />
                <Spec
                  label={t("pricing.parcelFinal")}
                  value={cash(priced.finalParcelPrice)}
                />
                <Spec
                  label={t("pricing.profitMargin")}
                  value={num(priced.profitMarginPct)}
                  unit="%"
                />
                <Spec
                  label={t("pricing.lossMargin")}
                  value={num(priced.lossMarginPct)}
                  unit="%"
                />
              </div>
            </Card>

            {/* What the job is printed in. `colours` is only on the priced
                select, so this card lives inside the priced block. */}
            <OrderColours orderId={o.id} colours={priced.colours} />
          </>
        )}

        {/* Paper reserved for the order, in metres, and the picker behind it. */}
        <OrderPaper orderId={o.id} status={o.status} kind={o.kind} />

        {/* Owns the entries list and the recording form. */}
        <OrderProduction orderId={o.id} status={o.status} />

        {/* Ink drawn from the colour stock — the consumable beside the paper above. */}
        <OrderInks orderId={o.id} status={o.status} />

        <Card title={t("detail.lifecycle")}>
          {o.statusChanges.length === 0 && (
            <p className={styles.quiet}>{t("detail.noTransitions")}</p>
          )}
          {o.statusChanges.map((change) => (
            <div key={change.id} className={styles.row}>
              <span className={styles.rowDate}>
                {day().format(new Date(change.at))}
              </span>
              <span className={styles.rowMove}>
                {change.fromStatus === change.toStatus ? (
                  <strong>{statusLabel(enums, o.kind, change.toStatus)}</strong>
                ) : (
                  <>
                    {change.fromStatus
                      ? enums(`orderStatus.${change.fromStatus}`)
                      : t("detail.created")}{" "}
                    → <strong>{statusLabel(enums, o.kind, change.toStatus)}</strong>
                  </>
                )}
                {change.note && (
                  <span className={styles.quiet}> ({change.note})</span>
                )}
              </span>
              <span className={styles.rowBy}>{change.by?.name ?? "—"}</span>
            </div>
          ))}
          {o.description && (
            <p className={styles.description}>
              <span className={styles.k}>{t("detail.description")}</span>
              {o.description}
            </p>
          )}
          {/* The cross-cutting trace: every call on this order and on what
              was raised from it — runs, shipments, invoices. Admin-only,
              like the activity page itself. */}
          {canWrite && (
            <p className={styles.quiet}>
              <Link
                className={records.inlineLink}
                href={`/settings/activity?entity=${encodeURIComponent(o.id)}`}
              >
                {t("detail.activityOnOrder")}
              </Link>
            </p>
          )}
        </Card>
      </div>

      <aside className={styles.rail}>
        <Card title={t("detail.status")} className={styles.statusCard}>
          <div className={styles.statusLine}>
            <i
              className={styles.statusDot}
              style={
                {
                  "--dot":
                    o.kind === "QUOTE"
                      ? "var(--bp-neutral-300)"
                      : STATUS_DOT[o.status],
                } as CSSProperties
              }
              aria-hidden="true"
            />
            <span className={styles.statusText}>
              {statusLabel(enums, o.kind, o.status)}
            </span>
          </div>
          <div className={styles.meterRow}>
            <span className={styles.k}>{t("detail.produced")}</span>
            <span className={styles.meterValue}>{pct}%</span>
          </div>
          <div
            className={styles.meter}
            role="meter"
            aria-label={t("detail.producedAgainstOrdered")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <span className={styles.meterFill} style={{ width: `${pct}%` }} />
          </div>
          <div className={styles.meterRow}>
            <span className={styles.k}>{t("detail.packed")}</span>
            <span className={styles.meterValue}>
              {packed > 0
                ? t("parcels", { count: packed, n: int().format(packed) })
                : t("detail.noneRecorded")}
            </span>
          </div>
          <OrderTransitions
            orderId={o.id}
            kind={o.kind}
            status={o.status}
            draftInvoice={draftInvoice}
            draftShipment={draftShipment}
            edit={
              canWrite ? (
                <Link href={`/orders/${o.id}/edit`}>
                  <Button variant="secondary">{t("detail.editOrder")}</Button>
                </Link>
              ) : null
            }
          />
        </Card>

        {/* From INVOICED onward: the documents that bill this order, one per export cycle. */}
        {invoices && invoices.length > 0 && (
          <Card title={t("detail.invoices", { count: invoices.length })}>
            {invoices.map((inv) => (
              <div key={inv.id}>
                <div className={styles.invoiceRow}>
                  <Link className={records.inlineLink} href={`/invoices/sales/${inv.id}`}>
                    {inv.numero ?? t("detail.draftInvoice")}
                  </Link>
                  <span
                    className={[
                      records.statusBadge,
                      inv.status === "ISSUED" ? records.statusSuccess : records.statusNeutral,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {enums(`salesInvoiceStatus.${inv.status}`)}
                  </span>
                </div>
                <div className={styles.moneyRow}>
                  <span className={styles.moneyLabel}>
                    {inv.quantity === null
                      ? t("parcelsLabel")
                      : t("parcels", { count: inv.quantity, n: int().format(inv.quantity) })}
                  </span>
                  <span className={styles.moneyValue}>
                    {inv.totalTtc === null ? "—" : money().format(inv.totalTtc)}
                    {inv.currency && <span className={styles.unit}> {inv.currency}</span>}
                  </span>
                </div>
              </div>
            ))}
            {draftInvoice && (
              <p className={styles.hint}>
                {t("detail.draftInvoiceHint")}
              </p>
            )}
            {toInvoice !== null && planned !== null && (
              <p className={styles.hint}>
                {toInvoice === 0
                  ? t("detail.allParcelsInvoiced", { planned: int().format(planned) })
                  : t("detail.remainingToInvoice", {
                      remaining: int().format(toInvoice),
                      planned: int().format(planned),
                    })}
              </p>
            )}
          </Card>
        )}

        {/* Outbound: the truck(s) that carried this order's parcels. Unpriced, so the warehouse sees it. */}
        {shipments.length > 0 && (
          <Card title={t("detail.shipments", { count: shipments.length })}>
            {shipments.map((s) => (
              <div key={s.id}>
                <div className={styles.invoiceRow}>
                  <Link className={records.inlineLink} href={`/shipments/${s.id}`}>
                    {s.numero ?? t("detail.draftShipment")}
                  </Link>
                  <span
                    className={[
                      records.statusBadge,
                      s.status === "SHIPPED" ? records.statusSuccess : records.statusNeutral,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {enums(`shipmentStatus.${s.status}`)}
                  </span>
                </div>
                <div className={styles.moneyRow}>
                  <span className={styles.moneyLabel}>
                    {t("parcels", { count: s.quantity, n: int().format(s.quantity) })} ·{" "}
                    {enums(`shipmentKind.${s.kind}`)}
                  </span>
                  <span className={styles.moneyValue}>
                    {s.exportDate ? day().format(new Date(s.exportDate)) : "—"}
                  </span>
                </div>
              </div>
            ))}
            {draftShipment && (
              <p className={styles.hint}>
                {t("detail.draftShipmentHint")}
              </p>
            )}
            {toShip !== null && planned !== null && (
              <p className={styles.hint}>
                {toShip === 0
                  ? t("detail.allParcelsShipped", { planned: int().format(planned) })
                  : t("detail.remainingToShip", {
                      remaining: int().format(toShip),
                      planned: int().format(planned),
                    })}
              </p>
            )}
          </Card>
        )}

        {priced && (
          <Card title={t("detail.orderTotal")}>
            <div className={styles.total}>
              {priced.orderTotal ? money().format(priced.orderTotal) : "—"}
            </div>
            {priced.pricingSource === "LEGACY" && (
              <p className={styles.hint} style={{ margin: "0 0 10px" }}>
                {t("detail.legacyPricing")}
                {priced.paperKiloPrice === null && ` ${t("detail.legacyPricingReprice")}`}
              </p>
            )}
            {(
              [
                ["paperPrice", num(priced.paperKiloPrice), "/kg"],
                ["unitPrice", num(priced.unitPrice), ""],
                ["withMargins", num(priced.unitPriceWithMargins), ""],
                ["gluePerUnit", num(priced.glueCostPerUnit), ""],
                ["finalUnitPrice", num(priced.finalUnitPrice), ""],
                ["parcelPrice", cash(priced.parcelPrice), ""],
                ["transport", cash(priced.transportCost), ""],
                [
                  "parcels",
                  o.parcelCount === null ? null : money().format(o.parcelCount),
                  "",
                ],
              ] as const
            ).map(([key, value, u]) => (
              <div key={key} className={styles.moneyRow}>
                <span className={styles.moneyLabel}>{t(`pricing.${key}`)}</span>
                <span
                  className={[
                    styles.moneyValue,
                    value === null ? styles.absent : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {value ?? "—"}
                  {value !== null && u && (
                    <span className={styles.unit}> {u}</span>
                  )}
                </span>
              </div>
            ))}
          </Card>
        )}

        {/* Artwork belongs to the product and is edited on its page. */}
        <Card
          title={t("detail.productArtworkCount", { count: Math.max(1, p.images.length) })}
        >
          <div className={styles.artwork}>
            {photo ? (
              <a href={photo} target="_blank" rel="noreferrer">
                {/* S3 URL from the legacy bucket, opened full size: next/image would re-proxy it. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo} alt={t("detail.artworkAlt", { name: p.name })} />
              </a>
            ) : (
              <span>{t("detail.noArtwork")}</span>
            )}
          </div>
          {p.images.length > 1 && (
            <div className={styles.artworkMore}>
              {p.images.slice(1).map((src) => (
                <Thumbnail
                  key={src}
                  size="sm"
                  src={assetUrl(src)}
                  href={assetUrl(src)}
                />
              ))}
            </div>
          )}
        </Card>
      </aside>
    </div>
  );
}

/**
 * The order shape as it arrives for a caller allowed to read pricing —
 * `ORDER_DETAIL_SELECT_PRICED` on the server.
 */
type PricedOrder = Extract<OrderDetailData, { orderTotal: unknown }>;

/**
 * Narrows an order to the priced shape. One `in` check is enough: the two
 * selects differ by whole columns, so the presence of `orderTotal` implies
 * every other money field came with it.
 */
function hasPricing(order: OrderDetailData): order is PricedOrder {
  return "orderTotal" in order;
}
