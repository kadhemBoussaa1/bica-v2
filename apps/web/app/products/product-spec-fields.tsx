"use client";

import { useTranslations } from "next-intl";
import { PAPER_TYPES, TYPE_SACS } from "@repo/api-contract";
import { CheckboxField, SelectField, TextField } from "@repo/ui/field";
import styles from "../records/records.module.css";

/**
 * The bag/sheet specification fields, shared by the standalone product form
 * and the order form's inline "new product" section — the same fields, the
 * same rules, so the two can never validate a spec differently.
 *
 * Takes the parent's string-state getters/setters rather than owning state
 * itself: both callers already hold their numeric fields as strings (an empty
 * input has no numeric value, and coercing "" to 0 would claim a real
 * measurement of zero — see the convention note on `order-form.tsx`), and a
 * shared component that owned its own state would need to lift it right back
 * out to the parent for `safeParse`.
 */
export interface ProductSpecFieldsProps {
  typeSac: string;
  setTypeSac: (value: string) => void;
  widthCm: string;
  setWidthCm: (value: string) => void;
  lengthCm: string;
  setLengthCm: (value: string) => void;
  gussetCm: string;
  setGussetCm: (value: string) => void;
  pleatWidthCm: string;
  setPleatWidthCm: (value: string) => void;
  pleatLengthCm: string;
  setPleatLengthCm: (value: string) => void;
  grammage: string;
  setGrammage: (value: string) => void;
  paperType: string;
  setPaperType: (value: string) => void;
  hasHandle: boolean;
  setHasHandle: (value: boolean) => void;
  handleWeightG: string;
  setHandleWeightG: (value: string) => void;
  disabled?: boolean;
}

export function ProductSpecFields({
  typeSac,
  setTypeSac,
  widthCm,
  setWidthCm,
  lengthCm,
  setLengthCm,
  gussetCm,
  setGussetCm,
  pleatWidthCm,
  setPleatWidthCm,
  pleatLengthCm,
  setPleatLengthCm,
  grammage,
  setGrammage,
  paperType,
  setPaperType,
  hasHandle,
  setHasHandle,
  handleWeightG,
  setHandleWeightG,
  disabled = false,
}: ProductSpecFieldsProps) {
  const t = useTranslations("products");
  const enums = useTranslations("enums");
  const isSheet = typeSac === "SOUS_PLAT";

  return (
    <>
      <SelectField
        label={t("spec.bagType")}
        value={typeSac}
        onChange={(e) => {
          const next = e.target.value;
          setTypeSac(next);
          // A sheet has no gusset, pleats or handle — see
          // `normaliseProductSpec`, the same rule the server enforces.
          // Resetting here means switching to SOUS_PLAT cannot leave stale
          // values behind that the server would then reject.
          if (next === "SOUS_PLAT") {
            setGussetCm("");
            setPleatWidthCm("");
            setPleatLengthCm("");
            setHasHandle(false);
            setHandleWeightG("");
          }
        }}
        disabled={disabled}
        allowEmpty
        placeholder={t("spec.chooseType")}
        options={TYPE_SACS.map((v) => ({ value: v, label: enums(`typeSac.${v}`) }))}
      />
      <TextField
        label={t("spec.width")}
        unit="cm"
        format="numeric"
        value={widthCm}
        onChange={(e) => setWidthCm(e.target.value)}
        autoComplete="off"
        disabled={disabled}
      />
      <TextField
        label={t("spec.length")}
        unit="cm"
        format="numeric"
        value={lengthCm}
        onChange={(e) => setLengthCm(e.target.value)}
        autoComplete="off"
        disabled={disabled}
      />
      {!isSheet && (
        <>
          <TextField
            label={t("spec.gusset")}
            unit="cm"
            format="numeric"
            value={gussetCm}
            onChange={(e) => setGussetCm(e.target.value)}
            autoComplete="off"
            disabled={disabled}
          />
          <TextField
            label={t("spec.foldWidth")}
            unit="cm"
            format="numeric"
            value={pleatWidthCm}
            onChange={(e) => setPleatWidthCm(e.target.value)}
            autoComplete="off"
            disabled={disabled}
          />
          <TextField
            label={t("spec.foldLength")}
            unit="cm"
            format="numeric"
            value={pleatLengthCm}
            onChange={(e) => setPleatLengthCm(e.target.value)}
            autoComplete="off"
            disabled={disabled}
          />
        </>
      )}
      <TextField
        label={t("spec.grammage")}
        unit="g/m²"
        format="numeric"
        value={grammage}
        onChange={(e) => setGrammage(e.target.value)}
        autoComplete="off"
        disabled={disabled}
      />
      <SelectField
        label={t("spec.paper")}
        value={paperType}
        onChange={(e) => setPaperType(e.target.value)}
        disabled={disabled}
        allowEmpty
        placeholder={t("spec.notSet")}
        options={PAPER_TYPES.map((v) => ({ value: v, label: enums(`paperType.${v}`) }))}
      />
      {!isSheet && (
        <div className={styles.formWide}>
          <CheckboxField
            label={t("spec.hasHandle")}
            checked={hasHandle}
            onChange={(e) => {
              setHasHandle(e.target.checked);
              if (!e.target.checked) setHandleWeightG("");
            }}
            disabled={disabled}
          />
        </div>
      )}
      {!isSheet && hasHandle && (
        <TextField
          label={t("spec.handleWeight")}
          unit="g"
          format="numeric"
          value={handleWeightG}
          onChange={(e) => setHandleWeightG(e.target.value)}
          autoComplete="off"
          disabled={disabled}
        />
      )}
    </>
  );
}
