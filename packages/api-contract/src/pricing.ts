import { z } from "zod";
import { PAPER_TYPES, QUANTITY_UNITS, TYPE_SACS, type TypeSac } from "./orders.js";

/**
 * The bag calculator: dimensions and pricing for the three bag types.
 *
 * This module is the single implementation of the formulas. The order form
 * calls it to show figures live as the user types, and the API calls the same
 * functions when saving, so the two can never disagree. It has no dependency on
 * Prisma or the network — everything here is a pure function of its arguments,
 * which is also what lets it be checked against the 253 priced legacy orders.
 *
 * Units, fixed throughout:
 *   - dimensions in centimetres
 *   - grammage in g/m²
 *   - weights in grams
 *   - paper and glue prices per kilogram
 *   - margins as percentages, so 2 means 2%
 *
 * Verified against the legacy database (see docs/legacy-migration.md): with
 * these formulas the stored unit price reproduces exactly on every FOND_CARRE
 * and FOND_V order, and the stored parcel price on every order that had one.
 */

// ---------------------------------------------------------------------------
// Product specification
// ---------------------------------------------------------------------------

export interface ProductSpec {
  typeSac: TypeSac;
  /** Bag width, cm. */
  widthCm: number;
  /** Bag length (height), cm. */
  lengthCm: number;
  /** Side gusset, cm. Required for FOND types (may be 0), absent for SOUS_PLAT. */
  gussetCm: number | null;
  pleatWidthCm: number | null;
  pleatLengthCm: number | null;
  /** Paper weight, g/m². */
  grammage: number;
  /**
   * Whether this bag has handles. Decided per product, not per type: a
   * FOND_CARRE is made with or without depending on what the client ordered.
   */
  hasHandle: boolean;
  /** Weight of the handles, grams. Only read when `hasHandle`. */
  handleWeightG: number | null;
}

export interface ProductDimensions {
  /** Paper reel width needed to make the bag ("laize"), cm. */
  productionWidthCm: number;
  /** Length cut from the reel per bag, cm. */
  cuttingLengthCm: number;
  /** Paper in one bag, grams. */
  paperWeightG: number;
  /** Handle weight counted, grams — 0 when the bag has no handle. */
  handleWeightG: number;
  /** Total weight of one finished bag, grams. */
  unitWeightG: number;
}

/**
 * Production width, cutting length and unit weight for a specification.
 *
 * The per-type formulas, with w = width, s = gusset, L = length:
 *   FOND_CARRE  width = (w + s) × 2 + pleat width;  length = L + s/2 + pleat length
 *   FOND_V      width = (w + s) × 2 + pleat width;  length = L + pleat length
 *   SOUS_PLAT   width = w;                          length = L
 *
 * Paper weight = width × length × grammage / 10000 — the division converts cm²
 * to m², which is what grammage is per. A 28×30×16 bag is 17 g with it and
 * 168 kg without.
 */
