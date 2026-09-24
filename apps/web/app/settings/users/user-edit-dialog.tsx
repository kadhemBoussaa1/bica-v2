"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Role } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { SelectField } from "@repo/ui/field";
import { FormDialog } from "@repo/ui/form-dialog";
import { useTRPC } from "../../trpc/client";
import records from "../../records/records.module.css";
import styles from "./users.module.css";

/** The row the dialog edits: a prop contract, checked against the list row at the call site. */
interface EditableUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  banned: boolean;
}

/** Which destructive action the nested confirmation is asking about. */
type Confirming = "ban" | "unban" | "delete" | null;

/**
 * Everything that changes an account, in one place: the role, banning, and
 * deletion — the handoff's "ban and delete live in Edit, next to the role".
 * Each write invalidates the list and the rail's figure; a successful one
 * closes the dialog, a failed one shows its message here.
 */
export function UserEditDialog({
  user,
  assignable,
  onClose,
}: {
  user: EditableUser;
  /** Roles the caller may assign; the current one stays listed even if outside it. */
  assignable: readonly Role[];
  onClose: () => void;
}) {
  const t = useTranslations("users");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [role, setRole] = useState<Role>(user.role);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [error, setError] = useState<string | null>(null);

  // Un-narrowed on purpose: with no input `queryKey()` prefix-matches every
  // page, sort and filter of the list, so no stale page survives.
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.user.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.settings.summary.queryKey() }),
    ]);

  const onError = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : t("somethingWentWrong"));

  const setRoleMutation = useMutation(
    trpc.user.setRole.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        onClose();
      },
      onError,
    }),
  );
  const setBanned = useMutation(
    trpc.user.setBanned.mutationOptions({
      onSuccess: async () => {
        setConfirming(null);
        await invalidate();
        onClose();
      },
      onError: (cause) => {
        setConfirming(null);
        onError(cause);
      },
    }),
  );
  const remove = useMutation(
    trpc.user.remove.mutationOptions({
      onSuccess: async () => {
        setConfirming(null);
        await invalidate();
        onClose();
      },
      onError: (cause) => {
        setConfirming(null);
        onError(cause);
      },
    }),
  );

  const busy = setRoleMutation.isPending || setBanned.isPending || remove.isPending;
  const roleOptions = (assignable.includes(user.role) ? assignable : [user.role, ...assignable]).map(
    (value) => ({ value, label: enums(`role.${value}`) }),
  );

  function confirm() {
    if (confirming === "delete") remove.mutate({ id: user.id });
    else if (confirming !== null) setBanned.mutate({ id: user.id, banned: confirming === "ban" });
  }

  return (
    <FormDialog eyebrow={t("eyebrow")} title={t("editor.title", { name: user.name })} onClose={() => !busy && onClose()}>
      <div className={styles.dialogBody}>
        {error && (
          <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
            {error}
          </p>
        )}

        <p className={styles.dialogEmail}>{user.email}</p>

        <SelectField
          label={t("editor.role")}
          value={role}
          options={roleOptions}
          disabled={busy}
          onChange={(event) => {
            setError(null);
            setRole(event.target.value as Role);
          }}
        />

        <div className={styles.dialogBlock}>
          <span className={styles.dialogBlockText}>
            <span className={styles.dialogBlockTitle}>
              {t("editor.status")}: {user.banned ? t("banned") : t("active")}
            </span>
            <span className={styles.dialogBlockHint}>
              {user.banned ? t("editor.bannedHint") : t("editor.activeHint")}
            </span>
          </span>
          <Button
            size="dense"
            disabled={busy}
            onClick={() => {
              setError(null);
              setConfirming(user.banned ? "unban" : "ban");
            }}
          >
            {user.banned ? t("unban") : t("ban")}
          </Button>
        </div>

        <div className={styles.dialogBlock}>
          <span className={styles.dialogBlockText}>
            <span className={styles.dialogBlockTitle}>{t("editor.deleteTitle")}</span>
            <span className={styles.dialogBlockHint}>{t("editor.deleteHint")}</span>
          </span>
          <Button
            size="dense"
            variant="danger"
            disabled={busy}
            onClick={() => {
              setError(null);
              setConfirming("delete");
            }}
          >
            {common("delete")}
          </Button>
        </div>

        <div className={styles.dialogActions}>
          <Button disabled={busy} onClick={onClose}>
            {common("cancel")}
          </Button>
          <Button
            variant="primary"
            busy={setRoleMutation.isPending}
            disabled={busy || role === user.role}
            onClick={() => {
              setError(null);
              setRoleMutation.mutate({ id: user.id, role });
            }}
          >
            {t("editor.save")}
          </Button>
        </div>
      </div>

      {/* A second modal over the first: the browser stacks them in the top
          layer and returns focus to this dialog when it closes. */}
      <Dialog
        open={confirming !== null}
        title={
          confirming === "delete"
            ? t("deleteTitle")
            : confirming === "ban"
              ? t("banTitle")
              : t("unbanTitle")
        }
        confirmLabel={
          confirming === "delete" ? common("delete") : confirming === "ban" ? t("ban") : t("unban")
        }
        destructive={confirming !== "unban"}
        busy={setBanned.isPending || remove.isPending}
        onConfirm={confirm}
        onClose={() => !busy && setConfirming(null)}
      >
        {confirming === "delete" &&
          t.rich("deleteBody", {
            email: user.email,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        {confirming === "ban" &&
          t.rich("banBody", {
            email: user.email,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        {confirming === "unban" &&
          t.rich("unbanBody", {
            email: user.email,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
      </Dialog>
    </FormDialog>
  );
}
