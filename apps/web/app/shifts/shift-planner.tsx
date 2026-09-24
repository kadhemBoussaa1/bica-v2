"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { isSunday, SHIFT_TYPES, weekStartOf, type ShiftType } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { EmptyState } from "@repo/ui/empty-state";
import { TableSkeleton } from "@repo/ui/skeleton";
import { useToast } from "@repo/ui/toast";
import { useTRPC } from "../trpc/client";
import records from "../records/records.module.css";
import { EmployeePicker } from "./employee-picker";
import { RosterBoard } from "./roster-board";
import { invalidateShiftQueries } from "./shift-queries";
import { formatWeekRange, stepWeek, thisWeekStart, weekIsOver } from "./week";
import styles from "./shifts.module.css";

/**
 * The planner: the week's roster as three shift columns plus the unassigned
 * pool, the day-by-day tickets under it, and the week's lifecycle — open,
 * copy, clear, publish — in the header. The week is in the URL
 * (`?week=YYYY-MM-DD`, a Sunday) so a week can be linked and the stepper
 * survives a reload.
 *
 * The date input is `type="date"` snapped to its Sunday rather than
 * `type="week"`: the HTML week input counts ISO weeks, which start on
 * Monday, and this plant's start on Sunday night.
 */
export function ShiftPlanner() {
  const t = useTranslations("shifts");
  const enums = useTranslations("enums");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const { push } = useToast();

  const requested = params.get("week");
  const weekStart = requested && isSunday(requested) ? requested : thisWeekStart();
  const setWeek = (next: string) => router.replace(`/shifts?week=${next}`);

  const weekQuery = useQuery({
    ...trpc.shift.weekByStart.queryOptions({ weekStart }),
    placeholderData: (prev) => prev,
  });
  const navQuery = useQuery(trpc.nav.counts.queryOptions());
  // Only the total: how many are not placed is the roster minus the placed.
  const rosterQuery = useQuery(
    trpc.employee.list.queryOptions({ pageSize: 10, sortBy: "lastName", sortDir: "asc", filter: "onRoster" }),
  );

  const [assigning, setAssigning] = useState<ShiftType | null>(null);
  const [dialog, setDialog] = useState<"copy" | "clear" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => invalidateShiftQueries(queryClient, trpc);
  const fail = (cause: { message: string }) => {
    setDialog(null);
    setError(cause.message);
  };
  const openWeek = useMutation(
    trpc.shift.openWeek.mutationOptions({
      onSuccess: async () => {
        push({ title: t("week.opened"), tone: "success" });
        await refresh();
      },
      onError: fail,
    }),
  );
  const copyWeek = useMutation(
    trpc.shift.copyWeek.mutationOptions({
      onSuccess: async (result) => {
        setDialog(null);
        push({ title: t("week.copied", result), tone: "success" });
        await refresh();
      },
      onError: fail,
    }),
  );
  const clearWeek = useMutation(
    trpc.shift.clearWeek.mutationOptions({
      onSuccess: async (result) => {
        setDialog(null);
        push({ title: t("week.cleared", result), tone: "success" });
        await refresh();
      },
      onError: fail,
    }),
  );
  const publish = useMutation(
    trpc.shift.publish.mutationOptions({
      onSuccess: async () => {
        setDialog(null);
        push({ title: t("week.published"), tone: "success" });
        await refresh();
      },
      onError: fail,
    }),
  );

  const week = weekQuery.data?.week ?? null;
  const previousWeek = weekQuery.data?.previousWeek ?? null;
  const draft = week?.status === "DRAFT";
  const over = week ? weekIsOver(week.weekStart) : false;
  const people = week?.assignments.length ?? 0;
  const tickets = week ? week.shifts.reduce((n, s) => n + s._count.tasks, 0) : 0;
  const countOn = (type: ShiftType) => week?.assignments.filter((a) => a.type === type).length ?? 0;
  const emptyTypes = SHIFT_TYPES.filter((type) => week && countOn(type) === 0);
  const pending = navQuery.data?.shifts ?? 0;
  const busy = openWeek.isPending || copyWeek.isPending || clearWeek.isPending || publish.isPending;

  // "Published week: every change is recorded. 6 on morning, 4 on
  // afternoon, 3 on night, 11 not placed. The night shift is empty." — the
  // handoff's lede, built from the week rather than typed.
  const rosterCount = rosterQuery.data?.total ?? null;
  const lede = week
    ? [
        draft ? t("week.ledeDraft") : t("week.ledePublished"),
        SHIFT_TYPES.map((type) =>
          t("week.countOn", { count: countOn(type), shift: enums(`shiftType.${type}`).toLowerCase() }),
        ).join(", ") +
          (rosterCount !== null ? `, ${t("week.notPlacedCount", { count: Math.max(0, rosterCount - people) })}` : "") +
          ".",
        ...emptyTypes.map((type) => t("week.emptyShift", { shift: enums(`shiftType.${type}`).toLowerCase() })),
      ].join(" ")
    : t("subtitle");

  return (
    <>
      <header className={records.header}>
        <div className={records.heading}>
          <span className={records.eyebrow}>{t("eyebrow")}</span>
          <h1 className={records.title}>{t("title")}</h1>
          <p className={records.subtitle}>{lede}</p>
        </div>
        <div className={records.headerActions}>
          {draft && previousWeek && (
            <Button onClick={() => setDialog("copy")} disabled={busy}>
              {t("week.copyPrevious")}
            </Button>
          )}
          {draft && (
            <Button
              variant="danger"
              onClick={() => setDialog("clear")}
              disabled={busy || (people === 0 && tickets === 0)}
            >
              {t("week.clear")}
            </Button>
          )}
          <Link href="/shifts/requests">
            <Button className={pending > 0 ? styles.inboxHot : undefined}>
              {t("week.requestsButton")}
              {pending > 0 && <span className={styles.inboxCount}>{pending}</span>}
            </Button>
          </Link>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.stepperBox}>
          <button
            type="button"
            className={styles.stepArrow}
            aria-label={t("week.previous")}
            onClick={() => setWeek(stepWeek(weekStart, -1))}
          >
            ‹
          </button>
          <label className={styles.stepLabel}>
            <span>{t("week.weekOf", { range: formatWeekRange(weekStart) })}</span>
            <input
              type="date"
              className={styles.stepInput}
              value={weekStart}
              onChange={(e) => e.target.value && setWeek(weekStartOf(e.target.value))}
              aria-label={t("week.pick")}
            />
          </label>
          <button
            type="button"
            className={styles.stepArrow}
            aria-label={t("week.next")}
            onClick={() => setWeek(stepWeek(weekStart, 1))}
          >
            ›
          </button>
        </div>
        {weekStart !== thisWeekStart() && (
          <button type="button" className={styles.linkBtn} onClick={() => setWeek(thisWeekStart())}>
            {t("week.backToThisWeek")}
          </button>
        )}
        {week && (
          <span
            className={[styles.pill, draft ? styles.pillDraft : over ? styles.pillNeutral : styles.pillLive]
              .filter(Boolean)
              .join(" ")}
          >
            <i className={styles.pillDot} aria-hidden="true" />
            {over && !draft ? t("week.over") : enums(`shiftWeekStatus.${week.status}`)}
          </span>
        )}
        <span className={styles.spacer} />
        {draft && (
          <Button variant="primary" onClick={() => setDialog("publish")} disabled={busy}>
            {t("week.publish")}
          </Button>
        )}
      </div>

      {error && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      {weekQuery.isPending ? (
        <TableSkeleton />
      ) : weekQuery.isError ? (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {weekQuery.error.message}
        </p>
      ) : week === null ? (
        <EmptyState
          title={t("week.notOpened")}
          text={t("week.notOpenedText")}
          actions={
            <Button
              variant="primary"
              busy={openWeek.isPending}
              onClick={() => {
                setError(null);
                openWeek.mutate({ weekStart });
              }}
            >
              {t("week.open")}
            </Button>
          }
        />
      ) : (
        <RosterBoard week={week} onAssign={over ? undefined : setAssigning} />
      )}

      {week && assigning && (
        <EmployeePicker week={week} type={assigning} onClose={() => setAssigning(null)} />
      )}

      <Dialog
        open={dialog === "copy"}
        title={t("week.copyTitle")}
        confirmLabel={t("week.copyPrevious")}
        busy={copyWeek.isPending}
        onConfirm={() =>
          week && previousWeek && copyWeek.mutate({ weekId: week.id, fromWeekId: previousWeek.id })
        }
        onClose={() => !copyWeek.isPending && setDialog(null)}
      >
        {t("week.copyBody")}
      </Dialog>

      <Dialog
        open={dialog === "clear"}
        title={t("week.clearTitle")}
        confirmLabel={t("week.clear")}
        destructive
        busy={clearWeek.isPending}
        onConfirm={() => week && clearWeek.mutate({ weekId: week.id })}
        onClose={() => !clearWeek.isPending && setDialog(null)}
      >
        {t("week.clearBody", { people, tickets })}
      </Dialog>

      <Dialog
        open={dialog === "publish"}
        title={t("week.publishTitle")}
        confirmLabel={t("week.publish")}
        busy={publish.isPending}
        onConfirm={() => week && publish.mutate({ weekId: week.id })}
        onClose={() => !publish.isPending && setDialog(null)}
      >
        <p>{t("week.publishBody", { people })}</p>
        {emptyTypes.length > 0 && <p>{t("week.publishEmpty", { count: emptyTypes.length })}</p>}
      </Dialog>
    </>
  );
}
