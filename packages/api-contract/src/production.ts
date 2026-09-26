import { z } from "zod";

/**
 * Machine types, mirroring the `MachineType` enum in the Prisma schema.
 *
 * Duplicated here rather than imported because this package must not depend on
 * the generated Prisma client — `apps/web` pulls it into the browser bundle.
 * Keep the two in step.
 *
 * An enum rather than a lookup table (unlike SupplierFamily): these are classes
 * of physical equipment, and a ninth means the factory bought a new kind of
 * machine. Ordered by how common each is in the migrated data.
 */
export const MACHINE_TYPES = [
  "SAC_V",
  "CORDON",
  "IMPRESSION",
  "SAC_POIGNE_TORSADE",
  "SAC_POIGNE_PLATE",
  "COUPE",
  "COUPE_SOUS_PLAT",
  "SAC_LUXE",
] as const;

export const machineTypeSchema = z.enum(MACHINE_TYPES);
export type MachineType = (typeof MACHINE_TYPES)[number];

/** "SAC_POIGNE_TORSADE" -> "Sac poigne torsade". */
export function machineTypeLabel(type: MachineType): string {
  const words = type.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    });

/**
 * Like `optionalText`, but keeps "cleared" and "not sent" apart.
 *
 * `optionalText` folds `""` into `undefined`, which the employee update path
 * reads as "leave this column alone" — necessary, because a non-admin's form
 * legitimately omits the fields it was never shown. That would otherwise make
 * an emptied box un-clearable, so a caller that *did* render a field sends
 * `null` to clear it: `undefined` = absent, `null` = clear.
 */
const clearableText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => {
      if (value === null) return null;
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    });

/**
 * A measurement in the machine's capability ranges. Optional throughout: which
 * ones apply depends on the machine type, and most legacy rows set only a few.
 * Non-negative because every one is a physical dimension or weight.
 */
const measure = z
  .number()
  .min(0, "Cannot be negative")
  .max(100000)
  .optional();

/**
 * A real calendar day as `YYYY-MM-DD`. The shape alone is not enough:
 * "2026-13-01" or "2026-02-30" match `\d{4}-\d{2}-\d{2}`, become an Invalid
 * Date (or roll into the next month) server-side, and reach Prisma as a 500
 * instead of a 400. Parsed as UTC midnight — how every `@db.Date` column here
 * is written — and required to print back as itself, which rejects both.
 */
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Not a real date");

const isoDate = calendarDate
  .optional()
  .transform((value) => value || undefined);

/** `isoDate`, with the clear/absent distinction of `clearableText`. */
const clearableDate = calendarDate
  .nullish()
  .transform((value) => (value === null ? null : value || undefined));

export const createMachineInput = z.object({
  /// The real identifier — see the Machine model. Name is only a label.
  code: z.string().trim().min(1, "Code is required").max(60),
  name: z.string().trim().min(1, "Name is required").max(200),
  type: machineTypeSchema,
  brand: optionalText(100),
  price: z.number().min(0).max(1e9).optional(),
  purchaseDate: isoDate,
  imageUrl: optionalText(500),
  invoiceUrl: optionalText(500),
  supplierId: z.string().min(1).optional(),
  laize: measure,
  laizeMin: measure,
  laizeMax: measure,
  grammage: measure,
  grammageMin: measure,
  grammageMax: measure,
  grammageMinWithoutHandle: measure,
  grammageMaxWithoutHandle: measure,
  grammageMinWithHandle: measure,
  grammageMaxWithHandle: measure,
  grammageMinKraft: measure,
  grammageMaxKraft: measure,
  grammageMinLaminatedKraft: measure,
  grammageMaxLaminatedKraft: measure,
  lengthMin: measure,
  lengthMax: measure,
  widthMin: measure,
  widthMax: measure,
});

export const updateMachineInput = createMachineInput.extend({
  id: z.string().min(1),
});

export type CreateMachineInput = z.infer<typeof createMachineInput>;
export type UpdateMachineInput = z.infer<typeof updateMachineInput>;

/**
 * Employee input.
 *
 * The restricted fields (`salary`, `salaryGross`, `cin`,
 * `socialSecurityNumber`, `birthDate`, `address`) are part of this schema, but
 * the procedures that accept it are ADMIN-gated and the service strips them for
 * lower ranks on read. See EmployeeService.
 *
 * `matricule` is optional on create only: left blank, the server assigns the
 * next free number (`EmployeeService.nextMatricule`). An existing record
 * always has one, so `updateEmployeeInput` requires it again.
 */
