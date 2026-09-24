"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  createShiftTaskInput,
  SHIFT_TASK_TYPES,
  taskMachineTypes,
  updateShiftTaskInput,
  type ShiftTaskType,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { SelectField, TextAreaField } from "@repo/ui/field";
import { FormDialog } from "@repo/ui/form-dialog";
import { useToast } from "@repo/ui/toast";
import { useTRPC } from "../trpc/client";
import records from "../records/records.module.css";
import { Avatar } from "./avatar";
import { invalidateShiftQueries } from "./shift-queries";
import type { RosterEmployee, TaskData } from "./types";
import { formatDayShort, formatShiftHours, formatWeekdayLong } from "./week";
import styles from "./shifts.module.css";

interface TaskFormProps {
  shift: { id: string; type: "NIGHT" | "MORNING" | "AFTERNOON"; date: string | Date };
  /** The one person the ticket is for. */
  employee: RosterEmployee;
  /** Their other tickets that day, named so a duplicate is not typed twice. */
  existing?: readonly TaskData[];
  /** Editing this ticket; absent for a new one. */
  task?: TaskData;
  onClose: () => void;
}

/**
 * "A ticket for Amir" — one person, one day, one task, in the handoff's
 * shape: the type as chips, machine and order optional, a note. The machine
 * list is filtered by the same rule the server enforces
 * (`taskMachineTypes`) and the order list is the floor's (`order.onFloor`),
 * so the form cannot offer anything the call would refuse.
 */
export function TaskForm({ shift, employee, existing = [], task, onClose }: TaskFormProps) {
  const t = useTranslations("shifts");
  const enums = useTranslations("enums");
  const common = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { push } = useToast();

  const [type, setType] = useState<ShiftTaskType>(task?.type ?? "PRODUCTION");
  const [machineId, setMachineId] = useState(task?.machine?.id ?? "");
  const [orderId, setOrderId] = useState(task?.order?.id ?? "");
  const [note, setNote] = useState(task?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  const allowedTypes = taskMachineTypes(type);
  const machinesQuery = useQuery(
    trpc.machine.list.queryOptions({ pageSize: 100, sortBy: "name", sortDir: "asc" }),
  );
  const machines = (machinesQuery.data?.rows ?? []).filter(
    (m) => m.active && (allowedTypes === null || allowedTypes.some((x) => x === m.type)),
  );
  const ordersQuery = useQuery(trpc.order.onFloor.queryOptions());
  const orders = ordersQuery.data ?? [];

  const done = async (title: string) => {
    push({ title, tone: "success" });
    await invalidateShiftQueries(queryClient, trpc);
    onClose();
  };
  const create = useMutation(
    trpc.shift.createTask.mutationOptions({
      onSuccess: () => done(t("task.created", { name: employee.firstName || employee.lastName })),
      onError: (cause) => setError(cause.message),
    }),
  );
  const update = useMutation(
    trpc.shift.updateTask.mutationOptions({
      onSuccess: () => done(t("task.saved")),
      onError: (cause) => setError(cause.message),
    }),
  );
  const busy = create.isPending || update.isPending;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (task) {
      const parsed = updateShiftTaskInput.safeParse({
        id: task.id,
        employeeId: employee.id,
        type,
        machineId: machineId || null,
        orderId: orderId || null,
        note: note.trim() === "" ? null : note,
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? common("checkForm"));
        return;
      }
      update.mutate(parsed.data);
      return;
    }
    const parsed = createShiftTaskInput.safeParse({
      shiftId: shift.id,
      employeeId: employee.id,
      type,
      machineId: machineId || undefined,
      orderId: orderId || undefined,
      note,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    create.mutate(parsed.data);
  }

  const others = existing.filter((x) => x.id !== task?.id);
  const first = employee.firstName || employee.lastName || employee.matricule;
  const when = `${formatWeekdayLong(shift.date)} ${formatDayShort(shift.date)} · ${enums(`shiftType.${shift.type}`)} ${formatShiftHours(shift.type)}`;

  return (
    <FormDialog
      eyebrow={t("eyebrow")}
      title={task ? t("task.edit") : t("task.forTitle", { name: first })}
      onClose={onClose}
    >
      <form className={styles.ticketForm} onSubmit={handleSubmit} noValidate>
        <div className={styles.ticketHead}>
          <Avatar employee={employee} size="lg" />
          <span className={styles.ticketWhen}>{when}</span>
        </div>
        {others.length > 0 && (
          <p className={styles.ticketExisting}>
            {t("task.existing", {
              list: others
                .map((x) =>
                  x.machine
                    ? t("task.existingOn", { type: enums(`shiftTaskType.${x.type}`), machine: x.machine.name })
                    : enums(`shiftTaskType.${x.type}`),
                )
                .join(", "),
            })}
          </p>
        )}
        {error && (
          <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
            {error}
          </p>
        )}

        <div className={styles.ticketLabel}>{t("task.type")}</div>
        <div className={styles.chips} role="radiogroup" aria-label={t("task.type")}>
          {SHIFT_TASK_TYPES.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={type === v}
              className={[styles.typeChip, type === v ? styles.typeChipOn : null].filter(Boolean).join(" ")}
              disabled={busy}
              onClick={() => {
                // A different kind runs on different machines: the previous
                // pick may no longer be offered, so it is cleared.
                setType(v);
                setMachineId("");
              }}
            >
              {enums(`shiftTaskType.${v}`)}
            </button>
          ))}
        </div>

        <div className={records.formGrid}>
          <SelectField
            label={`${t("task.machine")} — ${t("task.optional")}`}
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            disabled={busy || machinesQuery.isPending}
            allowEmpty
            placeholder={machinesQuery.isPending ? common("loading") : t("task.noMachine")}
            options={machines.map((m) => ({ value: m.id, label: `${m.name} (${m.code})` }))}
          />
          <SelectField
            label={`${t("task.order")} — ${t("task.optional")}`}
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            disabled={busy || ordersQuery.isPending}
            allowEmpty
            placeholder={ordersQuery.isPending ? common("loading") : t("task.noOrder")}
            options={orders.map((o) => ({
              value: o.id,
              label: `${o.numero} · ${o.product.name}${o.client ? ` · ${o.client.name}` : ""}`,
            }))}
          />
          <div className={records.formWide}>
            <TextAreaField
              label={t("task.note")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={t("task.notePlaceholder")}
              disabled={busy}
            />
          </div>
        </div>
        <div className={records.formActions}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {common("cancel")}
          </Button>
          <Button variant="primary" type="submit" busy={busy}>
            {busy ? common("saving") : task ? t("task.save") : t("task.create")}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
