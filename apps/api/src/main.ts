import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { TRPCError } from "@trpc/server";
import { toNodeHandler } from "better-auth/node";
import { json, type Request, type Response } from "express";
import {
  canAccess,
  DEFAULT_PDF_LOCALE,
  NOTIFICATION_STREAM_PATH,
  pdfLocaleSchema,
  salesInvoicePreviewInput,
  type PdfLocale,
  type Role,
} from "@repo/api-contract";
import { AppModule } from "./app.module";
import { getAuth } from "./auth/auth";
import { NotificationService } from "./notification/notification.service";
import { PdfService, type RenderedPdf } from "./pdf/pdf.service";
import { PrismaService } from "./prisma.service";
import { TrpcRouter } from "./trpc/trpc.router";
import type { SessionUser } from "./trpc/trpc";

const PORT = process.env.PORT ?? 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: CORS_ORIGIN, credentials: true });

  const trpcRouter = app.get(TrpcRouter);
  const prisma = app.get(PrismaService);
  const pdfService = app.get(PdfService);
  const notifications = app.get(NotificationService);
  const auth = await getAuth(prisma);

  // Better Auth owns /api/auth/* (sign-in, sign-out, session). Mounted before
  // the body parser, which it requires. Its /admin/* routes are refused over
  // HTTP by a before hook in auth.ts; UserService is the only way in.
  app.use("/api/auth/{*path}", toNodeHandler(auth));

  /**
   * The generated PDFs: purchase orders, goods receipts and sales invoices.
   *
   * One of the two HTTP surfaces here besides auth and tRPC (the other is
   * the notification stream below), and it exists because tRPC serialises
   * JSON: a PDF is bytes with a content type, and routing it
   * through a procedure would mean base64 in a JSON envelope. So these are
   * plain Express routes, which means they do their own session and role
   * check (`requireAdmin`) rather than inheriting `adminProcedure`'s.
   *
   * ADMIN and above, matching every purchasing and invoicing endpoint —
   * `canAccess` is the same function the tRPC guard uses, so the two cannot
   * drift. `inline` rather than `attachment`, so the browser's viewer can
   * show it in an iframe; the file name is still there for a save.
   *
   * Deliberately NOT audited. The audit middleware is tRPC's, and a document
   * read is a read: the procedures already record who opened the record this
   * renders from.
   */
  const requireAdmin = async (
    req: Request,
    res: Response,
  ): Promise<{ id: string; role: Role } | null> => {
    const session = await auth.api.getSession({
      headers: new Headers(req.headers as Record<string, string>),
    });
    const raw = session?.user as { id: string; role?: string; banned?: boolean } | undefined;
    const role = (raw?.role ?? "MAGASINIER") as Role;
    if (!raw || raw.banned) {
      res.status(401).json({ error: "Not signed in" });
      return null;
    }
    if (!canAccess(role, "ADMIN")) {
      res.status(403).json({ error: "Requires ADMIN privileges" });
      return null;
    }
    return { id: raw.id, role };
  };

  const sendPdf = (req: Request, res: Response, document: RenderedPdf) => {
    res.setHeader("Content-Disposition", `inline; filename="${document.fileName}"`);
    if (document.etag) {
      // A stored invoice never changes, so the browser may keep it — but
      // `no-cache` makes it ask first, which keeps the session and role check
      // on every view; a 304 then carries no bytes.
      res.setHeader("Cache-Control", "private, no-cache");
      res.setHeader("ETag", document.etag);
      if (req.headers["if-none-match"] === document.etag) {
        res.status(304).end();
        return;
      }
    } else {
      // A generated document reflects the record as it is now, and an order
      // or a draft is editable, so a cached copy would go stale silently.
      res.setHeader("Cache-Control", "no-store");
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(document.body.length));
    res.end(document.body);
  };

  // A TRPCError's message is written for the caller; anything else (Prisma,
  // react-pdf, S3) may carry internals, so it is logged and replaced.
  const sendError = (res: Response, cause: unknown) => {
    if (cause instanceof TRPCError) {
      const status =
        { NOT_FOUND: 404, CONFLICT: 409, BAD_REQUEST: 400, PRECONDITION_FAILED: 412 }[
          cause.code as string
        ] ?? 500;
      res.status(status).json({ error: cause.message });
      return;
    }
    console.error("[documents] render failed", cause);
    res.status(500).json({ error: "Could not render the document" });
  };

  const documentKinds: Record<string, (id: string, locale: PdfLocale) => Promise<RenderedPdf>> = {
    "purchase-order": (id, locale) => pdfService.purchaseOrder(id, locale),
    "goods-receipt": (id, locale) => pdfService.goodsReceipt(id, locale),
    "sales-invoice": (id, locale) => pdfService.salesInvoice(id, locale),
  };

  const http = app.getHttpAdapter().getInstance();

  http.get("/documents/:kind/:id.pdf", async (req: Request, res: Response) => {
    if (!(await requireAdmin(req, res))) return;

    const { kind, id } = req.params as { kind: string; id: string };
    const parsed = pdfLocaleSchema.safeParse(
      typeof req.query.lang === "string" ? req.query.lang : undefined,
    );
    // The schema defaults rather than rejects, so a bad `lang` still yields
    // the document — in French, as every legacy one was.
    const locale = parsed.success ? parsed.data : DEFAULT_PDF_LOCALE;

    const render = Object.hasOwn(documentKinds, kind) ? documentKinds[kind] : undefined;
    if (!render) {
      res.status(404).json({ error: "Unknown document kind" });
      return;
    }
    try {
      sendPdf(req, res, await render(id, locale));
    } catch (cause) {
      sendError(res, cause);
    }
  });

  /**
   * The live preview of a sales invoice: the unsaved draft in (`source:
   * "draft"`), or an unsaved layout to print the sample invoice with
   * (`"sample"`, SUPER_ADMIN), and the PDF it would print out. The same renderer as the real document, so the
   * preview cannot drift from it. Nothing is written.
   *
   * The body parser is route-level on purpose. Nest registers its global one
   * at `listen`, after everything here, and `app.useBodyParser` would put one
   * in front of Better Auth and tRPC, which both read the raw stream.
   *
   * Only `application/json` is accepted, and that is also the CSRF defence:
   * a JSON content type is not "simple", so a cross-site page cannot send it
   * without a CORS preflight, which only CORS_ORIGIN passes. Do not relax it
   * to accept `text/plain`.
   *
   * One render at a time per user, 429 for a second. The client serialises
   * its own requests (a render cannot be cancelled, so racing them would only
   * stack work here); this is the backstop for a client that does not.
   */
  const parseJson = json({ limit: "256kb" });
  const previewing = new Set<string>();

  http.post("/documents/sales-invoice/preview.pdf", async (req: Request, res: Response) => {
    const user = await requireAdmin(req, res);
    if (!user) return;
    if (!req.is("application/json")) {
      res.status(415).json({ error: "Send application/json" });
      return;
    }
    const bodyError = await new Promise<unknown>((resolve) => parseJson(req, res, resolve));
    if (bodyError) {
      const status = (bodyError as { status?: number }).status ?? 400;
      res.status(status).json({ error: status === 413 ? "The draft is too large" : "Malformed JSON" });
      return;
    }
    const input = salesInvoicePreviewInput.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "Invalid draft", issues: input.error.issues });
      return;
    }
    if (previewing.has(user.id)) {
      res.status(429).json({ error: "A preview is already rendering" });
      return;
    }

    // A layout is client-supplied and server-rendered: template writers only.
    if (input.data.source === "sample" && !canAccess(user.role, "SUPER_ADMIN")) {
      res.status(403).json({ error: "Requires SUPER_ADMIN privileges" });
      return;
    }

    previewing.add(user.id);
    try {
      const preview = input.data;
      sendPdf(
        req,
        res,
        preview.source === "sample"
          ? await pdfService.salesInvoiceSample(preview.layout, preview.status, preview.lang)
          : await pdfService.salesInvoicePreview(preview, preview.lang),
      );
    } catch (cause) {
      sendError(res, cause);
    } finally {
      previewing.delete(user.id);
    }
  });

  /**
   * The notification stream — docs/notifications-plan.md §4.4.
   *
   * A plain Express route for the PDF routes' reason: tRPC answers in JSON,
   * and a Server-Sent Events stream is an open response written to over
   * time. Any signed-in, non-banned account, any role; 401 otherwise, which
   * `EventSource` treats as final — the web hook (use-notification-stream)
   * then re-checks the session instead of retrying blindly.
   *
   * The stream carries `{ id, kind, toast }` and nothing else; the rows are
   * read through `notification.list`, which applies the role scope. So the
   * session is checked once here, and the stream's 15-minute lifetime
   * (`NotificationService.openStream`) is what re-checks it later.
   *
   * Not audited, like every read. No body parser: a GET with no body.
   */
  http.get(NOTIFICATION_STREAM_PATH, async (req: Request, res: Response) => {
    const session = await auth.api.getSession({
      headers: new Headers(req.headers as Record<string, string>),
    });
    const raw = session?.user as { id: string; banned?: boolean } | undefined;
    if (!raw || raw.banned) {
      res.status(401).json({ error: "Not signed in" });
      return;
    }
    notifications.openStream(raw.id, res);
  });

  app.use(
    "/trpc",
    createExpressMiddleware({
      router: trpcRouter.appRouter,
      createContext: async ({ req, res }) => {
        const session = await auth.api.getSession({
          headers: new Headers(req.headers as Record<string, string>),
        });

        // A banned user is treated as signed out.
        const raw = session?.user as
          | { id: string; email: string; name: string; role?: string; banned?: boolean }
          | undefined;
        // Set by the admin plugin while a higher-ranked user impersonates.
        const impersonatedBy =
          (session?.session as { impersonatedBy?: string | null } | undefined)
            ?.impersonatedBy ?? null;

        const user: SessionUser | null =
          raw && !raw.banned
            ? {
                id: raw.id,
                email: raw.email,
                name: raw.name,
                role: (raw.role ?? "MAGASINIER") as Role,
                impersonatedBy,
              }
            : null;

        return { prisma, user, req, res };
      },
    }),
  );

  // `req.ip` is the socket peer unless TRUST_PROXY names how many proxies sit
  // in front. Set it only where every request comes through a proxy that
  // overwrites X-Forwarded-For, or each audit row would carry an address the
  // client chose. The production compose file sets 1: nginx is the edge, and
  // the API publishes no port of its own. Unset in development.
  const proxyHops = Number(process.env.TRUST_PROXY ?? 0);
  if (proxyHops > 0) http.set("trust proxy", proxyHops);

  app.enableShutdownHooks();
  await app.listen(PORT);
}

void bootstrap();
