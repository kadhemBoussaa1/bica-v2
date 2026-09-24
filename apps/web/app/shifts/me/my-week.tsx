"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  addDays,
  canWorkerMarkDone,
  daysForShiftType,
  isoDayOf,
  SHIFT_HOURS,
  SHIFT_LENGTH_MS,
  type ShiftChangeStatus,
  type ShiftType,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TableSkeleton } from "@repo/ui/skeleton";
import { useToast } from "@repo/ui/toast";
import { formatDateTime } from "../../../i18n/formats";
import { useTRPC } from "../../trpc/client";
import records from "../../records/records.module.css";
import { Avatar } from "../avatar";
import { invalidateShiftQueries } from "../shift-queries";
import type { MyShift, MyWeek as MyWeekType } from "../types";
import {
  employeeName,
  formatDayShort,
  formatShiftHours,
  formatWeekRange,
  formatWeekday,
  formatWeekdayLong,
  hasEnded,
  hasStarted,
  stepWeek,
  thisWeekStart,
  todayOffsetIn,
  weekDays,
  weekIsOver,
} from "../week";
import { RequestDialog } from "./request-dialog";
import styles from "../shifts.module.css";

type Task = MyShift["tasks"][number];

/** One hour of the schedule, in pixels; the shift is eight of them. */
const HOUR_PX = 52;
/** The rail shows one hour before the shift and one after: ten hours. */
const RAIL_HOURS = 10;
const COLUMN_PX = HOUR_PX * RAIL_HOURS;

const STATUS_TONE: Record<ShiftChangeStatus, string | undefined> = {
  PENDING: styles.pillWarn,
  ACCEPTED: styles.pillLive,
  REJECTED: styles.pillDanger,
  WITHDRAWN: styles.pillNeutral,
};

/**
 * The worker's week as a schedule: seven day columns, the shift drawn as a
 * dashed window on an hour rail, and the day's tickets stacked inside it.
 * Tickets carry no time of their own — one person, one day — so they share
 * the window evenly rather than sitting at a clock position as the mock's
 * did. Today is selected on arrival and carries the red "now" line; the
 * selected ticket's card, the team and the requests sit beside the grid.
 */
