import { useTranslations } from "next-intl";
import type { OrderKind, OrderStatus } from "@repo/api-contract";
import styles from "../records/records.module.css";

/**
 * The order lifecycle's one status badge — see
 * docs/order-lifecycle-plan.md §5: this replaces every direct render of
 * `offreDePrix`/`produitFini`/`okFacturation` across the orders table and
 * detail page.
 *
 * `QUOTE` is shown ahead of `status` when it applies: a quote's pipeline
 * position (always `DRAFT`, enforced by the `kind` transition's guard — see
 * `order-lifecycle.ts`) is not the interesting fact about it, its document
 * kind is. Every `ORDER`-kind row renders its `status` instead.
 */
export function OrderStatusBadge({
  kind,
  status,
}: {
  kind: OrderKind;
  status: OrderStatus;
}) {
  const enums = useTranslations("enums");
  if (kind === "QUOTE") {
    return (
      <span className={[styles.statusBadge, styles.statusQuote].join(" ")}>
        {enums("orderKind.QUOTE")}
      </span>
    );
  }
  const toneClass = STATUS_TONE[status];
  return (
    <span className={[styles.statusBadge, toneClass].join(" ")}>
      {enums(`orderStatus.${status}`)}
    </span>
  );
}

/**
 * Tone only — no dot, unlike `@repo/ui`'s `StatusBadge`. That component's
 * fixed seven-value `Status` vocabulary belongs to job orders/rolls/shipments
 * and does not match `OrderStatus`'s eight values, so this is its own,
 * order-scoped badge rather than a forced fit onto a shared component with a
 * different domain's vocabulary.
 */
const STATUS_TONE: Record<OrderStatus, string> = {
  DRAFT: styles.statusNeutral!,
  IN_PRODUCTION: styles.statusActive!,
  PRODUCED: styles.statusInfo!,
  INVOICEABLE: styles.statusWarning!,
  INVOICED: styles.statusInfo!,
  READY_FOR_EXPORT: styles.statusWarning!,
  COMPLETED: styles.statusSuccess!,
  CANCELLED: styles.statusDanger!,
};
