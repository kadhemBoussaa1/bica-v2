"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { isoDayOf, type ShiftType } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { FormDialog } from "@repo/ui/form-dialog";
import { useToast } from "@repo/ui/toast";
import { useTRPC } from "../trpc/client";
import { Avatar } from "../employees/avatar";
import { invalidateShiftQueries } from "./shift-queries";
import type { WeekData } from "./types";
import { employeeName } from "../employees/employee-name";
import { formatShiftHours, shiftDaySpan } from "./week";
import styles from "./shifts.module.css";

interface EmployeePickerProps {
  week: WeekData;
  type: ShiftType;
  onClose: () => void;
}

type Scope = "free" | "all";

/**
 * "Who works nights?" — the add modal from the handoff. A grid of people
 * as photo cards, a search, a scope switch between the not-placed and
 * everyone (picking someone on another shift MOVES them), select-all over
 * what the search shows, and a summary that says how many are selected and
 * how many change shift. One call on confirm; on a published week the
 * server records an ADD or MOVE change per person.
 */
export function EmployeePicker({ week, type, onClose }: EmployeePickerProps) {
  const t = useTranslations("shifts");
  const enums = useTranslations("enums");
  const common = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { push } = useToast();

  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<Scope>("free");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const rosterQuery = useQuery(
    trpc.employee.list.queryOptions({
      pageSize: 100,
      sortBy: "lastName",
      sortDir: "asc",
      filter: "onRoster",
    }),
  );
  const placed = new Map(week.assignments.map((a) => [a.employeeId, a.type]));

  const term = search.trim().toLowerCase();
  const pool = (rosterQuery.data?.rows ?? []).filter((e) => {
    const where = placed.get(e.id);
    if (where === type) return false;
    if (scope === "free" && where !== undefined) return false;
    return term === "" || `${employeeName(e)} ${e.matricule}`.toLowerCase().includes(term);
  });
  const allOn = pool.length > 0 && pool.every((e) => picked.has(e.id));
  const moving = [...picked].filter((id) => placed.has(id)).length;

  const assign = useMutation(
    trpc.shift.assign.mutationOptions({
      onSuccess: async (result) => {
        push({
          title: t("picker.done", { count: result.added + result.moved, shift: enums(`shiftType.${type}`) }),
          tone: "success",
        });
        if (result.ticketsRemoved > 0) {
          push({ title: t("board.ticketsRemoved", { count: result.ticketsRemoved }), tone: "warning" });
        }
        await invalidateShiftQueries(queryClient, trpc);
        onClose();
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setPicked((current) => {
      const next = new Set(current);
      for (const e of pool) {
        if (allOn) next.delete(e.id);
        else next.add(e.id);
      }
      return next;
    });

  const busy = assign.isPending;
  const [from, to] = shiftDaySpan(isoDayOf(week.weekStart), type);
  const shiftName = enums(`shiftType.${type}`);

  return (
    <FormDialog eyebrow={t("eyebrow")} title={t("picker.title", { shift: shiftName })} onClose={onClose}>
      <div className={styles.pickerBody}>
        <p className={styles.pickerLede}>
          {t("picker.meta", { hours: formatShiftHours(type), days: t("board.days", { from, to }) })}
          {week.status === "PUBLISHED" && <> {t("picker.publishedNote")}</>}
        </p>
        {error && (
          <p className={styles.pickerError} role="alert">
            {error}
          </p>
        )}

        <div className={styles.pickerBar}>
          <input
            type="search"
            className={styles.pickerInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("board.searchPlaceholder")}
            aria-label={common("search")}
            autoFocus
            disabled={busy}
          />
          <div className={styles.segmented} role="tablist" aria-label={t("picker.scope")}>
            {(["free", "all"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={scope === key}
                className={[styles.segment, scope === key ? styles.segmentOn : null].filter(Boolean).join(" ")}
                onClick={() => setScope(key)}
              >
                {t(`picker.scope_${key}`)}
              </button>
            ))}
          </div>
          <Button size="dense" onClick={toggleAll} disabled={busy || pool.length === 0}>
            {allOn ? t("picker.deselectAll") : t("picker.selectAll", { count: pool.length })}
          </Button>
        </div>

        <div className={styles.pickerGrid} role="group" aria-label={t("picker.gridLabel")}>
          {rosterQuery.isPending ? (
            <p className={styles.muted}>{common("loading")}</p>
          ) : (
            pool.map((employee) => {
              const on = picked.has(employee.id);
              const where = placed.get(employee.id);
              return (
                <button
                  key={employee.id}
                  type="button"
                  className={[styles.pickCard, on ? styles.pickCardOn : null].filter(Boolean).join(" ")}
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => toggle(employee.id)}
                >
                  <span className={styles.pickCheck} aria-hidden="true">
                    {on ? "✓" : ""}
                  </span>
                  <Avatar employee={employee} size="lg" />
                  <span className={styles.pickName}>{employeeName(employee)}</span>
                  <span className={[styles.pickMeta, where ? styles.pickMetaWarm : null].filter(Boolean).join(" ")}>
                    {employee.matricule} ·{" "}
                    {where ? t("picker.onShift", { shift: enums(`shiftType.${where}`) }) : t("picker.free")}
                  </span>
                </button>
              );
            })
          )}
        </div>
        {!rosterQuery.isPending && pool.length === 0 && (
          <p className={styles.pickerEmpty}>{t("picker.none")}</p>
        )}

        <div className={styles.pickerFoot}>
          <span className={styles.pickerSummary}>
            {picked.size === 0
              ? t("picker.summaryEmpty")
              : t("picker.summary", { count: picked.size }) +
                (moving > 0 ? t("picker.summaryMoving", { count: moving }) : "") +
                "."}
          </span>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {common("cancel")}
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={picked.size === 0}
            onClick={() =>
              assign.mutate({ weekId: week.id, type, employeeIds: [...picked], moveIfPlaced: true })
            }
          >
            {picked.size === 0
              ? t("picker.assignNone")
              : t("picker.assignTo", { count: picked.size, shift: shiftName })}
          </Button>
        </div>
      </div>
    </FormDialog>
  );
}
