"use client";

import { useTranslations } from "next-intl";
import { RouteModal } from "../../route-modal";
import { OrderForm } from "../../../orders/order-form";

export default function Modal() {
  const t = useTranslations("orders");
  return (
    <RouteModal path="/orders/new" eyebrow={t("eyebrow")} title={t("newTitle")} size="wide">
      {(nav) => <OrderForm {...nav} />}
    </RouteModal>
  );
}
