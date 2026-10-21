/**
 * How a person is named across the app: surname first, as the roster and the
 * legacy sheets write it, with the matricule when both names are blank.
 */
export function employeeName(employee: { firstName: string; lastName: string; matricule: string }): string {
  return [employee.lastName, employee.firstName].filter(Boolean).join(" ") || employee.matricule;
}

/**
 * The name as the employees list and its cards print it, from
 * `Employes Cartes.dc.html`: a name typed all in capitals ("BEN HSSINE
 * FARAH") is set in title case, so half the roster does not shout; any
 * other casing is kept as typed. Display only — search and sort read the
 * stored name, and the matricule fallback is never recased.
 */
export function employeeDisplayName(employee: {
  firstName: string;
  lastName: string;
  matricule: string;
}): string {
  const name = employeeName(employee);
  if (!employee.firstName && !employee.lastName) return name;
  if (name !== name.toUpperCase() || name === name.toLowerCase()) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}
