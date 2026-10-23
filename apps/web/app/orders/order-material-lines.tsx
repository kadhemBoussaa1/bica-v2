"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import {
  MATERIAL_LINE_KEYS,
  MATERIAL_LINE_SLOTS,
  slotUsedBy,
  type MaterialLineKey,
  type OrderMaterialLineInput,
  type OrderMaterialsInput,
  type PaperType,
  type PricingSlot,
  type SlotKiloPrices,
  type TypeSac,
} from "@repo/api-contract";
import { ComboboxField, type ComboboxOption } from "@repo/ui/combobox-field";
import { TextField } from "@repo/ui/field";
import { formatDay, numberFormat } from "../../i18n/formats";
import { decimal } from "../records/decimal";
import styles from "../records/records.module.css";
import { useTRPC } from "../trpc/client";
import orderStyles from "./orders.module.css";

/*
 * The order form's four material lines — the paper and the three glues,
 * each a material from the raw material catalogue and the kilo price the
 * order is calculated with (docs/raw-material-prices-plan.md §3, §5).
 *
 * The server is never sent a catalogue price, only which one the form
 * showed (`catalog`), the stored line untouched (`keep`), or a price typed
 * over it (`manual`). What the form SHOWS is therefore exactly what the
 * save is checked against.
 */

type Outputs = inferRouterOutputs<AppRouter>;
type FormMaterial = Outputs["material"]["forOrderForm"]["materials"][number];
type StoredLine = Extract<Outputs["order"]["byId"], { orderTotal: unknown }>["materialPrices"][number];

/** What the lines need to know about the bag: which slots it uses, which paper fits. */
export interface MaterialProductKey {
  typeSac: TypeSac;
  hasHandle: boolean;
  paperType: PaperType | null;
  grammage: number;
}

/**
 * A line as the user left it. `auto` is a line nobody has touched: it shows
 * the catalogue's suggestion for the bag as it currently is — the one paper
 * that fits, a glue line's default — and follows the product while it
 * changes. `keep` is the stored line, untouched.
 */
type LineState =
  | { mode: "auto" }
  | { mode: "keep" }
  | { mode: "none" }
  | { mode: "catalog"; materialId: string }
  | { mode: "manual"; materialId: string; raw: string };

/** A line as it shows and saves. */
export interface EffectiveLine {
  key: MaterialLineKey;
  slot: PricingSlot;
  kind: "none" | "stored" | "catalog" | "manual";
  materialId: string | null;
  /** The price field's text. */
  raw: string;
  /** The price the live figures use; null when blank or not a number. */
  kiloPrice: number | null;
  stored: StoredLine | null;
  /** A stored catalogue line the catalogue has moved past. */
  stale: { current: number; saved: number } | null;
  /** When the catalogue price shown started. */
  since: Date | string | null;
  /** A manual line whose material has a catalogue price to go back to. */
  canRevert: boolean;
}

const kilo = () => numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** A paper fits a bag when its paper type matches and, if it names one, its grammage. */
function paperFits(material: FormMaterial, product: MaterialProductKey): boolean {
  return (
    material.type === "PAPER" &&
    (product.paperType === null || material.paperType === product.paperType) &&
    (material.grammage === null || material.grammage === product.grammage)
  );
}

function initialStates(stored: readonly StoredLine[]): Record<MaterialLineKey, LineState> {
  const has = (key: MaterialLineKey) => stored.some((line) => line.slot === MATERIAL_LINE_SLOTS[key]);
  return {
    paper: has("paper") ? { mode: "keep" } : { mode: "auto" },
    handleGlue: has("handleGlue") ? { mode: "keep" } : { mode: "auto" },
    sideGlue: has("sideGlue") ? { mode: "keep" } : { mode: "auto" },
    baseAdhesive: has("baseAdhesive") ? { mode: "keep" } : { mode: "auto" },
  };
}

/**
 * The lines' state and everything the form reads off it: what each shows,
 * the kilo prices for the live figures, and the payload for the save.
 *
 * `locked` is a priced order (`isPricingLocked`): its lines are the stored
 * ones, frozen, and the catalogue is not even fetched.
 */
