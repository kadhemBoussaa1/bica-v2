"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../../../route-modal";
import { EditPurchaseInvoice } from "../../../../../invoices/purchases/[id]/edit/edit-purchase-invoice";

export default function Modal() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("invoices");
  return (
    <RouteModal path={`/invoices/purchases/${id}/edit`} eyebrow={t("eyebrow")} title={t("purchases.editTitle")} size="wide">
      {(nav) => <EditPurchaseInvoice id={id} {...nav} />}
    </RouteModal>
  );
}
