import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import type { PaperType, PricingSlot, RawMaterialType } from "@repo/api-contract";
import { numberFormat } from "../../../i18n/formats";
import records from "../../records/records.module.css";

/*
 * Shared pieces of the material price catalogue: the table, the detail and
 * the two form dialogs describe a material the same way.
 */

type Outputs = inferRouterOutputs<AppRouter>["material"];
export type MaterialRow = Outputs["list"]["rows"][number];
export type MaterialDetail = Outputs["byId"];

/**
 * A material price, per kilogram or per carton: two decimals, up to four
 * when the millimes are there ("0,61", "4,215").
 */
export function formatPrice(value: number): string {
  return numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}

/** A grammage or a carton side: whole numbers, one decimal when there is one. */
function formatMeasure(value: number): string {
  return numberFormat({ maximumFractionDigits: 1 }).format(value);
}

/**
 * A carton's size as it reads on the supplier's documents, length first:
 * "400 × 300 × 400". The caller adds the unit. Shared with the products page
 * and the order form, so a carton reads the same everywhere.
 */
export function formatCartonSize(carton: {
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
}): string {
  return [carton.lengthMm, carton.widthMm, carton.heightMm]
    .map((side) => (side === null ? "—" : formatMeasure(side)))
    .join(" × ");
}

/** What a price is per, after the figure: "/kg" for a paper or a glue, "/carton" for a box. */
export function usePriceUnit() {
  const t = useTranslations("materials");
  return (type: RawMaterialType): string => t(type === "BOX" ? "unit.box" : "unit.kg");
}

/** Papier / Colle / Carton, as a pill: kraft orange for paper, blue for a carton, neutral for glue. */
export function MaterialTypeBadge({ type }: { type: RawMaterialType }) {
  const enums = useTranslations("enums");
  const tone =
    type === "PAPER" ? records.statusActive : type === "BOX" ? records.statusInfo : records.statusNeutral;
  return (
    <span className={[records.statusBadge, tone].filter(Boolean).join(" ")}>
      {enums(`rawMaterialType.${type}`)}
    </span>
  );
}

/**
 * What a material is, in one line: a paper's paper type and grammage
 * ("Papier kraft · 80 g/m²", or "· tous grammages"), a carton's size
 * ("400 × 300 × 400 mm"), a glue's default order lines ("Colle de côté,
 * Colle de fond").
 */
export function useMaterialUse() {
  const t = useTranslations("materials");
  const enums = useTranslations("enums");
  return (material: {
    type: RawMaterialType;
    paperType: PaperType | null;
    grammage: number | null;
    lengthMm: number | null;
    widthMm: number | null;
    heightMm: number | null;
    defaults: readonly { slot: PricingSlot }[];
  }): string => {
    if (material.type === "BOX") return t("size", { size: formatCartonSize(material) });
    if (material.type === "PAPER") {
      const paper = material.paperType ? enums(`paperType.${material.paperType}`) : "—";
      const grammage =
        material.grammage === null
          ? t("anyGrammage")
          : t("grammage", { grammage: formatMeasure(material.grammage) });
      return `${paper} · ${grammage}`;
    }
    return material.defaults.length === 0
      ? t("noDefault")
      : material.defaults.map((line) => enums(`pricingSlot.${line.slot}`)).join(", ");
  };
}

/** A tRPC error's code ("CONFLICT"), or null for anything else. */
export function errorCode(cause: unknown): string | null {
  const data = (cause as { data?: { code?: unknown } | null } | null)?.data;
  return typeof data?.code === "string" ? data.code : null;
}
