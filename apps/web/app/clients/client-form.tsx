"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { createClientInput, updateClientInput } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/field";
import { useTRPC } from "../trpc/client";
import { formatDay } from "../../i18n/formats";
import records from "../records/records.module.css";
import styles from "../records/partners.module.css";
import {
  CompletenessMeter,
  FieldRow,
  isReachable,
  NameCheck,
  Step,
  useDebounced,
} from "../records/partner-ui";
import { CLIENT_FIELDS, clientFilled } from "./client-panel";

/**
 * Existing values when editing, absent when creating. Typed structurally rather
 * than from the router output so the edit page can pass a narrowed row.
 */
export interface ClientFormValues {
  id: string;
  name: string;
  taxId: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  registeredAt: string | Date | null;
}

/** `<input type="date">` needs YYYY-MM-DD; the API sends an ISO timestamp. */
function toDateInput(value: string | Date | null): string {
  if (value === null) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export function ClientForm({
  initial,
  onDone,
  onCancel,
}: {
  onDone?: (target: string) => void | Promise<void>;
  onCancel?: (target: string) => void;
  initial?: ClientFormValues;
}) {
  const router = useRouter();
  const t = useTranslations("clients");
  const common = useTranslations("common");
  // The route modal passes both; the full page falls through to navigation.
  const go = (target: string) => (onDone ? onDone(target) : router.push(target));
  const cancel = (target: string) => (onCancel ? onCancel(target) : router.push(target));
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [name, setName] = useState(initial?.name ?? "");
  const [taxId, setTaxId] = useState(initial?.taxId ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [registeredAt, setRegisteredAt] = useState(
    toDateInput(initial?.registeredAt ?? null),
  );
  const [error, setError] = useState<string | null>(null);

  /*
   * The name is checked against the book as it is typed: the server says
   * which row would make the save fail (an exact match, the schema's unique
   * rule) and which rows it merely resembles. The unique rule is still
   * enforced on save — this only moves the answer forward to where the user
   * can act on it.
   */
  const settledName = useDebounced(name.trim(), 300);
  const similarQuery = useQuery({
    ...trpc.client.similar.queryOptions({
      name: settledName,
      excludeId: initial?.id,
    }),
    enabled: settledName.length > 0,
    // Keep the last verdict up while the next one loads, so the notice does
    // not flicker out between keystrokes.
    placeholderData: (prev) => prev,
  });
  // Only trust a verdict about the name currently in the box.
  const verdict =
    settledName === name.trim() && settledName ? similarQuery.data : undefined;
  const clash = verdict?.exact ?? null;

  // Invalidate un-narrowed: with no input it prefix-matches every page, sort
  // and filter combination, so no stale page survives in the cache.
  const done = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.client.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.client.stats.queryKey() }),
    ]);
    await go("/clients");
  };

  const create = useMutation(
    trpc.client.create.mutationOptions({
      onSuccess: done,
      onError: (cause) => setError(cause.message),
    }),
  );
  const update = useMutation(
    trpc.client.update.mutationOptions({
      onSuccess: done,
      onError: (cause) => setError(cause.message),
    }),
  );

  const busy = create.isPending || update.isPending;
  const canSubmit = name.trim().length > 0 && clash === null && !busy;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const raw = { name, taxId, address, email, phone, registeredAt };

    // The same Zod schemas the server validates with, so bad input never leaves
    // the browser and the messages match.
    if (initial) {
      const parsed = updateClientInput.safeParse({ ...raw, id: initial.id });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? common("checkForm"));
        return;
      }
      update.mutate(parsed.data);
      return;
    }

    const parsed = createClientInput.safeParse(raw);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    create.mutate(parsed.data);
  }

  const draft = {
    taxId: taxId.trim() || null,
    email: email.trim() || null,
    phone: phone.trim() || null,
    address: address.trim() || null,
  };

  return (
    <div className={records.formWithAside}>
      <form className={records.formPanel} onSubmit={handleSubmit} noValidate>
        {error && (
          <p
            className={[records.notice, records.error]
              .filter(Boolean)
              .join(" ")}
            role="alert"
          >
            {error}
          </p>
        )}

        <div className={records.formGrid}>
          <Step
            number={1}
            title={t("form.identity")}
            meta={t("form.required")}
            required
          />

          <div className={records.formWide}>
            <TextField
              label={t("form.name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("form.namePlaceholder")}
              autoComplete="off"
              disabled={busy}
              aria-invalid={clash !== null}
            />
            <NameCheck verdict={verdict} />
          </div>

          <TextField
            label={t("fields.taxId")}
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            placeholder={t("form.optional")}
            autoComplete="off"
            disabled={busy}
          />
          <TextField
            label={t("fields.since")}
            type="date"
            value={registeredAt}
            onChange={(e) => setRegisteredAt(e.target.value)}
            disabled={busy}
          />

          <Step
            number={2}
            title={t("form.contact")}
            meta={t("form.contactMeta")}
            required={false}
          />

          <TextField
            label={t("fields.email")}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("form.emailPlaceholder")}
            autoComplete="off"
            disabled={busy}
          />
          <TextField
            label={t("fields.phone")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("form.phonePlaceholder")}
            autoComplete="off"
            disabled={busy}
          />
          <div className={records.formWide}>
            <TextField
              label={t("fields.address")}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t("form.addressPlaceholder")}
              autoComplete="off"
              disabled={busy}
            />
            <p className={records.hint}>{t("form.blankHint")}</p>
          </div>
        </div>

        <div className={records.formActions}>
          <Button
            variant="secondary"
            onClick={() => cancel("/clients")}
            disabled={busy}
          >
            {common("cancel")}
          </Button>
          <Button variant="primary" type="submit" disabled={!canSubmit} busy={busy}>
            {busy
              ? common("saving")
              : initial
                ? common("saveChanges")
                : t("form.createClient")}
          </Button>
        </div>
      </form>

      <aside className={records.formAside} aria-label={t("form.previewAria")}>
        <span className={styles.previewLabel}>{t("form.previewLabel")}</span>
        <div className={styles.preview}>
          <div
            className={[
              styles.previewName,
              name.trim() ? null : styles.absentValue,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {name.trim() || t("form.untitled")}
          </div>
          <CompletenessMeter
            filled={clientFilled(draft)}
            total={CLIENT_FIELDS.length}
            label={t("form.completeness")}
            className={styles.previewMeter}
          />
          <FieldRow label={t("fields.taxId")} value={draft.taxId} />
          <FieldRow
            label={t("fields.sinceShort")}
            value={registeredAt ? formatDay(registeredAt) : null}
          />
          <FieldRow label={t("fields.email")} value={draft.email} />
          <FieldRow label={t("fields.phone")} value={draft.phone} />
          <FieldRow label={t("fields.address")} value={draft.address} />
        </div>
        <p className={styles.previewNote}>
          {isReachable(draft)
            ? t("form.reachableNote")
            : t("form.unreachableNote")}
        </p>
      </aside>
    </div>
  );
}
