"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  addDays,
  daysForShiftType,
  isoDayOf,
  SHIFT_TYPES,
  type ShiftType,
} from "@repo/api-contract";
import { Dialog } from "@repo/ui/dialog";
import { useToast } from "@repo/ui/toast";
import { useTRPC } from "../trpc/client";
import { Avatar } from "./avatar";
import { ChangeDialog } from "./change-dialog";
import { invalidateShiftQueries } from "./shift-queries";
import { TaskCard } from "./task-card";
import { TaskForm } from "./task-form";
import type { DayShift, RosterEmployee, TaskData, WeekAssignment, WeekData } from "./types";
import {
  employeeName,
  formatDayShort,
  formatShiftHours,
  formatWeekday,
  formatWeekdayLong,
  hasEnded,
  shiftDaySpan,
  todayOffsetIn,
  weekDays,
  weekIsOver,
} from "./week";
import styles from "./shifts.module.css";

interface RosterBoardProps {
  week: WeekData;
  /** Opens the add modal for one shift. Absent once the week is over. */
  onAssign?: (type: ShiftType) => void;
}

/**
 * A bell struck through: "a ticket for this person notifies nobody" — no
 * linked account, or a banned one (docs/notifications-plan.md fact 9). An
 * icon, not a word, so the name keeps its room in a narrow column in every
 * language; the words are its label and tooltip.
 */
function BellOffGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 12.5V8a4.5 4.5 0 0 1 7.6-3.25M13.5 8v4.5l1.25 1.5H6" />
      <path d="M7.25 15.5a1.75 1.75 0 0 0 3.5 0" />
      <path d="M2.5 2.5l13 13" />
    </svg>
  );
}

/**
 * The planner's body, as the "Planning équipes — Kraft v3" handoff draws
 * it: a strip of the seven days with their ticket counts, then the three
 * shift columns and the "not placed" column. A column lists its people for
 * the week; under each name, that person's tickets for the SELECTED day, a
 * "+ Ticket" button while the shift runs that day, and a menu to move them
 * to another shift or take them off. The not-placed column places someone
 * with one tap on a shift letter.
 *
 * Moves and removals go straight through on a draft, and are recorded as
 * changes on a published week — the same calls the change dialog makes,
 * without the form. Removing still confirms: it deletes the person's open
 * tickets and the mock's undo toast has no server counterpart.
 */
