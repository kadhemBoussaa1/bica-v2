import { createHash, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { DEFAULT_PAGE, MAX_PAGE } from "./stock-api.contract";
import type { StockReferenceService } from "./stock-api.reference";
import { HistoryUnavailableError, type StockApiService } from "./stock-api.service";

/** Where BICA Expert's base URL points: https://<host>/integration/v1. */
export const STOCK_API_BASE = "/integration/v1";

/** Calls per key per minute. BICA polls every 2 min and reconciles every 15. */
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

// "A limit larger than you allow is fine": clamped, not refused.
const pageSize = z.coerce
  .number()
  .int()
  .positive()
  .default(DEFAULT_PAGE)
  .transform((size) => Math.min(size, MAX_PAGE));
const page = z.coerce.number().int().positive().default(1);

const movementsQuery = z.object({
  afterSequence: z.coerce.number().int().nonnegative().default(0),
  limit: pageSize,
  eventType: z.enum(["stock.movement", "stock.snapshot"]).optional(),
  since: z.string().optional(),
});

const asOfQuery = z.object({ asOf: z.string().optional() });

const lotsQuery = z.object({
  sku: z.string().trim().min(1).optional(),
  warehouseCode: z.string().trim().min(1).optional(),
  onHandOnly: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  page,
  pageSize,
});

const partnersQuery = z.object({ role: z.enum(["SUPPLIER", "CUSTOMER"]).optional() });

const productionOrdersQuery = z.object({
  status: z.enum(["OPEN", "COMPLETED", "CANCELLED"]).optional(),
  page,
  pageSize,
});

const historyQuery = z.object({
  since: z.string().optional(),
  until: z.string().optional(),
  page,
  pageSize,
});

class BadRequest extends Error {
  constructor(
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
  }
}

function digest(key: string): Buffer {
  return createHash("sha256").update(key).digest();
}

/**
 * A date parameter as an instant. A bare date is the END of that day in UTC
 * for `asOf` and `until` — closing stock, what a period close asks for —
 * and its START for `since`; a datetime must carry its zone, so nobody's
 * local midnight is guessed at.
 */
function parseInstant(
  name: string,
  raw: string | undefined,
  edge: "start" | "end" = "end",
): Date | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const start = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== raw) {
      throw new BadRequest(`${name} is not a real date`);
    }
    return edge === "start" ? start : new Date(start.getTime() + 86_400_000 - 1);
  }
  const instant = new Date(raw);
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(raw) || Number.isNaN(instant.getTime())) {
    throw new BadRequest(`${name} must be YYYY-MM-DD or an ISO 8601 datetime with a zone`);
  }
  return instant;
}

function parse<T>(schema: z.ZodType<T>, query: unknown): T {
  const result = schema.safeParse(query);
  if (!result.success) throw new BadRequest("Invalid query parameters", result.error.issues);
  return result.data;
}

/**
 * The read API BICA Expert pulls from — docs/erp-stock-api.md.
 *
 * Plain Express routes beside the PDFs and the notification stream, not
 * tRPC: the caller is another company's server, holding a bearer key rather
 * than a session, and the contract is plain JSON. Read-only, so not audited.
 *
 * Keys come from STOCK_API_KEYS, comma-separated: two at once is how a key
 * is rotated without downtime. They are compared as SHA-256 digests in
 * constant time. With none set, the API answers 503 — it exists, it is
 * just not switched on.
 */
export function mountStockApi(
  http: Express,
  api: StockApiService,
  reference: StockReferenceService,
): void {
  const keys = (process.env.STOCK_API_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean)
    .map(digest);
  if (keys.length === 0) console.log("[stock-api] pull API is off: STOCK_API_KEYS not set");

  const windows = new Map<number, { start: number; count: number }>();

  const authorize = (req: Request, res: Response): boolean => {
    if (keys.length === 0) {
      res.status(503).json({ error: "The stock API is not configured" });
      return false;
    }
    const match = /^Bearer\s+(\S+)$/i.exec(req.get("authorization") ?? "");
    const presented = match?.[1] ? digest(match[1]) : null;
    const index = presented ? keys.findIndex((key) => timingSafeEqual(key, presented)) : -1;
    if (index < 0) {
      res.status(401).set("WWW-Authenticate", "Bearer").json({ error: "Invalid API key" });
      return false;
    }

    const now = Date.now();
    const window = windows.get(index);
    if (!window || now - window.start >= RATE_WINDOW_MS) {
      windows.set(index, { start: now, count: 1 });
    } else if (++window.count > RATE_LIMIT) {
      const retryAfter = Math.ceil((window.start + RATE_WINDOW_MS - now) / 1000);
      res.status(429).set("Retry-After", String(retryAfter)).json({ error: "Too many requests" });
      return false;
    }
    return true;
  };

  const route = (path: string, handler: (req: Request) => Promise<unknown>) => {
    http.get(`${STOCK_API_BASE}${path}`, async (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      if (!authorize(req, res)) return;
      try {
        res.json(await handler(req));
      } catch (cause) {
        if (cause instanceof BadRequest) {
          res.status(400).json({ error: cause.message, issues: cause.issues });
        } else if (cause instanceof HistoryUnavailableError) {
          res.status(422).json({
            error: cause.message,
            historyStartsAt: cause.historyStartsAt.toISOString(),
          });
        } else {
          console.error(`[stock-api] ${req.path} failed`, cause);
          res.status(500).json({ error: "Internal error" });
        }
      }
    });
  };

  route("/health", () => api.health());

  route("/stock/movements", async (req) => {
    const { afterSequence, limit, eventType, since } = parse(movementsQuery, req.query);
    return api.movements(afterSequence, limit, {
      eventType,
      since: parseInstant("since", since, "start"),
    });
  });

  route("/stock/levels", async (req) => {
    const { asOf } = parse(asOfQuery, req.query);
    return api.levels(parseInstant("asOf", asOf));
  });

  route("/stock/valuation", async (req) => {
    const { asOf } = parse(asOfQuery, req.query);
    return api.valuation(parseInstant("asOf", asOf));
  });

  route("/stock/lots", async (req) => reference.lots(parse(lotsQuery, req.query)));

  route("/stock/history", async (req) => {
    const query = parse(historyQuery, req.query);
    return reference.history({
      page: query.page,
      pageSize: query.pageSize,
      since: parseInstant("since", query.since, "start"),
      until: parseInstant("until", query.until),
    });
  });

  route("/partners", async (req) => reference.partners(parse(partnersQuery, req.query).role));

  route("/production/orders", async (req) =>
    reference.productionOrderList(parse(productionOrdersQuery, req.query)),
  );
}
