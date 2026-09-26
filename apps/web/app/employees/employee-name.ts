/**
 * How a person is named across the app: surname first, as the roster and the
 * legacy sheets write it, with the matricule when both names are blank.
 */
export function employeeName(employee: { firstName: string; lastName: string; matricule: string }): string {
  return [employee.lastName, employee.firstName].filter(Boolean).join(" ") || employee.matricule;
}
