"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { canAccess } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/field";
import { useCurrentUser } from "../auth/use-auth";
import { useTRPC } from "../trpc/client";
import records from "../records/records.module.css";
import styles from "./order-detail.module.css";

const money = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type Colour = { id: string; nom: string | null; prix: number | null };
type Row = { nom: string; prix: string };

const str = (value: number | null) => (value === null ? "" : String(value));
const rowsOf = (colours: readonly Colour[]): Row[] =>
  colours.map((c) => ({ nom: c.nom ?? "", prix: str(c.prix) }));

/**
 * The order's print inks — the names and costs on `OrderColour`, edited here
 * rather than on the order form (2026-09-18).
 *
 * They were a section of the create/update form, saved by a second mutation
 * fired from that form's `onSuccess`: a non-atomic two-call save, and one
 * that failed outright for a non-admin editing an order, since
 * `order.setColours` is `adminProcedure` while the rest of the form is not.
 * Moving them here makes the save a single call by the role that is allowed
 * to make it, and leaves the creation form to the figures.
 *
 * Not to be confused with `OrderInks` below it, which is ink drawn from the
 * colour *stock* for a production run (`InkUsage`) — a different model and a
 * different question. This card is what the job is printed in; that one is
 * what was taken off the shelf to do it.
 *
 * The list is replaced wholesale, matching `OrderService.setColours`: the
 * rows below are the new set, and a row left blank in both fields is dropped
 * rather than saved as an empty colour.
 */
export function OrderColours({
  orderId,
  colours,
}: {
  orderId: string;
  colours: readonly Colour[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const { user } = useCurrentUser();

  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => rowsOf(colours));
  const [error, setError] = useState<string | null>(null);

  const canEdit = user !== null && canAccess(user.role, "ADMIN");

  const save = useMutation(
    trpc.order.setColours.mutationOptions({
      onSuccess: async () => {
        setEditing(false);
        setError(null);
        await queryClient.invalidateQueries({
          queryKey: trpc.order.byId.queryKey(),
        });
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  const start = () => {
    setRows(rowsOf(colours));
    setError(null);
    setEditing(true);
  };

  const submit = () =>
    save.mutate({
      orderId,
      colours: rows
        .filter((r) => r.nom.trim() !== "" || r.prix.trim() !== "")
        .map((r) => ({
          nom: r.nom.trim() === "" ? undefined : r.nom,
          prix: r.prix.trim() === "" ? undefined : Number(r.prix),
        })),
    });

  const busy = save.isPending;

  return (
    <section className={styles.card}>
      <div className={styles.sectionHead}>
        <h2 className={styles.cardTitle}>
          {t("form.sectionInks")}
          {colours.length > 0 && ` (${colours.length})`}
        </h2>
        {canEdit && !editing && (
          <Button size="dense" onClick={start}>
            {common("edit")}
          </Button>
        )}
      </div>

      {error && (
        <p
          className={[records.notice, records.error].filter(Boolean).join(" ")}
          role="alert"
        >
          {error}
        </p>
      )}

      {!editing && colours.length === 0 && (
        <p className={styles.quiet}>{t("form.inksEmpty")}</p>
      )}

      {!editing && colours.length > 0 && (
        <div className={styles.inks}>
          {colours.map((colour) => (
            <span key={colour.id} className={records.colourChip}>
              {colour.nom ?? "—"}
              {colour.prix !== null && (
                <span className={records.colourPrice}>
                  {money.format(colour.prix)}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {editing && (
        <>
          <p className={styles.quiet}>{t("form.inksHint")}</p>
          {rows.map((row, index) => (
            <div key={index} className={records.colourRow}>
              <TextField
                label={index === 0 ? t("form.ink") : ""}
                value={row.nom}
                onChange={(e) =>
                  setRows((current) =>
                    current.map((r, i) =>
                      i === index ? { ...r, nom: e.target.value } : r,
                    ),
                  )
                }
                autoComplete="off"
                disabled={busy}
              />
              <TextField
                label={index === 0 ? t("form.cost") : ""}
                format="numeric"
                value={row.prix}
                onChange={(e) =>
                  setRows((current) =>
                    current.map((r, i) =>
                      i === index ? { ...r, prix: e.target.value } : r,
                    ),
                  )
                }
                autoComplete="off"
                disabled={busy}
              />
              <Button
                className={records.actionBtn}
                variant="danger"
                disabled={busy}
                onClick={() =>
                  setRows((current) => current.filter((_, i) => i !== index))
                }
              >
                {t("form.remove")}
              </Button>
            </div>
          ))}
          <div className={styles.sectionHead}>
            <Button
              className={records.actionBtn}
              disabled={busy || rows.length >= 20}
              onClick={() =>
                setRows((current) => [...current, { nom: "", prix: "" }])
              }
            >
              {t("form.addInk")}
            </Button>
            <div className={styles.inks}>
              <Button
                size="dense"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
              >
                {common("cancel")}
              </Button>
              <Button size="dense" busy={busy} onClick={submit}>
                {common("save")}
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
