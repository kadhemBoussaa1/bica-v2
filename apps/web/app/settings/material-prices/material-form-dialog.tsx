"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  createRawMaterialInput,
  GLUE_SLOTS,
  isGlueSlot,
  PAPER_TYPES,
  RAW_MATERIAL_TYPES,
  updateRawMaterialInput,
  type GlueSlot,
  type PaperType,
  type RawMaterialType,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { ComboboxField, type ComboboxOption } from "@repo/ui/combobox-field";
import { CheckboxField, SelectField, TextField } from "@repo/ui/field";
import { FormDialog } from "@repo/ui/form-dialog";
import { decimal } from "../../records/decimal";
import records from "../../records/records.module.css";
import { SegmentedFilter } from "../../records/segmented-filter";
import { useTRPC } from "../../trpc/client";
import { usePriceUnit, type MaterialDetail } from "./material-ui";
import styles from "./materials.module.css";

/** A carton side as the field shows it: blank for none, the stored figure otherwise. */
function sideText(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

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
  const unit = usePriceUnit();

  const [type, setType] = useState<RawMaterialType>(material?.type ?? "PAPER");
  const [code, setCode] = useState(material?.code ?? "");
  const [label, setLabel] = useState(material?.label ?? "");
  const [supplierId, setSupplierId] = useState(material?.supplier?.id ?? "");
  const [paperType, setPaperType] = useState<PaperType | "">(material?.paperType ?? "");
  const [grammage, setGrammage] = useState(material?.grammage == null ? "" : String(material.grammage));
  const [lengthMm, setLengthMm] = useState(sideText(material?.lengthMm));
  const [widthMm, setWidthMm] = useState(sideText(material?.widthMm));
  const [heightMm, setHeightMm] = useState(sideText(material?.heightMm));
  const [slots, setSlots] = useState<GlueSlot[]>(
    (material?.defaults ?? []).flatMap((line) => (isGlueSlot(line.slot) ? [line.slot] : [])),
  );
  const [price, setPrice] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const suppliersQuery = useQuery({
    ...trpc.material.supplierOptions.queryOptions({ currentId: material?.supplier?.id }),
    enabled: type !== "GLUE",
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

  // The suppliers that have sold this kind of material here first (paper
  // deliveries for a paper, box orders for a carton): it is almost always
  // bought from one of them. The full list is over a hundred names, so the
  // field is searchable by name.
  const suppliers = suppliersQuery.data ?? [];
  const sells = (supplier: (typeof suppliers)[number]) => (type === "BOX" ? supplier.boxes : supplier.paper);
  const usualSuppliers = suppliers.filter(sells);
  const otherSuppliers = suppliers.filter((supplier) => !sells(supplier));
  const supplierOptions: ComboboxOption[] = [
    ...(usualSuppliers.length > 0
      ? [
          {
            value: "__usual",
            label: type === "BOX" ? t("form.boxSuppliers") : t("form.paperSuppliers"),
            disabled: true,
          },
        ]
      : []),
    ...usualSuppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
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

    let fields;
    if (type === "PAPER") {
      const grammageValue = number(t("form.grammage"), grammage);
      if (grammageValue === false) return;
      fields = {
        type,
        code,
        label,
        supplierId,
        paperType: paperType === "" ? undefined : paperType,
        // Blank clears it on edit: "any grammage".
        grammage: grammageValue ?? null,
      };
    } else if (type === "BOX") {
      const length = number(t("form.length"), lengthMm);
      if (length === false) return;
      const width = number(t("form.width"), widthMm);
      if (width === false) return;
      const height = number(t("form.height"), heightMm);
      if (height === false) return;
      if (length === undefined || width === undefined || height === undefined) {
        setError(t("form.sizeRequired"));
        return;
      }
      fields = { type, code, label, supplierId, lengthMm: length, widthMm: width, heightMm: height };
    } else {
      fields = { type, code, label, defaultSlots: slots };
    }

    if (material) {
      const parsed = updateRawMaterialInput.safeParse({ id: material.id, ...fields });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? common("checkForm"));
        return;
      }
      update.mutate(parsed.data);
      return;
    }

    const amount = number(t("form.price"), price);
    if (amount === false) return;
    if (amount === undefined) {
      setError(type === "BOX" ? t("form.priceRequiredBox") : t("form.priceRequired"));
      return;
    }
    const parsed = createRawMaterialInput.safeParse({ ...fields, price: amount, comment });
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
            placeholder={
              type === "PAPER"
                ? t("form.codePlaceholder")
                : type === "BOX"
                  ? t("form.codePlaceholderBox")
                  : t("form.codePlaceholderGlue")
            }
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoFocus
            disabled={busy}
          />
          <TextField
            label={t("form.label")}
            placeholder={
              type === "PAPER"
                ? t("form.labelPlaceholder")
                : type === "BOX"
                  ? t("form.labelPlaceholderBox")
                  : t("form.labelPlaceholderGlue")
            }
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </div>

        {type !== "GLUE" && (
          <ComboboxField
            label={t("form.supplier")}
            placeholder={t("form.supplierPlaceholder")}
            searchPlaceholder={t("form.supplierSearch")}
            noMatch={(search) => t("form.supplierNoMatch", { search })}
            options={supplierOptions}
            value={supplierId}
            onChange={setSupplierId}
            disabled={busy || suppliersQuery.isPending}
          />
        )}

        {type === "PAPER" && (
          <>
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
        )}

        {type === "BOX" && (
          <>
            <div className={styles.threeUp}>
              {(
                [
                  ["length", lengthMm, setLengthMm],
                  ["width", widthMm, setWidthMm],
                  ["height", heightMm, setHeightMm],
                ] as const
              ).map(([side, value, setValue]) => (
                <TextField
                  key={side}
                  label={t(`form.${side}`)}
                  unit="mm"
                  format="numeric"
                  inputMode="decimal"
                  placeholder="—"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  autoComplete="off"
                  disabled={busy}
                />
              ))}
            </div>
            <p className={styles.note}>{t("form.sizeHint")}</p>
          </>
        )}

        {type === "GLUE" && (
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
                label={type === "BOX" ? t("form.priceBox") : t("form.price")}
                unit={unit(type)}
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
