import { getTranslations } from "next-intl/server";
import { RollLookup } from "./roll-lookup";
import styles from "../../records/records.module.css";

/**
 * Scanning a reel to see what it is — the handheld's third job, beside
 * receiving and the stocktake.
 *
 * A phone camera already reaches a reel through the label's own URL
 * (`/scan/roll/<id>`). The warehouse's keyboard-wedge scanner does not open
 * URLs: it types the label's text into whatever screen is showing, so it
 * needs a screen that is listening. This is that screen.
 */
export default async function RollScanPage() {
  const t = await getTranslations("stock");

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("lookup.title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("lookup.subtitle")}</p>
      </header>

      <RollLookup />
    </div>
  );
}
