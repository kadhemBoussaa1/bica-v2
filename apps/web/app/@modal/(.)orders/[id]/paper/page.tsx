"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../../route-modal";
import { RollPicker } from "../../../../orders/[id]/paper/roll-picker";

export default function Modal() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("orders");
  return (
    <RouteModal path={`/orders/${id}/paper`} eyebrow={t("eyebrow")} title={t("picker.title")} size="wide">
      {(nav) => <RollPicker orderId={id} {...nav} />}
    </RouteModal>
  );
}
