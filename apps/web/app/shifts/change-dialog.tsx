"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  adminChangeInput,
  SHIFT_CHANGE_KINDS,
  SHIFT_TYPES,
  type ShiftChangeKind,
  type ShiftType,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { SelectField, TextAreaField } from "@repo/ui/field";
import { FormDialog } from "@repo/ui/form-dialog";
import { useToast } from "@repo/ui/toast";
import { useTRPC } from "../trpc/client";
import records from "../records/records.module.css";
import { invalidateShiftQueries } from "./shift-queries";
import type { RosterEmployee, WeekAssignment, WeekData } from "./types";
import { employeeName } from "../employees/employee-name";
import { formatShiftHours } from "./week";

interface ChangeDialogProps {
  week: WeekData;
  /** The person's row: the person and their shift are fixed. */
  assignment: WeekAssignment;
  /** The roster's people not placed this week: the pool a replacement comes from. */
  pool: readonly RosterEmployee[];
  onClose: () => void;
}

/**
 * An admin's change to one person's shift on a published week, for the rest
 * of the week: move, swap, replace or remove. Adding people is the photo
 * picker's job (`EmployeePicker`), which records ADD changes in bulk.
 */
export function ChangeDialog({ week, assignment, pool, onClose }: ChangeDialogProps) {
  const t = useTranslations("shifts");
  const enums = useTranslations("enums");
  const common = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { push } = useToast();

  const fixedType = assignment.type;
  const employeeId = assignment.employeeId;
  const [kind, setKind] = useState<ShiftChangeKind>("MOVE");
  const [toType, setToType] = useState<ShiftType | "">("");
  const [counterpartId, setCounterpartId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const kinds: readonly ShiftChangeKind[] = SHIFT_CHANGE_KINDS.filter((k) => k !== "ADD");
  const needsTo = kind === "MOVE";
  const needsCounterpart = kind === "SWAP" || kind === "REPLACE";

  const typeLabel = (type: ShiftType) => `${enums(`shiftType.${type}`)} ${formatShiftHours(type)}`;
  const otherTypes = SHIFT_TYPES.filter((x) => x !== fixedType);
  const counterparts: readonly { id: string; label: string }[] =
    kind === "SWAP"
      ? week.assignments
          .filter((a) => a.type !== fixedType)
          .map((a) => ({
            id: a.employeeId,
            label: `${employeeName(a.employee)} · ${enums(`shiftType.${a.type}`)}`,
          }))
      : pool.map((e) => ({ id: e.id, label: employeeName(e) }));

  const change = useMutation(
    trpc.shift.change.mutationOptions({
      onSuccess: async (result) => {
        push({ title: t("change.recorded"), tone: "success" });
        if (result.ticketsRemoved > 0) {
          push({
            title: t("board.ticketsRemoved", { count: result.ticketsRemoved }),
            tone: "warning",
          });
        }
        await invalidateShiftQueries(queryClient, trpc);
        onClose();
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = adminChangeInput.safeParse({
      weekId: week.id,
      kind,
      employeeId,
      toType: needsTo ? toType || undefined : undefined,
      counterpartEmployeeId: needsCounterpart ? counterpartId || undefined : undefined,
      reason,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    change.mutate(parsed.data);
  }

  const busy = change.isPending;

  return (
    <FormDialog eyebrow={t("eyebrow")} title={t("change.title")} onClose={onClose}>
      <form className={records.formPanel} onSubmit={handleSubmit} noValidate>
        {error && (
          <p
            className={[records.notice, records.error].filter(Boolean).join(" ")}
            role="alert"
          >
            {error}
          </p>
        )}
        <div className={records.formGrid}>
          <SelectField
            label={t("change.kind")}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ShiftChangeKind);
              setToType("");
              setCounterpartId("");
            }}
            disabled={busy}
            options={kinds.map((k) => ({ value: k, label: enums(`shiftChangeKind.${k}`) }))}
          />

          <SelectField
            label={t("change.employee")}
            value={employeeId}
            disabled
            options={[{ value: employeeId, label: employeeName(assignment.employee) }]}
          />

          <SelectField
            label={t("change.from")}
            value={fixedType}
            disabled
            options={[{ value: fixedType, label: typeLabel(fixedType) }]}
          />

          {needsTo && (
            <SelectField
              label={t("change.to")}
              value={toType}
              onChange={(e) => setToType(e.target.value as ShiftType)}
              disabled={busy}
              placeholder={t("change.pickShift")}
              options={otherTypes.map((x) => ({ value: x, label: typeLabel(x) }))}
            />
          )}

          {needsCounterpart && (
            <SelectField
              label={kind === "SWAP" ? t("change.counterpart") : t("change.counterpartReplace")}
              value={counterpartId}
              onChange={(e) => setCounterpartId(e.target.value)}
              disabled={busy}
              placeholder={
                counterparts.length === 0 ? t("change.nobodyAvailable") : t("change.pickPerson")
              }
              options={counterparts.map((c) => ({ value: c.id, label: c.label }))}
            />
          )}

          <div className={records.formWide}>
            <TextAreaField
              label={t("change.reason")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              disabled={busy}
            />
          </div>
        </div>
        <div className={records.formActions}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {common("cancel")}
          </Button>
          <Button variant="primary" type="submit" busy={busy}>
            {busy ? common("saving") : t("change.submit")}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
