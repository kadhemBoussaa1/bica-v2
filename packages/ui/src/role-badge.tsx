import { ROLES, type Role } from "@repo/api-contract";
import styles from "./components.module.css";

/**
 * A user's role. Deliberately distinct from StatusBadge: roles are an identity
 * attribute, not a workflow state, so they read as quiet chrome rather than
 * competing with job-order status colours. Rank drives the weight — the
 * higher the role, the stronger the treatment — and the two rank-50 siblings
 * share one, since they share a rank.
 */
const ROLE_STYLES: Record<Role, string | undefined> = {
  SUPER_ADMIN: styles.roleSuperAdmin,
  ADMIN: styles.roleAdmin,
  PRODUCTION: styles.roleStaff,
  MAGASINIER: styles.roleStaff,
};

/**
 * `label` is the translated role name; the toolkit has no translation layer,
 * so without it the raw role reads as English chrome ("SUPER ADMIN").
 */
export function RoleBadge({ role, label }: { role: Role; label?: string }) {
  return (
    <span className={[styles.roleBadge, ROLE_STYLES[role]].filter(Boolean).join(" ")}>
      {label ?? role.replace("_", " ")}
    </span>
  );
}

export { ROLES };
export type { Role };
