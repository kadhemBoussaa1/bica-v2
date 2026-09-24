"use client";

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
import { OrderStatusBadge } from "../orders/order-status";
import { useTRPC } from "../trpc/client";
import {
  Dotted,
  FlowPanel,
  initials,
  int,
  stageClass,
  stageUnit,
} from "./production-shared";
import records from "../records/records.module.css";
import styles from "./production.module.css";
import { dateFormat, formatPercent } from "../../i18n/formats";

const clock = () => dateFormat({
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * The day payload, derived from the router rather than hand-written — a
 * hand-written row shape silently drifts from the server's `select`.
 */
type DayData = inferRouterOutputs<AppRouter>["production"]["daily"];
type Run = DayData["byMachine"]["PRINTING"][number]["runs"][number];

/**
 * The headline figure for one run. A migrated row has only `quantite`, so
 * that is the fallback — it IS the row's output.
 */
function headline(run: Run): number {
  switch (run.stage) {
    case "PRINTING":
      return run.metersPrinted ?? run.quantite;
    case "PRODUCER":
      return run.piecesProduced ?? run.quantite;
    case "QUALITY_CONTROL":
      return run.piecesControlled ?? run.quantite;
    case "PACKAGING":
      return run.parcelsClosed ?? run.quantite;
  }
}

/**
 * One station's runs for the day, in the order they were typed in. The API
 * groups them by machine (or by person); the day view lists them flat, each
 * entry naming its own machine.
 */
function runsOf(day: DayData, stage: WorkshopStage): Run[] {
  const groups =
    stage === "PRINTING" || stage === "PRODUCER"
      ? day.byMachine[stage]
      : day.byPerson[stage];
  return groups
    .flatMap((group) => group.runs)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/** The producer's own breakdown of one run, as a bar and a legend. */
function Split({ good, fix, waste }: { good: number; fix: number; waste: number }) {
  const t = useTranslations("production");
  const total = good + fix + waste || 1;
  const parts = [
    { key: "good", label: t("good"), value: good, className: styles.good },
    { key: "fix", label: t("toFix"), value: fix, className: styles.fix },
    { key: "waste", label: t("waste"), value: waste, className: styles.waste },
  ];
  return (
    <div>
      <div className={styles.splitBar} aria-hidden="true">
        {parts.map((part) => (
          <span
            key={part.key}
            className={[styles.qualitySeg, part.className].filter(Boolean).join(" ")}
            style={{ width: `${(part.value / total) * 100}%` }}
          />
        ))}
      </div>
      <div className={styles.splitLegend}>
        {parts.map((part) => (
          <span
            key={part.key}
            className={[styles.legendItem, part.className].filter(Boolean).join(" ")}
          >
            <i className={styles.legendDot} aria-hidden="true" />
            <span className={styles.unit}>{part.label}</span>
            <span className={styles.legendValue}>{int().format(part.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** One recorded entry: who, on which machine, how much, against which order. */
function Entry({ run }: { run: Run }) {
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

  const qty = headline(run);
  const planned = run.stage === "PRODUCER" ? run.order.quantite : 0;
  const hasSplit =
    run.stage === "PRODUCER" &&
    (run.goodPieces !== null ||
      run.piecesToFix !== null ||
      run.wastePieces !== null);

  const photo = assetUrl(run.machine?.imageUrl);
  const face = assetUrl(person?.image);

  return (
    <article className={styles.entry}>
      {run.machine ? (
        <span className={styles.entryPhoto}>
          {photo !== null ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" loading="lazy" />
          ) : (
            <span>{t("noPhoto")}</span>
          )}
        </span>
      ) : (
        <span className={styles.mark} aria-hidden="true">
          {face !== null ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={face} alt="" />
          ) : person || run.employee ? (
            initials(operator)
          ) : (
            "—"
          )}
        </span>
      )}

      <div className={styles.entryBody}>
        <div className={styles.entryWho}>
          <span className={styles.operator}>{operator}</span>
          <span className={styles.unit}>{role}</span>
          {time && <span className={styles.time}>{time}</span>}
        </div>

        {run.machine && (
          <Dotted
            className={styles.entryMachine}
            parts={[run.machine.name, <span key="code">{run.machine.code}</span>]}
          />
        )}

        <div className={styles.qtyRow}>
          <span className={styles.qty}>{int().format(qty)}</span>
          <span className={styles.qtyUnit}>{stageUnit(run.stage, t)}</span>
          {planned > 0 && (
            <span
              className={[styles.target, qty >= planned ? styles.targetMet : null]
                .filter(Boolean)
                .join(" ")}
            >
              {t("ofPlanned", {
                planned: int().format(planned),
                percent: formatPercent(qty / planned),
              })}
            </span>
          )}
        </div>

        {hasSplit && (
          <Split
            good={run.goodPieces ?? 0}
            fix={run.piecesToFix ?? 0}
            waste={run.wastePieces ?? 0}
          />
        )}

        {run.note && <p className={styles.note}>{run.note}</p>}

        <div className={styles.chips}>
          <Link className={styles.job} href={`/orders/${run.order.id}`}>
            <span className={styles.jobNumber}>{run.order.numero}</span>
            {/* An order can lose its client (the relation is nullable). */}
            {run.order.client && (
              <span className={styles.jobClient}>{run.order.client.name}</span>
            )}
          </Link>
          <OrderStatusBadge kind={run.order.kind} status={run.order.status} />
        </div>
      </div>
    </article>
  );
}

/**
 * One station's block for the day: its name and total on a strip in its own
 * colour, then every entry. A station with nothing recorded says so and
 * offers to record it.
 */
function Station({
  stage,
  runs,
  onRecord,
}: {
  stage: WorkshopStage;
  runs: Run[];
  onRecord: ((stage: WorkshopStage) => void) | null;
}) {
  const t = useTranslations("production");
  const enums = useTranslations("enums");
  const label = enums(`workshopStage.${stage}`);
  const total = runs.reduce((sum, run) => sum + headline(run), 0);

  return (
    <section
      className={[styles.station, stageClass(stage)].filter(Boolean).join(" ")}
      aria-label={label}
    >
      <div className={styles.stationHead}>
        <i className={styles.dot} aria-hidden="true" />
        <h2 className={styles.stationName}>{label}</h2>
        <span className={styles.unit}>
          {runs.length === 0 ? t("noEntries") : t("entryCount", { count: runs.length })}
        </span>
        <span className={styles.stationFigure}>
          <span className={styles.stationTotal}>
            {runs.length === 0 ? "—" : int().format(total)}
          </span>
          <span className={styles.unit}>{stageUnit(stage, t)}</span>
        </span>
      </div>

      {runs.map((run) => (
        <Entry key={run.id} run={run} />
      ))}

      {runs.length === 0 && (
        <div className={styles.stationEmpty}>
          <span>{t("noStageEntry", { stage: label.toLowerCase() })}</span>
          {onRecord && (
            <Button variant="secondary" size="dense" onClick={() => onRecord(stage)}>
              {t("recordStage", { stage: label.toLowerCase() })}
            </Button>
          )}
        </div>
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
  const t = useTranslations("production");
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
  // "Today" only on today; any other day is named, so the tile never lies.
  const scope =
    date === isoDay(new Date())
      ? t("scopeToday")
      : dateFormat({ dateStyle: "medium", timeZone: "UTC" }).format(
          new Date(`${date}T00:00:00.000Z`),
        );

  return (
    <>
      <FlowPanel title={t("flowDay")} totals={day.totals} meta={() => scope} />
      <div className={styles.stations}>
        {WORKSHOP_STAGES.map((stage) => (
          <Station
            key={stage}
            stage={stage}
            runs={runsOf(day, stage)}
            onRecord={onRecord}
          />
        ))}
      </div>
    </>
  );
}