export function computeDimensions(spec: ProductSpec): ProductDimensions {
  const w = spec.widthCm;
  const L = spec.lengthCm;
  const s = spec.gussetCm ?? 0;
  const pleatW = spec.pleatWidthCm ?? 0;
  const pleatL = spec.pleatLengthCm ?? 0;

  let productionWidthCm: number;
  let cuttingLengthCm: number;

  switch (spec.typeSac) {
    case "FOND_CARRE":
      productionWidthCm = (w + s) * 2 + pleatW;
      cuttingLengthCm = L + s / 2 + pleatL;
      break;
    case "FOND_V":
      productionWidthCm = (w + s) * 2 + pleatW;
      cuttingLengthCm = L + pleatL;
      break;
    case "SOUS_PLAT":
      productionWidthCm = w;
      cuttingLengthCm = L;
      break;
  }

  const paperWeightG = (productionWidthCm * cuttingLengthCm * spec.grammage) / 10000;
  const handleWeightG = spec.hasHandle ? (spec.handleWeightG ?? 0) : 0;

  return {
    productionWidthCm,
    cuttingLengthCm,
    paperWeightG,
    handleWeightG,
    unitWeightG: paperWeightG + handleWeightG,
  };
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * What one "unit" of the order is. FOND bags are ordered and priced per piece.
 * SOUS_PLAT sheets are ordered and priced per kilogram: the client asks for so
 * many kilos, and the unit price is simply the paper's kilo price.
 */
export type QuantityUnit = (typeof QUANTITY_UNITS)[number];

export function quantityUnitFor(typeSac: TypeSac): QuantityUnit {
  return typeSac === "SOUS_PLAT" ? "KILOGRAMS" : "PIECES";
}

/** One glue: what a kilogram costs and how many grams a bag uses. */
export interface GlueLine {
  kiloPrice: number | null;
  weightG: number | null;
}

export interface PricingInputs {
  /** Price of the paper, per kilogram. Nothing can be priced without it. */
  paperKiloPrice: number | null;
  /** Percent. Null means 0. */
  profitMarginPct: number | null;
  /** Percent. Null means 0. */
  lossMarginPct: number | null;

  /** Only counted when the product has a handle. */
  handleGlue: GlueLine;
  sideGlue: GlueLine;
  baseAdhesive: GlueLine;
  /**
   * Migrated orders only. The old system recorded glue as a cost per bag, not a
   * weight and a kilo price, so that cost is carried here as a fallback: it is
   * used only while all three glue lines above are blank, and is replaced (not
   * added to) the moment any of them is filled in. Not a form field — see
   * `toPricingInputs`.
   */
  legacyGlueCostPerUnit: number | null;

  /** Pieces, or kilograms for SOUS_PLAT — see `quantityUnitFor`. */
  quantity: number | null;
  /** How many pieces go in one parcel. FOND types. */
  piecesPerParcel: number | null;
  /** How many kilograms go in one parcel. SOUS_PLAT. */
  kilosPerParcel: number | null;
  /** Cost of the parcel itself (the carton). */
  parcelPrice: number | null;
  /** Transport, per parcel. */
  transportCost: number | null;
}

export interface PricingFigures {
  quantityUnit: QuantityUnit;
  dimensions: ProductDimensions;

  /** One unit at the paper price, before margins: kilo price / 1000 × unit weight. */
  unitPrice: number | null;
  /** After profit and loss margins, applied multiplicatively. */
  unitPriceWithMargins: number | null;
  /** Glue per unit. Always a number; 0 when there is none. */
  glueCostPerUnit: number;
  /** Unit with margins plus glue — what one unit is sold for. */
  finalUnitPrice: number | null;

  /** Pieces or kilograms in one parcel, per `quantityUnit`. */
  unitsPerParcel: number | null;
  /** Parcel contents at the final unit price. */
  baseParcelPrice: number | null;
  /** Base plus carton plus transport — what one parcel is sold for. */
  finalParcelPrice: number | null;

  /** Order quantity divided by units per parcel. Fractional if it does not divide. */
  parcelCount: number | null;
  /** Parcel count × final parcel price. */
  orderTotal: number | null;

  /**
   * Metres of reel the order needs at `dimensions.productionWidthCm` — see
   * `computeMetrageNecessaire`. Null when the quantity is blank or the
   * product has no grammage (a SOUS_PLAT need cannot be converted from kg).
   */
  metrageNecessaire: number | null;
}

/**
 * Length of paper an order consumes, in metres, at the production width.
 *
 * Every unit takes `cuttingLengthCm` off the reel:
 *   FOND_*    pieces = quantity
 *   SOUS_PLAT pieces = quantity (kg) × 1000 / paperWeightG   (sheets)
 *   metres    = pieces × cuttingLengthCm / 100
 *
 * `paperWeightG`, not `unitWeightG`: a handle's weight is not paper. The
 * loss margin is a pricing figure and is deliberately NOT applied here —
 * the warehouse allocates against the raw need and decides its own slack.
 * Null rather than 0 or Infinity when the sheet weighs nothing, which is
 * what a product with grammage 0 gives (11 migrated products).
 */
export function computeMetrageNecessaire(
  dimensions: Pick<ProductDimensions, "cuttingLengthCm" | "paperWeightG">,
  quantityUnit: QuantityUnit,
  quantity: number | null,
): number | null {
  const qty = positive(quantity);
  if (qty === null) return null;
  const pieces =
    quantityUnit === "KILOGRAMS"
      ? dimensions.paperWeightG > 0
        ? (qty * 1000) / dimensions.paperWeightG
        : null
      : qty;
  if (pieces === null) return null;
  return (pieces * dimensions.cuttingLengthCm) / 100;
}

/** Positive finite number, else null — so a blank or zero input propagates as "not set". */
function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function glueCost(line: GlueLine): number {
  const kilo = positive(line.kiloPrice);
  const grams = positive(line.weightG);
  return kilo !== null && grams !== null ? (kilo / 1000) * grams : 0;
}

/**
 * Prices an order. Every figure is null when an input it needs is missing,
 * rather than 0 or NaN: a blank paper price means "not priced yet", not free.
 *
 * FOND_CARRE and FOND_V, per piece:
 *   unit price            = paper kilo price / 1000 × unit weight (g)
 *   with margins          = unit price × (1 + profit/100) × (1 + loss/100)
 *   glue per piece        = Σ over glue lines of kilo price / 1000 × grams
 *                           (handle glue only when the bag has a handle)
 *   final unit price      = with margins + glue
 *   base parcel price     = pieces per parcel × final unit price
 *   final parcel price    = base + carton + transport
 *   order total           = (quantity / pieces per parcel) × final parcel price
 *
 * SOUS_PLAT, per kilogram:
 *   unit price            = paper kilo price
 *   with margins          = same margins as above
 *   final unit price      = with margins (no glue on a flat sheet)
 *   base parcel price     = kilos per parcel × final unit price
 *   final parcel, total   = as above, with quantity in kilograms
 *
 * The margins are multiplicative because that is how the business applies them
 * and what the legacy data confirms on every row. The additive alternative,
 * × (1 + (profit + loss)/100), gives a slightly lower figure and was never used.
 */
export function priceOrder(spec: ProductSpec, inputs: PricingInputs): PricingFigures {
  const quantityUnit = quantityUnitFor(spec.typeSac);
  const dimensions = computeDimensions(spec);
  const perKilo = quantityUnit === "KILOGRAMS";

  const paperKiloPrice = positive(inputs.paperKiloPrice);
  const profit = 1 + (inputs.profitMarginPct ?? 0) / 100;
  const loss = 1 + (inputs.lossMarginPct ?? 0) / 100;

  const unitPrice =
    paperKiloPrice === null
      ? null
      : perKilo
        ? paperKiloPrice
        : (paperKiloPrice / 1000) * dimensions.unitWeightG;

  const unitPriceWithMargins = unitPrice === null ? null : unitPrice * profit * loss;

  // A sheet is not glued. The legacy carry-over still applies to either kind,
  // because one migrated SOUS_PLAT order did record a glue cost.
  //
  // Fallback, not additive: a migrated order's legacy glue cost is only used
  // when none of the three new glue lines are filled in. The moment a real
  // line is entered, it replaces the legacy figure rather than adding to it —
  // otherwise editing a legacy order's glue would double-count it.
  const newGlue = perKilo
    ? 0
    : (spec.hasHandle ? glueCost(inputs.handleGlue) : 0) +
      glueCost(inputs.sideGlue) +
      glueCost(inputs.baseAdhesive);
  const glueCostPerUnit = newGlue > 0 ? newGlue : (positive(inputs.legacyGlueCostPerUnit) ?? 0);

  const finalUnitPrice =
    unitPriceWithMargins === null ? null : unitPriceWithMargins + glueCostPerUnit;

  const unitsPerParcel = positive(perKilo ? inputs.kilosPerParcel : inputs.piecesPerParcel);

  const baseParcelPrice =
    finalUnitPrice === null || unitsPerParcel === null
      ? null
      : unitsPerParcel * finalUnitPrice;

  const finalParcelPrice =
    baseParcelPrice === null
      ? null
      : baseParcelPrice + (positive(inputs.parcelPrice) ?? 0) + (positive(inputs.transportCost) ?? 0);

  const quantity = positive(inputs.quantity);
  const parcelCount =
    quantity === null || unitsPerParcel === null ? null : quantity / unitsPerParcel;

  const orderTotal =
    parcelCount === null || finalParcelPrice === null ? null : parcelCount * finalParcelPrice;

  const metrageNecessaire = computeMetrageNecessaire(dimensions, quantityUnit, quantity);

  return {
    quantityUnit,
    dimensions,
    metrageNecessaire,
    unitPrice,
    unitPriceWithMargins,
    glueCostPerUnit,
    finalUnitPrice,
    unitsPerParcel,
    baseParcelPrice,
    finalParcelPrice,
    parcelCount,
    orderTotal,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    });

/** A dimension in cm. Bags are not 10 m wide. */
const dimension = z.number().min(0, "Cannot be negative").max(1000);
const optionalDimension = dimension.optional();

/**
 * The product specification as the form submits it: one flat object for every
 * type, with the per-type rules enforced below so the message names the field
 * and the type ("Gusset is required for a FOND_CARRE bag").
 *
 * A discriminated union would be stricter at the type level, but the form holds
 * one flat state whatever the type, and the rules here are the same ones the
 * engine relies on — a SOUS_PLAT never reads its gusset, so it must not have one.
 */
export const productSpecInput = z
  .object({
    name: optionalText(200),
    typeSac: z.enum(TYPE_SACS),
    widthCm: z.number().positive("Width is required").max(1000),
    lengthCm: z.number().positive("Length is required").max(1000),
    gussetCm: optionalDimension,
    pleatWidthCm: optionalDimension,
    pleatLengthCm: optionalDimension,
    grammage: z.number().positive("Grammage is required").max(2000),
    paperType: z.enum(PAPER_TYPES).optional(),
    hasHandle: z.boolean().default(false),
    handleWeightG: z.number().min(0).max(1000).optional(),
  })
  .superRefine((spec, ctx) => {
    if (spec.typeSac === "SOUS_PLAT") {
      // A flat sheet: none of the bag-only fields may carry a value. Zero is
      // tolerated because that is what a cleared numeric input often submits.
      const forbidden: [keyof typeof spec, number | undefined][] = [
        ["gussetCm", spec.gussetCm],
        ["pleatWidthCm", spec.pleatWidthCm],
        ["pleatLengthCm", spec.pleatLengthCm],
      ];
      for (const [field, value] of forbidden) {
        if (value !== undefined && value !== 0) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: "A SOUS_PLAT sheet has no gusset or pleats",
          });
        }
      }
      if (spec.hasHandle) {
        ctx.addIssue({
          code: "custom",
          path: ["hasHandle"],
          message: "A SOUS_PLAT sheet has no handles",
        });
      }
      return;
    }

    if (spec.gussetCm === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["gussetCm"],
        message: `Gusset is required for a ${spec.typeSac} bag (enter 0 if it has none)`,
      });
    }
    if (spec.hasHandle && !(spec.handleWeightG !== undefined && spec.handleWeightG > 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["handleWeightG"],
        message: "Enter the handle weight, or untick 'has handle'",
      });
    }
  });

