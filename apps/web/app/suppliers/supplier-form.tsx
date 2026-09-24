"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { createSupplierInput, updateSupplierInput } from "@repo/api-contract";
import Link from "next/link";
import { Button } from "@repo/ui/button";
import { SelectField, TextField } from "@repo/ui/field";
import { useTRPC } from "../trpc/client";
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
import { SUPPLIER_FIELDS, supplierFilled } from "./supplier-panel";

export interface SupplierFormValues {
  id: string;
  name: string;
  taxId: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  phone2: string | null;
  fax: string | null;
  website: string | null;
  familyId: string | null;
  vatRate: number | null;
  vatRateNote: string | null;
}

export function SupplierForm({
  initial,
  onDone,
  onCancel,
}: {
  onDone?: (target: string) => void | Promise<void>;
  onCancel?: (target: string) => void;
  initial?: SupplierFormValues;
}) {
  const router = useRouter();
  const t = useTranslations("suppliers");
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
  const [phone2, setPhone2] = useState(initial?.phone2 ?? "");
  const [fax, setFax] = useState(initial?.fax ?? "");
  const [website, setWebsite] = useState(initial?.website ?? "");
  const [familyId, setFamilyId] = useState(initial?.familyId ?? "");
  // Kept as a string: an empty number input has no numeric value, and coercing
  // "" to 0 would silently claim a 0% rate.
  const [vatRate, setVatRate] = useState(
    initial?.vatRate === null || initial?.vatRate === undefined
      ? ""
      : String(initial.vatRate),
  );
  const [error, setError] = useState<string | null>(null);

  // Active families only: the picker must not offer one that `create`/`update`
  // would reject. An archived family already on this supplier is handled below.
  const familiesQuery = useQuery(trpc.supplierFamily.list.queryOptions({}));
  const families = familiesQuery.data ?? [];

  // Live duplicate check on the name — see ClientForm for the reasoning.
  const settledName = useDebounced(name.trim(), 300);
  const similarQuery = useQuery({
    ...trpc.supplier.similar.queryOptions({
      name: settledName,
      excludeId: initial?.id,
    }),
    enabled: settledName.length > 0,
    placeholderData: (prev) => prev,
  });
  const verdict =
    settledName === name.trim() && settledName ? similarQuery.data : undefined;
  const clash = verdict?.exact ?? null;

  const done = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.supplier.list.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.supplier.stats.queryKey(),
      }),
    ]);
    await go("/suppliers");
  };

  const create = useMutation(
    trpc.supplier.create.mutationOptions({
      onSuccess: done,
      onError: (cause) => setError(cause.message),
    }),
  );
  const update = useMutation(
    trpc.supplier.update.mutationOptions({
      onSuccess: done,
      onError: (cause) => setError(cause.message),
    }),
  );

  const busy = create.isPending || update.isPending;
  const canSubmit = name.trim().length > 0 && clash === null && !busy;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedRate = vatRate.trim();
    if (trimmedRate !== "" && Number.isNaN(Number(trimmedRate))) {
      setError(t("form.vatNumberError"));
      return;
    }

    const raw = {
      name,
      taxId,
      address,
      email,
      phone,
      phone2,
      fax,
      website,
      familyId: familyId === "" ? undefined : familyId,
      vatRate: trimmedRate === "" ? undefined : Number(trimmedRate),
    };

    if (initial) {
      const parsed = updateSupplierInput.safeParse({ ...raw, id: initial.id });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? common("checkForm"));
        return;
      }
      update.mutate(parsed.data);
      return;
    }

    const parsed = createSupplierInput.safeParse(raw);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    create.mutate(parsed.data);
  }

  // The draft as the list would see it, for the preview and its meter.
  const parsedRate =
    vatRate.trim() === "" || Number.isNaN(Number(vatRate))
      ? null
      : Number(vatRate);
  const draft = {
    taxId: taxId.trim() || null,
    email: email.trim() || null,
    phone: phone.trim() || null,
    phone2: phone2.trim() || null,
    fax: fax.trim() || null,
    website: website.trim() || null,
    address: address.trim() || null,
    familyId: familyId || null,
    vatRate: parsedRate,
  };
  const familyLabel =
    families.find((family) => family.id === familyId)?.label ?? null;

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
          <div>
            <SelectField
              label={t("fields.family")}
              value={familyId}
              onChange={(e) => setFamilyId(e.target.value)}
              disabled={busy || familiesQuery.isPending}
              /*
               * The query returns active families. A supplier already assigned to
               * an archived one would otherwise render blank and lose that family
               * on the next save, so its own value is appended when missing.
               */
              options={[
                ...families.map((family) => ({
                  value: family.id,
                  label: family.label,
                })),
                ...(initial?.familyId &&
                !families.some((family) => family.id === initial.familyId)
                  ? [{ value: initial.familyId, label: t("form.archivedFamily") }]
                  : []),
              ]}
              // Blank is a real answer here: 20 of the migrated suppliers have no
              // family, so the option must stay selectable.
              allowEmpty
              placeholder={
                familiesQuery.isPending
                  ? t("form.loadingFamilies")
                  : t("form.noFamily")
              }
            />
            <p className={records.hint}>
              {t("form.missingCategory")}{" "}
              <Link className={records.inlineLink} href="/suppliers/families">
                {t("form.manageFamilies")}
              </Link>
            </p>
          </div>

          <div className={records.formWide}>
            <TextField
              label={t("fields.vatRate")}
              unit="%"
              format="numeric"
              value={vatRate}
              onChange={(e) => setVatRate(e.target.value)}
              placeholder={t("form.vatPlaceholder")}
              autoComplete="off"
              disabled={busy}
            />
            {/*
              The importer parks a legacy value it could not read as a single rate
              ("19% /7%", or a VAT number filed in the rate column). Show it here,
              since this form is where it gets resolved — saving a rate clears it.
            */}
            {initial?.vatRateNote && (
              <p className={records.hint}>
                {t("form.vatNoteHint", { value: initial.vatRateNote })}
              </p>
            )}
          </div>

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
            label={t("fields.website")}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder={t("form.websitePlaceholder")}
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
          <TextField
            label={t("fields.phone2")}
            value={phone2}
            onChange={(e) => setPhone2(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
          <TextField
            label={t("fields.fax")}
            value={fax}
            onChange={(e) => setFax(e.target.value)}
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
            onClick={() => cancel("/suppliers")}
            disabled={busy}
          >
            {common("cancel")}
          </Button>
          <Button variant="primary" type="submit" disabled={!canSubmit} busy={busy}>
            {busy
              ? common("saving")
              : initial
                ? common("saveChanges")
                : t("form.createSupplier")}
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
            filled={supplierFilled(draft)}
            total={SUPPLIER_FIELDS.length}
            label={t("form.completeness")}
            className={styles.previewMeter}
          />
          <FieldRow label={t("fields.family")} value={familyLabel} />
          <FieldRow label={t("fields.taxId")} value={draft.taxId} />
          <FieldRow
            label={t("fields.vatRate")}
            value={parsedRate === null ? null : `${parsedRate}%`}
          />
          <FieldRow label={t("fields.email")} value={draft.email} />
          <FieldRow label={t("fields.phone")} value={draft.phone ?? draft.phone2} />
          <FieldRow label={t("fields.website")} value={draft.website} />
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