export const createEmployeeInput = z.object({
  matricule: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((value) => value || undefined),
  firstName: z.string().trim().max(100).default(""),
  lastName: z.string().trim().max(100).default(""),
  // Clearable, like every optional field the form renders: it sends `null`
  // for an emptied box, and `optionalText` would reject that outright.
  department: clearableText(100),
  jobTitle: clearableText(150),
  employmentType: clearableText(40),
  categorie: clearableText(20),
  echelon: clearableText(20),
  gender: clearableText(20),
  email: z
    .string()
    .max(200)
    .nullish()
    .transform((value) => (value === null ? null : value?.trim() || undefined))
    .refine(
      (value) => value === undefined || value === null || z.email().safeParse(value).success,
      { message: "Enter a valid email address, or leave it blank" },
    ),
  phone: clearableText(40),
  phone2: clearableText(40),
  hireDate: clearableDate,
  contractEndDate: clearableDate,
  photo: clearableText(500),
  suspended: z.boolean().default(false),
  suspendedAt: clearableDate,
  suspensionReason: clearableText(500),
  salary: z.number().min(0).max(1e7).nullish(),
  salaryGross: z.number().min(0).max(1e7).nullish(),
  cin: clearableText(30),
  socialSecurityNumber: clearableText(40),
  birthDate: clearableDate,
  address: clearableText(300),
});

