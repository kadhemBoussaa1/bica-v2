"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../../../route-modal";
import { EditGoodsReceipt } from "../../../../../purchasing/receipts/[id]/edit/edit-goods-receipt";

export default function Modal() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("purchasing");
  return (
    <RouteModal
      path={`/purchasing/receipts/${id}/edit`}
      eyebrow={t("eyebrow")}
      title={t("receipts.editTitle")}
      size="wide"
    >
      {(nav) => <EditGoodsReceipt id={id} {...nav} />}
    </RouteModal>
  );
}
