"use client";

import { useTranslations } from "next-intl";
import { RouteModal } from "../../route-modal";
import { ClientForm } from "../../../clients/client-form";

export default function Modal() {
  const t = useTranslations("clients");
  return (
    <RouteModal path="/clients/new" eyebrow={t("eyebrow")} title={t("newTitle")}>
      {(nav) => <ClientForm {...nav} />}
    </RouteModal>
  );
}
