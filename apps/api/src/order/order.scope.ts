import { ordersAreScopedFor, PRODUCTION_VISIBLE_ORDER_STATUSES, type Role } from "@repo/api-contract";
import type { Prisma } from "../generated/prisma/client.js";

/**
 * The orders a role may see, as a Prisma predicate — the one place the API
 * turns `ordersAreScopedFor` + `PRODUCTION_VISIBLE_ORDER_STATUSES` into a
 * `where`.
 *
 * A pure function rather than a method on `OrderService`, because the
 * services that need it cannot inject that service: `OrderService` itself
 * depends on `ProductService`, so the product's order list importing it back
 * would be a cycle. `OrderService`, `ProductService` and `ProductionService`
 * all read the scope from here, so the rule cannot drift between the orders
 * list and the other doors onto the same rows.
 *
 * Empty for the unscoped roles rather than a redundant predicate, so their
 * query plan is unchanged.
 */
export function orderScopeFor(role: Role): Prisma.OrderWhereInput {
  return ordersAreScopedFor(role)
    ? { status: { in: [...PRODUCTION_VISIBLE_ORDER_STATUSES] } }
    : {};
}
