"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../../route-modal";
import { EditProduct } from "../../../../products/[id]/edit/edit-product";

export default function Modal() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("products");
  return (
    <RouteModal path={`/products/${id}/edit`} eyebrow={t("eyebrow")} title={t("editTitle")}>
      {(nav) => <EditProduct id={id} {...nav} />}
    </RouteModal>
  );
}
