// Shared validation schemas and inferred types.
//
// The AppRouter *type* is intentionally not re-exported here: tRPC infers it
// from the router implementation, which lives in `apps/api` because it depends
// on Prisma. `apps/web` imports that type directly with `import type`, so no
// server code is ever pulled into the browser bundle.
export * from "./assets.js";
export * from "./storage.js";
export * from "./schemas.js";
export * from "./roles.js";
export * from "./list.js";
export * from "./suppliers.js";
export * from "./partners.js";
export * from "./partner-names.js";
export * from "./production.js";
export * from "./orders.js";
export * from "./order-lifecycle.js";
export * from "./pricing.js";
export * from "./products.js";
export * from "./stock.js";
export * from "./scan.js";
export * from "./order-input.js";
export * from "./invoices.js";
export * from "./purchasing.js";
export * from "./pdf-locale.js";
export * from "./pdf-messages.js";
export * from "./document-layout.js";
export * from "./document-layout-sales-invoice.js";
export * from "./sales-invoice-model.js";
export * from "./document-templates.js";
export * from "./shipments.js";
export * from "./ink.js";
export * from "./allocation.js";
export * from "./inventory.js";
export * from "./chat.js";
export * from "./shifts.js";
