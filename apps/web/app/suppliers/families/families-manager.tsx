"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  canAccess,
  createSupplierFamilyInput,
  supplierFamilyCodeSchema,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { TextField } from "@repo/ui/field";
import { useCurrentUser } from "../../auth/use-auth";
import { useTRPC } from "../../trpc/client";
import styles from "../../records/records.module.css";

/** Which confirmation is open, if any. */
type Pending =
  | { kind: "archive"; id: string; label: string; active: boolean }
  | { kind: "remove"; id: string; label: string }
  | null;

/**
 * Add and retire supplier families.
 *
 * Deliberately not a `DataTable`: this is a short lookup list, not a paginated
 * one, and every row is editable in place. Paging and facets would be noise.
 */
export function FamiliesManager() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { user: me } = useCurrentUser();
  const t = useTranslations("suppliers");
  const common = useTranslations("common");
  const canWrite = me ? canAccess(me.role, "ADMIN") : false;

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  // The create form is opened on demand rather than sitting under the list: on
  // a page whose usual purpose is reading the categories, a permanent form is
  // noise. Opening it also lets it take focus.
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");

  // Editing is per-row and inline; only one row is open at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  // includeInactive: archived families still need managing (to restore them).
  const familiesQuery = useQuery(
    trpc.supplierFamily.list.queryOptions({ includeInactive: true }),
  );

  /**
   * Both the family list and the supplier list are invalidated by every
   * mutation: a renamed or archived family changes the labels the suppliers
   * table renders and the chips it offers, so refreshing only this page would
   * leave that one stale.
   */
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.supplierFamily.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.supplier.list.queryKey() }),
    ]);
  };

  const onError = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : t("families.genericError"));

  const create = useMutation(
    trpc.supplierFamily.create.mutationOptions({
      onSuccess: async () => {
        setNewCode("");
        setNewLabel("");
        setCreating(false);
        await invalidate();
      },
      onError,
    }),
  );
  const update = useMutation(
    trpc.supplierFamily.update.mutationOptions({
      onSuccess: async () => {
        setEditingId(null);
        await invalidate();
      },
      onError,
    }),
  );
  const setActive = useMutation(
    trpc.supplierFamily.setActive.mutationOptions({
      onSuccess: async () => {
        setPending(null);
        await invalidate();
      },
      onError,
    }),
  );
  const remove = useMutation(
    trpc.supplierFamily.remove.mutationOptions({
      onSuccess: async () => {
        setPending(null);
        await invalidate();
      },
      onError,
    }),
  );

  const busy =
    create.isPending || update.isPending || setActive.isPending || remove.isPending;

  function handleCreate() {
    setError(null);
    const parsed = createSupplierFamilyInput.safeParse({
      code: newCode.toUpperCase(),
      label: newLabel,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("families.checkValues"));
      return;
    }
    create.mutate(parsed.data);
  }

  if (familiesQuery.isPending) {
    return <p className={styles.muted}>{t("families.loading")}</p>;
  }

  if (familiesQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {familiesQuery.error.message}
      </p>
    );
  }

  const families = familiesQuery.data;

  return (
    <>
      {canWrite && (
        <div className={styles.managerBar}>
          <Button
            variant="primary"
            disabled={busy || creating}
            onClick={() => {
              setError(null);
              setCreating(true);
            }}
          >
            {t("families.newFamily")}
          </Button>
        </div>
      )}

      {error && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <div className={styles.familyPanel}>
        <div className={styles.familyHead}>
          <span>{t("families.columns.family")}</span>
          <span>{t("families.columns.code")}</span>
          <span className={styles.familyCount}>{t("families.columns.suppliers")}</span>
          <span />
        </div>

        {families.map((family) => (
          <div key={family.id} className={styles.familyRow}>
            {editingId === family.id ? (
              <TextField
                label=""
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                disabled={busy}
                autoComplete="off"
              />
            ) : (
              <span
                className={[styles.name, family.active ? null : styles.archivedRow]
                  .filter(Boolean)
                  .join(" ")}
              >
                {family.label}
                {!family.active && <span className={styles.archivedTag}>{t("archivedTag")}</span>}
              </span>
            )}

            {/* Immutable: filters and any future lookup key on this. */}
            <span className={styles.familyCode}>{family.code}</span>
            <span className={styles.familyCount}>{family.supplierCount}</span>

            {canWrite && (
              <div className={styles.actions}>
                {editingId === family.id ? (
                  <>
                    <Button
                      className={styles.actionBtn}
                      variant="primary"
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        update.mutate({ id: family.id, label: editLabel });
                      }}
                    >
                      {common("save")}
                    </Button>
                    <Button
                      className={styles.actionBtn}
                      disabled={busy}
                      onClick={() => setEditingId(null)}
                    >
                      {common("cancel")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      className={styles.actionBtn}
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setEditingId(family.id);
                        setEditLabel(family.label);
                      }}
                    >
                      {t("families.rename")}
                    </Button>
                    <Button
                      className={styles.actionBtn}
                      variant={family.active ? "danger" : "secondary"}
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setPending({
                          kind: "archive",
                          id: family.id,
                          label: family.label,
                          active: family.active,
                        });
                      }}
                    >
                      {family.active ? common("archive") : common("restore")}
                    </Button>
                    {/*
                      Deleting is only offered while nothing uses the family. The
                      server refuses otherwise, so hiding the button here just
                      avoids a guaranteed error.
                    */}
                    {family.supplierCount === 0 && (
                      <Button
                        className={styles.actionBtn}
                        variant="danger"
                        disabled={busy}
                        onClick={() => {
                          setError(null);
                          setPending({
                            kind: "remove",
                            id: family.id,
                            label: family.label,
                          });
                        }}
                      >
                        {common("delete")}
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {canWrite && creating && (
          <div className={styles.createRow}>
            <TextField
              label={t("families.newFamily")}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t("families.labelPlaceholder")}
              autoComplete="off"
              autoFocus
              disabled={busy}
            />
            <TextField
              label={t("families.columns.code")}
              value={newCode}
              // Upper-cased as you type, since that is the only accepted form —
              // better than rejecting it after the fact.
              onChange={(e) => setNewCode(e.target.value.toUpperCase())}
              placeholder={t("families.codePlaceholder")}
              autoComplete="off"
              disabled={busy}
              error={
                newCode !== "" &&
                !supplierFamilyCodeSchema.safeParse(newCode).success
                  ? t("families.codeError")
                  : undefined
              }
            />
            <span />
            <div className={styles.actions}>
              <Button
                className={styles.actionBtn}
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setCreating(false);
                }}
              >
                {common("cancel")}
              </Button>
              <Button variant="primary" disabled={busy} onClick={handleCreate}>
                {create.isPending ? t("families.adding") : t("families.addFamily")}
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={pending !== null}
        title={
          pending?.kind === "remove"
            ? t("families.deleteDialog.title")
            : pending?.active
              ? t("families.archiveDialog.title")
              : t("families.restoreDialog.title")
        }
        confirmLabel={
          pending?.kind === "remove"
            ? common("delete")
            : pending?.active
              ? common("archive")
              : common("restore")
        }
        destructive={pending?.kind === "remove" || (pending?.active ?? false)}
        busy={busy}
        onConfirm={() => {
          if (!pending) return;
          if (pending.kind === "remove") remove.mutate({ id: pending.id });
          else setActive.mutate({ id: pending.id, active: !pending.active });
        }}
        onClose={() => !busy && setPending(null)}
      >
        {pending?.kind === "remove" &&
          t.rich("families.deleteDialog.body", {
            name: pending.label,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        {pending?.kind === "archive" &&
          pending.active &&
          t.rich("families.archiveDialog.body", {
            name: pending.label,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        {pending?.kind === "archive" &&
          !pending.active &&
          t.rich("families.restoreDialog.body", {
            name: pending.label,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
      </Dialog>
    </>
  );
}