export type ProductSpecInput = z.infer<typeof productSpecInput>;

/** Non-negative price or weight; blank is "not set". */
const amount = z.number().min(0, "Cannot be negative").max(1e9).optional();

const glueLineInput = z.object({
  kiloPrice: amount,
  weightG: z.number().min(0).max(10000).optional(),
});

/**
 * Pricing inputs as the form submits them. Everything optional: a quote can be
 * saved half-filled, and the engine returns null figures for what is missing.
 * The legacy data has a profit margin of 100% on one order, so the ceiling is
 * generous; loss is a wastage rate and is capped at 100.
 *
 * Deliberately has NO `legacyGlueCostPerUnit` field: that value exists only on
 * migrated rows, is never entered by a user, and must not be settable through
 * an order create/update payload (there would be nothing stopping a client
 * from inventing or overwriting it). The server reads it from the stored row
 * and passes it to `toPricingInputs` as an explicit argument instead.
 */
export const pricingInput = z.object({
  paperKiloPrice: amount,
  profitMarginPct: z.number().min(0).max(1000).optional(),
  lossMarginPct: z.number().min(0).max(100).optional(),
  handleGlue: glueLineInput.default({}),
  sideGlue: glueLineInput.default({}),
  baseAdhesive: glueLineInput.default({}),
  piecesPerParcel: z.number().min(0).max(1e7).optional(),
  kilosPerParcel: z.number().min(0).max(1e7).optional(),
  parcelPrice: amount,
  transportCost: amount,
});

