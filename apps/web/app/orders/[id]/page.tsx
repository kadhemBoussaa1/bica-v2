import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { OrderDetail } from "./order-detail";
import styles from "../../records/records.module.css";

/**
 * No page header here: the order's own card at the top of the main column is
 * the title, and the actions live in the rail beside it.
 */
export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("orders");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/orders">
        {t("backToList")}
      </Link>
      <OrderDetail id={id} />
    </div>
  );
}
