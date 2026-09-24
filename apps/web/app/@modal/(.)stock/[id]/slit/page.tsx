"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../../route-modal";
import { RollSlitForm } from "../../../../stock/roll-slit-form";

export default function Modal() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("stock");
  return (
    <RouteModal path={`/stock/${id}/slit`} eyebrow={t("eyebrow")} title={t("rolls.slit.title")}>
      {(nav) => <RollSlitForm rollId={id} {...nav} />}
    </RouteModal>
  );
}
