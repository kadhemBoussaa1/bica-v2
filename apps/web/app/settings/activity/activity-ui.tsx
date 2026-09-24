"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { Button } from "@repo/ui/button";
import { RoleBadge } from "@repo/ui/role-badge";
import { useTRPC } from "../../trpc/client";
import records from "../../records/records.module.css";
import styles from "./activity.module.css";
import { dateFormat, numberFormat } from "../../../i18n/formats";

type AuditRow = inferRouterOutputs<AppRouter>["audit"]["list"]["rows"][number];

const dateTime = () => dateFormat({
  dateStyle: "medium",
  timeStyle: "short",
});

const dateTimeSeconds = () => dateFormat({
  dateStyle: "medium",
  timeStyle: "medium",
});

/** No tRPC transformer is configured, so `at` arrives as an ISO string. */
export function formatDateTime(value: string | Date, seconds = false): string {
  return (seconds ? dateTimeSeconds() : dateTime()).format(new Date(value));
}

/** The `activity` namespace translator, as `useTranslations("activity")` returns it. */
type ActivityT = ReturnType<typeof useTranslations<"activity">>;

/**
 * Plain-language labels for the procedures a reader meets most, under
 * `actions.<module>.<procedure>` in `messages/<locale>/activity.json`.
 * Anything absent renders as its raw path, so a new procedure is never
 * hidden — it just reads as code until someone names it there.
 */
export function actionLabel(t: ActivityT, action: string): string | null {
  const key = `actions.${action}`;
  return t.has(key) ? t(key) : null;
}

/**
 * Where a row's entity lives in the app, by module. The stock module holds
 * two record types, told apart by the action name. Users have no detail
 * page; their trace is the activity list itself. Unknown → null → text.
 */
function entityHref(module: string, action: string, id: string): string | null {
  switch (module) {
    case "order":
      return `/orders/${id}`;
    case "salesInvoice":
      return `/invoices/sales/${id}`;
    case "purchaseInvoice":
      return `/invoices/purchases/${id}`;
    case "shipment":
      return `/shipments/${id}`;
    case "stock":
      return action.includes("Shipment") ? `/stock/shipments/${id}` : `/stock/${id}`;
    case "client":
      return `/clients/${id}`;
    case "supplier":
      return `/suppliers/${id}`;
    case "product":
      return `/products/${id}`;
    case "machine":
      return `/machines/${id}`;
    case "employee":
      return `/employees/${id}`;
    case "purchaseOrder":
      return `/purchasing/orders/${id}`;
    case "goodsReceipt":
      return `/purchasing/receipts/${id}`;
    // A shift, a change or a ticket has no page of its own: the planner is
    // navigated by week, and the entity id is a row inside it. Unlinked on
    // purpose, not by omission.
    case "shift":
      return null;
    // Allocations have no page of their own: the order carries them, and
    // it is the row's related entity. Unlinked on purpose, not by omission.
    case "allocation":
      return null;
    case "user":
    case "auth":
      return `/settings/activity?actor=${encodeURIComponent(id)}`;
    default:
      return null;
  }
}

const KIND_CLASS: Record<AuditRow["kind"], string | undefined> = {
  QUERY: records.statusNeutral,
  MUTATION: records.statusActive,
  AUTH: records.statusInfo,
};

export function KindBadge({ kind }: { kind: AuditRow["kind"] }) {
  const t = useTranslations("activity");
  return (
    <span className={[records.statusBadge, KIND_CLASS[kind]].filter(Boolean).join(" ")}>
      {t(`kind.${kind}`)}
    </span>
  );
}

export function OutcomeBadge({ outcome }: { outcome: AuditRow["outcome"] }) {
  const t = useTranslations("activity");
  return (
    <span
      className={[
        records.statusBadge,
        outcome === "OK" ? records.statusSuccess : records.statusDanger,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {t(`outcome.${outcome}`)}
    </span>
  );
}

/** A row's entity as a link when the module has a page, else plain text. */
export function EntityLink({ row }: { row: Pick<AuditRow, "module" | "action" | "entityId" | "entityLabel"> }) {
  if (!row.entityId) return <span className={records.absent} />;
  const href = entityHref(row.module, row.action, row.entityId);
  const text = row.entityLabel ?? row.entityId;
  return href ? (
    <Link
      className={[records.inlineLink, styles.entity].filter(Boolean).join(" ")}
      href={href}
      onClick={(e) => e.stopPropagation()}
      title={text}
    >
      <span className={records.mono}>{text}</span>
    </Link>
  ) : (
    <span className={[records.mono, styles.entity].filter(Boolean).join(" ")} title={text}>
      {text}
    </span>
  );
}

function Kv({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.kv}>
      <span className={styles.kvLabel}>{label}</span>
      <span className={styles.kvValue}>{children}</span>
    </div>
  );
}

/** `input` is stored as JSON; a truncated payload is `{ truncated, bytes, preview }`. */
function isTruncated(
  value: unknown,
): value is { truncated: true; bytes: number; preview: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { truncated?: unknown }).truncated === true &&
    typeof (value as { preview?: unknown }).preview === "string"
  );
}

