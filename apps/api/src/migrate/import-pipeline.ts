/**
 * Loads the old app's order pipelines into the manufacturing-order module
 * (docs/manufacturing-orders-plan.md):
 *   - `pipeline_template` (+ steps)   -> ManufacturingTemplate(+Action)
 *   - `ordre_fabrication`             -> ManufacturingOrder
 *   - `commande_pipeline_action`      -> ManufacturingAction
 *   - `pipeline_action_employees`     -> ManufacturingActionAssignee
 *   - step `details.attachments`      -> ManufacturingActionAttachment
 *   - `pipeline_action_comment`       -> ManufacturingActionComment
 *
 * Step 7 of the migration order; requires steps 1–3 (orders, employees and
 * machines carry the `legacyId` every link resolves through).
 *
 *   pnpm --filter api db:import:step7 [--dry-run]
 *
 * It reads the **raw** legacy dump (LEGACY_RAW_DATABASE_URL), not the ETL
 * output: the ETL dropped template steps, `parent_action_id` and
 * `requires_attachment`.
 *
 * What changes on the way in:
 *   - an OF is renumbered to the new rule (`OF-<year>-<order n>`); its old
 *     number is kept in `legacyNumero`;
 *   - sub-steps are flattened into the pipeline, in `order_index` order (a
 *     sub-step always sits right after its parent);
 *   - a built-in step type gets its French name, a catalogue step its label;
 *   - a switch is on when the old step required the field or holds a value;
 *   - the OF's status is recomputed from its actions, and its last activity
 *     is the latest date on them — the old app recorded neither which
 *     template an OF came from nor when it was last touched;
 *   - the built-in extras with no column here (supplier, expected date, plate
 *     size, defect and box counts, the "validated" tick) become one authorless
 *     comment on the action.
 *
 * Not carried over: the daily worker plan, the frozen dimensions, and photos
 * the old app stored inline in the step JSON (`photoUrl` as a `data:` URI) —
 * counted in the output, written nowhere.
 *
 * **Create-only.** A template is keyed on `legacyId`, an OF on
 * `legacyNumero`; one already here is left exactly as it is, so a re-run
 * never overwrites work done in the app. An OF is skipped, and listed, when
 * its order is not in this database, already has an OF made in the app, is a
 * quote, or is not numbered `CMD-<n>`.
 *
 * The whole run is one transaction, so a failure — or `--dry-run`, which
 * rolls back on purpose — leaves the database as it was. Read-only against
 * legacy.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  manufacturingOrderNumero,
  manufacturingStatusOf,
  PLANT_UTC_OFFSET_MS,
  type ManufacturingActionStatus,
} from "@repo/api-contract";
import { PrismaClient } from "../generated/prisma/client.js";
import { legacyRawPool, text } from "./legacy.js";

type Row = Record<string, unknown>;

/** Thrown at the end of a dry run to roll the transaction back. */
class DryRunRollback extends Error {}

/**
 * The legacy Java app wrote `timestamp without time zone` columns in UTC (a
 * step created with its OF carries the same clock time as the OF's
 * `timestamptz`). The queries convert them with `AT TIME ZONE 'UTC'`, so the
 * driver receives a real instant; this only narrows the type.
 */
function instant(value: unknown): Date | null {
  return value instanceof Date ? value : null;
}

const STATUS: Record<string, ManufacturingActionStatus> = {
  PENDING: "WAITING",
  IN_PROGRESS: "IN_PROGRESS",
  DONE: "DONE",
  SKIPPED: "SKIPPED",
};

/**
 * The old app's six built-in step types, under the French names its screens
 * showed. `machine`/`employee` are what its validators required at DONE —
 * printing and production needed both, the rest neither.
 */
