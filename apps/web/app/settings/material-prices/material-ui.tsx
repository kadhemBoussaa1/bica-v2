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

/** A kilo price: two decimals, up to four when the millimes are there ("0,61", "4,215"). */
export function formatKiloPrice(value: number): string {
  return numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}

function formatGrammage(value: number): string {
  return numberFormat({ maximumFractionDigits: 1 }).format(value);
}

/** Papier / Colle, as a pill: kraft orange for paper, neutral for glue. */
export function MaterialTypeBadge({ type }: { type: RawMaterialType }) {
  const enums = useTranslations("enums");
  return (
    <span
      className={[records.statusBadge, type === "PAPER" ? records.statusActive : records.statusNeutral]
        .filter(Boolean)
        .join(" ")}
    >
      {enums(`rawMaterialType.${type}`)}
    </span>
  );
}

/**
 * What a material is used for, in one line: a paper's paper type and
 * grammage ("Papier kraft · 80 g/m²", or "· tous grammages"), a glue's
 * default order lines ("Colle de côté, Colle de fond").
 */
export function useMaterialUse() {
  const t = useTranslations("materials");
  const enums = useTranslations("enums");
  return (material: {
    type: RawMaterialType;
    paperType: PaperType | null;
    grammage: number | null;
    defaults: readonly { slot: PricingSlot }[];
  }): string => {
    if (material.type === "PAPER") {
      const paper = material.paperType ? enums(`paperType.${material.paperType}`) : "—";
      const grammage =
        material.grammage === null
          ? t("anyGrammage")
          : t("grammage", { grammage: formatGrammage(material.grammage) });
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
