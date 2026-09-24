"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../../../route-modal";
import { EditShipment } from "../../../../../stock/shipments/[id]/edit/edit-shipment";

export default function Modal() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("stock");
  return (
    <RouteModal path={`/stock/shipments/${id}/edit`} eyebrow={t("eyebrow")} title={t("shipments.editShipment")}>
      {(nav) => <EditShipment id={id} {...nav} />}
    </RouteModal>
  );
}
