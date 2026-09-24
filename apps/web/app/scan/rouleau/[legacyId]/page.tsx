import { getTranslations } from "next-intl/server";
import { LegacyScanRedirect } from "./legacy-scan-redirect";
import styles from "../../../records/records.module.css";

/**
 * What a LEGACY reel label's QR resolves to.
 *
 * 732 reels carry a printed label from the previous system encoding
 * `/scan/rouleau/<legacyId>`. Those labels are on physical paper in the
 * warehouse and cannot be reprinted on a whim, so the path has to keep
 * working: the id in it is `PaperRoll.legacyId`, not the reel's v2 id, which
 * is why this needs a lookup where `/scan/roll/<cuid>` does not.
 */
export default async function LegacyScanPage({
  params,
}: {
  params: Promise<{ legacyId: string }>;
}) {
  const { legacyId } = await params;
  const t = await getTranslations("stock");

  return (
    <div className={styles.page}>
      <LegacyScanRedirect legacyId={legacyId} loadingLabel={t("rolls.loading")} />
    </div>
  );
}
