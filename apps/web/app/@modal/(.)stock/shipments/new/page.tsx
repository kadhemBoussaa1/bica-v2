"use client";

import { useTranslations } from "next-intl";
import { RouteModal } from "../../../route-modal";
import { ShipmentForm } from "../../../../stock/shipments/shipment-form";

export default function Modal() {
  const t = useTranslations("stock");
  return (
    <RouteModal path="/stock/shipments/new" eyebrow={t("eyebrow")} title={t("shipments.newShipment")}>
      {(nav) => <ShipmentForm {...nav} />}
    </RouteModal>
  );
}
