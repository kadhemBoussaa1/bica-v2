"use client";

import { useTranslations } from "next-intl";
import { RouteModal } from "../../../route-modal";
import { SalesInvoiceForm } from "../../../../invoices/sales/sales-invoice-form";

export default function Modal() {
  const t = useTranslations("invoices");
  return (
    <RouteModal path="/invoices/sales/new" eyebrow={t("eyebrow")} title={t("sales.new")} size="wide">
      {(nav) => <SalesInvoiceForm {...nav} />}
    </RouteModal>
  );
}
