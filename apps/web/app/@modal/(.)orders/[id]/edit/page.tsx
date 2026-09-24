"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../../route-modal";
import { EditOrder } from "../../../../orders/[id]/edit/edit-order";

export default function Modal() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("orders");
  return (
    <RouteModal path={`/orders/${id}/edit`} eyebrow={t("eyebrow")} title={t("editTitle")} size="wide">
      {(nav) => <EditOrder id={id} {...nav} />}
    </RouteModal>
  );
}
