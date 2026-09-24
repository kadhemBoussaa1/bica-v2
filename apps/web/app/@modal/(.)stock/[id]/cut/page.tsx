"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../../route-modal";
import { RollCutForm } from "../../../../stock/roll-cut-form";

export default function Modal() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("stock");
  return (
    <RouteModal path={`/stock/${id}/cut`} eyebrow={t("eyebrow")} title={t("rolls.cut.title")}>
      {(nav) => <RollCutForm rollId={id} {...nav} />}
    </RouteModal>
  );
}
