import Link from "next/link";
import { getTranslations } from "next-intl/server";
import styles from "../../records/records.module.css";
import { ManufacturingOrderDetail } from "./manufacturing-order-detail";

/** One OF: its header and its pipeline. ADMIN and above — the API refuses anyone else. */
export default async function ManufacturingOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("manufacturing");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/manufacturing-orders">
        {t("detail.back")}
      </Link>
      <ManufacturingOrderDetail id={id} />
    </div>
  );
}