export function RosterBoard({ week, onAssign }: RosterBoardProps) {
  const t = useTranslations("shifts");
  const enums = useTranslations("enums");
  const common = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { push } = useToast();

  const weekStart = isoDayOf(week.weekStart);
  const draft = week.status === "DRAFT";
  const over = weekIsOver(week.weekStart);

  const [offset, setOffset] = useState<number>(() => todayOffsetIn(weekStart) ?? 1);
  const date = addDays(weekStart, offset);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [removing, setRemoving] = useState<WeekAssignment | null>(null);
  const [changing, setChanging] = useState<WeekAssignment | null>(null);
  const [unQuery, setUnQuery] = useState("");
  const [form, setForm] = useState<{
    shift: DayShift;
    employee: RosterEmployee;
    existing: readonly TaskData[];
    task?: TaskData;
    hasAccount: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState<TaskData | null>(null);

  // The menu closes on any click elsewhere and on Escape.
  useEffect(() => {
    if (menuFor === null) return;
    const close = () => setMenuFor(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("click", close);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("click", close);
      window.removeEventListener("keydown", key);
    };
  }, [menuFor]);

  const dayQuery = useQuery({
    ...trpc.shift.dayView.queryOptions({ date }),
    placeholderData: (prev) => prev,
  });
  const rosterQuery = useQuery(
    trpc.employee.list.queryOptions({
      pageSize: 100,
      sortBy: "lastName",
      sortDir: "asc",
      filter: "onRoster",
    }),
  );

  // Who on this roster a ticket would reach no one for — no account, or a
  // banned one (docs/notifications-plan.md §4.6). Ids only, from the
  // admin-only day view.
  const noAccount = new Set(dayQuery.data?.noAccount ?? []);
  const placed = new Set(week.assignments.map((a) => a.employeeId));
  const unplacedAll = (rosterQuery.data?.rows ?? []).filter((e) => !placed.has(e.id));
  const uq = unQuery.trim().toLowerCase();
  const unplaced = unplacedAll.filter(
    (e) => !uq || `${employeeName(e)} ${e.matricule}`.toLowerCase().includes(uq),
  );

  const settle = async (message: string, ticketsRemoved = 0) => {
    push({ title: message, tone: "success" });
    if (ticketsRemoved > 0) {
      push({ title: t("board.ticketsRemoved", { count: ticketsRemoved }), tone: "warning" });
    }
    await invalidateShiftQueries(queryClient, trpc);
  };
  const fail = (cause: { message: string }) => push({ title: cause.message, tone: "error" });

  const typeLabel = (type: ShiftType) => enums(`shiftType.${type}`);
  const assign = useMutation(
    trpc.shift.assign.mutationOptions({
      onSuccess: (r, vars) =>
        settle(t("board.placed", { count: r.added + r.moved, shift: typeLabel(vars.type) }), r.ticketsRemoved),
      onError: fail,
    }),
  );
  const moveDraft = useMutation(
    trpc.shift.moveDraft.mutationOptions({
      onSuccess: (r, vars) => settle(t("board.moved", { shift: typeLabel(vars.type) }), r.ticketsRemoved),
      onError: fail,
    }),
  );
  const change = useMutation(
    trpc.shift.change.mutationOptions({
      onSuccess: (r, vars) =>
        settle(
          vars.kind === "REMOVE"
            ? t("board.removed")
            : t("board.movedRecorded", { shift: vars.toType ? typeLabel(vars.toType) : "" }),
          r.ticketsRemoved,
        ),
      onError: fail,
    }),
  );
  const unassign = useMutation(
    trpc.shift.unassign.mutationOptions({
      onSuccess: (r) => settle(t("board.removed"), r.ticketsRemoved),
      onError: fail,
    }),
  );
  const removeTask = useMutation(
    trpc.shift.removeTask.mutationOptions({
      onSuccess: () => settle(t("task.deleted")),
      onError: fail,
    }),
  );

  const moveTo = (row: WeekAssignment, type: ShiftType) => {
    setMenuFor(null);
    if (draft) moveDraft.mutate({ assignmentId: row.id, type });
    else change.mutate({ weekId: week.id, kind: "MOVE", employeeId: row.employeeId, toType: type });
  };
  const remove = (row: WeekAssignment) => {
    setRemoving(null);
    if (draft) unassign.mutate({ assignmentId: row.id });
    else change.mutate({ weekId: week.id, kind: "REMOVE", employeeId: row.employeeId });
  };

  const dayShifts = dayQuery.data?.shifts ?? [];
  const ticketsOn = (dayOffset: number) =>
    week.shifts
      .filter((s) => isoDayOf(s.date) === addDays(weekStart, dayOffset))
      .reduce((n, s) => n + s._count.tasks, 0);

  return (
    <>
      <div className={styles.dayBar} role="tablist" aria-label={t("day.pick")}>
        {weekDays(weekStart).map((day, index) => (
          <button
            key={day}
            type="button"
            role="tab"
            aria-selected={index === offset}
            className={[styles.dayBtn, index === offset ? styles.dayBtnActive : null]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setOffset(index)}
          >
            <span className={styles.dayBtnName}>{formatWeekday(day)}</span>
            <span className={styles.dayBtnDate}>{formatDayShort(day)}</span>
            <span className={styles.dayBtnCount}>
              {t("day.ticketCount", { count: ticketsOn(index) })}
            </span>
          </button>
        ))}
      </div>

      <div className={styles.board} role="list" aria-label={t("board.label")}>
        {SHIFT_TYPES.map((type) => {
          const people = week.assignments.filter((a) => a.type === type);
          const [from, to] = shiftDaySpan(weekStart, type);
          const off = !daysForShiftType(type).includes(offset);
          const dayShift = dayShifts.find((s) => s.type === type) ?? null;
          const ended = dayShift ? hasEnded(dayShift) : false;
          return (
            <section
              key={type}
              className={[styles.column, styles[`column${type}`]].filter(Boolean).join(" ")}
              role="listitem"
            >
              <div className={styles.columnHead}>
                <div className={styles.columnTitleRow}>
                  <span className={styles.columnTitle}>{typeLabel(type)}</span>
                  <span className={styles.columnHours}>{formatShiftHours(type)}</span>
                  <span className={styles.spacer} />
                  <span className={styles.columnCount}>
                    {people.length === 0
                      ? t("board.emptyLabel")
                      : t("board.people", { count: people.length })}
                  </span>
                </div>
                <div className={styles.columnMeta}>{t("board.days", { from, to })}</div>
              </div>

              {off && (
                <div className={styles.columnOff}>
                  {t("board.off", { day: formatWeekdayLong(date) })}
                </div>
              )}

              {people.map((row) => {
                const tasks = dayShift ? dayShift.tasks.filter((x) => x.employeeId === row.employeeId) : [];
                const open = openRow === row.id;
                const menuOpen = menuFor === row.id;
                const canTicket = !off && dayShift !== null && !ended;
                return (
                  <div key={row.id} className={styles.personRow}>
                    <div className={styles.person}>
                      <Avatar employee={row.employee} size="md" />
                      <button
                        type="button"
                        className={styles.personText}
                        onClick={() => setOpenRow(open ? null : row.id)}
                        aria-expanded={open}
                        disabled={tasks.length === 0}
                      >
                        <span className={styles.personNameRow}>
                          <span className={styles.personName}>{employeeName(row.employee)}</span>
                          {noAccount.has(row.employeeId) && (
                            <span
                              className={styles.noAccount}
                              role="img"
                              aria-label={t("board.noAccount")}
                              title={t("board.noAccountTitle")}
                            >
                              <BellOffGlyph />
                            </span>
                          )}
                        </span>
                        <span
                          className={[styles.personMeta, tasks.length > 0 ? styles.personMetaHot : null]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {tasks.length > 0
                            ? tasks
                                .map((x) =>
                                  x.machine
                                    ? `${enums(`shiftTaskType.${x.type}`)} · ${x.machine.name}`
                                    : enums(`shiftTaskType.${x.type}`),
                                )
                                .join(" ; ")
                            : off
                              ? row.employee.matricule
                              : `${row.employee.matricule} · ${t("board.noTicketOn", { day: formatWeekdayLong(date) })}`}
                        </span>
                      </button>
                      {canTicket && dayShift && (
                        <button
                          type="button"
                          className={styles.ticketBtn}
                          onClick={() =>
                            setForm({
                              shift: dayShift,
                              employee: row.employee,
                              existing: tasks,
                              hasAccount: !noAccount.has(row.employeeId),
                            })
                          }
                        >
                          {t("board.ticket")}
                        </button>
                      )}
                      {!over && (
                        <button
                          type="button"
                          className={[styles.menuBtn, menuOpen ? styles.menuBtnOpen : null]
                            .filter(Boolean)
                            .join(" ")}
                          aria-label={t("board.options")}
                          aria-expanded={menuOpen}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuFor(menuOpen ? null : row.id);
                          }}
                        >
                          ⋯
                        </button>
                      )}
                      {menuOpen && (
                        <div className={styles.menu} role="menu" onClick={(e) => e.stopPropagation()}>
                          {SHIFT_TYPES.filter((x) => x !== type).map((x) => (
                            <button
                              key={x}
                              type="button"
                              role="menuitem"
                              className={styles.menuItem}
                              onClick={() => moveTo(row, x)}
                            >
                              {t("board.moveTo", { shift: `${typeLabel(x)} · ${formatShiftHours(x)}` })}
                            </button>
                          ))}
                          {!draft && (
                            <button
                              type="button"
                              role="menuitem"
                              className={styles.menuItem}
                              onClick={() => {
                                setMenuFor(null);
                                setChanging(row);
                              }}
                            >
                              {t("board.other")}
                            </button>
                          )}
                          <div className={styles.menuRule} />
                          <button
                            type="button"
                            role="menuitem"
                            className={[styles.menuItem, styles.menuItemDanger].filter(Boolean).join(" ")}
                            onClick={() => {
                              setMenuFor(null);
                              setRemoving(row);
                            }}
                          >
                            {t("board.remove")}
                          </button>
                        </div>
                      )}
                    </div>
                    {open && dayShift && tasks.length > 0 && (
                      <div className={styles.personTasks}>
                        {tasks.map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            shift={dayShift}
                            mode="admin"
                            onEdit={
                              ended
                                ? undefined
                                : (x) =>
                                    setForm({
                                      shift: dayShift,
                                      employee: row.employee,
                                      existing: tasks,
                                      task: x,
                                      hasAccount: !noAccount.has(row.employeeId),
                                    })
                            }
                            onDelete={ended ? undefined : setDeleting}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {people.length === 0 && <div className={styles.columnEmpty}>{t("board.nobody")}</div>}

              {onAssign && !over && (
                <div className={styles.columnFoot}>
                  <button type="button" className={styles.addBtn} onClick={() => onAssign(type)}>
                    {t("board.add")}
                  </button>
                </div>
              )}
            </section>
          );
        })}

        <section className={[styles.column, styles.columnPool].filter(Boolean).join(" ")} role="listitem">
          <div className={styles.columnHead}>
            <div className={styles.columnTitleRow}>
              <span className={styles.columnTitle}>{t("board.unassigned")}</span>
              <span className={styles.spacer} />
              <span className={styles.columnCount}>
                {rosterQuery.isPending
                  ? common("loading")
                  : t("board.people", { count: unplacedAll.length })}
              </span>
            </div>
            <div className={styles.columnMeta}>{t("board.unplacedHint")}</div>
            <input
              type="search"
              className={styles.poolSearch}
              value={unQuery}
              onChange={(e) => setUnQuery(e.target.value)}
              placeholder={t("board.searchPlaceholder")}
              aria-label={common("search")}
            />
          </div>
          <div className={styles.poolList}>
            {unplaced.map((employee) => (
              <div key={employee.id} className={styles.poolRow}>
                <Avatar employee={employee} size="sm" />
                <span className={styles.personText}>
                  <span className={styles.personName}>{employeeName(employee)}</span>
                  <span className={styles.personMeta}>{employee.matricule}</span>
                </span>
                {!over && (
                  <span className={styles.quick}>
                    {SHIFT_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        className={styles.quickBtn}
                        title={t("board.placeIn", { shift: typeLabel(type) })}
                        aria-label={t("board.placeIn", { shift: typeLabel(type) })}
                        disabled={assign.isPending}
                        onClick={() =>
                          assign.mutate({ weekId: week.id, type, employeeIds: [employee.id] })
                        }
                      >
                        {t(`board.short.${type}`)}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            ))}
            {!rosterQuery.isPending && unplaced.length === 0 && (
              <div className={styles.columnEmpty}>
                {unplacedAll.length === 0 ? t("board.everyonePlaced") : t("picker.none")}
              </div>
            )}
          </div>
        </section>
      </div>

      <Dialog
        open={removing !== null}
        title={t("board.removeTitle")}
        confirmLabel={t("board.removeShort")}
        destructive
        busy={unassign.isPending || change.isPending}
        onConfirm={() => removing && remove(removing)}
        onClose={() => setRemoving(null)}
      >
        {removing &&
          t.rich("board.removeBody", {
            name: employeeName(removing.employee),
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
      </Dialog>

      <Dialog
        open={deleting !== null}
        title={t("task.deleteTitle")}
        confirmLabel={t("task.delete")}
        destructive
        busy={removeTask.isPending}
        onConfirm={() => {
          if (deleting) removeTask.mutate({ id: deleting.id });
          setDeleting(null);
        }}
        onClose={() => !removeTask.isPending && setDeleting(null)}
      >
        {t("task.deleteBody")}
      </Dialog>

      {changing && (
        <ChangeDialog
          week={week}
          assignment={changing}
          pool={unplacedAll}
          onClose={() => setChanging(null)}
        />
      )}
      {form && (
        <TaskForm
          shift={form.shift}
          employee={form.employee}
          existing={form.existing}
          task={form.task}
          hasAccount={form.hasAccount}
          onClose={() => setForm(null)}
        />
      )}
    </>
  );
}
