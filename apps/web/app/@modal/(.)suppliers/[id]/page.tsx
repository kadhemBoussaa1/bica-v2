"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../route-modal";
import { EditSupplier } from "../../../suppliers/[id]/edit-supplier";

export default function Modal() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("suppliers");
  return (
    <RouteModal path={`/suppliers/${id}`} eyebrow={t("eyebrow")} title={t("editTitle")}>
      {(nav) => <EditSupplier id={id} {...nav} />}
    </RouteModal>
  );
}