export type PricingInput = z.infer<typeof pricingInput>;

/** Adapts the optional-field form shape to the engine's nullable inputs. */
export function toProductSpec(input: ProductSpecInput): ProductSpec {
  return {
    typeSac: input.typeSac,
    widthCm: input.widthCm,
    lengthCm: input.lengthCm,
    gussetCm: input.gussetCm ?? null,
    pleatWidthCm: input.pleatWidthCm ?? null,
    pleatLengthCm: input.pleatLengthCm ?? null,
    grammage: input.grammage,
    hasHandle: input.hasHandle,
    handleWeightG: input.handleWeightG ?? null,
  };
}

/**
 * `legacyGlueCostPerUnit` is not part of `PricingInput` (see the doc comment on
 * `pricingInput`) — the caller passes it explicitly, sourced from the stored
 * `Order` row rather than from user input. Pass `null` for a new order.
 */
export function toPricingInputs(
  input: PricingInput,
  quantity: number | null,
  legacyGlueCostPerUnit: number | null,
): PricingInputs {
  const line = (glue: { kiloPrice?: number; weightG?: number }): GlueLine => ({
    kiloPrice: glue.kiloPrice ?? null,
    weightG: glue.weightG ?? null,
  });
  return {
    paperKiloPrice: input.paperKiloPrice ?? null,
    profitMarginPct: input.profitMarginPct ?? null,
    lossMarginPct: input.lossMarginPct ?? null,
    handleGlue: line(input.handleGlue),
    sideGlue: line(input.sideGlue),
    baseAdhesive: line(input.baseAdhesive),
    legacyGlueCostPerUnit,
    quantity,
    piecesPerParcel: input.piecesPerParcel ?? null,
    kilosPerParcel: input.kilosPerParcel ?? null,
    parcelPrice: input.parcelPrice ?? null,
    transportCost: input.transportCost ?? null,
  };
}

