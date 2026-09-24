"use client";

import { useTranslations } from "next-intl";
import { RouteModal } from "../../../route-modal";
import { InkForm } from "../../../../stock/inks/ink-form";

export default function Modal() {
  const t = useTranslations("stock");
  return (
    <RouteModal path="/stock/inks/new" eyebrow={t("eyebrow")} title={t("inks.newColour")}>
      {(nav) => <InkForm {...nav} />}
    </RouteModal>
  );
}
