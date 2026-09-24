import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EditPurchaseOrder } from "./edit-purchase-order";
import styles from "../../../../records/records.module.css";

export default async function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("purchasing");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href={`/purchasing/orders/${id}`}>
        {t("orders.backToOrder")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("orders.editTitle")}</h1>
        </div>
        <p className={styles.subtitle}>{t("orders.editSubtitle")}</p>
      </header>

      <EditPurchaseOrder id={id} />
    </div>
  );
}
