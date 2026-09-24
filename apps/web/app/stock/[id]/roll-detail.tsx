"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { assetUrl, canAccess, canAccessAny } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Thumbnail } from "@repo/ui/thumbnail";
import { useCurrentUser } from "../../auth/use-auth";
import { useTRPC } from "../../trpc/client";
import { invalidateRollQueries, rollMoney } from "../roll-queries";
import styles from "../../records/records.module.css";
import { Panel, Row, Val } from "../../records/record-ui";
import stock from "../stock.module.css";
import { dateFormat, numberFormat } from "../../../i18n/formats";

const kg = () => numberFormat({ maximumFractionDigits: 3 });
const metres = () => numberFormat({ maximumFractionDigits: 2 });
const money = () => numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = () => dateFormat({ dateStyle: "medium" });

/**
 * The reel's state as one word, from "Stock v3.dc.html", which leads its
 * detail header with the number and a status pill rather than making the
 * reader infer the state from the five yes/no rows further down.
 *
 * The handoff's five states are mutually exclusive and ordered: the flags on
 * the row are not, so the first match wins. Archived outranks everything (an
 * archived reel is out of stock whatever else it says), then consumed, then
 * the reservation, then a part-used reel, and "available" is what is left.
 * The same order the list's facets use, so a reel reads the same in both.
 */
type ReelState = "archived" | "consumed" | "reserved" | "partial" | "available";

function reelState(r: {
  archived: boolean;
  consomme: boolean;
  // Nullable in the migrated data, where "not recorded" is not the same
  // answer as "no" — both are falsy here, which is the right reading: a reel
  // with no reservation recorded is not reserved.
  reserved: boolean | null;
  partiel: boolean | null;
}): ReelState {
  if (r.archived) return "archived";
  if (r.consomme) return "consumed";
  if (r.reserved) return "reserved";
  if (r.partiel) return "partial";
  return "available";
}

/** The badge tone for each state — records.module.css owns the palette. */
const REEL_STATE_TONE: Record<ReelState, string> = {
  available: "statusSuccess",
  partial: "statusActive",
  reserved: "statusInfo",
  consumed: "statusNeutral",
  archived: "statusNeutral",
};

/** One figure under the hero bar: a quantity, its unit, an optional tone. */
function Figure({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: string;
}) {
  return (
    <div className={stock.figure}>
      <div className={stock.figureLabel}>{label}</div>
      <div className={stock.figureFigure}>
        <span className={[stock.figureValue, tone].filter(Boolean).join(" ")}>{value}</span>
        <span className={stock.figureUnit}>{unit}</span>
      </div>
    </div>
  );
}

