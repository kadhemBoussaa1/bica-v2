"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { createUserInput, type Role } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { SelectField, TextField } from "@repo/ui/field";
import { useTRPC } from "../../../trpc/client";
import styles from "../users.module.css";

export function NewUserForm({
  onDone,
  onCancel,
}: {
  onDone?: (target: string) => void | Promise<void>;
  onCancel?: (target: string) => void;
} = {}) {
  const t = useTranslations("users");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const router = useRouter();
  // The route modal passes both; the full page falls through to navigation.
  const go = (target: string) => (onDone ? onDone(target) : router.push(target));
  const cancel = (target: string) => (onCancel ? onCancel(target) : router.push(target));
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [error, setError] = useState<string | null>(null);

  // The server decides which roles this caller may assign; the picker never
  // offers a role the create call would reject.
  const rolesQuery = useQuery(trpc.user.assignableRoles.queryOptions());
  const roles = rolesQuery.data ?? [];

  const create = useMutation(
    trpc.user.create.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.user.list.queryKey() }),
          // The settings rail counts accounts; it must learn about the new one.
          queryClient.invalidateQueries({ queryKey: trpc.settings.summary.queryKey() }),
        ]);
        await go("/settings/users");
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    // Same Zod schema the server validates with, so bad input never leaves
    // the browser and the messages match.
    const parsed = createUserInput.safeParse({ email, name, password, role });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    create.mutate(parsed.data);
  }

  return (
    <form className={styles.formPanel} onSubmit={handleSubmit} noValidate>
      {error && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <div className={styles.formGrid}>
        <TextField
          label={t("form.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          disabled={create.isPending}
        />
        <TextField
          label={t("form.email")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
          disabled={create.isPending}
        />
        <div className={styles.formWide}>
          <TextField
            label={t("form.temporaryPassword")}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            disabled={create.isPending}
          />
          <p className={styles.hint}>{t("form.passwordHint")}</p>
        </div>
        <div className={styles.formWide}>
          <SelectField
            label={t("form.role")}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            disabled={create.isPending || rolesQuery.isPending}
            options={roles.map((value) => ({ value, label: enums(`role.${value}`) }))}
            placeholder={
              rolesQuery.isPending ? t("form.loadingRoles") : t("form.selectRole")
            }
          />
        </div>
      </div>

      <div className={styles.formActions}>
        <Button
          variant="secondary"
          onClick={() => cancel("/settings/users")}
          disabled={create.isPending}
        >
          {common("cancel")}
        </Button>
        <Button variant="primary" type="submit" disabled={create.isPending}>
          {create.isPending ? t("form.creating") : t("form.createUser")}
        </Button>
      </div>
    </form>
  );
}
