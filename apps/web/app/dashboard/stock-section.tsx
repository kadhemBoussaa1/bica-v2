"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { numberFormat } from "../../i18n/formats";
import { formatShiftDate } from "../shifts/week";
import { Dot, type DotTone } from "./section";
import { Panel } from "./section";
import type { Summary } from "./summary";
import styles from "./dashboard.module.css";

const int = () => numberFormat({ maximumFractionDigits: 0 });
const tonnes = () => numberFormat({ maximumFractionDigits: 1 });

/**
 * Paper on hand, split the way the stock page's chips split it — free and
 * reserved reels, which add up to the total — then the three things that
 * move it: a delivery to scan in, a stocktake, inks to reorder.
 *
 * On hand means received AND live: a delivery still on the truck is the
 * receiving line, not stock.
 */
export function StockSection({ data }: { data: Summary }) {
  const t = useTranslations("dashboard.stock");
  const { rolls, free, reserved, inks, openStocktake, receiving } = data.stock;
  const share = (kg: number) => (rolls.kg > 0 ? `${(kg / rolls.kg) * 100}%` : "0");
  const toReorder = inks.low + inks.out;

  const delivery = receiving.first;
  const receivingMeta =
    receiving.deliveries === 0
      ? t("receivingNone")
      : receiving.deliveries === 1 && delivery
        ? t("receivingOne", { supplier: delivery.supplier, numero: delivery.numero, count: receiving.reels })
        : t("receivingMany", { count: receiving.reels });

  return (
    <Panel title={t("title")} links={[{ href: "/stock", label: t("link") }]}>
      <div className={styles.tonnage}>
        <span className={styles.tonnageValue}>
          {t("tonnes", { tonnes: tonnes().format(rolls.kg / 1000) })}
        </span>
        <span className={styles.tonnageMeta}>{t("onHand", { count: rolls.count })}</span>
      </div>
      <div className={styles.split} aria-hidden="true">
        <span className={styles.splitFree} style={{ width: share(free.kg) }} />
        <span className={styles.splitReserved} style={{ width: share(reserved.kg) }} />
      </div>
      <div className={styles.splitLegend}>
        <span className={styles.legendItem}>
          <i className={[styles.swatch, styles.splitFree].filter(Boolean).join(" ")} aria-hidden="true" />
          {t("free", { tonnes: tonnes().format(free.kg / 1000) })}
        </span>
        <span className={styles.legendItem}>
          <i className={[styles.swatch, styles.splitReserved].filter(Boolean).join(" ")} aria-hidden="true" />
          {t("reserved", { tonnes: tonnes().format(reserved.kg / 1000) })}
        </span>
      </div>

      <div className={styles.linkRows}>
        <LinkRow
          href="/stock/receiving"
          tone={receiving.deliveries > 0 ? "info" : "ok"}
          label={t("receiving", { count: receiving.deliveries })}
          meta={receivingMeta}
          value={int().format(receiving.deliveries)}
        />
        <LinkRow
          href={openStocktake ? `/stock/counts/${openStocktake.id}` : "/stock/counts"}
          tone={openStocktake ? "live" : "muted"}
          label={t("stocktake")}
          meta={
            openStocktake
              ? t("stocktakeOpen", { date: formatShiftDate(openStocktake.openedAt) })
              : t("stocktakeNone")
          }
          value={
            openStocktake
              ? `${int().format(openStocktake.scanned)} / ${int().format(openStocktake.labelledCount)}`
              : "—"
          }
        />
        <LinkRow
          href="/stock/inks"
          tone={inks.out > 0 ? "danger" : inks.low > 0 ? "warn" : "ok"}
          label={t("inks")}
          meta={toReorder === 0 ? t("inksOk") : t("inksMeta", { out: inks.out, low: inks.low })}
          value={int().format(toReorder)}
        />
      </div>
    </Panel>
  );
}

function LinkRow({
  href,
  tone,
  label,
  meta,
  value,
}: {
  href: string;
  tone: DotTone;
  label: string;
  meta: string;
  value: string;
}) {
  return (
    <Link className={styles.linkRow} href={href}>
      <Dot tone={tone} />
      <span className={styles.linkRowText}>
        <span className={styles.linkRowLabel}>{label}</span>
        <span className={styles.linkRowMeta}>{meta}</span>
      </span>
      <bdi className={styles.linkRowValue}>{value}</bdi>
    </Link>
  );
}