function InputBlock({ input }: { input: unknown }) {
  const t = useTranslations("activity");
  if (input === null || input === undefined) {
    return <p className={records.muted}>{t("panel.noInput")}</p>;
  }
  if (isTruncated(input)) {
    return (
      <>
        <p className={styles.truncated}>
          {t("panel.truncated", { bytes: numberFormat().format(input.bytes) })}
        </p>
        <pre className={styles.json}>{input.preview}</pre>
      </>
    );
  }
  return <pre className={styles.json}>{JSON.stringify(input, null, 2)}</pre>;
}

/**
 * The row's full record, fetched on open: the list select leaves out the
 * input, the error message and the user agent so a page of rows stays
 * light, and this is where they show.
 */
export function ActivityPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const trpc = useTRPC();
  const detailQuery = useQuery(trpc.audit.byId.queryOptions({ id }));
  const row = detailQuery.data;
  const t = useTranslations("activity");
  const common = useTranslations("common");
  const label = row ? actionLabel(t, row.action) : null;

  return (
    <aside className={styles.panel} aria-label={t("panel.ariaLabel")}>
      <div className={styles.panelHead}>
        <div className={styles.panelHeading}>
          <div className={styles.badges}>
            {row && <KindBadge kind={row.kind} />}
            {row && <OutcomeBadge outcome={row.outcome} />}
          </div>
          <div className={styles.panelName}>{label ?? row?.action ?? t("panel.loading")}</div>
          {label && row && <div className={styles.path}>{row.action}</div>}
        </div>
        <Button size="dense" className={styles.panelClose} onClick={onClose} aria-label={common("close")}>
          ×
        </Button>
      </div>

      {detailQuery.isError && (
        <div className={styles.panelSection}>
          <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
            {detailQuery.error.message}
          </p>
        </div>
      )}

      {row && (
        <>
          <div className={styles.panelSection}>
            <h3 className={styles.sectionTitle}>{t("panel.who")}</h3>
            <Kv label={t("panel.user")}>
              {row.actorName ?? <span className={records.muted}>{t("anonymous")}</span>}
            </Kv>
            {row.actorEmail && <Kv label={t("panel.email")}>{row.actorEmail}</Kv>}
            {row.actorRole && (
              <Kv label={t("panel.role")}>
                <RoleBadge role={row.actorRole} />
              </Kv>
            )}
            {row.impersonatedById && (
              <Kv label={t("panel.impersonatedBy")}>
                <Link
                  className={records.inlineLink}
                  href={`/settings/activity?actor=${encodeURIComponent(row.impersonatedById)}`}
                >
                  {row.impersonatedById}
                </Link>
              </Kv>
            )}
            {row.actorId && (
              <Kv label={t("panel.trace")}>
                <Link
                  className={records.inlineLink}
                  href={`/settings/activity?actor=${encodeURIComponent(row.actorId)}`}
                >
                  {t("panel.traceLink")}
                </Link>
              </Kv>
            )}
          </div>

          <div className={styles.panelSection}>
            <h3 className={styles.sectionTitle}>{t("panel.what")}</h3>
            <Kv label={t("panel.when")}>{formatDateTime(row.at, true)}</Kv>
            <Kv label={t("panel.entity")}>
              <EntityLink row={row} />
            </Kv>
            {row.relatedId && (
              <Kv label={t("panel.from")}>
                <Link
                  className={records.inlineLink}
                  href={`/settings/activity?entity=${encodeURIComponent(row.relatedId)}`}
                >
                  {row.relatedId}
                </Link>
              </Kv>
            )}
            <Kv label={t("panel.duration")}>{t("duration", { ms: String(row.durationMs) })}</Kv>
            {row.errorCode && <Kv label={t("panel.error")}>{row.errorCode}</Kv>}
            {row.errorMessage && <Kv label={t("panel.message")}>{row.errorMessage}</Kv>}
          </div>

          <div className={styles.panelSection}>
            <h3 className={styles.sectionTitle}>{t("panel.input")}</h3>
            <InputBlock input={row.input} />
          </div>

          <div className={styles.panelSection}>
            <h3 className={styles.sectionTitle}>{t("panel.client")}</h3>
            <Kv label={t("panel.ip")}>{row.ip ?? <span className={records.absent} />}</Kv>
            <Kv label={t("panel.browser")}>{row.userAgent ?? <span className={records.absent} />}</Kv>
          </div>
        </>
      )}
    </aside>
  );
}
