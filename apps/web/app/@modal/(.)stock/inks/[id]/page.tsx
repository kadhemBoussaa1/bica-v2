"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../../route-modal";
import { EditInk } from "../../../../stock/inks/[id]/edit-ink";

export default function Modal() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("stock");
  return (
    <RouteModal path={`/stock/inks/${id}`} eyebrow={t("eyebrow")} title={t("inks.editColour")}>
      {(nav) => <EditInk id={id} {...nav} />}
    </RouteModal>
  );
}
