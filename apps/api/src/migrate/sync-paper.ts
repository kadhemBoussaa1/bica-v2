/**
 * Brings the old app's paper stock up to date here while both apps are in
 * use (2026-10-12): new shipments and reels, what the old app did to reels
 * already here (splits, consumption, weights), and the paper it reserved for
 * orders.
 *
 *   node dist/migrate/sync-paper.js           # dry run: reports, writes nothing
 *   node dist/migrate/sync-paper.js --apply
 *
 * Reads the old app's RAW database (LEGACY_RAW_DATABASE_URL) and applies the
 * ETL's own rules to it (bicapack packages/db/etl/04_stock.sql), so a fresh
 * backup needs no ETL conversion and a reel nobody touched maps to exactly
 * what the first import wrote.
 *
 * The old app is the source for a row until this app changes it:
 *
 *   - shipments: created when missing, never rewritten;
 *   - reels: created when missing, and rewritten to the old app's figures
 *     while unchanged here (`updatedAt` not past `legacySyncedAt`). A reel
 *     changed here — received, cut, reserved, edited — is left as it is and
 *     reported;
 *   - allocations: created when missing. An open one (RESERVED) on a live
 *     reel unchanged here, for an order paper can be reserved for here,
 *     becomes a working reservation in metres: the reel's free length goes
 *     down and production consumes it on the order. Anything else — consumed
 *     or cancelled history, a used-up or changed reel, an order closed here,
 *     a length that does not fit — comes in by weight only, like the first
 *     import's rows, and the open ones among them are reported. An existing
 *     allocation still RESERVED and unchanged here follows the old app to
 *     CONSUMED or CANCELED.
 *     The old app archives a used-up reel and leaves its reservation open:
 *     such a reservation comes in, or moves, as CONSUMED (user, 2026-10-12),
 *     the first import's open rows included. A split reel the old app puts
 *     back in stock stays archived here: its pieces are the stock.
 *
 * Then every reel unchanged here gets its reserve counters rebuilt from its
 * RESERVED allocations in metres (the invariant on
 * `PaperRoll.metrageReserve`), with `reserved` and `disponible` following.
 *
 * One transaction, so all of it or none. A second run on the same backup
 * writes nothing.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PAPER_TYPES } from "@repo/api-contract";
import { PrismaClient, type Prisma } from "../generated/prisma/client.js";
import type { AllocationState, PaperType } from "../generated/prisma/enums.js";
import { kgPerMetre } from "../stock/roll-math.js";
import {
  legacyRawPool,
  normaliseSupplierName,
  SUPPLIER_NAME_ALIASES,
  text,
} from "./legacy.js";

// The old app's timestamps are wall-clock Tunis time with no zone. The first
// import ran in this zone, so pinning it here reads an unchanged
// `date_consommation` back to the very instant already stored. Written, not
// read, so it is no build input for turbo.
// eslint-disable-next-line turbo/no-undeclared-env-vars
process.env.TZ = "Africa/Tunis";

/** The order statuses paper can be reserved for — AllocationService's rule. */
const RESERVABLE_ORDER_STATUSES = new Set(["DRAFT", "IN_PRODUCTION"]);

/**
 * The old app reserved whole kilograms of a reel, so a "whole reel" comes out
 * a metre or two short of its length. Within this share of the free length
 * the reservation takes it all, rather than leaving a sliver on offer.
 */
const WHOLE_REEL_SLACK = 0.01;

const ALLOCATION_STATES = ["RESERVED", "CONSUMED", "CANCELED"] as const;

class DryRunRollback extends Error {}