export function MyWeek() {
  const t = useTranslations("shifts");
  const enums = useTranslations("enums");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { push } = useToast();

  const [weekStart, setWeekStart] = useState(thisWeekStart);
  const [dayOffset, setDayOffset] = useState<number>(() => todayOffsetIn(thisWeekStart()) ?? 1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // The "now" line and the live state move on their own, once a minute.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const query = useQuery({
    ...trpc.shift.myWeek.queryOptions({ weekStart }),
    placeholderData: (prev) => prev,
  });
  const settle = async (title: string) => {
    push({ title, tone: "success" });
    await invalidateShiftQueries(queryClient, trpc);
  };
  const fail = (cause: { message: string }) => push({ title: cause.message, tone: "error" });
  const withdraw = useMutation(
    trpc.shift.withdraw.mutationOptions({ onSuccess: () => settle(t("me.withdrawn")), onError: fail }),
  );
  const setDone = useMutation(
    trpc.shift.setTaskDone.mutationOptions({
      onSuccess: (_r, vars) => settle(vars.done ? t("me.markedDone") : t("me.reopened")),
      onError: fail,
    }),
  );

  const goWeek = (next: string) => {
    setWeekStart(next);
    setDayOffset(todayOffsetIn(next) ?? 1);
    setSelectedId(null);
  };

  const typeLabel = (type: ShiftType) => `${enums(`shiftType.${type}`)} ${formatShiftHours(type)}`;

  if (query.isPending) return <TableSkeleton />;
  if (query.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {query.error.message}
      </p>
    );
  }

  const { employee, week, requests } = query.data;
  const mine = week?.mine ?? null;
  const isThisWeek = weekStart === thisWeekStart();
  const todayOffset = todayOffsetIn(weekStart);
  const days = weekDays(weekStart);
  const workDays = mine ? daysForShiftType(mine.type) : [];
  const shiftOf = (offset: number): MyShift | null =>
    week?.shifts.find((s) => isoDayOf(s.date) === addDays(weekStart, offset)) ?? null;
  const tasksOf = (offset: number): readonly Task[] => shiftOf(offset)?.tasks ?? [];
  const coworkers = mine
    ? week!.assignments.filter((a) => a.type === mine.type && a.employeeId !== employee?.id)
    : [];
  const firstNames = coworkers.map((a) => a.employee.firstName || a.employee.lastName);

  // The lede: this week, a past week or a coming one, in one sentence.
  const allTasks = week?.shifts.flatMap((s) => s.tasks) ?? [];
  const doneCount = allTasks.filter((x) => x.status === "DONE").length;
  const withTeam = firstNames.length > 0 ? t("me.with", { names: firstNames.join(", ") }) : "";
  let lede: string;
  if (employee === null) lede = t("me.noEmployee");
  else if (!week) lede = t("week.notPublishedText");
  else if (!mine) lede = t("me.offWeek");
  else if (isThisWeek) {
    const todays = todayOffset === null ? [] : tasksOf(todayOffset);
    const left = todays.filter((x) => x.status !== "DONE").length;
    const todayPart =
      todays.length === 0
        ? t("me.sentence.todayNone")
        : left === 0
          ? t("me.sentence.todayDone")
          : t("me.sentence.todayLeft", { left, total: todays.length });
    lede = `${t("me.sentence.this", { shift: enums(`shiftType.${mine.type}`).toLowerCase(), with: withTeam })} ${todayPart}`;
  } else if (weekIsOver(weekStart, now)) {
    lede = t("me.sentence.past", { shift: enums(`shiftType.${mine.type}`), with: withTeam, done: doneCount, total: allTasks.length });
  } else {
    lede = t("me.sentence.future", { shift: enums(`shiftType.${mine.type}`).toLowerCase(), with: withTeam, count: allTasks.length });
  }

  // The selected ticket, or the day's first open one.
  const dayTasks = tasksOf(dayOffset);
  const selected =
    dayTasks.find((x) => x.id === selectedId) ?? dayTasks.find((x) => x.status !== "DONE") ?? dayTasks[0] ?? null;
  const selectedShift = shiftOf(dayOffset);
  const dayWorks = workDays.includes(dayOffset);

  /** Pixels from the top of a column for an instant, on the rail that starts one hour before the shift. */
  const railTop = (instant: Date, shift: { startsAt: string | Date }) => {
    const ms = instant.getTime() - (new Date(shift.startsAt).getTime() - 60 * 60 * 1000);
    return Math.max(0, Math.min(COLUMN_PX, (ms / 3_600_000) * HOUR_PX));
  };
  const railHours = mine
    ? Array.from({ length: RAIL_HOURS + 1 }, (_, k) => (SHIFT_HOURS[mine.type].start - 1 + k + 24) % 24)
    : [];

  const statusOf = (task: Task, shift: MyShift) =>
    task.status === "DONE"
      ? "done"
      : hasStarted(shift, now) && !hasEnded(shift, now)
        ? "live"
        : hasStarted(shift, now)
          ? "todo"
          : "planned";

  return (
    <>
      <header className={records.header}>
        <div className={records.heading}>
          <span className={records.eyebrow}>
            {t("eyebrow")} · {formatWeekRange(weekStart)}
          </span>
          <h1 className={records.title}>{t("me.title")}</h1>
          <p className={records.subtitle}>{lede}</p>
        </div>
        <div className={styles.meNav}>
          <button
            type="button"
            className={styles.meArrow}
            aria-label={t("week.previous")}
            onClick={() => goWeek(stepWeek(weekStart, -1))}
          >
            ‹
          </button>
          <button
            type="button"
            className={[styles.meThis, isThisWeek ? styles.meThisOn : null].filter(Boolean).join(" ")}
            onClick={() => goWeek(thisWeekStart())}
          >
            {t("week.thisWeek")}
          </button>
          <button
            type="button"
            className={styles.meArrow}
            aria-label={t("week.next")}
            onClick={() => goWeek(stepWeek(weekStart, 1))}
          >
            ›
          </button>
        </div>
        {mine && !weekIsOver(weekStart, now) && (
          <Button variant="primary" onClick={() => setRequesting(true)}>
            {t("me.request")}
          </Button>
        )}
      </header>

      {employee === null ? (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {t("me.noEmployee")} {t("me.noEmployeeText")}
        </p>
      ) : !week ? (
        <div className={styles.reqEmpty}>
          <div className={styles.reqEmptyTitle}>{t("week.notPublished")}</div>
          <div className={styles.reqEmptyBody}>{t("week.notPublishedText")}</div>
        </div>
      ) : (
        <div className={styles.meLayout}>
          <section className={styles.mePanel}>
            <div className={styles.meBar}>
              {mine ? (
                <span className={[styles.pill, styles[`shiftPill${mine.type}`]].filter(Boolean).join(" ")}>
                  <i className={styles.pillDot} aria-hidden="true" />
                  {typeLabel(mine.type)}
                </span>
              ) : (
                <span className={[styles.pill, styles.pillNeutral].filter(Boolean).join(" ")}>{t("me.offWeek")}</span>
              )}
              <span className={styles.spacer} />
              {(["todo", "live", "done"] as const).map((key) => (
                <span key={key} className={styles.legend}>
                  <i className={[styles.legendSwatch, styles[`sw_${key}`]].filter(Boolean).join(" ")} aria-hidden="true" />
                  {t(`me.legend.${key}`)}
                </span>
              ))}
            </div>

            <div className={styles.scheduleScroll}>
              <div className={styles.schedule}>
                <span />
                {days.map((day, i) => {
                  const tasks = tasksOf(i);
                  const done = tasks.filter((x) => x.status === "DONE").length;
                  const works = workDays.includes(i);
                  const isToday = i === todayOffset;
                  const on = i === dayOffset;
                  return (
                    <button
                      key={day}
                      type="button"
                      className={[
                        styles.dayHead,
                        on ? styles.dayHeadOn : null,
                        isToday ? styles.dayHeadToday : null,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-pressed={on}
                      onClick={() => {
                        setDayOffset(i);
                        setSelectedId(null);
                      }}
                    >
                      <span className={styles.dayHeadName}>{isToday ? t("me.today") : formatWeekday(day)}</span>
                      <span className={styles.dayHeadMeta}>
                        {formatDayShort(day)} ·{" "}
                        {!works
                          ? t("me.summary.off")
                          : tasks.length === 0
                            ? t("me.summary.none")
                            : t("me.summary.done", { done, total: tasks.length })}
                      </span>
                    </button>
                  );
                })}

                <div className={styles.rail} style={{ height: COLUMN_PX }}>
                  {railHours.map((h, k) => (
                    <span key={k} className={styles.railHour} style={{ top: k * HOUR_PX }}>
                      {String(h).padStart(2, "0")}:00
                    </span>
                  ))}
                </div>
                {days.map((day, i) => {
                  const shift = shiftOf(i);
                  const tasks = tasksOf(i);
                  const works = workDays.includes(i);
                  const isToday = i === todayOffset;
                  const on = i === dayOffset;
                  const slot = tasks.length > 0 ? (HOUR_PX * 8 - 4 * (tasks.length - 1)) / tasks.length : 0;
                  return (
                    <div
                      key={day}
                      className={[styles.col, isToday ? styles.colToday : on ? styles.colOn : null]
                        .filter(Boolean)
                        .join(" ")}
                      style={{ height: COLUMN_PX }}
                    >
                      {works ? (
                        <div className={styles.window} style={{ top: HOUR_PX, height: HOUR_PX * 8 }} />
                      ) : (
                        <div className={styles.colOff}>{t("me.dayOff")}</div>
                      )}
                      {works && tasks.length === 0 && <div className={styles.colNone}>{t("me.noTaskYet")}</div>}
                      {shift &&
                        tasks.map((task, k) => {
                          const state = statusOf(task, shift);
                          return (
                            <button
                              key={task.id}
                              type="button"
                              className={[
                                styles.taskBlock,
                                styles[`tb_${state}`],
                                selected?.id === task.id && on ? styles.taskBlockOn : null,
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              style={{ top: HOUR_PX + k * (slot + 4), height: slot }}
                              onClick={() => {
                                setDayOffset(i);
                                setSelectedId(task.id);
                              }}
                            >
                              <span className={styles.taskBlockLabel}>{enums(`shiftTaskType.${task.type}`)}</span>
                              <span className={styles.taskBlockTime}>{formatShiftHours(shift.type)}</span>
                              {slot >= 96 && task.machine && (
                                <span className={styles.taskBlockMachine}>{task.machine.name}</span>
                              )}
                            </button>
                          );
                        })}
                      {isToday && shift && railTop(now, shift) > 0 && railTop(now, shift) < COLUMN_PX && (
                        <div className={styles.nowLine} style={{ top: railTop(now, shift) }}>
                          <span className={styles.nowDot} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <aside className={styles.meAside}>
            <div className={[styles.meCard, styles.meCardStrong].filter(Boolean).join(" ")}>
              {selected && selectedShift ? (
                (() => {
                  const state = statusOf(selected, selectedShift);
                  const mayMark = canWorkerMarkDone(selectedShift, now);
                  return (
                    <div>
                      <div className={styles.meCardHead}>
                        <span className={styles.meKicker}>
                          {dayOffset === todayOffset ? t("me.today") : formatWeekdayLong(days[dayOffset] ?? weekStart)}
                          {" · "}
                          {formatDayShort(days[dayOffset] ?? weekStart)}
                        </span>
                        <span className={[styles.pill, styles[`st_${state}`]].filter(Boolean).join(" ")}>
                          <i className={styles.pillDot} aria-hidden="true" />
                          {t(`me.status.${state}`)}
                        </span>
                      </div>
                      <div className={styles.meCardTitle}>{enums(`shiftTaskType.${selected.type}`)}</div>
                      <div className={styles.meCardWhen}>
                        {formatShiftHours(selectedShift.type)} · {t("me.hours", { count: SHIFT_LENGTH_MS / 3_600_000 })}
                      </div>
                      <dl className={styles.meFacts}>
                        <div>
                          <dt>{t("task.machine")}</dt>
                          <dd>{selected.machine ? `${selected.machine.name} (${selected.machine.code})` : "—"}</dd>
                        </div>
                        <div>
                          <dt>{t("task.order")}</dt>
                          <dd>{selected.order?.numero ?? "—"}</dd>
                        </div>
                        <div>
                          <dt>{t("me.assignedBy")}</dt>
                          <dd>{selected.createdBy?.name ?? "—"}</dd>
                        </div>
                        {selected.note && <div className={styles.meNote}>{selected.note}</div>}
                      </dl>
                      {state === "done" ? (
                        <div className={styles.meHint}>
                          {t("me.doneAt", { date: selected.doneAt ? formatDateTime(selected.doneAt) : "" })}
                        </div>
                      ) : mayMark ? (
                        <Button
                          variant="primary"
                          size="floor"
                          className={styles.meMark}
                          busy={setDone.isPending}
                          onClick={() => setDone.mutate({ id: selected.id, done: true })}
                        >
                          {t("task.markDone")}
                        </Button>
                      ) : (
                        <div className={styles.meHint}>
                          {hasStarted(selectedShift, now) ? t("task.shiftOver") : t("me.markLater")}
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                <div className={styles.meEmpty}>
                  {!mine
                    ? t("me.offWeek")
                    : !dayWorks
                      ? t("me.noSel.off")
                      : dayTasks.length > 0
                        ? t("me.noSel.pick")
                        : t("me.noSel.none", { day: formatWeekdayLong(days[dayOffset] ?? weekStart) })}
                </div>
              )}
            </div>

            <div className={styles.meCard}>
              <div className={styles.meKickerMuted}>
                {t("me.team", {
                  day: dayOffset === todayOffset ? t("me.today").toLowerCase() : `${formatWeekday(days[dayOffset] ?? weekStart)} ${formatDayShort(days[dayOffset] ?? weekStart)}`,
                })}
              </div>
              {!mine || !dayWorks ? (
                <div className={styles.meEmpty}>{t("me.offThisDay")}</div>
              ) : coworkers.length === 0 ? (
                <div className={styles.meEmpty}>{t("me.alone")}</div>
              ) : (
                coworkers.map((a) => (
                  <div key={a.id} className={styles.teamRow}>
                    <Avatar employee={a.employee} size="sm" />
                    <span className={styles.personText}>
                      <span className={styles.personName}>{employeeName(a.employee)}</span>
                      <span className={styles.personMeta}>{a.employee.matricule}</span>
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className={styles.meCard}>
              <div className={styles.meKickerMuted}>{t("me.myRequests")}</div>
              {requests.length === 0 ? (
                <div className={styles.meEmpty}>{t("me.noRequests")}</div>
              ) : (
                requests.map((row) => (
                  <div key={row.id} className={styles.reqRow}>
                    <div className={styles.reqRowHead}>
                      <strong>
                        {row.kind === "SWAP" && row.counterpart
                          ? t("me.reqSwap", { name: row.counterpart.firstName || row.counterpart.lastName })
                          : row.toType
                            ? t("me.reqMove", { shift: enums(`shiftType.${row.toType}`) })
                            : enums(`shiftChangeKind.${row.kind}`)}
                      </strong>
                      <span className={[styles.pill, STATUS_TONE[row.status]].filter(Boolean).join(" ")}>
                        {enums(`shiftChangeStatus.${row.status}`)}
                      </span>
                    </div>
                    <div className={styles.reqRowDetail}>
                      {t("requests.period", { range: formatWeekRange(isoDayOf(row.week.weekStart)) })}
                      {row.reason ? ` · « ${row.reason} »` : ""}
                    </div>
                    {row.status !== "PENDING" && row.decidedAt && (
                      <div className={styles.reqRowReply}>
                        {row.decisionReason === "superseded"
                          ? t("requests.superseded")
                          : row.status === "WITHDRAWN"
                            ? t("requests.decided.withdrawn", { date: formatDateTime(row.decidedAt) })
                            : t(row.status === "ACCEPTED" ? "requests.decided.accepted" : "requests.decided.rejected", {
                                name: row.decidedBy?.name ?? "—",
                                date: formatDateTime(row.decidedAt),
                              }) + (row.status === "REJECTED" && row.decisionReason ? ` — ${row.decisionReason}` : "")}
                      </div>
                    )}
                    {row.status === "PENDING" && (
                      <button
                        type="button"
                        className={styles.withdrawBtn}
                        disabled={withdraw.isPending}
                        onClick={() => withdraw.mutate({ changeId: row.id })}
                      >
                        {t("me.withdraw")}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      )}

      {requesting && week && mine && employee && (
        <RequestDialog
          week={week as MyWeekType}
          mine={mine}
          employeeId={employee.id}
          weekRange={formatWeekRange(weekStart)}
          onClose={() => setRequesting(false)}
        />
      )}
    </>
  );
}
