"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { canWorkerMarkDone, isTaskMissed } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { useToast } from "@repo/ui/toast";
import { useTRPC } from "../trpc/client";
import { invalidateShiftQueries } from "./shift-queries";
import type { TaskData } from "./types";
import { employeeName } from "../employees/employee-name";
import styles from "./shifts.module.css";

interface TaskCardProps {
  task: TaskData;
  shift: { startsAt: string | Date; endsAt: string | Date };
  /**
   * `admin` offers edit, delete, done and reopen at dense size. `floor` is
   * the worker's card: one big Done button, disabled once the shift is over
   * by the same rule the server applies, so it never offers what the call
   * would refuse.
   */
  mode: "admin" | "floor";
  /** Floor only: whether the viewer is this ticket's person. */
  canMark?: boolean;
  /** Names the person on the card, for a list that mixes people. */
  showEmployee?: boolean;
  onEdit?: (task: TaskData) => void;
  onDelete?: (task: TaskData) => void;
}

/**
 * One ticket: its kind, machine, order, person and note, with a pill that
 * reads Open, Done or Missed. "Missed" is derived here from the shift's end
 * (`isTaskMissed`), never stored.
 */
export function TaskCard({
  task,
  shift,
  mode,
  canMark = false,
  showEmployee = false,
  onEdit,
  onDelete,
}: TaskCardProps) {
  const t = useTranslations("shifts");
  const enums = useTranslations("enums");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { push } = useToast();

  const setDone = useMutation(
    trpc.shift.setTaskDone.mutationOptions({
      onSuccess: () => invalidateShiftQueries(queryClient, trpc),
      onError: (cause) => push({ title: cause.message, tone: "error" }),
    }),
  );

  const now = new Date();
  const missed = isTaskMissed(task, shift, now);
  const done = task.status === "DONE";
  const workerMayMark = canMark && !done && canWorkerMarkDone(shift, now);

  const pill = done
    ? { className: styles.pillLive, label: t("task.done") }
    : missed
      ? { className: styles.pillDanger, label: t("task.missed") }
      : { className: styles.pillInfo, label: t("task.open") };

  return (
    <div className={[styles.task, done ? styles.taskDone : null].filter(Boolean).join(" ")}>
      <div className={styles.taskHead}>
        <span className={styles.taskType}>{enums(`shiftTaskType.${task.type}`)}</span>
        <span className={[styles.pill, pill.className].filter(Boolean).join(" ")}>
          {pill.label}
        </span>
      </div>
      {showEmployee && (
        <div className={styles.taskLine}>
          <span className={styles.taskLabel}>{t("task.assignee")}: </span>
          {employeeName(task.employee)}
        </div>
      )}
      {task.machine && (
        <div className={styles.taskLine}>
          <span className={styles.taskLabel}>{t("task.machine")}: </span>
          {task.machine.name} ({task.machine.code})
        </div>
      )}
      {task.order && (
        <div className={styles.taskLine}>
          <span className={styles.taskLabel}>{t("task.order")}: </span>
          {task.order.numero}
        </div>
      )}
      {task.note && <p className={styles.taskNote}>{task.note}</p>}
      {done && task.doneBy && (
        <div className={[styles.taskLine, styles.taskLabel].filter(Boolean).join(" ")}>
          {t("task.doneBy", { name: task.doneBy.name })}
        </div>
      )}

      {mode === "admin" ? (
        <div className={styles.taskActions}>
          <Button
            size="dense"
            variant={done ? "secondary" : "primary"}
            busy={setDone.isPending}
            onClick={() => setDone.mutate({ id: task.id, done: !done })}
          >
            {done ? t("task.reopen") : t("task.markDone")}
          </Button>
          {onEdit && (
            <Button size="dense" disabled={done} onClick={() => onEdit(task)}>
              {t("task.edit")}
            </Button>
          )}
          {onDelete && (
            <Button size="dense" variant="danger" onClick={() => onDelete(task)}>
              {t("task.delete")}
            </Button>
          )}
        </div>
      ) : canMark && !done ? (
        <div className={styles.taskActions}>
          <Button
            size="floor"
            variant="primary"
            busy={setDone.isPending}
            disabled={!workerMayMark}
            title={workerMayMark ? undefined : t("task.shiftOver")}
            onClick={() => setDone.mutate({ id: task.id, done: true })}
          >
            {workerMayMark ? t("task.markDone") : t("task.shiftOver")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
