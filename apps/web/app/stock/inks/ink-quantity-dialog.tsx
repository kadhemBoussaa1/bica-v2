"use client";

import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  adjustInkStockInput,
  INK_ADJUST_REASONS,
  restockInkInput,
  type InkAdjustReason,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/field";
import { FormDialog } from "@repo/ui/form-dialog";
import { useTRPC } from "../../trpc/client";
import records from "../../records/records.module.css";
import pills from "../../records/list-header.module.css";
import { formatDelta, formatQty, InkMeter, inkLevel, type InkRow } from "./ink-ui";
import styles from "./inks.module.css";

/** The delivery sizes the tins usually come in. */
const QUICK_ADDS = [5, 10, 25, 50];

/** "12,5" and "12.5" both read as twelve and a half. */
function parse(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Restock (a delivery, added to the balance) and Adjust (a count, which
 * replaces it) — one dialog, since both preview the same thing: the balance
 * before, the balance after, and where the after sits against the threshold.
 */
export function InkQuantityDialog({
  kind,
  colour,
  onClose,
  onDone,
}: {
  kind: "restock" | "adjust";
  colour: Pick<InkRow, "id" | "code" | "name" | "unit" | "stock" | "alertThreshold" | "active">;
  onClose: () => void;
  onDone: (message: string) => void | Promise<void>;
}) {
  const t = useTranslations("stock");
  const common = useTranslations("common");
  const units = useTranslations("enums");
  const trpc = useTRPC();
  const unit = units(`inkUnit.${colour.unit}`);
  const isRestock = kind === "restock";

  const [amount, setAmount] = useState(isRestock ? "" : String(colour.stock));
  const [reason, setReason] = useState<InkAdjustReason>("INVENTORY");
  const [receiptRef, setReceiptRef] = useState("");
  const [error, setError] = useState<string | null>(null);

  const value = parse(amount);
  const after = value === null ? colour.stock : isRestock ? colour.stock + value : value;
  const delta = after - colour.stock;
  const valid = value !== null && (isRestock ? value > 0 : value >= 0);
  const level = inkLevel({ ...colour, stock: after });
  const threshold = colour.alertThreshold;

  const done = (result: { code: string; stock: number }) =>
    onDone(
      t(isRestock ? "inks.restockedToast" : "inks.adjustedToast", {
        code: result.code,
        stock: formatQty(result.stock),
        unit,
      }),
    );
  const restock = useMutation(trpc.ink.restock.mutationOptions({ onSuccess: done, onError: (c) => setError(c.message) }));
  const adjust = useMutation(trpc.ink.adjust.mutationOptions({ onSuccess: done, onError: (c) => setError(c.message) }));
  const busy = restock.isPending || adjust.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (value === null) {
      setError(t("inks.enterNumber"));
      return;
    }
    if (isRestock) {
      const parsed = restockInkInput.safeParse({ id: colour.id, quantity: value, receiptRef });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? t("inks.checkQuantity"));
        return;
      }
      restock.mutate(parsed.data);
      return;
    }
    const parsed = adjustInkStockInput.safeParse({ id: colour.id, stock: value, reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("inks.checkBalance"));
      return;
    }
    adjust.mutate(parsed.data);
  }

  const note =
    threshold === null
      ? t("inks.v3.preview.noThreshold")
      : after <= 0
        ? t("inks.v3.preview.willBeOut")
        : after <= threshold
          ? t("inks.v3.preview.stillUnder", { qty: formatQty(threshold), unit })
          : t("inks.v3.preview.above", { qty: formatQty(threshold), unit });

  return (
    <FormDialog
      eyebrow={colour.code}
      title={t(isRestock ? "inks.v3.restockTitle" : "inks.v3.adjustTitle", { name: colour.name ?? colour.code })}
      onClose={() => !busy && onClose()}
    >
      <form className={styles.dialogForm} onSubmit={submit} noValidate>
        <p className={styles.intro}>{t(isRestock ? "inks.v3.restockIntro" : "inks.v3.adjustIntro")}</p>

        {error && (
          <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
            {error}
          </p>
        )}

        <TextField
          label={t(isRestock ? "inks.quantityReceived" : "inks.countedBalance")}
          unit={unit}
          format="numeric"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          autoComplete="off"
          autoFocus
          disabled={busy}
        />

        {isRestock && (
          <div className={styles.chipRow}>
            {QUICK_ADDS.map((step) => (
              <button
                key={step}
                type="button"
                className={pills.pill}
                disabled={busy}
                onClick={() => setAmount(String(Math.round(((value ?? 0) + step) * 1000) / 1000))}
              >
                +{step} {unit}
              </button>
            ))}
          </div>
        )}

        <div className={styles.preview}>
          <div>
            <div className={styles.previewLabel}>{t("inks.v3.preview.current")}</div>
            <div className={styles.previewFigure}>
              {formatQty(colour.stock)} <span className={styles.previewUnit}>{unit}</span>
            </div>
          </div>
          <div className={styles.previewDelta}>
            <div className={[styles.delta, delta > 0 ? styles.deltaUp : delta < 0 ? styles.deltaDown : null].filter(Boolean).join(" ")}>
              <bdi>{formatDelta(delta)}</bdi>
            </div>
            <div className={[styles.previewArrow, styles.arrow].filter(Boolean).join(" ")} aria-hidden="true">
              →
            </div>
          </div>
          <div className={styles.previewEnd}>
            <div className={styles.previewLabel}>{t("inks.v3.preview.next")}</div>
            <div className={[styles.previewFigure, styles[`figure_${level}`]].filter(Boolean).join(" ")}>
              {formatQty(after)} <span className={styles.previewUnit}>{unit}</span>
            </div>
          </div>
          <div className={styles.previewMeter}>
            <InkMeter stock={colour.stock} alertThreshold={threshold} preview={after} level={level} />
          </div>
          <div className={[styles.previewNote, styles[`standing_${level}`]].filter(Boolean).join(" ")}>{note}</div>
        </div>

        {isRestock ? (
          <TextField
            label={t("inks.v3.receiptRef")}
            format="mono"
            placeholder={t("inks.v3.receiptPlaceholder")}
            value={receiptRef}
            onChange={(event) => setReceiptRef(event.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        ) : (
          <div className={styles.fieldGroup} role="group" aria-labelledby="ink-adjust-reason">
            <span id="ink-adjust-reason" className={styles.fieldLabel}>
              {t("inks.v3.reason")}
            </span>
            <div className={styles.chipRow}>
              {INK_ADJUST_REASONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={[pills.pill, reason === option ? pills.pillActive : null].filter(Boolean).join(" ")}
                  aria-pressed={reason === option}
                  disabled={busy}
                  onClick={() => setReason(option)}
                >
                  {t(`inks.v3.reasons.${option}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={records.formActions}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {common("cancel")}
          </Button>
          <Button variant="primary" type="submit" busy={busy} disabled={!valid}>
            {isRestock
              ? valid
                ? t("inks.v3.addQty", { qty: formatQty(value ?? 0), unit })
                : t("inks.addToStock")
              : t("inks.v3.setTo", { qty: formatQty(after), unit })}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
