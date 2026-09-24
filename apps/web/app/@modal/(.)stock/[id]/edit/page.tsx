"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../../route-modal";
import { EditRoll } from "../../../../stock/[id]/edit/edit-roll";

export default function Modal() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("stock");
  return (
    <RouteModal path={`/stock/${id}/edit`} eyebrow={t("eyebrow")} title={t("rolls.editReel")}>
      {(nav) => <EditRoll id={id} {...nav} />}
    </RouteModal>
  );
}
