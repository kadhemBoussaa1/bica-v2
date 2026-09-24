"use client";

import { useTranslations } from "next-intl";
import { RouteModal } from "../../../route-modal";
import { PurchaseInvoiceForm } from "../../../../invoices/purchases/purchase-invoice-form";

export default function Modal() {
  const t = useTranslations("invoices");
  return (
    <RouteModal path="/invoices/purchases/new" eyebrow={t("eyebrow")} title={t("purchases.new")} size="wide">
      {(nav) => <PurchaseInvoiceForm {...nav} />}
    </RouteModal>
  );
}
