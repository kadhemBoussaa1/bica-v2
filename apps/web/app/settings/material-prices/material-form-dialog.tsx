"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  createRawMaterialInput,
  GLUE_SLOTS,
  PAPER_TYPES,
  RAW_MATERIAL_TYPES,
  updateRawMaterialInput,
  type GlueSlot,
  type PaperType,
  type RawMaterialType,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { CheckboxField, SelectField, TextField, type SelectOption } from "@repo/ui/field";
import { FormDialog } from "@repo/ui/form-dialog";
import { decimal } from "../../records/decimal";
import records from "../../records/records.module.css";
import { SegmentedFilter } from "../../records/segmented-filter";
import { useTRPC } from "../../trpc/client";
import type { MaterialDetail } from "./material-ui";
import styles from "./materials.module.css";

/**
 * Create and edit a material. The type is chosen once: order lines rely on
 * it, so on edit it is shown, not offered. The price is typed only on
 * create — it opens the history; afterwards it moves through "New price",
 * which keeps that history (`material.setPrice`).
 */
export function MaterialFormDialog({
  material,
  onClose,
  onDone,
}: {
  /** Absent for a new material. */
  material?: MaterialDetail;
  onClose: () => void;
  onDone: (id: string) => void | Promise<void>;
}) {
  const t = useTranslations("materials");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const trpc = useTRPC();

  const [type, setType] = useState<RawMaterialType>(material?.type ?? "PAPER");
  const [code, setCode] = useState(material?.code ?? "");
  const [label, setLabel] = useState(material?.label ?? "");
  const [supplierId, setSupplierId] = useState(material?.supplier?.id ?? "");
  const [paperType, setPaperType] = useState<PaperType | "">(material?.paperType ?? "");
  const [grammage, setGrammage] = useState(material?.grammage == null ? "" : String(material.grammage));
  const [slots, setSlots] = useState<GlueSlot[]>(
    (material?.defaults ?? []).flatMap((line) => (line.slot === "PAPER" ? [] : [line.slot])),
  );
  const [price, setPrice] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const suppliersQuery = useQuery({
    ...trpc.material.supplierOptions.queryOptions({ currentId: material?.supplier?.id }),
    enabled: type === "PAPER",
  });

  const create = useMutation(
    trpc.material.create.mutationOptions({
      onSuccess: (row) => onDone(row.id),
      onError: (cause) => setError(cause.message),
    }),
  );
  const update = useMutation(
    trpc.material.update.mutationOptions({
      onSuccess: (row) => onDone(row.id),
      onError: (cause) => setError(cause.message),
    }),
  );
  const busy = create.isPending || update.isPending;

  // The suppliers that ship paper here first; a paper is almost always
  // bought from one of them, and the full list is over a hundred names.
  const suppliers = suppliersQuery.data ?? [];
  const paperSuppliers = suppliers.filter((supplier) => supplier.paper);
  const otherSuppliers = suppliers.filter((supplier) => !supplier.paper);
  const supplierOptions: SelectOption[] = [
    ...(paperSuppliers.length > 0
      ? [{ value: "__paper", label: t("form.paperSuppliers"), disabled: true }]
      : []),
    ...paperSuppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
    ...(otherSuppliers.length > 0
      ? [{ value: "__other", label: t("form.otherSuppliers"), disabled: true }]
      : []),
    ...otherSuppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
  ];

  /** undefined when blank, false (after reporting) when not a number. */
  function number(fieldLabel: string, value: string): number | undefined | false {
    if (value.trim() === "") return undefined;
    const parsed = decimal(value);
    if (Number.isNaN(parsed)) {
      setError(t("form.mustBeNumber", { label: fieldLabel }));
      return false;
    }
    return parsed;
  }

  function toggleSlot(slot: GlueSlot, on: boolean) {
    setSlots((current) =>
      on ? GLUE_SLOTS.filter((s) => s === slot || current.includes(s)) : current.filter((s) => s !== slot),
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const grammageValue = number(t("form.grammage"), grammage);
    if (grammageValue === false) return;
    const fields =
      type === "PAPER"
        ? {
            type,
            code,
            label,
            supplierId,
            paperType: paperType === "" ? undefined : paperType,
            // Blank clears it on edit: "any grammage".
            grammage: grammageValue ?? null,
          }
        : { type, code, label, defaultSlots: slots };

    if (material) {
      const parsed = updateRawMaterialInput.safeParse({ id: material.id, ...fields });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? common("checkForm"));
        return;
      }
      update.mutate(parsed.data);
      return;
    }

    const kiloPrice = number(t("form.price"), price);
    if (kiloPrice === false) return;
    if (kiloPrice === undefined) {
      setError(t("form.priceRequired"));
      return;
    }
    const parsed = createRawMaterialInput.safeParse({ ...fields, kiloPrice, comment });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    create.mutate(parsed.data);
  }

  return (
    <FormDialog
      eyebrow={t("detail.eyebrow")}
      title={material ? t("form.editTitle", { label: material.label }) : t("form.createTitle")}
      onClose={() => !busy && onClose()}
    >
      <form className={styles.dialogBody} onSubmit={submit} noValidate>
        {error && (
          <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
            {error}
          </p>
        )}

        <div className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>{t("form.type")}</span>
          {material ? (
            <p className={styles.note}>
              {enums(`rawMaterialType.${material.type}`)} — {t("form.typeNote")}
            </p>
          ) : (
            <SegmentedFilter
              label={t("form.type")}
              segments={RAW_MATERIAL_TYPES.map((key) => ({ key, label: enums(`rawMaterialType.${key}`) }))}
              value={type}
              onChange={(next) => {
                setError(null);
                setType(next);
              }}
            />
          )}
        </div>

        <div className={styles.codeLabel}>
          <TextField
            label={t("form.code")}
            format="mono"
            placeholder={type === "PAPER" ? t("form.codePlaceholder") : t("form.codePlaceholderGlue")}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoFocus
            disabled={busy}
          />
          <TextField
            label={t("form.label")}
            placeholder={type === "PAPER" ? t("form.labelPlaceholder") : t("form.labelPlaceholderGlue")}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </div>

        {type === "PAPER" ? (
          <>
            <SelectField
              label={t("form.supplier")}
              placeholder={t("form.supplierPlaceholder")}
              options={supplierOptions}
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              disabled={busy || suppliersQuery.isPending}
            />
            <div className={styles.twoUp}>
              <SelectField
                label={t("form.paperType")}
                placeholder={t("form.paperTypePlaceholder")}
                options={PAPER_TYPES.map((key) => ({ value: key, label: enums(`paperType.${key}`) }))}
                value={paperType}
                onChange={(event) => setPaperType(event.target.value as PaperType)}
                disabled={busy}
              />
              <TextField
                label={t("form.grammage")}
                unit="g/m²"
                format="numeric"
                inputMode="decimal"
                placeholder="—"
                value={grammage}
                onChange={(event) => setGrammage(event.target.value)}
                autoComplete="off"
                disabled={busy}
              />
            </div>
            <p className={styles.note}>{t("form.grammageHint")}</p>
          </>
        ) : (
          <div className={styles.fieldGroup} role="group" aria-labelledby="material-slots-label">
            <span id="material-slots-label" className={styles.fieldLabel}>
              {t("form.defaults")}
            </span>
            <div className={styles.slots}>
              {GLUE_SLOTS.map((slot) => (
                <CheckboxField
                  key={slot}
                  label={enums(`pricingSlot.${slot}`)}
                  checked={slots.includes(slot)}
                  onChange={(event) => toggleSlot(slot, event.target.checked)}
                  disabled={busy || material?.active === false}
                />
              ))}
            </div>
            <p className={styles.note}>{t("form.defaultsHint")}</p>
          </div>
        )}

        {!material && (
          <>
            <div className={styles.twoUp}>
              <TextField
                label={t("form.price")}
                unit="/kg"
                format="numeric"
                inputMode="decimal"
                placeholder="0,00"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                autoComplete="off"
                disabled={busy}
              />
              <TextField
                label={t("form.comment")}
                placeholder={t("form.commentPlaceholder")}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                autoComplete="off"
                disabled={busy}
              />
            </div>
            <p className={styles.note}>{t("form.createNote")}</p>
          </>
        )}

        <div className={records.formActions}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {common("cancel")}
          </Button>
          <Button variant="primary" type="submit" busy={busy}>
            {material ? common("save") : t("form.create")}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
