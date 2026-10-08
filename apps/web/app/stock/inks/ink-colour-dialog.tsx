"use client";

import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  createInkColourInput,
  INK_UNITS,
  updateInkColourInput,
  type InkUnit,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/field";
import { FormDialog } from "@repo/ui/form-dialog";
import { useTRPC } from "../../trpc/client";
import { SegmentedFilter } from "../../records/segmented-filter";
import records from "../../records/records.module.css";
import { formatQty, type InkRow } from "./ink-ui";
import styles from "./inks.module.css";

/** The handoff's swatches: process colours, the usual Pantones, kraft brown, grey. */
const SWATCHES = [
  "#1A1A1A",
  "#0093D3",
  "#D6007E",
  "#FFE500",
  "#F5F2EA",
  "#C8102E",
  "#00843D",
  "#7A4A24",
  "#003DA5",
  "#F28C00",
  "#6D2077",
  "#8A8D8F",
];

/** Numbers are held as strings while typed; "" is "not set". */
const str = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));

/**
 * Create and edit a colour. The balance is only typed on create — the
 * opening figure; afterwards it moves through Restock and Adjust, so an edit
 * that resubmits every field cannot overwrite a balance a usage line changed
 * underneath it (see `createInkColourInput`). The unit is fixed once the
 * colour exists, since every figure on it is in that unit.
 */
