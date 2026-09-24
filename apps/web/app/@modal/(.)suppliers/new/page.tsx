"use client";

import { useTranslations } from "next-intl";
import { RouteModal } from "../../route-modal";
import { SupplierForm } from "../../../suppliers/supplier-form";

export default function Modal() {
  const t = useTranslations("suppliers");
  return (
    <RouteModal path="/suppliers/new" eyebrow={t("eyebrow")} title={t("newTitle")}>
      {(nav) => <SupplierForm {...nav} />}
    </RouteModal>
  );
}