export function RollDetail({ id }: { id: string }) {
  const t = useTranslations("stock");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user: me } = useCurrentUser();
  // Mirrors the procedures' gates — UX only, see ClientsTable. Archive and
  // delete are ADMIN+; cut and slit are the warehouse's (`warehouseProcedure`).
  const canWrite = me ? canAccess(me.role, "ADMIN") : false;
  const canCut = me ? canAccessAny(me.role, ["ADMIN", "MAGASINIER"]) : false;
  const [pending, setPending] = useState<"archive" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const rollQuery = useQuery(trpc.stock.rollById.queryOptions({ id }));

  const invalidate = () => invalidateRollQueries(queryClient, trpc);

  const setArchived = useMutation(
    trpc.stock.setRollArchived.mutationOptions({
      onSuccess: async () => {
        setPending(null);
        await invalidate();
      },
      onError: (cause) => setActionError(cause.message),
    }),
  );
  const remove = useMutation(
    trpc.stock.removeRoll.mutationOptions({
      onSuccess: async () => {
        setPending(null);
        await invalidate();
        router.push("/stock");
      },
      // The API refuses a delete while allocations, split children or
      // consumption reference the reel; surface that message rather than a
      // generic failure.
      onError: (cause) => setActionError(cause.message),
    }),
  );
  /*
   * Receiving one reel from its own page, for the case the scan screen does
   * not cover: a label that will not read at all. Sends the reel's id as the
   * code — `parseRollScan` accepts a bare cuid for exactly this — and the
   * reel's own shipment, so the cross-shipment check can never fire here.
   */
  const receive = useMutation(
    trpc.stock.receiveRoll.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        await queryClient.invalidateQueries({ queryKey: trpc.nav.counts.queryKey() });
      },
      onError: (cause) => setActionError(cause.message),
    }),
  );
  const busy = setArchived.isPending || remove.isPending;

  if (rollQuery.isPending) return <p className={styles.muted}>{t("rolls.loading")}</p>;

  if (rollQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {rollQuery.error.message}
      </p>
    );
  }

  const r = rollQuery.data;
  const date = (value: string | null) => (value === null ? null : day().format(new Date(value)));
  const name = r.numero ?? t("rolls.detail.thisReel");
  const free = Math.max(0, r.metrageRestant - r.metrageReserve);
  // Nulls unless this session may read pricing — the same rank test the
  // server used to decide whether to select the columns at all.
  const rollPrice = rollMoney(r, canWrite);
  /*
   * The proportion left, and what has gone. Both need the received weight,
   * which is null on 159 migrated reels — hence the null `pct` rather than a
   * division by zero, and the 0 fallback for `cutSoFar`. Clamped both ends:
   * a migrated row can carry `poidsRestant` above `poids`, which would
   * otherwise draw a bar past its track or a negative "already cut".
   */
  const pct =
    r.poids === null || r.poids <= 0
      ? null
      : Math.max(0, Math.min(100, Math.round((r.poidsRestant / r.poids) * 100)));
  const cutSoFar = r.poids === null ? 0 : Math.max(0, r.poids - r.poidsRestant);
  /*
   * "KRP-90 · 90 g/m² · 920 mm" beside the number, as the handoff's header
   * reads it. Every part is nullable in the migrated data — 160 reels have no
   * grammage and 6 no grade — so only the parts that exist are drawn and the
   * line disappears entirely rather than rendering a row of separators. Each
   * part is its own <bdi>: joined into one string, the bidi algorithm on an
   * Arabic page reorders the Latin runs and their digits across the dots.
   */
  const specParts = [
    r.paperGrade,
    r.grammage === null ? null : `${r.grammage} g/m²`,
    r.laize === null ? null : `${r.laize} mm`,
  ].filter((part): part is string => Boolean(part));

  /*
   * Deleting is offered only when nothing references the reel: no
   * allocation, no split child, no stocktake line. The API refuses it
   * otherwise — deleting a split parent would leave its children pointing at
   * a row that no longer exists, and a reel seen in a stocktake is part of
   * that count's record — so showing the button would be a dead end.
   * Archiving is the retirement path and is always available.
   */
  const deletable =
    r.allocations.length === 0 &&
    r.children.length === 0 &&
    r._count.countLines === 0 &&
    !r.consomme;
  // A used-up or archived reel has nothing left to cut.
  const cuttable = canCut && !r.consomme && !r.archived;
  // Offered only where the server would accept it: the warehouse's to do, on
  // a live reel that has a delivery to be received against.
  const receivable =
    canCut && !r.consomme && !r.archived && r.receivedAt === null && r.importShipmentId !== null;

  const state = reelState(r);

  /*
   * The dark card's rows: the same five booleans the old State panel listed
   * as Yes/No, read as facts with a figure beside each. The handoff's own
   * rows — state, what is held, what has been cut, when it arrived.
   *
   * `receivedAt` is null on reels that were never scanned in, which is a
   * genuine "pending", not a missing date: until someone receives it the
   * reel cannot be cut, slit or reserved.
   */
  // CSS-module classes are `string | undefined` under noUncheckedIndexedAccess;
  // the dots compose them with filter(Boolean), so a missing one drops out.
  const stateRows: { id: string; label: string; value: string; tone: string | undefined }[] = [
    {
      // Keyed by role, not by label: the state row and the held row both
      // read "Reserved" on a reserved reel, which is correct copy but a
      // duplicate React key.
      id: "state",
      label: t(`rolls.state.${state}`),
      value: pct === null ? t("rolls.detail.noReceivedWeight") : t("rolls.detail.pctLeft", { pct }),
      tone:
        state === "available"
          ? stock.dotSuccess
          : state === "partial"
            ? stock.dotWarn
            : state === "reserved"
              ? stock.dotInfo
              : stock.dotMuted,
    },
    {
      id: "held",
      label: t("rolls.detail.reserved"),
      value:
        r.metrageReserve > 0
          ? t("rolls.detail.metresHeld", { metres: metres().format(r.metrageReserve) })
          : t("rolls.detail.none"),
      tone: r.metrageReserve > 0 ? stock.dotInfo : stock.dotMuted,
    },
    {
      id: "cut",
      label: t("rolls.detail.cutFromThis"),
      value: cutSoFar > 0 ? `${kg().format(cutSoFar)} kg` : t("rolls.detail.none"),
      tone: cutSoFar > 0 ? stock.dotWarn : stock.dotMuted,
    },
    {
      id: "received",
      label: t("rolls.detail.receivedOn"),
      value: r.receivedAt ? (date(r.receivedAt) ?? "") : t("rolls.detail.pending"),
      tone: r.receivedAt ? stock.dotSuccess : stock.dotMuted,
    },
  ];

  /*
   * The sentence under the rows: what the state means for what can be done
   * next, which is the question someone opens this page with. Three cases,
   * in the order that decides them — a reservation constrains a cut before a
   * remnant does, and an untouched reel is the only one whose weight is
   * still correctable.
   */
  const stateNote =
    r.metrageReserve > 0
      ? t("rolls.detail.noteReserved")
      : cutSoFar > 0
        ? t("rolls.detail.noteRemnant")
        : t("rolls.detail.noteUntouched");

  /*
   * The Lineage panel's rows — what the reel is made of today, not an event
   * log: `byId` has no per-reel history to read (the audit log records
   * procedure calls, not reel events), so each row is a figure already on
   * the row, labelled with where it came from or where it went.
   *
   * Built conditionally so a reel only shows the lines that apply to it: an
   * untouched reel says so in one row rather than listing three zeroes.
   */
  const freeKg = Math.max(0, r.poidsRestant - r.poidsReserve);
  const lineage: {
    id: string;
    label: string;
    meta: string;
    value: string;
    tone: string | undefined;
  }[] = [];
  if (r.poids !== null) {
    lineage.push({
      id: "received",
      label: t("rolls.detail.lineageReceived"),
      meta: r.importShipment
        ? `${r.importShipment.numeroImport}${
            r.receivedAt ? ` · ${date(r.receivedAt)}` : ""
          }`
        : t("rolls.detail.lineageNoShipment"),
      value: `${kg().format(r.poids)} kg`,
      tone: stock.dotInfo,
    });
  }
  if (r.parent) {
    lineage.push({
      id: "parent",
      label: t("rolls.detail.lineageCutFrom"),
      meta: r.parent.numero ?? r.parent.paperGrade ?? t("rolls.detail.rollFallback"),
      value: "",
      tone: stock.dotWarn,
    });
  }
  if (cutSoFar > 0) {
    lineage.push({
      id: "cut",
      label: t("rolls.detail.lineageCut"),
      meta: t("rolls.detail.lineageCutMeta", { count: r.children.length }),
      value: `− ${kg().format(cutSoFar)} kg`,
      tone: stock.dotWarn,
    });
  }
  if (r.poidsReserve > 0) {
    lineage.push({
      id: "held",
      label: t("rolls.detail.lineageHeld"),
      meta: t("rolls.detail.lineageHeldMeta", { count: r.allocations.length }),
      value: `${kg().format(r.poidsReserve)} kg`,
      tone: stock.dotInfo,
    });
  }
  lineage.push({
    id: "free",
    label: freeKg > 0 ? t("rolls.detail.lineageFree") : t("rolls.detail.lineageNothingLeft"),
    meta:
      cutSoFar === 0 && r.poidsReserve === 0
        ? t("rolls.detail.lineageUntouchedMeta")
        : t("rolls.detail.lineageFreeMeta"),
    value: `${kg().format(freeKg)} kg`,
    tone: freeKg > 0 ? stock.dotSuccess : stock.dotMuted,
  });

  return (
    <>
      {actionError && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {actionError}
        </p>
      )}

      {/*
        The reel's own identity line — the handoff leads its detail with the
        number and a status pill. The page's <h1> is the generic "Paper roll"
        (a server component, which cannot know the state), so this carries
        which reel this is and what condition it is in.
      */}
      <div className={stock.identity}>
        <span className={stock.identityNo}>{name}</span>
        <span
          className={[styles.statusBadge, styles[REEL_STATE_TONE[state]]]
            .filter(Boolean)
            .join(" ")}
        >
          {t(`rolls.state.${state}`)}
        </span>
        {specParts.length > 0 && (
          <span className={stock.identitySpec}>
            {specParts.map((part, index) => (
              <Fragment key={part}>
                {index > 0 && " · "}
                <bdi>{part}</bdi>
              </Fragment>
            ))}
          </span>
        )}
      </div>

      {/*
        Cut and slit only. Archive and delete moved to the "Take out of
        stock" card in the rail (2026-09-18), as the handoff groups them:
        they retire the reel, which is a different kind of decision from
        working it, and mixing the two put a destructive button beside the
        one the warehouse presses daily.
      */}
      {cuttable && (
        <div className={styles.managerBar}>
          <div className={styles.actions}>
            <Link href={`/stock/${id}/cut`}>
              <Button variant="primary" className={styles.actionBtn}>
                {t("rolls.detail.cut")}
              </Button>
            </Link>
            <Link href={`/stock/${id}/slit`}>
              <Button className={styles.actionBtn}>{t("rolls.detail.slit")}</Button>
            </Link>
          </div>
        </div>
      )}

      {/*
        What is left on the reel, as the figure the page opens with — from
        "Stock v3.dc.html". The proportion needs a denominator, and `poids` is
        null on 159 migrated reels, so the bar and the percentage appear only
        when a received weight exists; the remaining figure always does.
      */}
      <section className={stock.hero}>
        <div className={stock.heroLabel}>{t("rolls.remaining.heroLabel")}</div>
        <div className={stock.heroFigures}>
          <span className={stock.heroValue}>{kg().format(r.poidsRestant)}</span>
          <span className={stock.heroUnit}>kg</span>
          {r.poids !== null && (
            <span className={stock.heroOf}>
              {t("rolls.remaining.heroOf", { total: kg().format(r.poids) })}
            </span>
          )}
          {pct !== null && (
            <span
              className={[
                stock.heroPct,
                pct >= 100 ? stock.pctFull : pct === 0 ? stock.pctEmpty : stock.pctPart,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {pct}%
            </span>
          )}
        </div>

        {pct !== null && (
          <span className={[stock.bar, stock.barTall, stock.heroBar].filter(Boolean).join(" ")}>
            <span
              className={[
                stock.barFill,
                pct >= 100 ? stock.barFillFull : pct === 0 ? stock.barFillEmpty : null,
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ width: `${pct}%` }}
            />
          </span>
        )}

        <div className={stock.figures}>
          <Figure
            label={t("rolls.remaining.lengthRemaining")}
            value={metres().format(r.metrageRestant)}
            unit="m"
          />
          <Figure
            label={t("rolls.remaining.reserved")}
            value={metres().format(r.metrageReserve)}
            unit="m"
          />
          <Figure
            label={t("rolls.remaining.free")}
            value={metres().format(free)}
            unit="m"
            tone={stock.figureFree}
          />
          <Figure
            label={t("rolls.remaining.alreadyCut")}
            value={kg().format(cutSoFar)}
            unit="kg"
            tone={cutSoFar > 0 ? stock.figureCut : undefined}
          />
        </div>
      </section>

      {/*
        Main column and rail, as the handoff lays this page out: the reel's
        own story on the left, the things you look up or act on at the right.
        `detailBody` collapses to one column under 900px.
      */}
      <div className={stock.detailBody}>
        <div className={stock.detailMain}>
        <Panel title={t("rolls.detail.rollPanel")}>
          {/* Labels, not keys: 17 legacy reels share the number "0". */}
          <Row label={t("rolls.detail.number")}><Val value={r.numero} /></Row>
          <Row label={t("rolls.detail.sourceNumber")}><Val value={r.numeroSource} /></Row>
          <Row label={t("rolls.detail.grade")}><Val value={r.paperGrade} /></Row>
          <Row label={t("rolls.detail.description")}><Val value={r.description} /></Row>
          <Row label={t("rolls.detail.paper")}>
            <Val value={r.paperType ? enums(`paperType.${r.paperType}`) : null} />
          </Row>
          <Row label={t("rolls.detail.grammage")}><Val value={r.grammage} suffix="g/m²" /></Row>
          <Row label={t("rolls.detail.width")}><Val value={r.laize} suffix="mm" /></Row>
          {/* Only rolls labelled through the legacy app carry a QR image. */}
          {assetUrl(r.qrCodeUrl) !== null && (
            <Row label={t("rolls.detail.qrCode")}>
              <Thumbnail
                size="sm"
                src={assetUrl(r.qrCodeUrl)}
                href={assetUrl(r.qrCodeUrl)}
                alt={t("rolls.detail.qrAlt", { numero: r.numero ?? "" })}
              />
            </Row>
          )}
        </Panel>

        <Panel title={t("rolls.detail.quantityPanel")}>
          <Row label={t("rolls.detail.weight")}>
            <Val value={r.poids === null ? null : kg().format(r.poids)} suffix="kg" />
          </Row>
          <Row label={t("rolls.detail.reserved")}>
            <Val value={kg().format(r.poidsReserve)} suffix="kg" />
          </Row>
          <Row label={t("rolls.detail.length")}>
            <Val value={r.metrage === null ? null : metres().format(r.metrage)} suffix="m" />
          </Row>
          <Row label={t("rolls.detail.lengthReserved")}>
            <Val value={metres().format(r.metrageReserve)} suffix="m" />
          </Row>
          <Row label={t("rolls.detail.lengthFree")}>
            <Val value={metres().format(free)} suffix="m" />
          </Row>
        </Panel>

        {/*
          The handoff gives this panel an empty state instead of hiding it:
          "nothing holds this reel" is a useful answer before a cut, and the
          silence of a missing panel is not. Only where a reservation could
          exist at all — a consumed or archived reel is nobody's to hold, and
          the state pill above already says so.
        */}
        {r.allocations.length === 0 && !r.consomme && !r.archived && (
          <Panel title={t("rolls.detail.noAllocationsPanel")} wide>
            <p className={stock.emptyNote}>
              <strong className={stock.emptyNoteTitle}>
                {t("rolls.detail.noAllocationsTitle")}
              </strong>
              {t("rolls.detail.noAllocationsBody")}
            </p>
          </Panel>
        )}

        {r.allocations.length > 0 && (
          <Panel title={t("rolls.detail.allocatedPanel", { count: r.allocations.length })} wide>
            {r.allocations.map((alloc) => (
              <Row key={alloc.id} label={day().format(new Date(alloc.dateAllocation))}>
                <Link className={styles.inlineLink} href={`/orders/${alloc.order.id}`}>
                  {alloc.order.numero}
                </Link>
                {" — "}
                {alloc.metrageReserve === null
                  ? t("rolls.detail.kgOnly", { kg: kg().format(alloc.poidsReserve) })
                  : `${metres().format(alloc.metrageReserve)} m`}
                {" · "}
                {enums(`allocationState.${alloc.state}`)}
                {alloc.allocatedBy && (
                  <span className={styles.muted}>
                    {" · "}
                    {t("rolls.detail.by", { name: alloc.allocatedBy.name })}
                  </span>
                )}
              </Row>
            ))}
          </Panel>
        )}

        {/*
          The split lineage. Cutting a reel creates a child pointing back here,
          nesting up to 16 deep in the migrated data.
        */}
        {(r.parent || r.children.length > 0) && (
          <Panel title={t("rolls.detail.splitPanel")} wide>
            {r.parent && (
              <Row label={t("rolls.detail.cutFrom")}>
                <Link className={styles.inlineLink} href={`/stock/${r.parent.id}`}>
                  {r.parent.numero ?? r.parent.paperGrade ?? t("rolls.detail.rollFallback")}
                </Link>
              </Row>
            )}
            {r.children.map((child) => (
              <Row key={child.id} label={t("rolls.detail.cutInto")}>
                <Link className={styles.inlineLink} href={`/stock/${child.id}`}>
                  {child.numero ?? t("rolls.detail.rollFallback")}
                </Link>
                {" — "}
                {child.laize !== null && `${child.laize} mm · `}
                {metres().format(child.metrageRestant)} m · {kg().format(child.poidsRestant)} kg
                {child.consomme ? ` ${t("rolls.detail.usedSuffix")}` : ""}
              </Row>
            ))}
          </Panel>
        )}

        {/*
          Where the weight on this reel went, as the handoff's Lineage panel:
          what arrived, what is held, what was cut, what is free. Built from
          the figures already on the row — there is no per-reel event log to
          read (`AuditLog` records procedure calls, not reel events), so this
          states the reel's composition today rather than claiming a history
          it cannot evidence. That is also why it carries no dates beyond the
          ones the row itself stores.
        */}
        <Panel title={t("rolls.detail.lineagePanel")} wide>
          {lineage.map((entry) => (
            <div key={entry.id} className={stock.lineageRow}>
              <i className={[stock.lineageDot, entry.tone].filter(Boolean).join(" ")} />
              <span className={stock.lineageText}>
                <span className={stock.lineageLabel}>{entry.label}</span>
                <span className={stock.lineageMeta}>{entry.meta}</span>
              </span>
              <span className={stock.lineageValue}>{entry.value}</span>
            </div>
          ))}
        </Panel>
        </div>

        <div className={stock.detailRail}>
          <Panel title={t("rolls.detail.purchasePanel")}>
            <Row label={t("rolls.detail.shipment")}>
              {r.importShipment ? (
                <Link className={styles.inlineLink} href={`/stock/shipments/${r.importShipment.id}`}>
                  {r.importShipment.numeroImport}
                </Link>
              ) : (
                <span className={styles.absent} />
              )}
            </Row>
            <Row label={t("rolls.detail.imported")}>
              <Val value={r.importShipment ? date(r.importShipment.dateImport) : null} />
            </Row>
            {/* What the paper cost is ADMIN+ only, and the server enforces it by
                not selecting the columns at all (`StockService.canReadPricing`).
                `canWrite` is that same rank test, so a warehouse session renders
                no price rows rather than two empty ones. */}
            {canWrite && (
              <>
                <Row label={t("rolls.detail.price")}>
                  <Val value={rollPrice.price === null ? null : money().format(rollPrice.price)} />
                </Row>
                <Row label={t("rolls.detail.withTransport")}>
                  <Val
                    value={
                      rollPrice.priceWithTransport === null
                        ? null
                        : money().format(rollPrice.priceWithTransport)
                    }
                  />
                </Row>
                {/*
                  What is still on the reel is worth — the handoff's figure,
                  added once the price columns landed (1 530 of 1 532 reels
                  carry one). Derived here rather than served: it is
                  `poidsRestant x price` and nothing else, so computing it in
                  the client keeps it honest against the weight shown above it
                  instead of risking a server total from a different snapshot.

                  Priced at the paper alone, not `priceWithTransport`, which
                  only 526 reels carry — mixing the two would make two reels
                  from one delivery incomparable.
                */}
                <Row label={t("rolls.detail.valueInStock")}>
                  <Val
                    value={
                      rollPrice.price === null
                        ? null
                        : money().format(r.poidsRestant * rollPrice.price)
                    }
                  />
                </Row>
              </>
            )}
            {/*
              The handoff ends this card with the shipment as a full-width
              link rather than only the inline one in the row above: from a
              reel, "where did this come from" is a place you go, not just a
              value you read.
            */}
            {r.importShipment && (
              <Link
                className={stock.shipmentLink}
                href={`/stock/shipments/${r.importShipment.id}`}
              >
                <span>
                  {t("rolls.detail.shipment")} {r.importShipment.numeroImport}
                </span>
                <span className={stock.shipmentArrow} aria-hidden="true">
                  →
                </span>
              </Link>
            )}
          </Panel>

          {/*
            The state at a glance, as the handoff's dark card: one row per
            fact with a coloured dot, and a sentence saying what it means for
            what you can do next. The five yes/no rows the panel used to
            carry are the same facts — this reads them as a story rather than
            a checklist.

            `data-surface="floor"` is what makes it dark: that scope already
            redefines every ink and hairline token for an ink ground, so the
            card inherits the shop-floor inversion rather than forking the
            palette (tokens.css).
          */}
          <section className={stock.statePanel} data-surface="floor">
            <h2 className={stock.statePanelTitle}>{t("rolls.detail.statePanel")}</h2>
            {stateRows.map((row) => (
              <div key={row.id} className={stock.stateRow}>
                <i className={[stock.stateDot, row.tone].filter(Boolean).join(" ")} />
                <span className={stock.stateLabel}>{row.label}</span>
                <span className={stock.stateValue}>{row.value}</span>
              </div>
            ))}
            <p className={stock.stateNote}>{stateNote}</p>
            {receivable && (
              <div className={stock.stateAction}>
                <Button
                  variant="primary"
                  busy={receive.isPending}
                  onClick={() => {
                    setActionError(null);
                    receive.mutate({ shipmentId: r.importShipmentId ?? "", code: r.id });
                  }}
                >
                  {t("rolls.detail.receive")}
                </Button>
              </div>
            )}
          </section>

          {/*
            Taking the reel out of stock, as its own card — the handoff keeps
            archive and delete together, away from the cut/slit actions, with
            the sentence that explains which of the two is possible.
          */}
          {canWrite && (
            <section className={stock.dangerPanel}>
              <h2 className={stock.dangerTitle}>{t("rolls.detail.removeTitle")}</h2>
              <p className={stock.dangerNote}>{t("rolls.detail.removeNote")}</p>
              <div className={stock.dangerActions}>
                <Button
                  onClick={() => {
                    setActionError(null);
                    setPending("archive");
                  }}
                >
                  {r.archived ? common("restore") : common("archive")}
                </Button>
                {deletable && (
                  <Button
                    variant="danger"
                    onClick={() => {
                      setActionError(null);
                      setPending("delete");
                    }}
                  >
                    {common("delete")}
                  </Button>
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Every cut, slit and consumption on this reel. Admin-only, like the
          activity page; reservations show on the order's timeline instead. */}
      {canWrite && (
        <p className={[styles.muted, stock.activityLink].filter(Boolean).join(" ")}>
          <Link className={styles.inlineLink} href={`/settings/activity?entity=${encodeURIComponent(id)}`}>
            {t("rolls.detail.activity")}
          </Link>
        </p>
      )}

      <Dialog
        open={pending !== null}
        title={
          pending === "delete"
            ? t("rolls.detail.deleteTitle")
            : r.archived
              ? t("rolls.detail.restoreTitle")
              : t("rolls.detail.archiveTitle")
        }
        confirmLabel={
          pending === "delete"
            ? common("delete")
            : r.archived
              ? common("restore")
              : common("archive")
        }
        destructive={pending === "delete" || !r.archived}
        busy={busy}
        onConfirm={() => {
          if (pending === "delete") remove.mutate({ id });
          else setArchived.mutate({ id, archived: !r.archived });
        }}
        onClose={() => !busy && setPending(null)}
      >
        {t.rich(
          pending === "delete"
            ? "rolls.detail.deleteBody"
            : r.archived
              ? "rolls.detail.restoreBody"
              : "rolls.detail.archiveBody",
          { name, strong: (chunks) => <strong>{chunks}</strong> },
        )}
      </Dialog>
    </>
  );
}
