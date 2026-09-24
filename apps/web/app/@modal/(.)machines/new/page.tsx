"use client";

import { useTranslations } from "next-intl";
import { RouteModal } from "../../route-modal";
import { MachineForm } from "../../../machines/machine-form";

export default function Modal() {
  const t = useTranslations("machines");
  return (
    <RouteModal path="/machines/new" eyebrow={t("eyebrow")} title={t("newMachine")}>
      {(nav) => <MachineForm {...nav} />}
    </RouteModal>
  );
}
