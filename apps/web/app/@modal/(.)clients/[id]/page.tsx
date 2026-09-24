"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../route-modal";
import { EditClient } from "../../../clients/[id]/edit-client";

export default function Modal() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("clients");
  return (
    <RouteModal path={`/clients/${id}`} eyebrow={t("eyebrow")} title={t("editTitle")}>
      {(nav) => <EditClient id={id} {...nav} />}
    </RouteModal>
  );
}
