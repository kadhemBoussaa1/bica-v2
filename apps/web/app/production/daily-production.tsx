"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  assetUrl,
  WORKSHOP_STAGES,
  type WorkshopStage,
} from "@repo/api-contract";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { Button } from "@repo/ui/button";
import { TableSkeleton } from "@repo/ui/skeleton";
import { useTRPC } from "../trpc/client";
import {
  Dotted,
  Face,
  FLOW,
  flowFigures,
  int,
  qualityOf,
  runUnit,
  stageClass,
} from "./production-shared";
import records from "../records/records.module.css";
import styles from "./production.module.css";
import { dateFormat, formatPercent, formatShare } from "../../i18n/formats";

/*
 * The day view. Source: "Production Journee.dc.html" in the Claude Design
 * project "Kraft paper bag ERP toolkit": a flow strip, then each station's
 * entries as cards that put a picture to the machine, the person and the
 * product. Month and period keep the fuller `FlowPanel`.
 */

const clock = () => dateFormat({
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * The day payload, derived from the router rather than hand-written — a
 * hand-written row shape silently drifts from the server's `select`.
 */
export type DayData = inferRouterOutputs<AppRouter>["production"]["daily"];
type Run = DayData["byMachine"]["PRINTING"][number]["runs"][number];

/**
 * The headline figure for one run, in `runUnit`'s unit. A migrated row has
 * only `quantite`, so that is the fallback — it IS the row's output.
 */
function headline(run: Run): number {
  switch (run.stage) {
    case "PRINTING":
      return run.piecesPrinted ?? run.metersPrinted ?? run.quantite;
    case "PRODUCER":
      return run.piecesProduced ?? run.quantite;
    case "PACKAGING":
      return run.parcelsClosed ?? run.quantite;
  }
}

/**
 * One station's runs for the day, in the order they were typed in. The API
 * groups them by machine (or by person); the day view lists them flat, each
 * entry naming its own machine.
 */
export function runsOf(day: DayData, stage: WorkshopStage): Run[] {
  const groups =
    stage === "PRINTING" || stage === "PRODUCER"
      ? day.byMachine[stage]
      : day.byPerson[stage];
  return groups
    .flatMap((group) => group.runs)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/** The people behind runs: the account that typed each in, or on a migrated run the employee it names. */
function peopleOf(runs: Run[]): number {
  return new Set(runs.map((run) => run.recordedBy?.id ?? run.employee?.id).filter(Boolean)).size;
}

/**
 * A machine's or a product's picture, or a word in its place — also while a
 * photo fails to load, as a dead link on the old app's bucket does.
 */
function Picture({ src, empty }: { src: string | null; empty: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (src === null || failed === src) return <span>{empty}</span>;
  // Plain <img>: DB-sourced URLs on a bucket this app does not own.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} />;
}

/**
 * The day's quality: the rate, the produced pieces' split as a bar, and the
 * figures behind it on one line. The same definition as `FlowPanel`
 * (`qualityOf`). The bar splits the produced figure, so waste — counted
 * beside it, never inside it — is on the line, not the bar.
 */
function DayQuality({ totals }: { totals: DayData["totals"] }) {
  const t = useTranslations("production");
  const { produced, parts, rate, brokenDown } = qualityOf(totals, t);
  // Green only for a good day, as `FlowPanel`'s rate: a green cell around
  // "60 %" would say the opposite of its figure.
  const good = brokenDown && rate >= 0.9;

  return (
    <div className={[styles.dayQuality, good ? styles.dayQualityGood : null].filter(Boolean).join(" ")}>
      <span className={styles.flowLabel}>{t("dayQuality")}</span>
      {produced === 0 ? (
        <span className={[styles.dayFlowValue, styles.dayQualityNone].filter(Boolean).join(" ")}>—</span>
      ) : brokenDown ? (
        <span className={styles.flowFigure}>
          <bdi className={styles.dayFlowValue}>{formatShare(rate)}</bdi>
          <span className={styles.unit}>{t("conformWord")}</span>
        </span>
      ) : (
        // Nothing declared good or to fix: say so, not "0 %".
        <span className={styles.dayQualityWord}>{t("notBrokenDown")}</span>
      )}
      {produced > 0 && (
        <span className={styles.dayQualityBar} aria-hidden="true">
          {parts
            .filter((part) => part.value > 0)
            .map((part) => (
              <span
                key={part.key}
                className={[styles.qualitySeg, part.className].filter(Boolean).join(" ")}
                style={{ "--grow": part.value } as React.CSSProperties}
              />
            ))}
        </span>
      )}
      <span className={styles.flowMeta}>
        {produced === 0 ? (
          t("nothingEntered")
        ) : (
          <Dotted
            parts={[
              t.rich(brokenDown ? "conformBase" : "noBreakdownBase", {
                good: int().format(totals.goodPieces),
                count: int().format(produced),
                b: (chunks) => <b className={styles.dayQualityFigure}>{chunks}</b>,
              }),
              totals.wastePieces > 0
                ? t("wasteCount", { count: int().format(totals.wastePieces) })
                : null,
            ]}
          />
        )}
      </span>
    </div>
  );
}

/**
 * The day at a glance, on one strip: each station's output with how many
 * entries and people made it, numbered in the order the work flows, then
 * the day's quality. Each producer entry carries its own split below, so the
 * strip gives the rate and nothing more.
 */
function DayFlow({ day }: { day: DayData }) {
  const t = useTranslations("production");

  return (
    <section className={styles.dayFlow} aria-label={t("flowDay")}>
      {FLOW.map((tile, index) => {
        const runs = runsOf(day, tile.stage);
        const figures = flowFigures(tile, day.totals, t);
        const empty = figures.every((figure) => figure.value === 0);
        const people = peopleOf(runs);
        return (
          <div
            key={tile.stage}
            className={[styles.dayFlowCell, stageClass(tile.stage), empty ? styles.dayFlowEmpty : null]
              .filter(Boolean)
              .join(" ")}
          >
            <span className={styles.flowLabel}>
              <i className={styles.dot} aria-hidden="true" />
              <Dotted parts={[index + 1, t(tile.label)]} />
            </span>
            <span className={styles.dayFlowFigures}>
              {figures.map((figure) => (
                <span key={figure.unit} className={styles.flowFigure}>
                  <span className={styles.dayFlowValue}>{int().format(figure.value)}</span>
                  <span className={styles.unit}>{figure.unit}</span>
                </span>
              ))}
            </span>
            <span className={styles.flowMeta}>
              {empty ? (
                t("nothingEntered")
              ) : (
                <Dotted
                  parts={[
                    t("entryCount", { count: runs.length }),
                    people > 0 ? t("operatorCount", { count: people }) : null,
                  ]}
                />
              )}
            </span>
          </div>
        );
      })}
      <DayQuality totals={day.totals} />
    </section>
  );
}

/**
 * Where an entry leaves its order: what was made before it (grey), then the
 * entry itself (orange), against the ordered quantity. Both parts stop at the
 * end of the bar: an order can be over-produced, and the bar should read
 * "full", not spill — the figure above it still says by how much.
 */
function OrderProgress({ before, qty, planned }: { before: number; qty: number; planned: number }) {
  const t = useTranslations("production");
  const done = before + qty;
  const beforeWidth = Math.min(100, (before / planned) * 100);
  const entryWidth = Math.min(100 - beforeWidth, (qty / planned) * 100);

  return (
    <div className={styles.progress}>
      <div className={styles.progressHead}>
        <span>{t("orderProgress")}</span>
        <Dotted
          className={styles.progressDone}
          parts={[int().format(done), formatPercent(done / planned)]}
        />
      </div>
      <div className={styles.progressBar} aria-hidden="true">
        <span className={styles.progressBefore} style={{ width: `${beforeWidth}%` }} />
        <span className={styles.progressEntry} style={{ width: `${entryWidth}%` }} />
      </div>
      <div className={styles.progressLegend}>
        <span className={styles.progressKey}>
          <i className={[styles.progressSwatch, styles.progressBefore].filter(Boolean).join(" ")} aria-hidden="true" />
          {t("progressBefore")}
        </span>
        <span className={styles.progressKey}>
          <i className={[styles.progressSwatch, styles.progressEntry].filter(Boolean).join(" ")} aria-hidden="true" />
          {t("progressThis")}
        </span>
        <bdi className={styles.progressPlanned}>
          {t("plannedCount", { count: int().format(planned) })}
        </bdi>
      </div>
    </div>
  );
}

/** The producer's own split of one run, as three figures. */
function SplitTiles({ good, fix, waste }: { good: number; fix: number; waste: number }) {
  const t = useTranslations("production");
  const tiles = [
    { key: "good", label: t("good"), value: good, className: styles.tileGood },
    { key: "fix", label: t("toFix"), value: fix, className: styles.tileFix },
    { key: "waste", label: t("waste"), value: waste, className: styles.tileWaste },
  ];
  return (
    <div className={styles.tiles}>
      {tiles.map((tile) => (
        <div key={tile.key} className={[styles.tile, tile.className].filter(Boolean).join(" ")}>
          <span className={styles.tileLabel}>{tile.label}</span>
          <span className={styles.tileValue}>{int().format(tile.value)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * One recorded entry as a card. On top, what made it — the machine, the
 * person, the product and its order — each with its picture, so a card is
 * recognisable from across the room. Under it, how much came off and, on the
 * producer, where that leaves the order and how the shift split it.
 */
function Entry({ run, before }: { run: Run; before: number }) {
  const t = useTranslations("production");
  const enums = useTranslations("enums");
  const person = run.recordedBy;
  const operator = person
    ? person.name
    : run.employee
      ? `${run.employee.firstName} ${run.employee.lastName}`.trim()
      : t("notAttributed");
  const role = person
    ? enums(`role.${person.role}`)
    : run.employee
      ? t("employeeRole", { matricule: run.employee.matricule })
      : t("migratedEntry");
  // `createdAt` is the insertion time. On a migrated row that is the import
  // batch, not the shift — so the clock only shows for entries typed in here.
  const time = person ? clock().format(new Date(run.createdAt)) : null;
  // The person's employee photo: the account's, or on a migrated run the
  // employee the old app named.
  const face = person ? person.employee?.photo : run.employee?.photo;
  const named = person !== null || run.employee !== null;
  const product = run.order.product;

  const qty = headline(run);
  // Producer pieces against the ordered pieces. Not on printing (metres or
  // printed bags are not the order's unit) nor on a sheet order counted in kg.
  const planned =
    run.stage === "PRODUCER" && run.order.quantityUnit === "PIECES" ? run.order.quantite : 0;
  const hasSplit =
    run.stage === "PRODUCER" &&
    (run.goodPieces !== null ||
      run.piecesToFix !== null ||
      run.wastePieces !== null);

  return (
    <article className={styles.card}>
      <div className={styles.cardCells}>
        {run.machine && (
          <div className={styles.cell}>
            <span className={styles.cellMachine}>
              <Picture src={assetUrl(run.machine.imageUrl)} empty={t("noPhoto")} />
            </span>
            <span className={styles.cellText}>
              <span className={styles.cellLabel}>{t("machine")}</span>
              <bdi className={styles.cellCode}>{run.machine.code}</bdi>
              <span className={styles.cellSub}>{run.machine.name}</span>
            </span>
          </div>
        )}

        <div className={styles.cell}>
          <span className={[styles.mark, styles.markLarge].filter(Boolean).join(" ")} aria-hidden="true">
            {named ? <Face photo={face} name={operator} /> : "—"}
          </span>
          <span className={styles.cellText}>
            <span className={styles.cellLabel}>{t("operator")}</span>
            <span className={styles.cellName}>{operator}</span>
            <span className={styles.cellSub}>{role}</span>
          </span>
        </div>

        {/* The whole cell opens the order — a tablet-sized target, where the
            order number alone would be one short word. */}
        <Link className={[styles.cell, styles.cellLink].filter(Boolean).join(" ")} href={`/orders/${run.order.id}`}>
          <span className={styles.cellProduct}>
            <Picture src={assetUrl(product.images[0] ?? null)} empty={t("noPhoto")} />
          </span>
          <span className={styles.cellText}>
            <span className={styles.cellLabel}>{t("product")}</span>
            <bdi className={styles.cellProductName}>{product.name}</bdi>
            <Dotted
              className={styles.cellSub}
              parts={[
                <span key="numero" className={styles.cellOrder}>{run.order.numero}</span>,
                // An order can lose its client (the relation is nullable).
                run.order.client?.name ?? null,
              ]}
            />
          </span>
        </Link>
      </div>

      <div className={styles.cardBody}>
        <div className={styles.cardOutput}>
          <div className={styles.qtyRow}>
            <span className={styles.qty}>{int().format(qty)}</span>
            <span className={styles.qtyUnit}>
              {t("qtyCaption", { stage: run.stage, unit: runUnit(run, t) })}
            </span>
            {time && <span className={styles.time}>{t("recordedAt", { time })}</span>}
          </div>
          {planned > 0 && <OrderProgress before={before} qty={qty} planned={planned} />}
        </div>

        {hasSplit && (
          <SplitTiles
            good={run.goodPieces ?? 0}
            fix={run.piecesToFix ?? 0}
            waste={run.wastePieces ?? 0}
          />
        )}

        {run.note && <p className={styles.note}>{run.note}</p>}
      </div>
    </article>
  );
}

/**
 * One station's part of the day: a head — its step in the flow, its name,
 * the day's count and total, the offer to record — then a card per entry,
 * or a dashed box saying there is none. The total is one per unit: a bag
 * printer's pieces and a press's metres sit side by side on printing.
 */
export function Station({
  stage,
  runs,
  orderBefore,
  onRecord,
}: {
  stage: WorkshopStage;
  runs: Run[];
  /** `daily`'s `orderBefore`: per producer run, its order's output before it. */
  orderBefore: Record<string, number>;
  onRecord: ((stage: WorkshopStage) => void) | null;
}) {
  const t = useTranslations("production");
  const enums = useTranslations("enums");
  const label = enums(`workshopStage.${stage}`);
  const totals = new Map<string, number>();
  for (const run of runs) {
    const unit = runUnit(run, t);
    totals.set(unit, (totals.get(unit) ?? 0) + headline(run));
  }

  return (
    <section
      className={[styles.stage, stageClass(stage)].filter(Boolean).join(" ")}
      aria-label={label}
    >
      <div className={styles.stageHead}>
        <span className={styles.stageStep} aria-hidden="true">
          {WORKSHOP_STAGES.indexOf(stage) + 1}
        </span>
        <h2 className={styles.stageName}>{label}</h2>
        <Dotted
          className={styles.stageCount}
          parts={
            runs.length === 0
              ? [t("noEntries")]
              : [
                  t("entryCount", { count: runs.length }),
                  ...[...totals].map(([unit, total]) => `${int().format(total)} ${unit}`),
                ]
          }
        />
        <span className={styles.stageRule} aria-hidden="true" />
        {onRecord && (
          <Button variant="secondary" size="dense" onClick={() => onRecord(stage)}>
            <span aria-hidden="true">+</span> {t("recordStage", { stage: label.toLowerCase() })}
          </Button>
        )}
      </div>

      {runs.length === 0 ? (
        <div className={styles.stageEmpty}>
          {t("noStageEntry", { stage: label.toLowerCase() })}
        </div>
      ) : (
        runs.map((run) => <Entry key={run.id} run={run} before={orderBefore[run.id] ?? 0} />)
      )}
    </section>
  );
}

/** Local-time YYYY-MM-DD — `toISOString` would shift the day near midnight. */
export function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The line beside the day navigation: how much was typed in, by how many
 * people. Reads the same query as the view, so it costs no second request.
 */
export function DayMeta({ date }: { date: string }) {
  const trpc = useTRPC();
  const t = useTranslations("production");
  const dayQuery = useQuery(trpc.production.daily.queryOptions({ date }));
  const day = dayQuery.data;
  if (!day || day.totals.runCount === 0) return null;

  const people = new Set(
    WORKSHOP_STAGES.flatMap((stage) => runsOf(day, stage))
      .map((run) => run.recordedBy?.id)
      .filter(Boolean),
  );
  return (
    <Dotted
      className={styles.periodMeta}
      parts={[
        t("entryCount", { count: day.totals.runCount }),
        people.size > 0 ? t("operatorCount", { count: people.size }) : null,
      ]}
    />
  );
}

interface DailyProductionProps {
  /** YYYY-MM-DD, owned by the view switcher's toolbar. */
  date: string;
  /** Opens the recording form preset to a station; null hides the offer. */
  onRecord: ((stage: WorkshopStage) => void) | null;
}

/**
 * The daily production dashboard.
 *
 * One day at a time, because that is the question the page answers: what did
 * the workshop do today? The totals are that day's, computed on the server
 * in the same pass that builds the sections below them — so a tile can never
 * disagree with the entries it summarises.
 */
export function DailyProduction({ date, onRecord }: DailyProductionProps) {
  const trpc = useTRPC();
  const dayQuery = useQuery(trpc.production.daily.queryOptions({ date }));

  if (dayQuery.isPending) return <TableSkeleton rows={5} />;

  if (dayQuery.isError) {
    return (
      <p
        className={[records.notice, records.error].filter(Boolean).join(" ")}
        role="alert"
      >
        {dayQuery.error.message}
      </p>
    );
  }

  const day = dayQuery.data;
  return (
    <>
      <DayFlow day={day} />
      <div className={styles.stations}>
        {WORKSHOP_STAGES.map((stage) => (
          <Station
            key={stage}
            stage={stage}
            runs={runsOf(day, stage)}
            orderBefore={day.orderBefore}
            onRecord={onRecord}
          />
        ))}
      </div>
    </>
  );
}
