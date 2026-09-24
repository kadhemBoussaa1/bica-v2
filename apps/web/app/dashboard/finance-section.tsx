"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatAmount } from "../invoices/invoice-ui";
import { Panel } from "./section";
import { countOf, type CurrencySum, type Range, type Summary } from "./summary";
import styles from "./dashboard.module.css";

type Tone = "muted" | "warn" | "danger";

const META_CLASS: Record<Tone, string | undefined> = {
  muted: undefined,
  warn: styles.metaWarn,
  danger: styles.metaDanger,
};

/**
 * Money in and money out, one line per figure and one amount per currency
 * — never a cross-currency total, EUR and TND do not add. An amount with no
 * recorded currency (the migrated supplier invoices) is drawn in amber with
 * "currency?" and its line says the figure cannot be trusted.
 */
export function FinanceSection({ data, range }: { data: Summary; range: Range }) {
  const t = useTranslations("dashboard.finance");
  const { sales, purchases } = data.money;
  const invoiced = sales.invoiced[range];
  const unknown = purchases.unpaidInvoices.filter((row) => row.currency === null);
  const openOrders = countOf(purchases.openOrders);

  return (
    <Panel title={t("title")} sub={t("sub")}>
      <div className={styles.financeGrid}>
        <Card title={t("sales")} links={[{ href: "/invoices/sales", label: t("salesLink") }]}>
          <Line
            label={t(`invoiced.${range}`)}
            rows={invoiced}
            meta={t("invoices", { count: countOf(invoiced) })}
          />
          <Line
            label={t("invoicedYear")}
            rows={sales.thisYear}
            meta={t("invoices", { count: countOf(sales.thisYear) })}
          />
          <Line label={t("overdueSales")} rows={sales.overdue} meta={t("noPayments")} tone="warn" />
        </Card>
        <Card
          title={t("purchases")}
          links={[
            { href: "/purchasing/orders", label: t("ordersLink") },
            { href: "/invoices/purchases", label: t("purchasesLink") },
          ]}
        >
          <Line
            label={t("openOrders")}
            rows={purchases.openOrders}
            meta={
              purchases.lateOrders > 0
                ? t("openOrdersLate", { count: openOrders, late: purchases.lateOrders })
                : t("openOrdersOnTime", { count: openOrders })
            }
            tone={purchases.lateOrders > 0 ? "danger" : "muted"}
          />
          <Line
            label={t("unpaidPurchases")}
            rows={purchases.unpaidInvoices}
            meta={
              unknown.length > 0
                ? t("noCurrency", { count: countOf(unknown) })
                : t("invoices", { count: countOf(purchases.unpaidInvoices) })
            }
            tone={unknown.length > 0 ? "warn" : "muted"}
          />
          <Line
            label={t("overduePurchases")}
            rows={purchases.overdueInvoices}
            meta={
              purchases.overdueInvoices.length === 0
                ? t("nothingOverdue")
                : t("invoices", { count: countOf(purchases.overdueInvoices) })
            }
            tone={purchases.overdueInvoices.length > 0 ? "danger" : "muted"}
          />
        </Card>
      </div>
    </Panel>
  );
}

function Card({
  title,
  links,
  children,
}: {
  title: string;
  links: ReadonlyArray<{ href: string; label: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.financeCard}>
      <div className={styles.financeHead}>
        <h3 className={styles.financeTitle}>{title}</h3>
        <span className={styles.financeLinks}>
          {links.map((link) => (
            <Link key={link.href} className={styles.inlineLink} href={link.href}>
              {link.label}
            </Link>
          ))}
        </span>
      </div>
      {children}
    </div>
  );
}

function Line({
  label,
  rows,
  meta,
  tone = "muted",
}: {
  label: string;
  rows: CurrencySum[];
  meta: string;
  tone?: Tone;
}) {
  const t = useTranslations("dashboard.finance");
  return (
    <div className={styles.financeRow}>
      <span className={styles.financeLabel}>{label}</span>
      <span className={styles.amounts}>
        {rows.length === 0 ? (
          <span className={styles.amountValue}>0</span>
        ) : (
          rows.map((row) => (
            // Isolated: "1 633,85 EUR" must not reorder inside an Arabic line.
            <bdi
              key={row.currency ?? ""}
              className={[styles.amount, row.currency === null ? styles.amountUnknown : null]
                .filter(Boolean)
                .join(" ")}
            >
              <span className={styles.amountValue}>{formatAmount(row.total)}</span>{" "}
              <span className={styles.amountCurrency}>{row.currency ?? t("unknownCurrency")}</span>
            </bdi>
          ))
        )}
      </span>
      <span className={[styles.financeMeta, META_CLASS[tone]].filter(Boolean).join(" ")}>{meta}</span>
    </div>
  );
}
