import type { TypeSac } from "@repo/api-contract";

/**
 * A bag's size as the floor reads it: width × gusset × length, in cm — the
 * order the invoices and packing lists print (`describeProductSpec`).
 * SOUS_PLAT has no gusset, so it is width × length.
 */
export function bagSize(spec: {
  typeSac: TypeSac;
  widthCm: number;
  lengthCm: number;
  gussetCm: number | null;
}): string {
  return spec.typeSac === "SOUS_PLAT"
    ? `${spec.widthCm}×${spec.lengthCm}`
    : `${spec.widthCm}×${spec.gussetCm ?? 0}×${spec.lengthCm}`;
}