export function useOrderMaterialLines({
  stored,
  product,
  locked,
}: {
  stored: readonly StoredLine[];
  product: MaterialProductKey | null;
  locked: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({
    ...trpc.material.forOrderForm.queryOptions(),
    enabled: !locked,
  });
  const materials = catalogQuery.data?.materials ?? [];
  const defaults = catalogQuery.data?.defaults ?? [];

  const [states, setStates] = useState(() => initialStates(stored));
  /** Lines whose catalogue price moved under a refused save, for the notice. */
  const [repriced, setRepriced] = useState<Partial<Record<MaterialLineKey, { from: number; to: number }>>>({});

  const byId = (id: string) => materials.find((material) => material.id === id) ?? null;
  const storedFor = (key: MaterialLineKey) =>
    stored.find((line) => line.slot === MATERIAL_LINE_SLOTS[key]) ?? null;
  const used = (key: MaterialLineKey) => !product || slotUsedBy(MATERIAL_LINE_SLOTS[key], product);
  /** The ids of a glue line's default glues. */
  const defaultsFor = (slot: PricingSlot) =>
    defaults.flatMap((entry) => (entry.slot === slot ? [entry.materialId] : []));

  /** The catalogue's suggestion for an untouched line. */
  function suggestion(key: MaterialLineKey): FormMaterial | null {
    const slot = MATERIAL_LINE_SLOTS[key];
    if (!used(key)) return null;
    if (slot === "PAPER") {
      if (!product) return null;
      const fits = materials.filter((material) => paperFits(material, product));
      return fits.length === 1 ? (fits[0] ?? null) : null;
    }
    // Several defaults are a choice the form does not make, like several
    // fitting papers: the line starts empty and lists them first.
    const presets = defaultsFor(slot);
    return presets.length === 1 && presets[0] ? byId(presets[0]) : null;
  }

  function effective(key: MaterialLineKey): EffectiveLine {
    const slot = MATERIAL_LINE_SLOTS[key];
    const storedLine = storedFor(key);
    const base = { key, slot, stored: storedLine, stale: null, since: null, canRevert: false };
    const none: EffectiveLine = { ...base, kind: "none", materialId: null, raw: "", kiloPrice: null };
    const catalog = (material: FormMaterial): EffectiveLine => ({
      ...base,
      kind: "catalog",
      materialId: material.id,
      raw: String(material.currentPrice.kiloPrice),
      kiloPrice: material.currentPrice.kiloPrice,
      since: material.currentPrice.validFrom,
    });

    // A priced order's lines are the stored ones, whatever the state says.
    const state: LineState = locked ? (storedLine ? { mode: "keep" } : { mode: "none" }) : states[key];
    switch (state.mode) {
      case "keep": {
        if (!storedLine) return none;
        const current = storedLine.material?.prices[0];
        const stale =
          !locked &&
          !storedLine.manual &&
          storedLine.material?.active &&
          current &&
          current.id !== storedLine.sourcePriceId
            ? { current: current.kiloPrice, saved: storedLine.kiloPrice }
            : null;
        return {
          ...base,
          kind: "stored",
          materialId: storedLine.material?.id ?? null,
          raw: String(storedLine.kiloPrice),
          kiloPrice: storedLine.kiloPrice,
          stale,
        };
      }
      case "none":
        return none;
      case "auto": {
        const material = suggestion(key);
        return material ? catalog(material) : none;
      }
      case "catalog": {
        const material = used(key) ? byId(state.materialId) : null;
        return material ? catalog(material) : none;
      }
      case "manual": {
        if (!used(key)) return none;
        const value = state.raw.trim() === "" ? Number.NaN : decimal(state.raw);
        return {
          ...base,
          kind: "manual",
          materialId: state.materialId,
          raw: state.raw,
          kiloPrice: Number.isFinite(value) && value > 0 ? value : null,
          canRevert: byId(state.materialId) !== null,
        };
      }
    }
  }

  const lines = Object.fromEntries(MATERIAL_LINE_KEYS.map((key) => [key, effective(key)])) as Record<
    MaterialLineKey,
    EffectiveLine
  >;

  const prices: SlotKiloPrices = {
    paper: lines.paper.kiloPrice,
    handleGlue: lines.handleGlue.kiloPrice,
    sideGlue: lines.sideGlue.kiloPrice,
    baseAdhesive: lines.baseAdhesive.kiloPrice,
  };

  const set = (key: MaterialLineKey, next: LineState) => {
    setStates((current) => ({ ...current, [key]: next }));
    setRepriced((current) => ({ ...current, [key]: undefined }));
  };

  /**
   * The save's `materials`, or the first line whose typed price is not a
   * price. On a priced order every line goes as stored — the server ignores
   * them there anyway.
   */
  function payload(): { ok: true; materials: OrderMaterialsInput } | { ok: false; key: MaterialLineKey } {
    const out = {} as Record<MaterialLineKey, OrderMaterialLineInput>;
    for (const key of MATERIAL_LINE_KEYS) {
      const line = lines[key];
      switch (line.kind) {
        case "none":
          out[key] = null;
          break;
        case "stored":
          out[key] = { mode: "keep" };
          break;
        case "catalog": {
          const material = line.materialId ? byId(line.materialId) : null;
          out[key] = material
            ? { mode: "catalog", materialId: material.id, priceId: material.currentPrice.id }
            : null;
          break;
        }
        case "manual":
          if (line.kiloPrice === null || line.materialId === null) return { ok: false, key };
          out[key] = { mode: "manual", materialId: line.materialId, kiloPrice: line.kiloPrice };
          break;
      }
    }
    return { ok: true, materials: out };
  }

  /**
   * After a save refused with CONFLICT: re-reads the catalogue, so every
   * catalogue line shows (and next sends) the price that is current now,
   * and notes which ones moved. True when one did — otherwise the conflict
   * was something else (a taken order number) and the caller says so.
   */
  async function reloadAfterConflict(): Promise<boolean> {
    const shown = MATERIAL_LINE_KEYS.flatMap((key) => {
      const line = lines[key];
      return line.kind === "catalog" && line.materialId && line.kiloPrice !== null
        ? [{ key, materialId: line.materialId, kiloPrice: line.kiloPrice }]
        : [];
    });
    const fresh = await queryClient.fetchQuery({
      ...trpc.material.forOrderForm.queryOptions(),
      staleTime: 0,
    });
    const moved: Partial<Record<MaterialLineKey, { from: number; to: number }>> = {};
    for (const entry of shown) {
      const now = fresh.materials.find((material) => material.id === entry.materialId);
      if (now && now.currentPrice.kiloPrice !== entry.kiloPrice) {
        moved[entry.key] = { from: entry.kiloPrice, to: now.currentPrice.kiloPrice };
      }
    }
    setRepriced(moved);
    return Object.keys(moved).length > 0;
  }

  return {
    locked,
    lines,
    prices,
    repriced,
    materials,
    defaultsFor,
    catalogLoading: !locked && catalogQuery.isPending,
    catalogEmpty: !locked && catalogQuery.isSuccess && materials.length === 0,
    used,
    payload,
    reloadAfterConflict,
    /** Picks a material ("" = no line): its catalogue price, until typed over. */
    choose: (key: MaterialLineKey, materialId: string) =>
      set(key, materialId === "" ? { mode: "none" } : { mode: "catalog", materialId }),
    /** Types a price over the line's material: a manual line. */
    type: (key: MaterialLineKey, raw: string) => {
      const materialId = lines[key].materialId;
      if (materialId) set(key, { mode: "manual", materialId, raw });
    },
    /** Back to the material's current catalogue price — a stale or a manual line. */
    useCatalog: (key: MaterialLineKey) => {
      const materialId = lines[key].materialId;
      if (materialId) set(key, { mode: "catalog", materialId });
    },
  };
}

export type OrderMaterialLines = ReturnType<typeof useOrderMaterialLines>;

/**
 * One line's fields: the material, its kilo price, and one line under them
 * saying where the price comes from — with the action that changes that.
 */
export function MaterialLineFields({
  lines,
  line,
  product,
  label,
  priceLabel,
  disabled,
  error,
}: {
  lines: OrderMaterialLines;
  line: EffectiveLine;
  product: MaterialProductKey | null;
  label: string;
  priceLabel: string;
  disabled: boolean;
  error?: string;
}) {
  const t = useTranslations("orders");
  const isPaper = line.slot === "PAPER";
  const kinds = lines.materials.filter((material) => material.type === (isPaper ? "PAPER" : "GLUE"));
  // Named by code, the one name that tells two glues of one brand apart; the
  // label and supplier are still found by the search. The price shows in
  // the field beside it.
  const option = (material: FormMaterial): ComboboxOption => ({
    value: material.id,
    label: material.code,
    keywords: [material.label, material.supplier?.name].filter(Boolean).join(" "),
  });

  // Papers that fit the bag first, and a glue line's default glues; the
  // others stay reachable below a rule, for the job that really is made
  // with something else.
  const lineDefaults = isPaper ? [] : lines.defaultsFor(line.slot);
  const preferred =
    isPaper && product
      ? (material: FormMaterial) => paperFits(material, product)
      : lineDefaults.length > 0
        ? (material: FormMaterial) => lineDefaults.includes(material.id)
        : null;
  const fitting = preferred ? kinds.filter(preferred) : kinds;
  const others = preferred ? kinds.filter((material) => !preferred(material)) : [];
  const options: ComboboxOption[] = [
    ...fitting.map(option),
    ...(others.length > 0
      ? [{ value: "__others", label: t(isPaper ? "lines.otherPapers" : "lines.otherGlues"), disabled: true }]
      : []),
    ...others.map(option),
  ];
  // The stored line's own material when the catalogue no longer offers it
  // (archived), and a line from before the catalogue, which names none.
  const storedMaterial = line.stored?.material;
  if (line.kind === "stored" && storedMaterial && !kinds.some((material) => material.id === storedMaterial.id)) {
    options.push({
      value: storedMaterial.id,
      label: t("lines.archived", { label: storedMaterial.code }),
      keywords: storedMaterial.label,
    });
  }
  if (line.kind === "stored" && !storedMaterial) {
    options.push({ value: "__carried", label: t("lines.carried"), disabled: true });
  }
  const value = line.kind === "stored" && !storedMaterial ? "__carried" : (line.materialId ?? "");

  const repriced = lines.repriced[line.key];
  const stored = line.stored;

  return (
    <>
      <ComboboxField
        label={label}
        value={value}
        options={options}
        onChange={(materialId) => lines.choose(line.key, materialId)}
        allowEmpty
        placeholder={t("lines.none")}
        searchPlaceholder={t("lines.searchMaterial")}
        noMatch={(search) => t("form.noMatch", { search })}
        disabled={disabled || lines.catalogLoading}
      />
      <div className={orderStyles.linePrice}>
        <TextField
          label={priceLabel}
          unit="/kg"
          error={error}
          format="numeric"
          inputMode="decimal"
          value={line.raw}
          onChange={(event) => lines.type(line.key, event.target.value)}
          autoComplete="off"
          // A price is typed over a material: no material, nothing to type over.
          disabled={disabled || line.materialId === null}
        />
        <p className={[styles.hint, orderStyles.lineSource].filter(Boolean).join(" ")}>
          {repriced ? (
            <span className={orderStyles.lineWarn}>
              {t("lines.repriced", { from: kilo().format(repriced.from), to: kilo().format(repriced.to) })}
            </span>
          ) : line.stale ? (
            <>
              <span className={orderStyles.lineWarn}>
                {t("lines.stale", {
                  current: kilo().format(line.stale.current),
                  saved: kilo().format(line.stale.saved),
                })}
              </span>{" "}
              {!disabled && (
                <button type="button" className={orderStyles.lineAction} onClick={() => lines.useCatalog(line.key)}>
                  {t("lines.useCurrent")}
                </button>
              )}
            </>
          ) : line.kind === "catalog" ? (
            line.since ? t("lines.fromCatalogue", { date: formatDay(line.since) }) : null
          ) : line.kind === "manual" ? (
            <>
              {t("lines.manual")}
              {line.canRevert && !disabled && (
                <>
                  {" · "}
                  <button type="button" className={orderStyles.lineAction} onClick={() => lines.useCatalog(line.key)}>
                    {t("lines.backToCatalogue")}
                  </button>
                </>
              )}
            </>
          ) : line.kind === "stored" && stored ? (
            stored.material === null ? (
              // Moving it onto the catalogue is only possible while the
              // pricing is open; a locked line just says what it is.
              lines.locked ? t("lines.carried") : t("lines.savedCarried")
            ) : stored.manual ? (
              t("lines.savedManual")
            ) : (
              t("lines.savedCatalogue")
            )
          ) : null}
        </p>
      </div>
    </>
  );
}
