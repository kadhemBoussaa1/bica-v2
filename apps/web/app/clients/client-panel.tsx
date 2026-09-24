"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import records from "../records/records.module.css";
import styles from "../records/partners.module.css";
import {
  CompletenessMeter,
  DuplicateNotice,
  FieldRow,
  filledCount,
  formatDate,
  isReachable,
} from "../records/partner-ui";

/** The optional fields a client record can hold; completeness is n of these. */
export const CLIENT_FIELDS = ["taxId", "email", "phone", "address"] as const;

export interface ClientContact {
  taxId: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
}

/** The one client row shape the panel renders; a superset of the list row. */
export interface PanelClient extends ClientContact {
  id: string;
  name: string;
  registeredAt: string | Date | null;
  active: boolean;
  duplicateOf: string | null;
}

export function clientFilled(client: ClientContact): number {
  return filledCount(client, CLIENT_FIELDS);
}

interface ClientPanelProps {
  client: PanelClient;
  canWrite: boolean;
  onClose: () => void;
  /** Opens the archive / restore confirmation owned by the list. */
  onToggleActive: () => void;
}

/**
 * The record beside the list. Everything shown comes off the list row itself
 * — `CLIENT_SELECT` already carries every field — so opening a record costs
 * no request, and archiving one updates the panel through the list's refetch.
 */
export function ClientPanel({
  client,
  canWrite,
  onClose,
  onToggleActive,
}: ClientPanelProps) {
  const t = useTranslations("clients");
  const common = useTranslations("common");
  const status = !client.active
    ? t("status.archived")
    : isReachable(client)
      ? t("status.reachable")
      : t("status.needsContact");

  return (
    <aside
      className={styles.panel}
      aria-label={t("panel.aria", { name: client.name })}
    >
      <div className={styles.panelHead}>
        <div className={styles.panelHeading}>
          <span className={records.eyebrow}>{t("panel.eyebrow")}</span>
          <div className={styles.panelName}>{client.name}</div>
        </div>
        <Button
          variant="ghost"
          className={styles.panelClose}
          aria-label={t("panel.close")}
          onClick={onClose}
        >
          ×
        </Button>
      </div>

      <div className={styles.panelSection}>
        <CompletenessMeter
          filled={clientFilled(client)}
          total={CLIENT_FIELDS.length}
          label={t("panel.completeness")}
        />
      </div>

      <div className={styles.panelSection}>
        <h3 className={records.detailTitle}>{t("panel.contactSection")}</h3>
        <FieldRow
          label={t("fields.email")}
          value={
            client.email ? (
              <a className={records.email} href={`mailto:${client.email}`}>
                {client.email}
              </a>
            ) : null
          }
        />
        <FieldRow label={t("fields.phone")} value={client.phone} />
        <FieldRow label={t("fields.address")} value={client.address} />
      </div>

      <div className={styles.panelSection}>
        <h3 className={records.detailTitle}>{t("panel.recordSection")}</h3>
        <FieldRow label={t("fields.taxId")} value={client.taxId} />
        <FieldRow
          label={t("fields.since")}
          value={formatDate(client.registeredAt)}
        />
        <FieldRow label={t("fields.status")} value={status} />
      </div>

      {client.duplicateOf && <DuplicateNotice of={client.duplicateOf} />}

      {canWrite && (
        <div className={styles.panelActions}>
          <Link href={`/clients/${client.id}`}>
            <Button variant="primary">{common("edit")}</Button>
          </Link>
          <Button
            variant={client.active ? "danger" : "secondary"}
            onClick={onToggleActive}
          >
            {client.active ? common("archive") : common("restore")}
          </Button>
        </div>
      )}
    </aside>
  );
}
