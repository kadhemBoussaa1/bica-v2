"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  assetUrl,
  createMachineInput,
  MACHINE_TYPES,
  updateMachineInput,
  type MachineType,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { SelectField, TextField } from "@repo/ui/field";
import { FileLink } from "@repo/ui/file-link";
import { Thumbnail } from "@repo/ui/thumbnail";
import { useTRPC } from "../trpc/client";
import styles from "../records/records.module.css";

export interface MachineFormValues {
  id: string;
  code: string;
  name: string;
  type: MachineType;
  brand: string | null;
  price: number | null;
  purchaseDate: string | Date | null;
  imageUrl: string | null;
  invoiceUrl: string | null;
  supplierId: string | null;
  laize: number | null;
  laizeMin: number | null;
  laizeMax: number | null;
  grammage: number | null;
  grammageMin: number | null;
  grammageMax: number | null;
  grammageMinWithoutHandle: number | null;
  grammageMaxWithoutHandle: number | null;
  grammageMinWithHandle: number | null;
  grammageMaxWithHandle: number | null;
  grammageMinKraft: number | null;
  grammageMaxKraft: number | null;
  grammageMinLaminatedKraft: number | null;
  grammageMaxLaminatedKraft: number | null;
  lengthMin: number | null;
  lengthMax: number | null;
  widthMin: number | null;
  widthMax: number | null;
}

/** Numbers are held as strings: an empty number input has no numeric value, and
 *  coercing "" to 0 would claim a real measurement of zero. */
const str = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

