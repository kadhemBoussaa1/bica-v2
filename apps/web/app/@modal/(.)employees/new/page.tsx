"use client";

import { useTranslations } from "next-intl";
import { RouteModal } from "../../route-modal";
import { EmployeeForm } from "../../../employees/employee-form";

export default function Modal() {
  const t = useTranslations("employees");
  return (
    <RouteModal path="/employees/new" eyebrow={t("eyebrow")} title={t("newEmployee")}>
      {(nav) => <EmployeeForm {...nav} />}
    </RouteModal>
  );
}
