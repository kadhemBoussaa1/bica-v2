"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  createInkColourInput,
  INK_UNITS,
  updateInkColourInput,
  type InkUnit,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { SelectField, TextField } from "@repo/ui/field";
import { useTRPC } from "../../trpc/client";
import styles from "../../records/records.module.css";

export interface InkFormValues {
  id: string;
  code: string;
  name: string | null;
  unit: InkUnit;
  stock: number;
  alertThreshold: number | null;
}

/** Numbers are held as strings — see MachineForm. */
const str = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

const qty = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

/**
 * Create and edit share one form, but the balance is only on CREATE: it is
 * the opening figure. Afterwards it moves through Restock and Adjust on the
 * list, so an edit that resubmits every field cannot overwrite a balance a
 * usage line changed underneath it (see `createInkColourInput`).
 */
export function InkForm({
  initial,
  onDone,
  onCancel,
}: {
  onDone?: (target: string) => void | Promise<void>;
  onCancel?: (target: string) => void;
  initial?: InkFormValues;
}) {
  const router = useRouter();
  const t = useTranslations("stock");
  const common = useTranslations("common");
  const units = useTranslations("enums");
  const unitLabel = (value: InkUnit) => units(`inkUnit.${value}`);
  // The route modal passes both; the full page falls through to navigation.
  const go = (target: string) => (onDone ? onDone(target) : router.push(target));
  const cancel = (target: string) => (onCancel ? onCancel(target) : router.push(target));
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [unit, setUnit] = useState<InkUnit>(initial?.unit ?? "KG");
  const [stock, setStock] = useState("");
  const [alertThreshold, setAlertThreshold] = useState(str(initial?.alertThreshold));
  const [error, setError] = useState<string | null>(null);

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: trpc.ink.list.queryKey() });
    await go("/stock/inks");
  };

  const create = useMutation(
    trpc.ink.create.mutationOptions({ onSuccess: done, onError: (c) => setError(c.message) }),
  );
  const update = useMutation(
    trpc.ink.update.mutationOptions({ onSuccess: done, onError: (c) => setError(c.message) }),
  );
  const busy = create.isPending || update.isPending;

  function number(label: string, value: string): number | undefined | false {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    if (Number.isNaN(Number(trimmed))) {
      setError(t("mustBeNumber", { label }));
      return false;
    }
    return Number(trimmed);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const threshold = number(t("inks.form.alertThreshold"), alertThreshold);
    if (threshold === false) return;

    if (initial) {
      const parsed = updateInkColourInput.safeParse({
        id: initial.id,
        code,
        name,
        unit,
        alertThreshold: threshold,
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? common("checkForm"));
        return;
      }
      update.mutate(parsed.data);
      return;
    }

    const opening = number(t("inks.form.openingBalance"), stock);
    if (opening === false) return;
    const parsed = createInkColourInput.safeParse({
      code,
      name,
      unit,
      stock: opening,
      alertThreshold: threshold,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    create.mutate(parsed.data);
  }

  return (
    <form className={styles.formPanel} onSubmit={handleSubmit} noValidate>
      {error && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <div className={styles.formGrid}>
        <TextField
          label={t("inks.form.code")}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <SelectField
          label={t("inks.form.unit")}
          value={unit}
          onChange={(e) => setUnit(e.target.value as InkUnit)}
          disabled={busy || initial !== undefined}
          options={INK_UNITS.map((value) => ({ value, label: unitLabel(value) }))}
        />
        <div className={styles.formWide}>
          <TextField
            label={t("inks.form.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </div>

        <span className={styles.formSection}>{t("inks.form.stockSection")}</span>
        {initial ? (
          <p className={[styles.hint, styles.formWide].filter(Boolean).join(" ")}>
            {t.rich("inks.form.balanceHint", {
              stock: qty.format(initial.stock),
              unit: unitLabel(initial.unit),
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        ) : (
          <TextField
            label={t("inks.form.openingBalance")}
            unit={unitLabel(unit)}
            format="numeric"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        )}
        <TextField
          label={t("inks.form.alertThreshold")}
          unit={unitLabel(unit)}
          format="numeric"
          value={alertThreshold}
          onChange={(e) => setAlertThreshold(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <p className={[styles.hint, styles.formWide].filter(Boolean).join(" ")}>
          {t("inks.form.alertThresholdHint")}
        </p>
      </div>

      <div className={styles.formActions}>
        <Button variant="secondary" onClick={() => cancel("/stock/inks")} disabled={busy}>
          {common("cancel")}
        </Button>
        <Button variant="primary" type="submit" busy={busy}>
          {busy ? common("saving") : initial ? common("saveChanges") : t("inks.form.createColour")}
        </Button>
      </div>
    </form>
  );
}
