import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ProductDetail } from "./product-detail";
import styles from "../../records/records.module.css";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("products");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/products">
        {t("backToList")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("detail.title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("detail.subtitle")}</p>
      </header>

      <ProductDetail id={id} />
    </div>
  );
}
