/**
 * Brings the old app's manufacturing orders (OFs) up to date here, step by
 * step, while both apps are in use (2026-10-22): steps the old app moved on
 * since the import, steps it added or deleted, and the files and comments it
 * put on them.
 *
 *   node dist/migrate/sync-pipeline.js           # dry run: reports, writes nothing
 *   node dist/migrate/sync-pipeline.js --apply
 *
 * Reads the old app's RAW database (LEGACY_RAW_DATABASE_URL) and reuses
 * import-pipeline.ts's rules: names, switches, sub-steps flattened in
 * `order_index` order, files, comments and the comment written from the
 * built-in fields.
 *
 * A step has no legacy key here. It is matched to the old step it was
 * imported from on name and creation time, which the import copied.
 *
 * The old app is the source until this app changes a step. "Changed here" is
 * read off the audit log, which names the step (`input.actionId`) of every
 * manufacturing write; this script's own writes are not audited.
 *
 *   - a step the old app moved on (status, start, end, machine, people) and
 *     nobody touched here takes the old app's state; one changed here is
 *     left and reported;
 *   - a step the old app added is inserted at its place;
 *   - a step the old app deleted goes too when its OF was never touched
 *     here; otherwise it stays, reported;
 *   - files and comments the old app has and the step lacks are added;
 *     nothing is removed;
 *   - the OF's status follows its steps, as the app computes it, and its
 *     last activity moves to the latest date on them. An OF the old app
 *     cancelled is cancelled here unless it was touched here.
 *
 * An OF not here is not created: import-pipeline.ts does that, create-only.
 *
 * One transaction. A second run on the same backup writes nothing.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  manufacturingStatusOf,
  PLANT_UTC_OFFSET_MS,
  type ManufacturingActionStatus,
} from "@repo/api-contract";
import { PrismaClient, type Prisma } from "../generated/prisma/client.js";
import { legacyRawPool, text } from "./legacy.js";

type Row = Record<string, unknown>;
type Tx = Prisma.TransactionClient;

class DryRunRollback extends Error {}

/** Legacy timestamps are UTC with no zone; the queries convert them (import-pipeline.ts). */
function instant(value: unknown): Date | null {
  return value instanceof Date ? value : null;
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  return a === null || b === null ? a === b : a.getTime() === b.getTime();
}

const STATUS: Record<string, ManufacturingActionStatus> = {
  PENDING: "WAITING",
  IN_PROGRESS: "IN_PROGRESS",
  DONE: "DONE",
  SKIPPED: "SKIPPED",
};

/**
 * How far along a step is. In an OF worked on here, a step only moves
 * forward: completing a step starts the next one, and the audit log names
 * only the step completed.
 */
const PROGRESS: Record<ManufacturingActionStatus, number> = {
  WAITING: 0,
  IN_PROGRESS: 1,
  DONE: 2,
  SKIPPED: 2,
};

/** import-pipeline.ts's built-in step types. */
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

