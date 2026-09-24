import { listQueryBase } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import type { ListDeclaration } from "../list/list-query";

export const EMPLOYEE_SORT_KEYS = [
  "lastName",
  "matricule",
  "department",
  "hireDate",
  "createdAt",
] as const;
export type EmployeeSortKey = (typeof EMPLOYEE_SORT_KEYS)[number];

export const EMPLOYEE_FACET_KEYS = ["onRoster", "suspended", "archived"] as const;
export type EmployeeFacet = (typeof EMPLOYEE_FACET_KEYS)[number];

/**
 * On the roster: active in this app AND not carrying the legacy `suspended`
 * flag. The `onRoster` facet, the shift planner's roster and the dashboard's
 * head count all read this one predicate.
 */
export const ON_ROSTER_WHERE = { active: true, suspended: false } satisfies Prisma.EmployeeWhereInput;

/**
 * The employees module's list vocabulary — a security boundary, and more
 * literally than the others: this file decides which columns can be sorted on,
 * and **a sort leaks the values of the column it sorts by**, through row order,
 * even when that column is never returned.
 *
 * So `salary`, `cin`, `socialSecurityNumber`, `birthDate` and `address` are
 * absent from `sortable` AND from `searchable`. Sorting by salary would let any
 * caller who can list employees rank them by pay; searching `cin` would confirm
 * a national ID by whether a row comes back. Neither is acceptable at
 * PRODUCTION/MAGASINIER rank, and neither is worth the risk at ADMIN.
 *
 * `suspended` is a legacy roster flag (55 of 94 rows) and is NOT the same as
 * `active`, which is this app's archive flag. Both are facets: "on roster"
 * means active and not suspended.
 */
export const employeeListDeclaration: ListDeclaration<
  Prisma.EmployeeWhereInput,
  Prisma.EmployeeOrderByWithRelationInput,
  EmployeeSortKey,
  EmployeeFacet
> = {
  sortable: {
    lastName: (dir) => [{ active: "desc" }, { lastName: dir }, { firstName: dir }],
    matricule: (dir) => [{ active: "desc" }, { matricule: dir }],
    department: (dir) => [{ active: "desc" }, { department: dir }],
    hireDate: (dir) => [{ active: "desc" }, { hireDate: dir }],
    createdAt: (dir) => [{ active: "desc" }, { createdAt: dir }],
  },
  defaultSort: "lastName",
  // Deliberately excludes every restricted field — see above.
  searchable: ["firstName", "lastName", "matricule", "jobTitle", "department"],
  facets: {
    onRoster: ON_ROSTER_WHERE,
    suspended: { active: true, suspended: true },
    archived: { active: false },
  },
};

/**
 * What everyone who can reach the employees list may read: enough to know who
 * someone is and what they do, so work can be assigned to them.
 */
export const EMPLOYEE_SELECT = {
  id: true,
  matricule: true,
  firstName: true,
  lastName: true,
  department: true,
  jobTitle: true,
  employmentType: true,
  categorie: true,
  echelon: true,
  gender: true,
  email: true,
  phone: true,
  phone2: true,
  hireDate: true,
  contractEndDate: true,
  photo: true,
  suspended: true,
  suspendedAt: true,
  suspensionReason: true,
  active: true,
  // The account they sign in with — the employee form's "Linked account".
  userId: true,
  createdAt: true,
} satisfies Prisma.EmployeeSelect;

/**
 * ADMIN and above additionally read salary, national ID, social security
 * number, date of birth and home address.
 *
 * Expressed as a wider `select` rather than by fetching everything and deleting
 * keys afterwards: the restricted columns must never leave Postgres for a
 * caller who is not entitled to them, because anything fetched can be leaked by
 * a later mistake.
 */
export const EMPLOYEE_SELECT_SENSITIVE = {
  ...EMPLOYEE_SELECT,
  salary: true,
  salaryGross: true,
  cin: true,
  socialSecurityNumber: true,
  birthDate: true,
  address: true,
} satisfies Prisma.EmployeeSelect;

export const listEmployeesInput = listQueryBase.extend({
  sortBy: z.enum(EMPLOYEE_SORT_KEYS).default("lastName"),
  filter: z.enum(["all", ...EMPLOYEE_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("asc"),
});

export type ListEmployeesInput = z.infer<typeof listEmployeesInput>;