/**
 * The flat `Order` columns `pricingInputsFromRow` reads. A structural type
 * rather than the generated Prisma row, so this package stays free of a Prisma
 * dependency (see the module comment) while still matching whatever row shape
 * the API selects, as long as it has these fields.
 */
export interface PricingInputRow {
  paperKiloPrice: number | null;
  profitMarginPct: number | null;
  lossMarginPct: number | null;
  handleGlueKiloPrice: number | null;
  handleGlueWeightG: number | null;
  sideGlueKiloPrice: number | null;
  sideGlueWeightG: number | null;
  baseAdhesiveKiloPrice: number | null;
  baseAdhesiveWeightG: number | null;
  legacyGlueCostPerUnit: number | null;
  piecesPerParcel: number | null;
  kilosPerParcel: number | null;
  parcelPrice: number | null;
  transportCost: number | null;
}

/**
 * Builds `PricingInputs` straight from a stored `Order` row, where the three
 * glue lines are six flat columns rather than the form's nested shape. Used by
 * the verifier and by the edit form's initial state — anywhere that starts
 * from a saved order rather than from a freshly parsed submission.
 */
export function pricingInputsFromRow(row: PricingInputRow, quantity: number | null): PricingInputs {
  return {
    paperKiloPrice: row.paperKiloPrice,
    profitMarginPct: row.profitMarginPct,
    lossMarginPct: row.lossMarginPct,
    handleGlue: { kiloPrice: row.handleGlueKiloPrice, weightG: row.handleGlueWeightG },
    sideGlue: { kiloPrice: row.sideGlueKiloPrice, weightG: row.sideGlueWeightG },
    baseAdhesive: { kiloPrice: row.baseAdhesiveKiloPrice, weightG: row.baseAdhesiveWeightG },
    legacyGlueCostPerUnit: row.legacyGlueCostPerUnit,
    quantity,
    piecesPerParcel: row.piecesPerParcel,
    kilosPerParcel: row.kilosPerParcel,
    parcelPrice: row.parcelPrice,
    transportCost: row.transportCost,
  };
}
