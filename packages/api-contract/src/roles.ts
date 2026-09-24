import { z } from "zod";

/**
 * Strictly ordered role hierarchy.
 *
 * SUPER_ADMIN (100) > ADMIN (75) > PRODUCTION (50) == MAGASINIER (50)
 *
 * PRODUCTION and MAGASINIER share a rank because they are siblings: an equal
 * rank means neither inherits the other's privileges, while everything above
 * them still passes a `>=` check.
 */
export const ROLES = ["SUPER_ADMIN", "ADMIN", "PRODUCTION", "MAGASINIER"] as const;

export const roleSchema = z.enum(ROLES);
export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = {
  SUPER_ADMIN: 100,
  ADMIN: 75,
  PRODUCTION: 50,
  MAGASINIER: 50,
};

/**
 * True when `role` sits at or above `required` in the hierarchy.
 *
 * Beware the sibling case: PRODUCTION and MAGASINIER share a rank, so this
 * returns true for one against the other. For gating a feature that belongs to
 * exactly one of them, use `canAccess` instead.
 */
export function hasRank(role: Role, required: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

/**
 * Feature gating that respects sibling isolation: a strictly higher rank always
 * passes (ADMIN and SUPER_ADMIN inherit downward), but at equal rank the role
 * must match exactly, so PRODUCTION cannot reach MAGASINIER-only features.
 */
export function canAccess(role: Role, required: Role): boolean {
  return role === required || ROLE_RANK[role] > ROLE_RANK[required];
}

/**
 * `canAccess` against any one of several roles — true when at least one passes.
 *
 * The case this exists for: a feature owned by ADMIN and above PLUS one
 * specific rank-50 sibling, e.g. "ADMIN+ or PRODUCTION". `canAccess` alone
 * cannot say that. Passing `["ADMIN", "PRODUCTION"]` admits ADMIN,
 * SUPER_ADMIN and PRODUCTION while still excluding MAGASINIER — the sibling
 * isolation holds, because each role is checked with `canAccess` rather than
 * by rank comparison.
 *
 * Order the list from the highest rank down; it reads as "ADMIN and above, or
 * also PRODUCTION" and matches how the transition table in
 * `order-lifecycle.ts` composes the same idea per row.
 */
export function canAccessAny(role: Role, required: readonly Role[]): boolean {
  return required.some((one) => canAccess(role, one));
}

/**
 * Roles permitted to create and manage others at their OWN rank.
 *
 * Deliberate exception to the strictly-below rule. SUPER_ADMIN is the top of
 * the hierarchy, so without this the only super admin could never be replaced
 * except by editing the database, and a lost account would lock everyone out.
 *
 * The trade-off is accepted knowingly: any super admin can mint another, and
 * (via canManageUser) ban, demote or delete an existing peer. Grant the role
 * accordingly — every holder can remove every other holder.
 */
const PEER_MANAGING_ROLES: ReadonlySet<Role> = new Set<Role>(["SUPER_ADMIN"]);

/** True when `actor` may act at its own rank, per PEER_MANAGING_ROLES. */
function allowsPeers(actor: Role, target: Role): boolean {
  return ROLE_RANK[actor] === ROLE_RANK[target] && PEER_MANAGING_ROLES.has(actor);
}

/**
 * Account creation rule: you may only create accounts strictly below your own
 * rank, unless your role manages peers (see PEER_MANAGING_ROLES).
 *
 * This still blocks escalation outright — no role can ever create one that
 * outranks it — and still blocks lateral expansion for ADMIN, which is not a
 * peer-managing role, so an ADMIN cannot create another ADMIN.
 *
 * Note the equal-rank check is on RANK, not role name: PRODUCTION and
 * MAGASINIER share rank 50, so adding either here would let one create the
 * other. Neither is peer-managing, so that does not arise today.
 */
export function canCreateRole(actor: Role, target: Role): boolean {
  return ROLE_RANK[actor] > ROLE_RANK[target] || allowsPeers(actor, target);
}

/** Roles `actor` is allowed to assign when creating an account. */
export function assignableRoles(actor: Role): Role[] {
  return ROLES.filter((r) => canCreateRole(actor, r));
}

/**
 * Management rule: acting ON another user (ban, delete, change role) requires
 * a strictly higher rank, or a peer-managing role at equal rank.
 *
 * Super admins can therefore ban, demote and delete each other. Acting on
 * YOURSELF is blocked separately in UserService.targetFor, so a super admin
 * cannot self-demote or self-delete by accident — but a peer can do it to
 * them.
 */
export function canManageUser(actor: Role, target: Role): boolean {
  return ROLE_RANK[actor] > ROLE_RANK[target] || allowsPeers(actor, target);
}
