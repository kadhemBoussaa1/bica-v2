"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../route-modal";
import { RollForm } from "../../../stock/roll-form";

export default function Modal() {
  const shipment = useSearchParams().get("shipment") ?? undefined;
  const t = useTranslations("stock");
  return (
    <RouteModal path="/stock/new" eyebrow={t("eyebrow")} title={t("rolls.newTitle")}>
      {(nav) => <RollForm shipmentId={shipment} {...nav} />}
    </RouteModal>
  );
}
