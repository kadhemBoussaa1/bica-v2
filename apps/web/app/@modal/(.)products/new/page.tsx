"use client";

import { useTranslations } from "next-intl";
import { RouteModal } from "../../route-modal";
import { ProductForm } from "../../../products/product-form";

export default function Modal() {
  const t = useTranslations("products");
  return (
    <RouteModal path="/products/new" eyebrow={t("eyebrow")} title={t("newTitle")}>
      {(nav) => <ProductForm {...nav} />}
    </RouteModal>
  );
}