function toDateInput(value: string | Date | null): string {
  if (value === null) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export function MachineForm({
  initial,
  onDone,
  onCancel,
}: {
  onDone?: (target: string) => void | Promise<void>;
  onCancel?: (target: string) => void;
  initial?: MachineFormValues;
}) {
  const t = useTranslations("machines");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const router = useRouter();
  // The route modal passes both; the full page falls through to navigation.
  const go = (target: string) => (onDone ? onDone(target) : router.push(target));
  const cancel = (target: string) => (onCancel ? onCancel(target) : router.push(target));
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<MachineType | "">(initial?.type ?? "");
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [price, setPrice] = useState(str(initial?.price));
  const [purchaseDate, setPurchaseDate] = useState(toDateInput(initial?.purchaseDate ?? null));
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "");
  const [invoiceUrl, setInvoiceUrl] = useState(initial?.invoiceUrl ?? "");

  /** Every capability measurement, kept in one record to avoid 18 useStates. */
  const [caps, setCaps] = useState<Record<string, string>>({
    laize: str(initial?.laize),
    laizeMin: str(initial?.laizeMin),
    laizeMax: str(initial?.laizeMax),
    grammage: str(initial?.grammage),
    grammageMin: str(initial?.grammageMin),
    grammageMax: str(initial?.grammageMax),
    grammageMinWithoutHandle: str(initial?.grammageMinWithoutHandle),
    grammageMaxWithoutHandle: str(initial?.grammageMaxWithoutHandle),
    grammageMinWithHandle: str(initial?.grammageMinWithHandle),
    grammageMaxWithHandle: str(initial?.grammageMaxWithHandle),
    grammageMinKraft: str(initial?.grammageMinKraft),
    grammageMaxKraft: str(initial?.grammageMaxKraft),
    grammageMinLaminatedKraft: str(initial?.grammageMinLaminatedKraft),
    grammageMaxLaminatedKraft: str(initial?.grammageMaxLaminatedKraft),
    lengthMin: str(initial?.lengthMin),
    lengthMax: str(initial?.lengthMax),
    widthMin: str(initial?.widthMin),
    widthMax: str(initial?.widthMax),
  });
  const cap = (key: string) => caps[key] ?? "";
  const setCap = (key: string, value: string) =>
    setCaps((current) => ({ ...current, [key]: value }));

  const [error, setError] = useState<string | null>(null);

  const suppliersQuery = useQuery(
    trpc.supplier.list.queryOptions({ pageSize: 100, sortBy: "name", sortDir: "asc" }),
  );
  const suppliers = suppliersQuery.data?.rows ?? [];

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: trpc.machine.list.queryKey() });
    await go("/machines");
  };

  const create = useMutation(
    trpc.machine.create.mutationOptions({ onSuccess: done, onError: (c) => setError(c.message) }),
  );
  const update = useMutation(
    trpc.machine.update.mutationOptions({ onSuccess: done, onError: (c) => setError(c.message) }),
  );
  const busy = create.isPending || update.isPending;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    // Convert the measurement strings once, reporting the first bad one rather
    // than letting Number("12a") become NaN and fail Zod with a vaguer message.
    const numbers: Record<string, number | undefined> = {};
    for (const [key, value] of Object.entries(caps)) {
      const trimmed = value.trim();
      if (trimmed === "") continue;
      if (Number.isNaN(Number(trimmed))) {
        setError(t("form.mustBeNumber", { field: t(`measures.${key}`) }));
        return;
      }
      numbers[key] = Number(trimmed);
    }

    const trimmedPrice = price.trim();
    if (trimmedPrice !== "" && Number.isNaN(Number(trimmedPrice))) {
      setError(t("form.priceMustBeNumber"));
      return;
    }

    const raw = {
      code,
      name,
      type: type === "" ? undefined : type,
      brand,
      price: trimmedPrice === "" ? undefined : Number(trimmedPrice),
      purchaseDate,
      imageUrl,
      invoiceUrl,
      supplierId: supplierId === "" ? undefined : supplierId,
      ...numbers,
    };

    if (initial) {
      const parsed = updateMachineInput.safeParse({ ...raw, id: initial.id });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? common("checkForm"));
        return;
      }
      update.mutate(parsed.data);
      return;
    }
    const parsed = createMachineInput.safeParse(raw);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    create.mutate(parsed.data);
  }

  const measure = (key: string, unit?: string) => (
    <TextField
      label={t(`measures.${key}`)}
      unit={unit}
      format="numeric"
      value={cap(key)}
      onChange={(e) => setCap(key, e.target.value)}
      autoComplete="off"
      disabled={busy}
    />
  );

  return (
    <form className={styles.formPanel} onSubmit={handleSubmit} noValidate>
      {error && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <div className={styles.formGrid}>
        <TextField
          label={t("form.code")}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <SelectField
          label={t("form.type")}
          value={type}
          onChange={(e) => setType(e.target.value as MachineType)}
          disabled={busy}
          placeholder={t("form.selectType")}
          options={MACHINE_TYPES.map((value) => ({ value, label: enums(`machineType.${value}`) }))}
        />
        <div className={styles.formWide}>
          <TextField
            label={t("form.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </div>

        <TextField
          label={t("form.brand")}
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <SelectField
          label={t("form.supplier")}
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          disabled={busy || suppliersQuery.isPending}
          allowEmpty
          placeholder={suppliersQuery.isPending ? common("loading") : t("form.noSupplier")}
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
        />
        <TextField
          label={t("form.price")}
          format="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("form.purchaseDate")}
          type="date"
          value={purchaseDate}
          onChange={(e) => setPurchaseDate(e.target.value)}
          disabled={busy}
        />

        <span className={styles.formSection}>{t("form.capabilities")}</span>
        <p className={[styles.hint, styles.formWide].filter(Boolean).join(" ")}>
          {t("form.capabilitiesHint")}
        </p>

        {measure("laize", "mm")}
        {measure("grammage", "g/m²")}
        {measure("laizeMin", "mm")}
        {measure("laizeMax", "mm")}
        {measure("grammageMin", "g/m²")}
        {measure("grammageMax", "g/m²")}
        {measure("grammageMinWithoutHandle", "g/m²")}
        {measure("grammageMaxWithoutHandle", "g/m²")}
        {measure("grammageMinWithHandle", "g/m²")}
        {measure("grammageMaxWithHandle", "g/m²")}
        {measure("grammageMinKraft", "g/m²")}
        {measure("grammageMaxKraft", "g/m²")}
        {measure("grammageMinLaminatedKraft", "g/m²")}
        {measure("grammageMaxLaminatedKraft", "g/m²")}
        {measure("lengthMin", "mm")}
        {measure("lengthMax", "mm")}
        {measure("widthMin", "mm")}
        {measure("widthMax", "mm")}

        <span className={styles.formSection}>{t("form.documents")}</span>
        {/*
          There is no machine detail page, so this form is also the display
          surface: the image gets a live preview and the invoice a link that
          actually opens, rather than a bucket path in a text box.
        */}
        <div className={styles.formWide}>
          <div className={styles.imageRow}>
            <Thumbnail size="sm" src={assetUrl(imageUrl)} />
            <TextField
              label={t("form.imageUrl")}
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </div>
        </div>
        <div className={styles.formWide}>
          <TextField
            label={t("form.invoiceUrl")}
            value={invoiceUrl}
            onChange={(e) => setInvoiceUrl(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
          {assetUrl(invoiceUrl) !== null && (
            <p className={styles.hint}>
              <FileLink href={assetUrl(invoiceUrl)} />
            </p>
          )}
        </div>
      </div>

      <div className={styles.formActions}>
        <Button variant="secondary" onClick={() => cancel("/machines")} disabled={busy}>
          {common("cancel")}
        </Button>
        <Button variant="primary" type="submit" busy={busy}>
          {busy ? common("saving") : initial ? common("saveChanges") : t("form.createMachine")}
        </Button>
      </div>
    </form>
  );
}
