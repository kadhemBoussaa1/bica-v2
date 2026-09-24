"use client";

import { useTranslations } from "next-intl";
import { RouteModal } from "../../../route-modal";
import { PurchaseOrderForm } from "../../../../purchasing/orders/purchase-order-form";

export default function Modal() {
  const t = useTranslations("purchasing");
  return (
    <RouteModal
      path="/purchasing/orders/new"
      eyebrow={t("eyebrow")}
      title={t("orders.new")}
      size="wide"
    >
      {(nav) => <PurchaseOrderForm {...nav} />}
    </RouteModal>
  );
}
