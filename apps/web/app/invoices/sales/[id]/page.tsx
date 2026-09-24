import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SalesInvoiceDetail } from "./sales-invoice-detail";
import styles from "../../../records/records.module.css";

export default async function SalesInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("invoices");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/invoices/sales">
        {t("sales.back")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("sales.detailTitle")}</h1>
        </div>
        <p className={styles.subtitle}>{t("sales.detailSubtitle")}</p>
      </header>

      <SalesInvoiceDetail id={id} />
    </div>
  );
}
