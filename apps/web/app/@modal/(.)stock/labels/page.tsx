"use client";

import { useSearchParams } from "next/navigation";
import { LabelsModal } from "../../../stock/labels/labels-dialog";

export default function Modal() {
  const params = useSearchParams();
  const shipment = params.get("shipment") ?? undefined;
  const rolls = params.get("rolls")?.split(",").filter(Boolean);
  return <LabelsModal shipmentId={shipment} rollIds={rolls} />;
}