type Row = Record<string, unknown>;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function int(value: unknown): number | null {
  const parsed = num(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function timestamp(value: unknown): Date | null {
  return value instanceof Date ? value : null;
}

/** The reel columns this sync owns, as 04_stock.sql + import-stock.ts map them. */
function reelData(row: Row, importShipmentId: string | null) {
  const poidsRestant = num(row.poids_restant);
  const paperType = text(row.paper_type);
  return {
    numero: text(row.numero),
    numeroInterne: text(row.numero_interne),
    numeroSource: text(row.numero_source),
    paperGrade: text(row.code),
    description: text(row.description),
    metrage: num(row.metrage),
    metrageRestant: num(row.metrage_restant) ?? 0,
    poids: num(row.poids),
    poidsRestant: poidsRestant ?? 0,
    laize: num(row.laize),
    grammage: int(row.grammage),
    paperType:
      paperType !== null && (PAPER_TYPES as readonly string[]).includes(paperType)
        ? (paperType as PaperType)
        : null,
    price: num(row.prix),
    priceWithTransport: num(row.prix_avec_transport),
    valide: true,
    partiel: false,
    // `poids_restant <= 0` in SQL, where NULL reads as false.
    consomme: poidsRestant !== null && poidsRestant <= 0,
    archived: row.statut === "ARCHIVE",
    dateConsommation: timestamp(row.date_consommation),
    consumedByNote: text(row.consomme_par),
    qrCodeUrl: text(row.qr_code_url),
    importShipmentId,
  };
}

type ReelData = ReturnType<typeof reelData>;

/**
 * The ETL's `disponible`: `statut = 'EN_STOCK' AND poids_restant > 0`, where
 * the importer reads a NULL result as true.
 */
function etlDisponible(row: Row): boolean {
  if (row.statut !== "EN_STOCK") return false;
  const poidsRestant = num(row.poids_restant);
  return poidsRestant === null || poidsRestant > 0;
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  return a === b;
}

/** The fields of `want` that `have` does not already hold. */
function changedFields<T extends object>(have: object, want: T): (keyof T)[] {
  const current = have as Partial<Record<keyof T, unknown>>;
  return (Object.keys(want) as (keyof T)[]).filter((key) => !same(current[key], want[key]));
}

/** Changed here since this sync (or the first import) last wrote it. */
function changedHere(row: { updatedAt: Date; legacySyncedAt: Date | null }): boolean {
  return row.legacySyncedAt === null || row.updatedAt.getTime() > row.legacySyncedAt.getTime();
}

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** What the allocation pass needs to know about a reel, after the reel pass. */
interface Reel {
  id: string;
  numero: string | null;
  /** Never rewritten, never given a working reservation — `frozenWhy` says why. */
  frozen: boolean;
  frozenWhy: string | null;
  live: boolean;
  disponible: boolean;
  metrageRestant: number;
  poidsRestant: number;
  laize: number | null;
  grammage: number | null;
  /** Metres held by RESERVED allocations so far. */
  reservedMetres: number;
  /** When the old app archived the reel as consumed — see `oldAppState`. */
  usedUpAt: Date | null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const raw = legacyRawPool();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const counts: Record<string, number> = {};
  const count = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  const lines: string[] = [];

  try {
    const { rows: shipmentRows } = await raw.query<Row>(
      `SELECT *, CASE WHEN NULLIF(date_import, '') IS NULL THEN NULL
                      ELSE ((date_import::timestamptz AT TIME ZONE 'Africa/Tunis')::date)::text
                 END AS date_import_day
       FROM import_model ORDER BY id`,
    );
    // Timestamps to milliseconds as Postgres rounds them: the ETL's columns
    // are TIMESTAMP(3), so the first import read .259514 back as .260, and
    // the driver would truncate it to .259 — a difference on every reel.
    const { rows: reelRows } = await raw.query<Row>(
      `SELECT id, numero, numero_interne, numero_source, code, description,
              metrage, metrage_restant, poids, poids_restant, laize, grammage,
              paper_type, prix, prix_avec_transport, statut, consomme_par,
              date_consommation::timestamp(3) AS date_consommation, qr_code_url,
              parent_id, import_id
       FROM rouleau_import ORDER BY id`,
    );
    // 04_stock.sql drops allocations naming no order: nothing to attach them to.
    const { rows: allocationRows } = await raw.query<Row>(
      `SELECT id, etat, poids, metrage_reserve, commande_id, rouleau_id,
              date_allocation::timestamp(3) AS date_allocation,
              date_consommation::timestamp(3) AS date_consommation,
              date_annulation::timestamp(3) AS date_annulation
       FROM rouleau_commande WHERE commande_id IS NOT NULL ORDER BY id`,
    );

    await prisma.$transaction(
      async (tx) => {
        const stamp = new Date();
        const synced = { legacySyncedAt: stamp, updatedAt: stamp };

        // ---- shipments ------------------------------------------------------

        const shipmentsHere = await tx.importShipment.findMany({
          where: { legacyId: { not: null } },
          select: { id: true, legacyId: true },
        });
        const shipmentIds = new Map(shipmentsHere.map((row) => [String(row.legacyId), row.id]));
        const suppliers = await tx.supplier.findMany({ select: { id: true, name: true } });
        const supplierByName = new Map(
          suppliers.map((row) => [normaliseSupplierName(row.name), row.id]),
        );
        /** Shipments that could not be created: their reels wait too. */
        const blockedShipments = new Set<string>();

        for (const row of shipmentRows) {
          if (shipmentIds.has(String(row.id))) continue;
          const name = text(row.fournisseur);
          const key = name === null ? null : normaliseSupplierName(name);
          const supplierId =
            key === null
              ? undefined
              : (supplierByName.get(key) ?? supplierByName.get(SUPPLIER_NAME_ALIASES.get(key) ?? ""));
          const numeroImport = text(row.numero_import) ?? `LEGACY-${String(row.id)}`;
          if (supplierId === undefined) {
            blockedShipments.add(String(row.id));
            count("shipments blocked");
            lines.push(
              `shipment ${numeroImport}: no supplier "${name ?? "(none)"}" here — create it, then re-run; its reels wait`,
            );
            continue;
          }
          const created = await tx.importShipment.create({
            data: {
              legacyId: BigInt(String(row.id)),
              numeroImport,
              dateImport:
                typeof row.date_import_day === "string"
                  ? new Date(`${row.date_import_day}T00:00:00.000Z`)
                  : null,
              supplierId,
              productName: text(row.nom_produit),
              totalMetrage: num(row.total_metrage),
              totalRolls: int(row.total_rouleaux),
              price: num(row.prix),
              priceTotal: num(row.prix_total),
              currency: "EUR",
              transportIncluded: typeof row.transport_inclus === "boolean" ? row.transport_inclus : null,
              transportPrice: num(row.prix_transport),
              hasCertificate: typeof row.has_certificate === "boolean" ? row.has_certificate : null,
              certificate: text(row.certificat),
              packingList: text(row.packing_list),
              importFile: text(row.fichier_import),
              observations: text(row.observations),
            },
            select: { id: true },
          });
          shipmentIds.set(String(row.id), created.id);
          count("shipments created");
          lines.push(`shipment ${numeroImport}: created`);
        }

        // ---- reels ----------------------------------------------------------

        const reelsHere = await tx.paperRoll.findMany({
          where: { legacyId: { not: null } },
          select: {
            id: true,
            legacyId: true,
            parentId: true,
            updatedAt: true,
            legacySyncedAt: true,
            receivedAt: true,
            disponible: true,
            reserved: true,
            poidsReserve: true,
            metrageReserve: true,
            numero: true,
            numeroInterne: true,
            numeroSource: true,
            paperGrade: true,
            description: true,
            metrage: true,
            metrageRestant: true,
            poids: true,
            poidsRestant: true,
            laize: true,
            grammage: true,
            paperType: true,
            price: true,
            priceWithTransport: true,
            valide: true,
            partiel: true,
            consomme: true,
            archived: true,
            dateConsommation: true,
            consumedByNote: true,
            qrCodeUrl: true,
            importShipmentId: true,
          },
        });
        const hereByLegacy = new Map(reelsHere.map((row) => [String(row.legacyId), row]));
        const reels = new Map<string, Reel>();
        const oldAppIds = new Set<string>();

        /** Old-app reels that have split pieces. */
        const oldAppParents = new Set(
          reelRows.filter((row) => row.parent_id !== null).map((row) => String(row.parent_id)),
        );

        for (const row of reelRows) {
          const legacyKey = String(row.id);
          oldAppIds.add(legacyKey);
          const importKey = row.import_id === null ? null : String(row.import_id);
          if (importKey !== null && blockedShipments.has(importKey)) continue;
          const data: ReelData = reelData(row, importKey === null ? null : (shipmentIds.get(importKey) ?? null));
          const here = hereByLegacy.get(legacyKey);
          let id: string;
          let frozenWhy: string | null = null;

          if (!here) {
            const created = await tx.paperRoll.create({
              data: {
                ...data,
                ...synced,
                legacyId: BigInt(legacyKey),
                disponible: etlDisponible(row),
                reserved: false,
                // Every old-app reel is on the floor: it has no pending state.
                receivedAt: stamp,
              },
              select: { id: true },
            });
            id = created.id;
            count("reels created");
            lines.push(`reel ${data.numero ?? legacyKey}: created`);
          } else {
            id = here.id;
            const changed = changedFields(here, data);
            if (changedHere(here)) {
              frozenWhy = "reel changed in this app";
              if (changed.length > 0) {
                count("reels changed here, left");
                lines.push(
                  `reel ${here.numero ?? legacyKey}: changed in this app, old app's ${changed.join(", ")} not applied`,
                );
              }
            } else if (here.archived && !data.archived && oldAppParents.has(legacyKey)) {
              // The old app put a split reel back in stock while its pieces
              // are still in stock too (8201007, 12 Oct): the same paper
              // twice. The pieces are the stock; the reel stays archived
              // here (user, 2026-10-12).
              frozenWhy = "split reel the old app put back in stock, kept archived here";
              count("split reels put back in stock by the old app, left archived");
              lines.push(`reel ${here.numero ?? legacyKey}: split, but back in stock in the old app — left archived`);
            } else if (changed.length > 0) {
              await tx.paperRoll.update({ where: { id }, data: { ...data, ...synced }, select: { id: true } });
              count("reels updated");
              lines.push(`reel ${here.numero ?? legacyKey}: ${changed.join(", ")}`);
            }
          }

          const frozen = frozenWhy !== null;
          const current = frozen && here ? here : data;
          reels.set(legacyKey, {
            id,
            numero: current.numero,
            frozen,
            frozenWhy,
            live: !current.consomme && !current.archived && (here ? here.receivedAt !== null : true),
            disponible: frozen && here ? here.disponible : etlDisponible(row),
            metrageRestant: current.metrageRestant,
            poidsRestant: current.poidsRestant,
            laize: current.laize,
            grammage: current.grammage,
            reservedMetres: 0,
            usedUpAt: row.statut === "ARCHIVE" ? timestamp(row.date_consommation) : null,
          });
        }

        const goneFromOldApp = reelsHere.filter((row) => !oldAppIds.has(String(row.legacyId)));
        if (goneFromOldApp.length > 0) {
          lines.push(`${goneFromOldApp.length} reel(s) here are no longer in the old app — left as they are`);
        }

        // Split lineage, now every reel has an id. 04_stock.sql leaves a
        // parent that does not exist as NULL.
        for (const row of reelRows) {
          const reel = reels.get(String(row.id));
          if (!reel || reel.frozen) continue;
          const parentId =
            row.parent_id === null ? null : (reels.get(String(row.parent_id))?.id ?? null);
          const before = hereByLegacy.get(String(row.id))?.parentId ?? null;
          if (parentId === before) continue;
          await tx.paperRoll.update({ where: { id: reel.id }, data: { parentId, ...synced }, select: { id: true } });
          count("split links set");
        }

        // ---- allocations ----------------------------------------------------

        const orders = await tx.order.findMany({
          where: { legacyId: { not: null } },
          select: { id: true, legacyId: true, numero: true, kind: true, status: true, active: true },
        });
        const orderByLegacy = new Map(orders.map((row) => [String(row.legacyId), row]));
        const allocationsHere = await tx.rollAllocation.findMany({
          where: { legacyId: { not: null } },
          select: {
            id: true,
            legacyId: true,
            state: true,
            metrageReserve: true,
            paperRollId: true,
            updatedAt: true,
            legacySyncedAt: true,
          },
        });
        const allocationByLegacy = new Map(allocationsHere.map((row) => [String(row.legacyId), row]));
        const reelById = new Map([...reels.values()].map((reel) => [reel.id, reel]));

        const label = (row: Row) => {
          const order = orderByLegacy.get(String(row.commande_id));
          const reel = reels.get(String(row.rouleau_id));
          return `${order?.numero ?? `order ${String(row.commande_id)}`} / reel ${reel?.numero ?? String(row.rouleau_id)}`;
        };

        /**
         * The old app's state, read the way the user decided (2026-10-12):
         * its warehouse archives a reel when it is used up and leaves the
         * reservation on it open, so RESERVED on a reel archived with a
         * consumption date is CONSUMED, on that date. `poids` stays the kg.
         * Applies to the first import's open rows too (user, same day).
         */
        const oldAppState = (row: Row, reel: Reel | undefined) => {
          const state = String(row.etat);
          return state === "RESERVED" && reel?.usedUpAt
            ? { state: "CONSUMED" as const, dateConsommation: reel.usedUpAt, readAsUsed: true }
            : { state, dateConsommation: timestamp(row.date_consommation), readAsUsed: false };
        };

        // Existing rows first, so a reservation the old app has settled
        // frees its metres before new ones are measured against the reel.
        for (const row of allocationRows) {
          const here = allocationByLegacy.get(String(row.id));
          if (!here) continue;
          const reel = reelById.get(here.paperRollId);
          const old = oldAppState(row, reel);
          const state = old.state as AllocationState;
          if (here.state === state) continue;
          if (here.state !== "RESERVED") {
            count("allocations settled here, left");
            lines.push(`allocation ${label(row)}: ${here.state} here, ${state} in the old app — left`);
            continue;
          }
          if (changedHere(here) || (here.metrageReserve !== null && (!reel || reel.frozen))) {
            count("allocations changed here, left");
            lines.push(`allocation ${label(row)}: changed in this app, old app's ${state} not applied`);
            continue;
          }
          await tx.rollAllocation.update({
            where: { id: here.id },
            data: {
              state,
              dateConsommation: old.dateConsommation,
              dateAnnulation: timestamp(row.date_annulation),
              ...synced,
            },
            select: { id: true },
          });
          count(`allocations RESERVED -> ${state}`);
          lines.push(
            `allocation ${label(row)}: RESERVED -> ${state}` +
              (old.readAsUsed ? " (reel archived as used up in the old app)" : ""),
          );
        }

        const held = await tx.rollAllocation.groupBy({
          by: ["paperRollId"],
          where: { state: "RESERVED", metrageReserve: { not: null } },
          _sum: { metrageReserve: true },
        });
        for (const row of held) {
          const reel = reelById.get(row.paperRollId);
          if (reel) reel.reservedMetres = row._sum.metrageReserve ?? 0;
        }

        for (const row of allocationRows) {
          if (allocationByLegacy.has(String(row.id))) continue;
          const order = orderByLegacy.get(String(row.commande_id));
          const reel = reels.get(String(row.rouleau_id));
          const old = oldAppState(row, reel);
          const state = old.state;
          const dateAllocation = timestamp(row.date_allocation);
          if (!order || !reel || !(ALLOCATION_STATES as readonly string[]).includes(state) || !dateAllocation) {
            count("allocations skipped");
            lines.push(
              `allocation ${label(row)}: skipped — ` +
                (!order ? "order not here" : !reel ? "reel not here" : !dateAllocation ? "no date" : `state "${state}"`),
            );
            continue;
          }
          const kg = num(row.poids) ?? 0;
          const base = {
            legacyId: BigInt(String(row.id)),
            orderId: order.id,
            paperRollId: reel.id,
            state: state as AllocationState,
            dateAllocation,
            dateConsommation: old.dateConsommation,
            dateAnnulation: timestamp(row.date_annulation),
            ...synced,
          };

          if (state !== "RESERVED") {
            await tx.rollAllocation.create({
              data: { ...base, poidsReserve: kg, metrageReserve: old.readAsUsed ? null : num(row.metrage_reserve) },
              select: { id: true },
            });
            if (old.readAsUsed) {
              count("allocations created CONSUMED (reel used up in the old app)");
              lines.push(
                `allocation ${label(row)}: ${fmt.format(kg)} kg consumed — open in the old app, reel archived as used up`,
              );
            } else {
              count(`allocations created ${state} (history)`);
            }
            continue;
          }

          // An open reservation: in metres if this app can hold it.
          const perMetre = kgPerMetre(reel);
          const free = reel.metrageRestant - reel.reservedMetres;
          let metres = num(row.metrage_reserve) ?? (perMetre > 0 ? kg / perMetre : null);
          if (metres !== null && free > 0 && Math.abs(metres - free) <= free * WHOLE_REEL_SLACK) {
            metres = free;
          }
          const byWeightBecause = !RESERVABLE_ORDER_STATUSES.has(order.status) || order.kind !== "ORDER" || !order.active
            ? `order is ${order.kind === "ORDER" ? order.status : order.kind}${order.active ? "" : " (archived)"} here`
            : reel.frozen
              ? (reel.frozenWhy ?? "reel changed in this app")
              : !reel.live
                ? "reel used up or archived"
                : metres === null
                  ? "reel has no length or weight to convert with"
                  : metres > free
                    ? `${fmt.format(metres)} m asked, ${fmt.format(Math.max(free, 0))} m free`
                    : null;

          if (byWeightBecause !== null || metres === null) {
            await tx.rollAllocation.create({
              data: { ...base, poidsReserve: kg, metrageReserve: null },
              select: { id: true },
            });
            count("allocations created RESERVED by weight");
            lines.push(`allocation ${label(row)}: ${fmt.format(kg)} kg reserved by weight only — ${byWeightBecause ?? ""}`);
            continue;
          }
          await tx.rollAllocation.create({
            data: { ...base, metrageReserve: metres, poidsReserve: metres * perMetre },
            select: { id: true },
          });
          reel.reservedMetres += metres;
          count("allocations created RESERVED in metres");
          lines.push(`allocation ${label(row)}: ${fmt.format(metres)} m reserved (${fmt.format(kg)} kg in the old app)`);
        }

        // ---- reserve counters -----------------------------------------------

        const reservations = await tx.rollAllocation.groupBy({
          by: ["paperRollId"],
          where: { state: "RESERVED", metrageReserve: { not: null } },
          _sum: { metrageReserve: true, poidsReserve: true },
        });
        const sums = new Map(reservations.map((row) => [row.paperRollId, row._sum]));
        const after = await tx.paperRoll.findMany({
          where: { id: { in: [...reels.values()].filter((reel) => !reel.frozen).map((reel) => reel.id) } },
          select: { id: true, metrageReserve: true, poidsReserve: true, reserved: true, disponible: true },
        });
        for (const row of after) {
          const reel = reelById.get(row.id);
          if (!reel) continue;
          const sum = sums.get(row.id);
          const metrageReserve = sum?.metrageReserve ?? 0;
          const want: Prisma.PaperRollUpdateInput = {
            metrageReserve,
            poidsReserve: sum?.poidsReserve ?? 0,
            reserved: metrageReserve > 0,
            // Only a reservation takes a reel off offer; otherwise the ETL's flag stands.
            disponible: reel.disponible && !(metrageReserve > 0 && reel.metrageRestant - metrageReserve <= 1e-9),
          };
          if (changedFields(row, want).length === 0) continue;
          await tx.paperRoll.update({ where: { id: row.id }, data: { ...want, ...synced }, select: { id: true } });
          count("reel counters rebuilt");
        }

        if (!apply) throw new DryRunRollback();
      },
      { timeout: 10 * 60 * 1000, maxWait: 60 * 1000 },
    );
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  } finally {
    await raw.end();
    await prisma.$disconnect();
  }

  for (const line of lines) console.log(line);
  console.log("");
  for (const [key, value] of Object.entries(counts).sort()) console.log(`${key}: ${value}`);
  if (Object.keys(counts).length === 0) console.log("nothing to do — already in step with the old app");
  console.log(apply ? "\napplied" : "\n(dry run — nothing written; --apply to write)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
