"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  requestChangeInput,
  SHIFT_TYPES,
  type ShiftType,
  type WorkerChangeKind,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { FormDialog } from "@repo/ui/form-dialog";
import { useToast } from "@repo/ui/toast";
import { useTRPC } from "../../trpc/client";
import { invalidateShiftQueries } from "../shift-queries";
import type { MyWeek } from "../types";
import { employeeName } from "../../employees/employee-name";
import { formatShiftHours } from "../week";
import styles from "../shifts.module.css";

interface RequestDialogProps {
  week: MyWeek;
  /** The viewer's own row for the week. */
  mine: { id: string; type: ShiftType };
  employeeId: string;
  weekRange: string;
  onClose: () => void;
}

/**
 * "What would you like to change?" — the request modal from the handoff:
 * two kind cards, then chips for the target shift or the colleague to swap
 * with, and the reason. The mock's "Which days?" picker is not here: a
 * request applies to the rest of the week, which the eyebrow says.
 */
export function RequestDialog({ week, mine, employeeId, weekRange, onClose }: RequestDialogProps) {
  const t = useTranslations("shifts");
  const enums = useTranslations("enums");
  const common = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { push } = useToast();

  const others = SHIFT_TYPES.filter((x) => x !== mine.type);
  const [kind, setKind] = useState<WorkerChangeKind>("MOVE");
  const [toType, setToType] = useState<ShiftType | "">(others[0] ?? "");
  const [counterpartId, setCounterpartId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const typeLabel = (type: ShiftType) => `${enums(`shiftType.${type}`)} ${formatShiftHours(type)}`;
  const counterparts = week.assignments.filter((a) => a.type !== mine.type && a.employeeId !== employeeId);

  const request = useMutation(
    trpc.shift.requestChange.mutationOptions({
      onSuccess: async () => {
        push({ title: t("me.sent"), tone: "success" });
        await invalidateShiftQueries(queryClient, trpc);
        onClose();
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (kind === "SWAP" && !counterpartId) {
      setError(t("me.pickSwap"));
      return;
    }
    const parsed = requestChangeInput.safeParse({
      weekId: week.id,
      kind,
      toType: kind === "MOVE" ? toType || undefined : undefined,
      counterpartEmployeeId: kind === "SWAP" ? counterpartId : undefined,
      reason,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    request.mutate(parsed.data);
  }

  const busy = request.isPending;

  return (
    <FormDialog eyebrow={`${weekRange} · ${typeLabel(mine.type)}`} title={t("me.requestTitle")} onClose={onClose}>
      <form className={styles.ticketForm} onSubmit={handleSubmit} noValidate>
        <div className={styles.kindGrid} role="radiogroup" aria-label={t("change.kind")}>
          {(["MOVE", "SWAP"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={[styles.kindCard, kind === k ? styles.kindCardOn : null].filter(Boolean).join(" ")}
              disabled={busy}
              onClick={() => {
                setKind(k);
                setError(null);
              }}
            >
              <span className={styles.kindLabel}>{t(`me.kind.${k}`)}</span>
              <span className={styles.kindHint}>{t(`me.kindHint.${k}`)}</span>
            </button>
          ))}
        </div>

        <div className={styles.ticketLabel}>{kind === "MOVE" ? t("me.moveTo") : t("me.counterpart")}</div>
        <div className={styles.chips} role="radiogroup">
          {kind === "MOVE"
            ? others.map((x) => (
                <button
                  key={x}
                  type="button"
                  role="radio"
                  aria-checked={toType === x}
                  className={[styles.typeChip, toType === x ? styles.typeChipOn : null].filter(Boolean).join(" ")}
                  disabled={busy}
                  onClick={() => setToType(x)}
                >
                  {typeLabel(x)}
                </button>
              ))
            : counterparts.length === 0
              ? <span className={styles.muted}>{t("change.nobodyAvailable")}</span>
              : counterparts.map((a) => (
                  <button
                    key={a.employeeId}
                    type="button"
                    role="radio"
                    aria-checked={counterpartId === a.employeeId}
                    className={[styles.typeChip, styles.typeChipSoft, counterpartId === a.employeeId ? styles.typeChipOn : null]
                      .filter(Boolean)
                      .join(" ")}
                    disabled={busy}
                    onClick={() => {
                      setCounterpartId(a.employeeId);
                      setError(null);
                    }}
                  >
                    {employeeName(a.employee)} · {enums(`shiftType.${a.type}`)}
                  </button>
                ))}
        </div>
        <p className={styles.muted}>{t("me.restOfWeek")}</p>

        <label className={styles.whyLabel}>
          <span>
            {t("me.reason")} <span className={styles.whyHint}>{t("me.reasonHint")}</span>
          </span>
          <textarea
            className={styles.whyInput}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={t("me.reasonPlaceholder")}
            disabled={busy}
          />
        </label>
        {error && (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        )}

        <div className={styles.pickerFoot}>
          <span className={styles.spacer} />
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {common("cancel")}
          </Button>
          <Button variant="primary" type="submit" busy={busy}>
            {busy ? common("saving") : t("me.submit")}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
