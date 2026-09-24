"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../route-modal";
import { EditEmployee } from "../../../employees/[id]/edit-employee";

export default function Modal() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("employees");
  return (
    <RouteModal path={`/employees/${id}`} eyebrow={t("eyebrow")} title={t("editEmployee")}>
      {(nav) => <EditEmployee id={id} {...nav} />}
    </RouteModal>
  );
}
