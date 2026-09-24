"use client";

import { useTranslations } from "next-intl";
import type { ShipmentKind, ShipmentStatus } from "@repo/api-contract";
import records from "../records/records.module.css";

/*
 * The pieces the outbound shipments list, record and editor share: the two
 * badges and the integer formatter. Money never appears here — the module
 * is the warehouse's. Parcel counts are an ICU plural in the module's
 * messages (`shipments.parcelCount`), so the callers format them.
 */

const int = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

export function formatInt(value: number): string {
  return int.format(value);
}

/** Draft / shipped, in the records module's status pills so a row reads like an order's. */
export function ShipmentStatusBadge({ status }: { status: ShipmentStatus }) {
  const enums = useTranslations("enums");
  return (
    <span
      className={[
        records.statusBadge,
        status === "SHIPPED" ? records.statusSuccess : records.statusNeutral,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {enums(`shipmentStatus.${status}`)}
    </span>
  );
}

/** Complete / partial — whether the truck took everything the order had left. */
export function ShipmentKindBadge({ kind }: { kind: ShipmentKind }) {
  const enums = useTranslations("enums");
  return (
    <span
      className={[
        records.statusBadge,
        kind === "PARTIAL" ? records.statusWarning : records.statusInfo,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {enums(`shipmentKind.${kind}`)}
    </span>
  );
}