export const updateEmployeeInput = createEmployeeInput.extend({
  id: z.string().min(1),
  matricule: z.string().trim().min(1, "Matricule is required").max(60),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeInput>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeInput>;

/**
 * How close a contract's end must be to count as ending soon: the list's
 * header tile counts these, and a row or record page draws the end date in
 * red. One number for both, so the tile and the red rows always agree.
 */
export const CONTRACT_ENDING_SOON_DAYS = 30;

/**
 * How a production run's quantity is counted, mirroring `ProductionUnit` in
 * the Prisma schema. Duplicated rather than imported, like every other enum
 * here — see the note on MACHINE_TYPES.
 *
 * Null on 915 of the 942 migrated runs, so it stays optional: the legacy data
 * mostly did not record it, and requiring it now would make those rows
 * uneditable. New runs recorded through the app should set it.
 */
export const PRODUCTION_UNITS = ["PIECE", "METER"] as const;
export type ProductionUnit = (typeof PRODUCTION_UNITS)[number];

/**
 * One recorded production run: what was made against an order on one day.
 *
 * `employeeId` is deliberately absent. Orders are no longer assigned to a
 * worker (see the note on the Order model — the assignment model was dropped
 * with the RBAC change), and the column is null on 899 of 942 migrated rows.
 * A run is attributed to whoever recorded it, through the session, rather
 * than naming an employee — which also means the form needs no employee
 * picker, and so PRODUCTION does not need to read the employees module.
 *
 * `verifiedAt`/`verifiedBy` are absent for a different reason: verification
 * is a supervisor action against a run that already exists, not part of
 * recording one. It is not built yet.
 */
/**
 * The four workshop stations, mirroring `WorkshopStage` in the Prisma schema.
 *
 * A SECOND AXIS, not part of `Role` — see the enum's own doc comment in the
 * schema. `Role` is a rank; these four are peers, so they cannot share it.
 * Ordered as the work flows, which is how the picker reads.
 */
export const WORKSHOP_STAGES = [
  "PRINTING",
  "PRODUCER",
  "QUALITY_CONTROL",
  "PACKAGING",
] as const;
export type WorkshopStage = (typeof WORKSHOP_STAGES)[number];

/** "QUALITY_CONTROL" -> "Quality control". */
export function workshopStageLabel(stage: WorkshopStage): string {
  const words = stage.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Which machine types each station may name.
 *
 * The printing station runs the presses; the producer station runs the bag
 * machines. Measured against the 22 machines in the data: 3 IMPRESSION and 19
 * bag machines across seven types.
 *
 * QUALITY_CONTROL and PACKAGING are absent deliberately — they record no
 * machine at all, which is why `machineId` is nullable on the column even
 * though it is required for the two stations listed here.
 *
 * Exported so the form filters its picker by exactly the same rule the server
 * enforces, rather than the two drifting apart.
 */
export const MACHINE_TYPES_FOR_STAGE = {
  PRINTING: ["IMPRESSION"],
  PRODUCER: [
    "SAC_V",
    "SAC_POIGNE_TORSADE",
    "SAC_POIGNE_PLATE",
    "CORDON",
    "COUPE",
    "COUPE_SOUS_PLAT",
    "SAC_LUXE",
  ],
} as const satisfies Partial<Record<WorkshopStage, readonly MachineType[]>>;

/** The machine types `stage` may name, or null when it records no machine. */
export function machineTypesForStage(stage: WorkshopStage): readonly MachineType[] | null {
  return stage === "PRINTING" || stage === "PRODUCER"
    ? MACHINE_TYPES_FOR_STAGE[stage]
    : null;
}

/** A non-negative whole count of pieces or parcels. */
const count = z.number().int().min(0, "Cannot be negative").max(1e9);

/**
 * Fields every run carries regardless of station.
 *
 * `employeeId` is deliberately absent — orders are no longer assigned to a
 * worker (see the note on the Order model), and the column is null on 899 of
 * 942 migrated rows. A run is attributed to whoever recorded it, through the
 * session (`recordedById`), which also means the form needs no employee
 * picker and PRODUCTION needs no access to the employees module.
 *
 * `verifiedAt`/`verifiedBy` are absent for a different reason: verification
 * is a supervisor action against a run that already exists, not part of
 * recording one. Not built yet.
 */
const productionRunBase = {
  orderId: z.string().min(1),
  /** The day the WORK happened — not when it was typed in (`createdAt`). */
  dateProduction: calendarDate,
  note: optionalText(500),
};

/**
 * One recorded production run, discriminated by which station recorded it.
 *
 * A discriminated union rather than one wide object with everything
 * optional: it is what makes "a PRINTING row has no parcelsClosed" true by
 * construction instead of by convention. The database columns are all
 * nullable (each stage fills its own subset), so this union IS the
 * constraint — same technique as `orderProductRef`, and the same reason.
 *
 * Each stage records exactly what that station measures:
 *
 *   - PRINTING         metres of paper run through the press
 *   - PRODUCER         pieces produced, and the shift's own breakdown
 *   - QUALITY_CONTROL  how many pieces were checked
 *   - PACKAGING        parcels closed
 *
 * PRINTING and PRODUCER additionally require `machineId`; the other two
 * stations have no machine field at all, so naming one is an unrecognised
 * key and a 400. That the machine's TYPE matches the station is checked in
 * `ProductionService` — the id alone cannot say, and the contract must not
 * reach for the database.
 *
 * Every branch is `.strict()`: a field belonging to another station is a
 * 400, not a silently dropped key. Zod's default is to strip unknowns, which
 * would let a client send `parcelsClosed` to a PRINTING run and get a 200
 * back with the value quietly discarded — correct in the database, but a lie
 * to the caller. Strict makes the union say what it means.
 *
 * The PRODUCER breakdown is NOT required to sum to `piecesProduced`. On the
 * only two legacy rows carrying one, the parts came to 10 516 of 11 500 and
 * 13 960 of 14 200 — the remainder is unaccounted in the source data, so
 * enforcing the arithmetic would reject the shop's own real numbers.
 */
export const createProductionRunInput = z.discriminatedUnion("stage", [
  z
    .object({
      ...productionRunBase,
      stage: z.literal("PRINTING"),
      /** Required: which press ran it. Validated against `IMPRESSION` server-side. */
      machineId: z.string().min(1, "Choose the machine"),
      metersPrinted: z.number().min(0, "Cannot be negative").max(1e9),
    })
    .strict(),
  z
    .object({
      ...productionRunBase,
      stage: z.literal("PRODUCER"),
      /** Required: which bag machine ran it. Validated server-side. */
      machineId: z.string().min(1, "Choose the machine"),
      piecesProduced: count,
      goodPieces: count.optional(),
      wastePieces: count.optional(),
      piecesToFix: count.optional(),
    })
    .strict(),
  z
    .object({
      ...productionRunBase,
      stage: z.literal("QUALITY_CONTROL"),
      /** One count, no pass/fail split: the volume controlled, not a verdict. */
      piecesControlled: count,
    })
    .strict(),
  z
    .object({
      ...productionRunBase,
      stage: z.literal("PACKAGING"),
      parcelsClosed: count,
    })
    .strict(),
]);

/**
 * Correcting a run. `orderId` is not updatable — a run recorded against the
 * wrong order is deleted and re-recorded rather than moved, so it cannot be
 * walked out of the caller's scope by editing it. `stage` is not updatable
 * either: a PACKAGING run edited into a PRODUCER one would change what the
 * order's packaging gate and totals count, and re-recording is the honest
 * fix. It is still in the payload because it is the union's discriminant —
 * it says which station's measures the rest of the object carries — and
 * `ProductionService.update` refuses a value that differs from the stored
 * row's with BAD_REQUEST.
 */
const updateBase = {
  id: z.string().min(1),
  dateProduction: calendarDate,
  note: optionalText(500),
};

export const updateProductionRunInput = z.discriminatedUnion("stage", [
  z
    .object({
      ...updateBase,
      stage: z.literal("PRINTING"),
      /** Required: which press ran it. Validated against `IMPRESSION` server-side. */
      machineId: z.string().min(1, "Choose the machine"),
      metersPrinted: z.number().min(0, "Cannot be negative").max(1e9),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      stage: z.literal("PRODUCER"),
      /** Required: which bag machine ran it. Validated server-side. */
      machineId: z.string().min(1, "Choose the machine"),
      piecesProduced: count,
      goodPieces: count.optional(),
      wastePieces: count.optional(),
      piecesToFix: count.optional(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      stage: z.literal("QUALITY_CONTROL"),
      piecesControlled: count,
    })
    .strict(),
  z
    .object({
      ...updateBase,
      stage: z.literal("PACKAGING"),
      parcelsClosed: count,
    })
    .strict(),
]);

export type CreateProductionRunInput = z.infer<typeof createProductionRunInput>;
export type UpdateProductionRunInput = z.infer<typeof updateProductionRunInput>;

/** Delete one recorded run. */
export const productionRunIdInput = z.object({ id: z.string().min(1) });
export type ProductionRunIdInput = z.infer<typeof productionRunIdInput>;