export function InkColourDialog({
  colour,
  onClose,
  onDone,
}: {
  /** Absent for a new colour. */
  colour?: Pick<InkRow, "id" | "code" | "name" | "unit" | "stock" | "alertThreshold" | "kiloPrice" | "hex">;
  onClose: () => void;
  onDone: (id: string) => void | Promise<void>;
}) {
  const t = useTranslations("stock");
  const common = useTranslations("common");
  const units = useTranslations("enums");
  const trpc = useTRPC();

  const [code, setCode] = useState(colour?.code ?? "");
  const [name, setName] = useState(colour?.name ?? "");
  const [hex, setHex] = useState<string | null>(colour ? colour.hex : SWATCHES[5]!);
  const [unit, setUnit] = useState<InkUnit>(colour?.unit ?? "KG");
  const [opening, setOpening] = useState("");
  const [threshold, setThreshold] = useState(str(colour?.alertThreshold));
  const [price, setPrice] = useState(str(colour?.kiloPrice));
  const [error, setError] = useState<string | null>(null);
  const unitLabel = units(`inkUnit.${unit}`);

  const create = useMutation(
    trpc.ink.create.mutationOptions({ onSuccess: (row) => onDone(row.id), onError: (c) => setError(c.message) }),
  );
  const update = useMutation(
    trpc.ink.update.mutationOptions({ onSuccess: (row) => onDone(row.id), onError: (c) => setError(c.message) }),
  );
  const busy = create.isPending || update.isPending;

  /** undefined when blank, false (after reporting) when not a number. */
  function number(label: string, value: string): number | undefined | false {
    const trimmed = value.trim().replace(",", ".");
    if (trimmed === "") return undefined;
    if (Number.isNaN(Number(trimmed))) {
      setError(t("mustBeNumber", { label }));
      return false;
    }
    return Number(trimmed);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const alertThreshold = number(t("inks.form.alertThreshold"), threshold);
    if (alertThreshold === false) return;
    const kiloPrice = number(t("inks.v3.price"), price);
    if (kiloPrice === false) return;
    if (kiloPrice === undefined) {
      setError(t("inks.v3.priceRequired"));
      return;
    }

    if (colour) {
      const parsed = updateInkColourInput.safeParse({
        id: colour.id,
        code,
        name,
        alertThreshold,
        kiloPrice,
        hex,
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? common("checkForm"));
        return;
      }
      update.mutate(parsed.data);
      return;
    }
    const stock = number(t("inks.form.openingBalance"), opening);
    if (stock === false) return;
    const parsed = createInkColourInput.safeParse({ code, name, unit, stock, alertThreshold, kiloPrice, hex });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    create.mutate(parsed.data);
  }

  return (
    <FormDialog
      eyebrow={t("inks.title")}
      title={colour ? t("inks.v3.editTitle", { name: colour.name ?? colour.code }) : t("inks.newColour")}
      onClose={() => !busy && onClose()}
    >
      <form className={styles.dialogForm} onSubmit={submit} noValidate>
        {error && (
          <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
            {error}
          </p>
        )}

        <div className={styles.codeName}>
          <TextField
            label={t("inks.form.code")}
            format="mono"
            placeholder={t("inks.v3.codePlaceholder")}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoFocus
            disabled={busy}
          />
          <TextField
            label={t("inks.form.name")}
            placeholder={t("inks.v3.namePlaceholder")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </div>

        <div className={styles.fieldGroup} role="group" aria-labelledby="ink-swatch-label">
          <span id="ink-swatch-label" className={styles.fieldLabel}>
            {t("inks.v3.swatch")} <span className={styles.fieldHint}>{t("inks.v3.swatchHint")}</span>
          </span>
          <div className={styles.swatches}>
            {SWATCHES.map((option) => (
              <button
                key={option}
                type="button"
                className={[styles.swatchOption, hex === option ? styles.swatchChosen : null].filter(Boolean).join(" ")}
                style={{ background: option }}
                aria-label={option}
                aria-pressed={hex === option}
                disabled={busy}
                onClick={() => setHex(option)}
              />
            ))}
            <label
              className={[
                styles.swatchOption,
                styles.swatchCustom,
                hex !== null && !SWATCHES.includes(hex) ? styles.swatchChosen : null,
              ]
                .filter(Boolean)
                .join(" ")}
              style={hex !== null && !SWATCHES.includes(hex) ? { background: hex } : undefined}
              title={t("inks.v3.swatchOther")}
            >
              <span className={styles.visuallyHidden}>{t("inks.v3.swatchOther")}</span>
              <input
                type="color"
                value={hex ?? "#C8102E"}
                disabled={busy}
                onChange={(event) => setHex(event.target.value.toUpperCase())}
              />
            </label>
            <button
              type="button"
              className={[styles.swatchOption, styles.swatchNone, hex === null ? styles.swatchChosen : null]
                .filter(Boolean)
                .join(" ")}
              aria-pressed={hex === null}
              disabled={busy}
              onClick={() => setHex(null)}
              title={t("inks.v3.swatchNone")}
            >
              <span className={styles.visuallyHidden}>{t("inks.v3.swatchNone")}</span>
            </button>
          </div>
        </div>

        {!colour && (
          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>{t("inks.form.unit")}</span>
            <SegmentedFilter
              label={t("inks.form.unit")}
              segments={INK_UNITS.map((key) => ({ key, label: units(`inkUnit.${key}`) }))}
              value={unit}
              onChange={setUnit}
            />
          </div>
        )}

        <div className={styles.twoUp}>
          {colour ? (
            <TextField
              label={t("inks.v3.currentBalance")}
              unit={unitLabel}
              format="numeric"
              value={formatQty(colour.stock)}
              readOnly
              disabled
            />
          ) : (
            <TextField
              label={t("inks.form.openingBalance")}
              unit={unitLabel}
              format="numeric"
              inputMode="decimal"
              placeholder="0"
              value={opening}
              onChange={(event) => setOpening(event.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          )}
          <TextField
            label={t("inks.v3.thresholdOptional")}
            unit={unitLabel}
            format="numeric"
            inputMode="decimal"
            placeholder="—"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </div>

        <div className={styles.twoUp}>
          <TextField
            label={t("inks.v3.price")}
            unit={`/${unitLabel}`}
            format="numeric"
            inputMode="decimal"
            placeholder="—"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </div>

        <p className={styles.fieldHint}>{colour ? t("inks.v3.editNote") : t("inks.v3.createNote")}</p>

        <div className={records.formActions}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {common("cancel")}
          </Button>
          <Button variant="primary" type="submit" busy={busy}>
            {colour ? common("save") : t("inks.form.createColour")}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
