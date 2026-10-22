"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { FormDialog } from "@repo/ui/form-dialog";
import { formatDateTime, formatDay } from "../../../i18n/formats";
import records from "../../records/records.module.css";
import { useTRPC } from "../../trpc/client";
import {
  formatKiloPrice,
  MaterialTypeBadge,
  useMaterialUse,
  type MaterialDetail,
} from "./material-ui";
import styles from "./materials.module.css";

/**
 * One material: what it is, the price it is at now and every price before
 * it, newest first — the history `material.setPrice` keeps. "New price" and
 * "Edit" hand over to their own dialogs; archive and restore are confirmed
 * here, since they change what the order form offers.
 */
export function MaterialDetailDialog({
  material,
  onClose,
  onEdit,
  onNewPrice,
  onChanged,
}: {
  material: MaterialDetail;
  onClose: () => void;
  onEdit: () => void;
  onNewPrice: () => void;
  onChanged: (active: boolean) => void | Promise<void>;
}) {
  const t = useTranslations("materials");
  const trpc = useTRPC();
  const describe = useMaterialUse();

  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setActive = useMutation(
    trpc.material.setActive.mutationOptions({
      onSuccess: async (row) => {
        setConfirming(false);
        await onChanged(row.active);
      },
      onError: (cause) => {
        setConfirming(false);
        setError(cause.message);
      },
    }),
  );
  const busy = setActive.isPending;
  const current = material.currentPrice;

  return (
    <FormDialog eyebrow={t("detail.eyebrow")} title={material.label} onClose={() => !busy && onClose()}>
      <div className={styles.dialogBody}>
        {error && (
          <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
            {error}
          </p>
        )}

        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>{t("detail.code")}</dt>
            <dd className={[styles.factValue, styles.factMono].filter(Boolean).join(" ")}>
              {material.code}
              {!material.active && <span className={records.archivedTag}>{t("archivedTag")}</span>}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>{t("detail.type")}</dt>
            <dd className={styles.factValue}>
              <MaterialTypeBadge type={material.type} />
            </dd>
          </div>
          {material.type === "PAPER" ? (
            <>
              <div className={styles.fact}>
                <dt className={styles.factLabel}>{t("detail.supplier")}</dt>
                <dd className={styles.factValue}>{material.supplier?.name ?? "—"}</dd>
              </div>
              <div className={styles.fact}>
                <dt className={styles.factLabel}>{t("detail.paper")}</dt>
                <dd className={styles.factValue}>{describe(material)}</dd>
              </div>
            </>
          ) : (
            <div className={styles.fact}>
              <dt className={styles.factLabel}>{t("detail.defaults")}</dt>
              <dd className={styles.factValue}>{describe(material)}</dd>
            </div>
          )}
        </dl>

        <div className={styles.current}>
          <span className={styles.currentText}>
            <span className={styles.factLabel}>{t("detail.currentPrice")}</span>
            {current ? (
              <>
                <span className={styles.currentFigure}>
                  {formatKiloPrice(current.kiloPrice)}
                  <span className={styles.priceUnit}>/kg</span>
                </span>
                <span className={styles.since}>{t("since", { date: formatDay(current.validFrom) })}</span>
              </>
            ) : (
              <span className={styles.currentFigure}>{t("noPrice")}</span>
            )}
          </span>
          {material.active && (
            <Button size="dense" variant="primary" disabled={busy || !current} onClick={onNewPrice}>
              {t("detail.newPrice")}
            </Button>
          )}
        </div>

        {!material.active && <p className={styles.note}>{t("detail.archivedNote")}</p>}

        <h3 className={styles.sectionTitle}>{t("detail.history")}</h3>
        <div className={styles.historyWrap}>
          <table className={styles.history}>
            <thead>
              <tr>
                <th scope="col">{t("detail.historyFrom")}</th>
                <th scope="col">{t("detail.historyTo")}</th>
                <th scope="col" className={styles.num}>
                  {t("detail.historyPrice")}
                </th>
                <th scope="col">{t("detail.historyBy")}</th>
                <th scope="col">{t("detail.historyComment")}</th>
              </tr>
            </thead>
            <tbody>
              {material.history.map((row) => (
                <tr key={row.id}>
                  <td className={styles.when}>{formatDateTime(row.validFrom)}</td>
                  <td className={styles.when}>
                    {row.validTo === null ? (
                      <span className={styles.currentTag}>{t("detail.current")}</span>
                    ) : (
                      formatDateTime(row.validTo)
                    )}
                  </td>
                  <td className={styles.num}>{formatKiloPrice(row.kiloPrice)}</td>
                  <td>{row.enteredBy?.name ?? "—"}</td>
                  <td className={styles.comment}>{row.comment ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.actions}>
          <Button size="dense" variant={material.active ? "danger" : "secondary"} disabled={busy} onClick={() => {
            setError(null);
            setConfirming(true);
          }}>
            {material.active ? t("detail.archive") : t("detail.restore")}
          </Button>
          <span className={styles.actionsEnd}>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              {t("detail.close")}
            </Button>
            <Button variant="primary" disabled={busy} onClick={onEdit}>
              {t("detail.edit")}
            </Button>
          </span>
        </div>
      </div>

      {/* A second modal over the first, as on the users page: the browser
          stacks them and returns focus here when it closes. */}
      <Dialog
        open={confirming}
        title={
          material.active
            ? t("detail.archiveTitle", { label: material.label })
            : t("detail.restoreTitle", { label: material.label })
        }
        confirmLabel={material.active ? t("detail.archive") : t("detail.restore")}
        destructive={material.active}
        busy={busy}
        onConfirm={() => setActive.mutate({ id: material.id, active: !material.active })}
        onClose={() => !busy && setConfirming(false)}
      >
        {material.active ? t("detail.archiveBody") : t("detail.restoreBody")}
      </Dialog>
    </FormDialog>
  );
}
