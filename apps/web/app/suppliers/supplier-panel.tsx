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
  isReachable,
} from "../records/partner-ui";

/**
 * The optional fields a supplier record can hold; completeness is n of these.
 * The second phone and the fax are left out: they are extras on top of a
 * phone, not gaps in the record.
 */
export const SUPPLIER_FIELDS = [
  "taxId",
  "familyId",
  "vatRate",
  "email",
  "phone",
  "address",
  "website",
] as const;

export interface SupplierDetails {
  taxId: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  phone2: string | null;
  fax: string | null;
  website: string | null;
  familyId: string | null;
  vatRate: number | null;
}

/** The one supplier row shape the panel renders; a superset of the list row. */
export interface PanelSupplier extends SupplierDetails {
  id: string;
  name: string;
  family: { label: string } | null;
  vatRateNote: string | null;
  active: boolean;
  duplicateOf: string | null;
}

export function supplierFilled(supplier: SupplierDetails): number {
  return filledCount(supplier, SUPPLIER_FIELDS);
}

/** A website as a link, tolerant of the bare hostnames the legacy data holds. */
function WebsiteLink({ url }: { url: string }) {
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return (
    <a className={records.email} href={href} target="_blank" rel="noreferrer">
      {url}
    </a>
  );
}

interface SupplierPanelProps {
  supplier: PanelSupplier;
  canWrite: boolean;
  onClose: () => void;
  /** Opens the archive / restore confirmation owned by the list. */
  onToggleActive: () => void;
}

/**
 * The record beside the list — the suppliers counterpart of ClientPanel.
 * Everything shown comes off the list row, so opening a record costs no
 * request.
 */
export function SupplierPanel({
  supplier,
  canWrite,
  onClose,
  onToggleActive,
}: SupplierPanelProps) {
  const t = useTranslations("suppliers");
  const common = useTranslations("common");
  const status = !supplier.active
    ? t("status.archived")
    : isReachable(supplier)
      ? t("status.reachable")
      : t("status.needsContact");

  return (
    <aside
      className={styles.panel}
      aria-label={t("panel.aria", { name: supplier.name })}
    >
      <div className={styles.panelHead}>
        <div className={styles.panelHeading}>
          <span className={records.eyebrow}>{t("panel.eyebrow")}</span>
          <div className={styles.panelName}>{supplier.name}</div>
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
          filled={supplierFilled(supplier)}
          total={SUPPLIER_FIELDS.length}
          label={t("panel.completeness")}
        />
      </div>

      <div className={styles.panelSection}>
        <h3 className={records.detailTitle}>{t("panel.contactSection")}</h3>
        <FieldRow
          label={t("fields.email")}
          value={
            supplier.email ? (
              <a className={records.email} href={`mailto:${supplier.email}`}>
                {supplier.email}
              </a>
            ) : null
          }
        />
        <FieldRow label={t("fields.phone")} value={supplier.phone} />
        <FieldRow label={t("fields.phone2")} value={supplier.phone2} />
        <FieldRow label={t("fields.fax")} value={supplier.fax} />
        <FieldRow
          label={t("fields.website")}
          value={
            supplier.website ? <WebsiteLink url={supplier.website} /> : null
          }
        />
        <FieldRow label={t("fields.address")} value={supplier.address} />
      </div>

      <div className={styles.panelSection}>
        <h3 className={records.detailTitle}>{t("panel.recordSection")}</h3>
        <FieldRow label={t("fields.family")} value={supplier.family?.label ?? null} />
        <FieldRow label={t("fields.taxId")} value={supplier.taxId} />
        <FieldRow
          label={t("fields.vatRate")}
          value={
            supplier.vatRate !== null ? (
              `${supplier.vatRate}%`
            ) : supplier.vatRateNote !== null ? (
              // The importer kept a value it could not read as one rate; it
              // needs a human, so show it rather than "Not recorded".
              <span
                className={records.flag}
                title={t("vatNotSingleRate")}
              >
                {supplier.vatRateNote}
              </span>
            ) : null
          }
        />
        <FieldRow label={t("fields.status")} value={status} />
      </div>

      {supplier.duplicateOf && <DuplicateNotice of={supplier.duplicateOf} />}

      {canWrite && (
        <div className={styles.panelActions}>
          <Link href={`/suppliers/${supplier.id}`}>
            <Button variant="primary">{common("edit")}</Button>
          </Link>
          <Button
            variant={supplier.active ? "danger" : "secondary"}
            onClick={onToggleActive}
          >
            {supplier.active ? common("archive") : common("restore")}
          </Button>
        </div>
      )}
    </aside>
  );
}