const BUILT_IN: Record<string, { label: string; staffed: boolean }> = {
  PREPARATION_MAQUETTE: { label: "Préparation maquette", staffed: false },
  PREPARATION_CLICHE: { label: "Préparation cliché", staffed: false },
  IMPRESSION: { label: "Impression", staffed: true },
  PRODUCTION: { label: "Production", staffed: true },
  CONTROLE_QUALITE: { label: "Contrôle qualité", staffed: false },
  EMBALAGE: { label: "Emballage", staffed: false },
};

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/** An old file carries a URL and a name only: the type is read off the extension. */
function contentTypeOf(url: string): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(url.split(/[?#]/)[0] ?? "")?.[1]?.toLowerCase();
  return (extension && CONTENT_TYPES[extension]) || "application/octet-stream";
}

/** The file's name off its URL, for an attachment the old app stored without one. */
function filenameOf(url: string): string {
  const segment = (url.split(/[?#]/)[0] ?? "").split("/").pop() ?? "";
  try {
    return decodeURIComponent(segment) || "file";
  } catch {
    return segment || "file";
  }
}

/** `2026-06-28T23:00:00.000Z` is midnight on the 29th at the plant: shown as that day. */
function plantDay(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const [year, month, day] = new Date(parsed.getTime() + PLANT_UTC_OFFSET_MS)
    .toISOString()
    .slice(0, 10)
    .split("-");
  return `${day}/${month}/${year}`;
}

interface StepDetails {
  attachments: { url: string; name: string | null }[];
  /** A photo stored inline in the JSON rather than as a file. */
  inlinePhoto: boolean;
  /** The built-in extras, as the lines of one comment. */
  facts: string[];
}

/**
 * The legacy `details` JSON, read defensively: only the keys the old app's
 * built-in steps wrote are picked, each optional. `employeeId(s)` and
 * `machineId` are skipped — they repeat the step's own columns.
 */
function readDetails(raw: unknown, supplierName: (legacyId: number) => string): StepDetails {
  const details = (raw !== null && typeof raw === "object" ? raw : {}) as Row;

  const listed = Array.isArray(details.attachments) ? details.attachments : [];
  const attachments = listed.flatMap((entry) => {
    const file = (entry !== null && typeof entry === "object" ? entry : {}) as Row;
    const url = text(file.url);
    return url ? [{ url, name: text(file.name) }] : [];
  });
  // The older single-file form, kept by the old app beside the array.
  const single = text(details.attachmentUrl);
  if (attachments.length === 0 && single) attachments.push({ url: single, name: null });

  const photo = text(details.photoUrl);
  if (photo && !photo.startsWith("data:") && !attachments.some((file) => file.url === photo)) {
    attachments.push({ url: photo, name: null });
  }

  const facts: string[] = [];
  if (typeof details.supplierId === "number") {
    facts.push(`Fournisseur : ${supplierName(details.supplierId)}`);
  }
  const expected = text(details.estimatedReceivingDate);
  if (expected) facts.push(`Date de réception prévue : ${plantDay(expected)}`);
  const dimensions = text(details.dimensions);
  if (dimensions) facts.push(`Dimensions du cliché : ${dimensions}`);
  if (typeof details.defectiveCount === "number") {
    facts.push(`Pièces défectueuses : ${details.defectiveCount}`);
  }
  if (typeof details.packedBoxesCount === "number") {
    facts.push(`Colis emballés : ${details.packedBoxesCount}`);
  }
  if (details.validated === true) facts.push("Maquette validée");

  return { attachments, inlinePhoto: photo?.startsWith("data:") === true, facts };
}

/** Legacy timestamps without a time zone, read as UTC instants. */
const utc = (column: string) => `${column} AT TIME ZONE 'UTC' AS ${column}`;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const legacy = legacyRawPool();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const unresolved: string[] = [];
  const skipped: string[] = [];
  const irregular: string[] = [];
  const counts: string[] = [];

  try {
    const [orders, employees, machines, suppliers, haveTemplates, haveOrders] = await Promise.all([
      prisma.order.findMany({
        where: { legacyId: { not: null } },
        select: {
          id: true,
          legacyId: true,
          numero: true,
          kind: true,
          manufacturingOrder: { select: { numero: true, legacyNumero: true } },
        },
      }),
      prisma.employee.findMany({ where: { legacyId: { not: null } }, select: { id: true, legacyId: true } }),
      prisma.machine.findMany({ where: { legacyId: { not: null } }, select: { id: true, legacyId: true } }),
      prisma.supplier.findMany({ where: { legacyId: { not: null } }, select: { name: true, legacyId: true } }),
      prisma.manufacturingTemplate.findMany({
        where: { legacyId: { not: null } },
        select: { legacyId: true },
      }),
      prisma.manufacturingOrder.findMany({
        where: { legacyNumero: { not: null } },
        select: { legacyNumero: true },
      }),
    ]);
    const orderOf = new Map(orders.map((row) => [String(row.legacyId), row]));
    const employeeIds = new Map(employees.map((row) => [String(row.legacyId), row.id]));
    const machineIds = new Map(machines.map((row) => [String(row.legacyId), row.id]));
    const supplierNames = new Map(suppliers.map((row) => [String(row.legacyId), row.name]));
    const templatesHere = new Set(haveTemplates.map((row) => String(row.legacyId)));
    const ordersHere = new Set(haveOrders.map((row) => row.legacyNumero));

    const supplierName = (legacyId: number) => supplierNames.get(String(legacyId)) ?? `n° ${legacyId}`;

    const q = async (sql: string) => (await legacy.query<Row>(sql)).rows;
    const [catalogue, templates, templateSteps, productionOrders, steps, assignees, comments] =
      await Promise.all([
        q(`SELECT id, label, requires_machine, requires_employee, requires_attachment
           FROM pipeline_custom_action ORDER BY id`),
        q(`SELECT id, name, description FROM pipeline_template ORDER BY id`),
        q(`SELECT id, template_id, order_index, action_type, custom_action_id
           FROM pipeline_template_step ORDER BY template_id, order_index, id`),
        q(`SELECT id, numero_of, commande_id, status, created_at, created_by,
                  cancelled_at, cancelled_reason
           FROM ordre_fabrication ORDER BY id`),
        q(`SELECT id, ordre_fabrication_id, order_index, action_type, custom_action_id, status,
                  NULLIF(btrim(details), '')::jsonb AS details,
                  ${utc("started_at")}, ${utc("completed_at")}, ${utc("created_at")},
                  assigned_employee_id, machine_id
           FROM commande_pipeline_action ORDER BY ordre_fabrication_id, order_index, id`),
        q(`SELECT action_id, employee_id FROM pipeline_action_employees ORDER BY action_id, employee_id`),
        q(`SELECT id, pipeline_action_id, body, created_by, active, ${utc("created_at")}
           FROM pipeline_action_comment ORDER BY pipeline_action_id, created_at, id`),
      ]);

    const catalogueOf = new Map(catalogue.map((row) => [String(row.id), row]));

    /** A step's name and what the old app required of it, built-in or catalogue. */
    const definitionOf = (row: Row, what: string) => {
      const custom = row.custom_action_id == null ? undefined : catalogueOf.get(String(row.custom_action_id));
      if (custom) {
        return {
          label: String(custom.label),
          machine: custom.requires_machine === true,
          employee: custom.requires_employee === true,
          attachment: custom.requires_attachment === true,
        };
      }
      const builtIn = BUILT_IN[String(row.action_type)];
      if (!builtIn) unresolved.push(`${what}: unknown step type ${String(row.action_type ?? row.custom_action_id)}`);
      return {
        label: builtIn?.label ?? text(row.action_type) ?? "Action",
        machine: builtIn?.staffed ?? false,
        employee: builtIn?.staffed ?? false,
        attachment: false,
      };
    };

    const stepsOf = new Map<string, Row[]>();
    for (const row of steps) {
      const key = String(row.ordre_fabrication_id);
      stepsOf.set(key, [...(stepsOf.get(key) ?? []), row]);
    }
    const assigneesOf = new Map<string, string[]>();
    for (const row of assignees) {
      const key = String(row.action_id);
      assigneesOf.set(key, [...(assigneesOf.get(key) ?? []), String(row.employee_id)]);
    }
    const commentsOf = new Map<string, Row[]>();
    let deletedComments = 0;
    for (const row of comments) {
      // The old app's soft delete: a removed comment is not carried over.
      if (row.active !== true) {
        deletedComments += 1;
        continue;
      }
      const key = String(row.pipeline_action_id);
      commentsOf.set(key, [...(commentsOf.get(key) ?? []), row]);
    }

    await prisma.$transaction(
      async (tx) => {
        // ---- templates ------------------------------------------------------
        let templatesCreated = 0;
        let templateActions = 0;
        for (const row of templates) {
          if (templatesHere.has(String(row.id))) continue;
          const actions = templateSteps
            .filter((step) => String(step.template_id) === String(row.id))
            .map((step, position) => {
              const definition = definitionOf(step, `template step ${String(step.id)}`);
              return {
                position,
                label: definition.label,
                handlesEmployees: definition.employee,
                handlesMachine: definition.machine,
                handlesAttachments: definition.attachment,
              };
            });
          await tx.manufacturingTemplate.create({
            data: {
              name: String(row.name),
              description: text(row.description),
              legacyId: BigInt(row.id as string),
              actions: { create: actions },
            },
          });
          templatesCreated += 1;
          templateActions += actions.length;
        }
        counts.push(
          `templates:   ${templatesCreated} created of ${templates.length} (${templateActions} actions)`,
        );

        // ---- OFs --------------------------------------------------------------
        const byStatus = { DRAFT: 0, IN_PROGRESS: 0, DONE: 0, CANCELLED: 0 };
        const byActionStatus = { WAITING: 0, IN_PROGRESS: 0, DONE: 0, SKIPPED: 0 };
        let created = 0;
        let alreadyHere = 0;
        let assigneeLinks = 0;
        let attachmentCount = 0;
        let oldComments = 0;
        let generatedComments = 0;
        let inlinePhotos = 0;

        for (const row of productionOrders) {
          const legacyNumero = String(row.numero_of);
          if (ordersHere.has(legacyNumero)) {
            alreadyHere += 1;
            continue;
          }
          const order = orderOf.get(String(row.commande_id));
          if (!order) {
            skipped.push(`${legacyNumero}: its order (legacy id ${String(row.commande_id)}) is not in this database`);
            continue;
          }
          if (order.manufacturingOrder) {
            skipped.push(
              `${legacyNumero}: order ${order.numero} already has ${order.manufacturingOrder.numero}, made in the app`,
            );
            continue;
          }
          if (order.kind !== "ORDER") {
            skipped.push(`${legacyNumero}: ${order.numero} is a quote here`);
            continue;
          }
          const createdAt = instant(row.created_at) ?? new Date();
          const year = createdAt.getUTCFullYear();
          const numero = manufacturingOrderNumero(order.numero, year);
          if (numero === null) {
            skipped.push(`${legacyNumero}: order ${order.numero} is not numbered CMD-<n>`);
            continue;
          }

          let lastActivityAt = createdAt;
          const actions = (stepsOf.get(String(row.id)) ?? []).map((step, position) => {
            const what = `${legacyNumero} step ${String(step.id)}`;
            const definition = definitionOf(step, what);
            const status = STATUS[String(step.status)];
            if (!status) throw new Error(`${what}: unknown status ${String(step.status)}`);

            const resolve = (map: Map<string, string>, value: unknown, kind: string) => {
              if (value == null) return null;
              const id = map.get(String(value));
              if (!id) unresolved.push(`${what}: ${kind} ${String(value)}`);
              return id ?? null;
            };
            const machineId = resolve(machineIds, step.machine_id, "machine");
            // The single "main" assignee is usually also in the join, not always.
            const people = new Set<string>();
            for (const legacyId of [...(assigneesOf.get(String(step.id)) ?? []), step.assigned_employee_id]) {
              const id = resolve(employeeIds, legacyId, "employee");
              if (id) people.add(id);
            }
            const details = readDetails(step.details, supplierName);
            if (details.inlinePhoto) inlinePhotos += 1;

            const startedAt = instant(step.started_at);
            const completedAt = instant(step.completed_at);
            const stamp = completedAt ?? startedAt ?? instant(step.created_at) ?? createdAt;
            const old = commentsOf.get(String(step.id)) ?? [];

            // The OF's last sign of life: the latest date on any of its
            // actions or their comments.
            for (const moment of [stamp, ...old.map((comment) => instant(comment.created_at))]) {
              if (moment && moment > lastActivityAt) lastActivityAt = moment;
            }

            byActionStatus[status] += 1;
            assigneeLinks += people.size;
            attachmentCount += details.attachments.length;
            oldComments += old.length;
            if (details.facts.length > 0) generatedComments += 1;

            return {
              position,
              label: definition.label,
              handlesEmployees: definition.employee || people.size > 0,
              handlesMachine: definition.machine || machineId !== null,
              handlesAttachments: definition.attachment || details.attachments.length > 0,
              status,
              startedAt,
              completedAt,
              machineId,
              createdAt: instant(step.created_at) ?? createdAt,
              assignees: { create: [...people].map((employeeId) => ({ employeeId })) },
              attachments: {
                create: details.attachments.map((file) => ({
                  url: file.url,
                  filename: file.name ?? filenameOf(file.url),
                  contentType: contentTypeOf(file.url),
                  createdAt: stamp,
                })),
              },
              comments: {
                create: [
                  // No author at all marks a comment written here, not by a person.
                  ...(details.facts.length > 0
                    ? [{ body: details.facts.join("\n"), createdAt: stamp }]
                    : []),
                  ...old.map((comment) => ({
                    body: String(comment.body),
                    authorName: text(comment.created_by),
                    createdAt: instant(comment.created_at) ?? stamp,
                  })),
                ],
              },
            };
          });

          // The app's rules assume started actions form a prefix of the
          // pipeline. Imported as found either way; an OF that breaks the
          // rule is named so it can be put right by hand.
          const firstWaiting = actions.findIndex((action) => action.status === "WAITING");
          const inProgress = actions.filter((action) => action.status === "IN_PROGRESS").length;
          if (
            inProgress > 1 ||
            (firstWaiting !== -1 && actions.slice(firstWaiting).some((action) => action.status !== "WAITING"))
          ) {
            irregular.push(`${legacyNumero} (${numero})`);
          }

          const cancelled = String(row.status) === "CANCELLED";
          const status = cancelled ? "CANCELLED" : manufacturingStatusOf(actions);
          await tx.manufacturingOrder.create({
            data: {
              numero,
              year,
              orderId: order.id,
              status,
              cancelledAt: cancelled ? (instant(row.cancelled_at) ?? createdAt) : null,
              cancelReason: cancelled ? text(row.cancelled_reason) : null,
              legacyNumero,
              createdByName: text(row.created_by),
              createdAt,
              lastActivityAt,
              actions: { create: actions },
            },
          });
          byStatus[status] += 1;
          created += 1;
        }

        counts.push(
          `OFs:         ${created} created of ${productionOrders.length}` +
            (alreadyHere ? `, ${alreadyHere} already here` : "") +
            (skipped.length ? `, ${skipped.length} skipped` : ""),
        );
        counts.push(
          `  status:    ${byStatus.DONE} done, ${byStatus.IN_PROGRESS} in progress, ` +
            `${byStatus.DRAFT} draft, ${byStatus.CANCELLED} cancelled`,
        );
        counts.push(
          `actions:     ${Object.values(byActionStatus).reduce((sum, n) => sum + n, 0)} ` +
            `(${byActionStatus.DONE} done, ${byActionStatus.IN_PROGRESS} in progress, ` +
            `${byActionStatus.WAITING} waiting, ${byActionStatus.SKIPPED} skipped)`,
        );
        counts.push(`assignees:   ${assigneeLinks}`);
        counts.push(`attachments: ${attachmentCount}`);
        counts.push(
          `comments:    ${oldComments} from the old app + ${generatedComments} written from built-in fields` +
            (deletedComments ? ` (${deletedComments} deleted ones left out)` : ""),
        );
        counts.push(`inline photos left out: ${inlinePhotos}`);

        if (dryRun) throw new DryRunRollback();
      },
      { timeout: 600_000, maxWait: 10_000 },
    );
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  } finally {
    for (const line of counts) console.log(line);
    const report = (title: string, lines: string[]) => {
      if (lines.length === 0) return;
      console.warn(`\n${title}`);
      for (const value of lines.slice(0, 40)) console.warn(`  ${value}`);
      if (lines.length > 40) console.warn(`  … and ${lines.length - 40} more`);
    };
    report("OFs skipped:", skipped);
    report("OFs whose actions are not in strict sequence (imported as found):", irregular);
    report("references that did not resolve (left empty):", unresolved);
    if (dryRun) console.log("\n(dry run — rolled back, nothing written)");
    await legacy.end();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