function contentTypeOf(url: string): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(url.split(/[?#]/)[0] ?? "")?.[1]?.toLowerCase();
  return (extension && CONTENT_TYPES[extension]) || "application/octet-stream";
}

function filenameOf(url: string): string {
  const segment = (url.split(/[?#]/)[0] ?? "").split("/").pop() ?? "";
  try {
    return decodeURIComponent(segment) || "file";
  } catch {
    return segment || "file";
  }
}

function plantDay(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const [year, month, day] = new Date(parsed.getTime() + PLANT_UTC_OFFSET_MS)
    .toISOString()
    .slice(0, 10)
    .split("-");
  return `${day}/${month}/${year}`;
}

/** import-pipeline.ts's reading of the step's `details` JSON. */
function readDetails(raw: unknown, supplierName: (legacyId: number) => string) {
  const details = (raw !== null && typeof raw === "object" ? raw : {}) as Row;

  const listed = Array.isArray(details.attachments) ? details.attachments : [];
  const attachments = listed.flatMap((entry) => {
    const file = (entry !== null && typeof entry === "object" ? entry : {}) as Row;
    const url = text(file.url);
    return url ? [{ url, name: text(file.name) }] : [];
  });
  const single = text(details.attachmentUrl);
  if (attachments.length === 0 && single) attachments.push({ url: single, name: null });

  const photo = text(details.photoUrl);
  if (photo && !photo.startsWith("data:") && !attachments.some((file) => file.url === photo)) {
    attachments.push({ url: photo, name: null });
  }

  const facts: string[] = [];
  if (typeof details.supplierId === "number") facts.push(`Fournisseur : ${supplierName(details.supplierId)}`);
  const expected = text(details.estimatedReceivingDate);
  if (expected) facts.push(`Date de réception prévue : ${plantDay(expected)}`);
  const dimensions = text(details.dimensions);
  if (dimensions) facts.push(`Dimensions du cliché : ${dimensions}`);
  if (typeof details.defectiveCount === "number") facts.push(`Pièces défectueuses : ${details.defectiveCount}`);
  if (typeof details.packedBoxesCount === "number") facts.push(`Colis emballés : ${details.packedBoxesCount}`);
  if (details.validated === true) facts.push("Maquette validée");

  return { attachments, facts };
}

const utc = (column: string) => `${column} AT TIME ZONE 'UTC' AS ${column}`;

const FACT_LINE = /^(Fournisseur : |Date de réception prévue : |Dimensions du cliché : |Pièces défectueuses : |Colis emballés : |Maquette validée$)/;

/**
 * The comment the import wrote from the built-in fields: no author at all,
 * and every line one of `readDetails`'s facts. An old comment whose writer
 * the old app lost has no author either, so the lines decide.
 */
function isFactsComment(comment: { authorId: string | null; authorName: string | null; body: string }): boolean {
  return (
    comment.authorId === null &&
    comment.authorName === null &&
    comment.body.split("\n").every((line) => FACT_LINE.test(line))
  );
}

/** One old step, as import-pipeline.ts would write it. */
interface Step {
  legacyId: string;
  label: string;
  handlesEmployees: boolean;
  handlesMachine: boolean;
  handlesAttachments: boolean;
  status: ManufacturingActionStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  machineId: string | null;
  people: string[];
  attachments: { url: string; filename: string; contentType: string; createdAt: Date }[];
  facts: string | null;
  comments: { body: string; authorName: string | null; createdAt: Date }[];
  stamp: Date;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const raw = legacyRawPool();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const changed: string[] = [];
  const keptHere: string[] = [];
  const notHere: string[] = [];
  const irregular: string[] = [];
  const unresolved: string[] = [];
  const counts: string[] = [];

  try {
    const q = async (sql: string) => (await raw.query<Row>(sql)).rows;
    const [catalogue, productionOrders, steps, assignees, comments] = await Promise.all([
      q(`SELECT id, label, requires_machine, requires_employee, requires_attachment
         FROM pipeline_custom_action ORDER BY id`),
      q(`SELECT id, numero_of, status, ${utc("cancelled_at")}, cancelled_reason
         FROM ordre_fabrication ORDER BY id`),
      q(`SELECT id, ordre_fabrication_id, order_index, action_type, custom_action_id, status,
                NULLIF(btrim(details), '')::jsonb AS details,
                ${utc("started_at")}, ${utc("completed_at")}, ${utc("created_at")},
                assigned_employee_id, machine_id
         FROM commande_pipeline_action ORDER BY ordre_fabrication_id, order_index, id`),
      q(`SELECT action_id, employee_id FROM pipeline_action_employees ORDER BY action_id, employee_id`),
      q(`SELECT id, pipeline_action_id, body, created_by, active, ${utc("created_at")}
         FROM pipeline_action_comment WHERE active ORDER BY pipeline_action_id, created_at, id`),
    ]);
    const catalogueOf = new Map(catalogue.map((row) => [String(row.id), row]));
    const group = (rows: Row[], key: string) => {
      const map = new Map<string, Row[]>();
      for (const row of rows) map.set(String(row[key]), [...(map.get(String(row[key])) ?? []), row]);
      return map;
    };
    const stepsOf = group(steps, "ordre_fabrication_id");
    const assigneesOf = group(assignees, "action_id");
    const commentsOf = group(comments, "pipeline_action_id");

    await prisma.$transaction(
      async (tx: Tx) => {
        // One connection in a transaction: read in turn, not in parallel.
        const employees = await tx.employee.findMany({
          where: { legacyId: { not: null } },
          select: { id: true, legacyId: true },
        });
        const machines = await tx.machine.findMany({
          where: { legacyId: { not: null } },
          select: { id: true, legacyId: true },
        });
        const suppliers = await tx.supplier.findMany({
          where: { legacyId: { not: null } },
          select: { name: true, legacyId: true },
        });
        const audit = await tx.auditLog.findMany({
          where: { kind: "MUTATION", outcome: "OK", module: "manufacturing" },
          select: { entityId: true, input: true },
        });
        const here = await tx.manufacturingOrder.findMany({
          where: { legacyNumero: { not: null } },
          include: {
            order: { select: { numero: true } },
            actions: {
              orderBy: { position: "asc" },
              include: {
                assignees: { select: { employeeId: true } },
                attachments: { select: { url: true } },
                comments: { select: { id: true, body: true, createdAt: true, authorId: true, authorName: true } },
              },
            },
          },
        });
        const employeeIds = new Map(employees.map((row) => [String(row.legacyId), row.id]));
        const machineIds = new Map(machines.map((row) => [String(row.legacyId), row.id]));
        const supplierNames = new Map(suppliers.map((row) => [String(row.legacyId), row.name]));
        const supplierName = (legacyId: number) => supplierNames.get(String(legacyId)) ?? `n° ${legacyId}`;
        const ofsTouched = new Set(audit.flatMap((row) => (row.entityId ? [row.entityId] : [])));
        const actionsTouched = new Set(
          audit.flatMap((row) => {
            const input = row.input as Record<string, unknown> | null;
            return typeof input?.actionId === "string" ? [input.actionId] : [];
          }),
        );
        const hereOf = new Map(here.map((row) => [String(row.legacyNumero), row]));

        const toStep = (row: Row, what: string): Step => {
          const custom = row.custom_action_id == null ? undefined : catalogueOf.get(String(row.custom_action_id));
          const builtIn = BUILT_IN[String(row.action_type)];
          if (!custom && !builtIn) unresolved.push(`${what}: unknown step type ${String(row.action_type)}`);
          const status = STATUS[String(row.status)];
          if (!status) throw new Error(`${what}: unknown status ${String(row.status)}`);
          const resolve = (map: Map<string, string>, value: unknown, kind: string) => {
            if (value == null) return null;
            const id = map.get(String(value));
            if (!id) unresolved.push(`${what}: ${kind} ${String(value)}`);
            return id ?? null;
          };
          const machineId = resolve(machineIds, row.machine_id, "machine");
          const people = new Set<string>();
          for (const legacyId of [
            ...(assigneesOf.get(String(row.id)) ?? []).map((link) => link.employee_id),
            row.assigned_employee_id,
          ]) {
            const id = resolve(employeeIds, legacyId, "employee");
            if (id) people.add(id);
          }
          const details = readDetails(row.details, supplierName);
          const createdAt = instant(row.created_at) ?? new Date(0);
          const startedAt = instant(row.started_at);
          const completedAt = instant(row.completed_at);
          const stamp = completedAt ?? startedAt ?? createdAt;
          return {
            legacyId: String(row.id),
            label: custom ? String(custom.label) : (builtIn?.label ?? text(row.action_type) ?? "Action"),
            handlesEmployees: (custom ? custom.requires_employee === true : (builtIn?.staffed ?? false)) || people.size > 0,
            handlesMachine: (custom ? custom.requires_machine === true : (builtIn?.staffed ?? false)) || machineId !== null,
            handlesAttachments: (custom ? custom.requires_attachment === true : false) || details.attachments.length > 0,
            status,
            startedAt,
            completedAt,
            createdAt,
            machineId,
            people: [...people],
            attachments: details.attachments.map((file) => ({
              url: file.url,
              filename: file.name ?? filenameOf(file.url),
              contentType: contentTypeOf(file.url),
              createdAt: stamp,
            })),
            facts: details.facts.length > 0 ? details.facts.join("\n") : null,
            comments: (commentsOf.get(String(row.id)) ?? []).map((comment) => ({
              body: String(comment.body),
              authorName: text(comment.created_by),
              createdAt: instant(comment.created_at) ?? stamp,
            })),
            stamp,
          };
        };

        let ofsChanged = 0;
        const totals = { moved: 0, added: 0, removed: 0, files: 0, comments: 0 };

        for (const row of productionOrders) {
          const legacyNumero = String(row.numero_of);
          const of = hereOf.get(legacyNumero);
          if (!of) {
            notHere.push(`${legacyNumero}: not here (import-pipeline.ts creates it once its order is here)`);
            continue;
          }
          const name = `${of.numero} (${of.order.numero}, ${legacyNumero})`;
          const ofTouched = ofsTouched.has(of.id);
          const desired = (stepsOf.get(String(row.id)) ?? []).map((step) =>
            toStep(step, `${legacyNumero} step ${String(step.id)}`),
          );

          // ---- match each old step to the action imported from it ----------
          type Action = (typeof of.actions)[number];
          const unmatched = new Set(of.actions);
          const matchOf = new Map<Step, Action>();
          for (const step of desired) {
            const action = of.actions.find(
              (candidate) =>
                unmatched.has(candidate) &&
                candidate.label === step.label &&
                candidate.createdAt.getTime() === step.createdAt.getTime(),
            );
            if (action) {
              matchOf.set(step, action);
              unmatched.delete(action);
            }
          }

          const notes: string[] = [];
          const ops: (() => Promise<unknown>)[] = [];

          /** A step here the old app's state must not overwrite. */
          const keepsOwn = (step: Step, action: Action) =>
            actionsTouched.has(action.id) || (ofTouched && PROGRESS[step.status] < PROGRESS[action.status]);

          // ---- steps both have ------------------------------------------------
          for (const [step, action] of matchOf) {
            const moved =
              action.status !== step.status ||
              !sameInstant(action.startedAt, step.startedAt) ||
              !sameInstant(action.completedAt, step.completedAt) ||
              action.machineId !== step.machineId;
            const herePeople = action.assignees.map((link) => link.employeeId).sort();
            const peopleChanged = herePeople.join() !== [...step.people].sort().join();
            if (moved || peopleChanged) {
              if (keepsOwn(step, action)) {
                // Both done, each app with its own times and people: not news.
                if (action.status !== step.status) {
                  keptHere.push(
                    `${name}: "${action.label}" is ${action.status} here, ${step.status} in the old app — ` +
                      `${actionsTouched.has(action.id) ? "changed here" : "further on here"}, left`,
                  );
                }
              } else {
                ops.push(() =>
                  tx.manufacturingAction.update({
                    where: { id: action.id },
                    data: {
                      status: step.status,
                      startedAt: step.startedAt,
                      completedAt: step.completedAt,
                      machineId: step.machineId,
                      handlesEmployees: action.handlesEmployees || step.handlesEmployees,
                      handlesMachine: action.handlesMachine || step.handlesMachine,
                      handlesAttachments: action.handlesAttachments || step.handlesAttachments,
                    },
                  }),
                );
                if (peopleChanged) {
                  ops.push(() => tx.manufacturingActionAssignee.deleteMany({ where: { actionId: action.id } }));
                  ops.push(() =>
                    tx.manufacturingActionAssignee.createMany({
                      data: step.people.map((employeeId) => ({ actionId: action.id, employeeId })),
                    }),
                  );
                }
                if (action.status !== step.status) {
                  notes.push(`"${action.label}" ${action.status} -> ${step.status}`);
                  totals.moved += 1;
                } else {
                  notes.push(`"${action.label}" dates/machine/people`);
                }
              }
            }

            // Files and comments: a union, whoever touched the step.
            const urls = new Set(action.attachments.map((file) => file.url));
            const files = step.attachments.filter((file) => !urls.has(file.url));
            if (files.length > 0) {
              ops.push(() =>
                tx.manufacturingActionAttachment.createMany({
                  data: files.map((file) => ({ ...file, actionId: action.id })),
                }),
              );
              if (!action.handlesAttachments && !actionsTouched.has(action.id)) {
                ops.push(() =>
                  tx.manufacturingAction.update({ where: { id: action.id }, data: { handlesAttachments: true } }),
                );
              }
              totals.files += files.length;
            }
            const said = new Set(action.comments.map((comment) => `${comment.createdAt.getTime()}|${comment.body}`));
            const newComments = step.comments.filter((comment) => !said.has(`${comment.createdAt.getTime()}|${comment.body}`));
            const factsComment = action.comments.find(isFactsComment);
            if (step.facts !== null && !factsComment) {
              ops.push(() =>
                tx.manufacturingActionComment.create({
                  data: { actionId: action.id, body: step.facts ?? "", createdAt: step.stamp },
                }),
              );
              totals.comments += 1;
            } else if (step.facts !== null && factsComment && factsComment.body !== step.facts) {
              ops.push(() =>
                tx.manufacturingActionComment.update({ where: { id: factsComment.id }, data: { body: step.facts ?? "" } }),
              );
            }
            if (newComments.length > 0) {
              ops.push(() =>
                tx.manufacturingActionComment.createMany({
                  data: newComments.map((comment) => ({ ...comment, actionId: action.id })),
                }),
              );
              totals.comments += newComments.length;
            }
            if (files.length || newComments.length) {
              notes.push(
                `"${action.label}" +` +
                  [files.length ? `${files.length} file(s)` : "", newComments.length ? `${newComments.length} comment(s)` : ""]
                    .filter(Boolean)
                    .join(" +"),
              );
            }
          }

          // ---- steps only the old app has ----------------------------------
          const missing = desired.filter((step) => !matchOf.has(step));
          const added: Step[] = [];
          for (const step of missing) {
            // A step renamed here has no match; inserting would double it.
            const lookalike = [...unmatched].find((action) => action.createdAt.getTime() === step.createdAt.getTime());
            if (ofTouched && lookalike) {
              keptHere.push(
                `${name}: the old app's "${step.label}" matches no step here (renamed here as "${lookalike.label}"?), not added`,
              );
              continue;
            }
            added.push(step);
          }

          // ---- steps only this app has --------------------------------------
          const removed: Action[] = [];
          for (const action of unmatched) {
            if (ofTouched || actionsTouched.has(action.id)) {
              keptHere.push(`${name}: "${action.label}" is not in the old app any more — OF changed here, kept`);
            } else {
              removed.push(action);
            }
          }

          // ---- the pipeline's order ------------------------------------------
          // Untouched here: the old app's order. Touched: this app's order,
          // an added step going right after the one it follows in the old app.
          type Slot = { action: Action } | { step: Step };
          let slots: Slot[];
          if (!ofTouched) {
            slots = desired.flatMap((step): Slot[] => {
              const action = matchOf.get(step);
              if (action) return [{ action }];
              return added.includes(step) ? [{ step }] : [];
            });
          } else {
            slots = of.actions.filter((action) => !removed.includes(action)).map((action) => ({ action }));
            for (const step of added) {
              const index = desired.indexOf(step);
              let at = 0;
              for (let previous = index - 1; previous >= 0; previous -= 1) {
                const before = desired[previous];
                const found = slots.findIndex(
                  (slot) => ("action" in slot && slot.action === matchOf.get(before as Step)) || ("step" in slot && slot.step === before),
                );
                if (found !== -1) {
                  at = found + 1;
                  break;
                }
              }
              slots.splice(at, 0, { step });
            }
          }

          for (const action of removed) {
            ops.push(() => tx.manufacturingAction.delete({ where: { id: action.id } }));
            notes.push(`"${action.label}" removed (deleted in the old app)`);
          }
          slots.forEach((slot, position) => {
            if ("action" in slot) {
              if (slot.action.position !== position) {
                ops.push(() => tx.manufacturingAction.update({ where: { id: slot.action.id }, data: { position } }));
              }
              return;
            }
            const step = slot.step;
            ops.push(() =>
              tx.manufacturingAction.create({
                data: {
                  manufacturingOrderId: of.id,
                  position,
                  label: step.label,
                  handlesEmployees: step.handlesEmployees,
                  handlesMachine: step.handlesMachine,
                  handlesAttachments: step.handlesAttachments,
                  status: step.status,
                  startedAt: step.startedAt,
                  completedAt: step.completedAt,
                  machineId: step.machineId,
                  createdAt: step.createdAt,
                  assignees: { create: step.people.map((employeeId) => ({ employeeId })) },
                  attachments: { create: step.attachments },
                  comments: {
                    create: [
                      ...(step.facts !== null ? [{ body: step.facts, createdAt: step.stamp }] : []),
                      ...step.comments,
                    ],
                  },
                },
              }),
            );
            notes.push(`"${step.label}" added (${step.status})`);
          });
          totals.added += added.length;
          totals.removed += removed.length;

          // ---- the OF itself -------------------------------------------------
          const finalStatuses = slots.map((slot) => {
            if ("step" in slot) return { status: slot.step.status };
            const step = [...matchOf].find(([, action]) => action === slot.action)?.[0];
            return { status: step !== undefined && !keepsOwn(step, slot.action) ? step.status : slot.action.status };
          });
          const ofData: Prisma.ManufacturingOrderUpdateInput = {};
          if (String(row.status) === "CANCELLED" && of.status !== "CANCELLED") {
            if (ofTouched) {
              keptHere.push(`${name}: cancelled in the old app — OF changed here, left ${of.status}`);
            } else {
              ofData.status = "CANCELLED";
              ofData.cancelledAt = instant(row.cancelled_at) ?? new Date();
              ofData.cancelReason = text(row.cancelled_reason);
            }
          } else if (of.status !== "CANCELLED") {
            const status = manufacturingStatusOf(finalStatuses);
            if (status !== of.status) ofData.status = status;
          }
          let lastActivityAt = of.lastActivityAt;
          for (const step of desired) {
            for (const moment of [step.stamp, ...step.comments.map((comment) => comment.createdAt)]) {
              if (moment > lastActivityAt) lastActivityAt = moment;
            }
          }
          if (lastActivityAt.getTime() !== of.lastActivityAt.getTime()) ofData.lastActivityAt = lastActivityAt;
          if (ofData.status !== undefined) notes.push(`OF ${of.status} -> ${String(ofData.status)}`);

          if (ops.length === 0 && Object.keys(ofData).length === 0) continue;
          for (const op of ops) await op();
          if (Object.keys(ofData).length > 0) await tx.manufacturingOrder.update({ where: { id: of.id }, data: ofData });
          ofsChanged += 1;
          if (notes.length > 0) changed.push(`${name}: ${notes.join("; ")}`);

          const firstWaiting = finalStatuses.findIndex((action) => action.status === "WAITING");
          if (
            finalStatuses.filter((action) => action.status === "IN_PROGRESS").length > 1 ||
            (firstWaiting !== -1 && finalStatuses.slice(firstWaiting).some((action) => action.status !== "WAITING"))
          ) {
            irregular.push(name);
          }
        }

        counts.push(
          `OFs changed: ${ofsChanged} of ${here.length} here`,
          `steps:       ${totals.moved} moved on, ${totals.added} added, ${totals.removed} removed`,
          `files:       ${totals.files} added`,
          `comments:    ${totals.comments} added`,
        );

        if (!apply) throw new DryRunRollback();
      },
      { timeout: 600_000, maxWait: 10_000 },
    );
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  } finally {
    const section = (title: string, lines: string[]) => {
      if (lines.length === 0) return;
      console.log(`\n${title} (${lines.length})`);
      for (const line of lines) console.log(`  ${line}`);
    };
    section("brought up to the old app", changed);
    section("left as they are here", keptHere);
    section("OFs whose steps are not in strict sequence afterwards", irregular);
    section("OFs of the old app not here", notHere);
    section("references that did not resolve (left empty)", unresolved);
    console.log("");
    for (const line of counts) console.log(line);
    if (!apply) console.log("\n(dry run — rolled back, nothing written; --apply to write)");
    await raw.end();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
