"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../../../route-modal";
import { EditPurchaseOrder } from "../../../../../purchasing/orders/[id]/edit/edit-purchase-order";

export default function Modal() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("purchasing");
  return (
    <RouteModal
      path={`/purchasing/orders/${id}/edit`}
      eyebrow={t("eyebrow")}
      title={t("orders.editTitle")}
      size="wide"
    >
      {(nav) => <EditPurchaseOrder id={id} {...nav} />}
    </RouteModal>
  );
}
