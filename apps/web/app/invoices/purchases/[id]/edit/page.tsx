import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EditPurchaseInvoice } from "./edit-purchase-invoice";
import styles from "../../../../records/records.module.css";

export default async function EditPurchaseInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("invoices");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href={`/invoices/purchases/${id}`}>
        {t("purchases.backToInvoice")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("purchases.editTitle")}</h1>
        </div>
        <p className={styles.subtitle}>{t("purchases.editSubtitle")}</p>
      </header>

      <EditPurchaseInvoice id={id} />
    </div>
  );
}
