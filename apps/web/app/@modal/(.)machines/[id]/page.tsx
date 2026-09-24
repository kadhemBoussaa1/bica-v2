"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../route-modal";
import { EditMachine } from "../../../machines/[id]/edit-machine";

export default function Modal() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("machines");
  return (
    <RouteModal path={`/machines/${id}`} eyebrow={t("eyebrow")} title={t("editMachine")}>
      {(nav) => <EditMachine id={id} {...nav} />}
    </RouteModal>
  );
}
