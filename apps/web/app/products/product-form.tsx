"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { assetUrl, createProductInput, updateProductInput } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { SelectField, TextField } from "@repo/ui/field";
import { Thumbnail } from "@repo/ui/thumbnail";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { useTRPC } from "../trpc/client";
import { ProductSpecFields } from "./product-spec-fields";
import styles from "../records/records.module.css";

export type ProductFormValues = inferRouterOutputs<AppRouter>["product"]["byId"];

const str = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

export function ProductForm({
  initial,
  onDone,
  onCancel,
}: {
  onDone?: (target: string) => void | Promise<void>;
  onCancel?: (target: string) => void;
  initial?: ProductFormValues;
}) {
  const router = useRouter();
  // The route modal passes both; the full page falls through to navigation.
  const go = (target: string) => (onDone ? onDone(target) : router.push(target));
  const cancel = (target: string) => (onCancel ? onCancel(target) : router.push(target));
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const t = useTranslations("products");
  const common = useTranslations("common");

  const [name, setName] = useState(initial?.name ?? "");
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [typeSac, setTypeSac] = useState(initial?.typeSac ?? "");
  const [widthCm, setWidthCm] = useState(str(initial?.widthCm));
  const [lengthCm, setLengthCm] = useState(str(initial?.lengthCm));
  const [gussetCm, setGussetCm] = useState(str(initial?.gussetCm));
  const [pleatWidthCm, setPleatWidthCm] = useState(str(initial?.pleatWidthCm));
  const [pleatLengthCm, setPleatLengthCm] = useState(str(initial?.pleatLengthCm));
  const [grammage, setGrammage] = useState(str(initial?.grammage));
  const [paperType, setPaperType] = useState(initial?.paperType ?? "");
  const [hasHandle, setHasHandle] = useState(initial?.hasHandle ?? false);
  const [handleWeightG, setHandleWeightG] = useState(str(initial?.handleWeightG));
  /**
   * Artwork URLs, edited as a list. Held as strings like every other field:
   * a blank row is dropped on submit rather than saved as an empty URL.
   */
  const [images, setImages] = useState<string[]>(initial?.images ?? []);
  const [error, setError] = useState<string | null>(null);

  // Active clients only, for the "shared vs one client" picker below.
  const clientsQuery = useQuery(
    trpc.client.list.queryOptions({ pageSize: 100, sortBy: "name", sortDir: "asc" }),
  );
  const clients = clientsQuery.data?.rows ?? [];

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: trpc.product.list.queryKey() });
    await queryClient.invalidateQueries({ queryKey: trpc.product.forClient.queryKey() });
    await go("/products");
  };

  const create = useMutation(
    trpc.product.create.mutationOptions({
      onSuccess: done,
      onError: (cause) => setError(cause.message),
    }),
  );
  const update = useMutation(
    trpc.product.update.mutationOptions({
      onSuccess: done,
      onError: (cause) => setError(cause.message),
    }),
  );

  const busy = create.isPending || update.isPending;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const num = (label: string, value: string): number | undefined => {
      const trimmed = value.trim();
      if (trimmed === "") return undefined;
      const parsed = Number(trimmed);
      if (Number.isNaN(parsed)) throw new Error(t("form.mustBeNumber", { field: label }));
      return parsed;
    };

    let raw: Record<string, unknown>;
    try {
      raw = {
        name,
        clientId: clientId === "" ? undefined : clientId,
        typeSac: typeSac === "" ? undefined : typeSac,
        widthCm: num(t("spec.width"), widthCm) ?? 0,
        lengthCm: num(t("spec.length"), lengthCm) ?? 0,
        gussetCm: num(t("spec.gusset"), gussetCm),
        pleatWidthCm: num(t("spec.foldWidth"), pleatWidthCm),
        pleatLengthCm: num(t("spec.foldLength"), pleatLengthCm),
        grammage: num(t("spec.grammage"), grammage) ?? 0,
        paperType: paperType === "" ? undefined : paperType,
        hasHandle,
        handleWeightG: num(t("spec.handleWeight"), handleWeightG),
        // Always sent, so clearing every row genuinely clears the artwork.
        // Blank rows are dropped rather than saved as empty URLs.
        images: images.map((url) => url.trim()).filter((url) => url !== ""),
      };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : common("checkForm"));
      return;
    }

    if (initial) {
      const result = updateProductInput.safeParse({ ...raw, id: initial.id });
      if (!result.success) {
        setError(result.error.issues[0]?.message ?? common("checkForm"));
        return;
      }
      update.mutate(result.data);
      return;
    }
    const result = createProductInput.safeParse(raw);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    create.mutate(result.data);
  }

  return (
    <form className={styles.formPanel} onSubmit={handleSubmit} noValidate>
      {error && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <div className={styles.formGrid}>
        <div className={styles.formWide}>
          <TextField
            label={t("form.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
          <p className={styles.hint}>{t("form.nameHint")}</p>
        </div>

        <SelectField
          label={t("form.client")}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          disabled={busy || clientsQuery.isPending}
          allowEmpty
          placeholder={clientsQuery.isPending ? t("loading") : t("form.sharedNoClient")}
          options={[
            ...clients.map((c) => ({ value: c.id, label: c.name })),
            ...(initial?.clientId && !clients.some((c) => c.id === initial.clientId)
              ? [{ value: initial.clientId, label: t("form.archivedClient") }]
              : []),
          ]}
        />

        <span className={styles.formSection}>{t("form.specification")}</span>
        <ProductSpecFields
          typeSac={typeSac}
          setTypeSac={setTypeSac}
          widthCm={widthCm}
          setWidthCm={setWidthCm}
          lengthCm={lengthCm}
          setLengthCm={setLengthCm}
          gussetCm={gussetCm}
          setGussetCm={setGussetCm}
          pleatWidthCm={pleatWidthCm}
          setPleatWidthCm={setPleatWidthCm}
          pleatLengthCm={pleatLengthCm}
          setPleatLengthCm={setPleatLengthCm}
          grammage={grammage}
          setGrammage={setGrammage}
          paperType={paperType}
          setPaperType={setPaperType}
          hasHandle={hasHandle}
          setHasHandle={setHasHandle}
          handleWeightG={handleWeightG}
          setHandleWeightG={setHandleWeightG}
          disabled={busy}
        />

        <span className={styles.formSection}>{t("form.artwork")}</span>
        <div className={styles.formWide}>
          <p className={styles.hint}>{t("form.artworkHint")}</p>
          {images.map((url, index) => (
            <div key={index} className={styles.imageRow}>
              {/*
                Live preview, so a mistyped or dead link is visible without
                opening a tab. A dead URL falls back to a placeholder box.
              */}
              <Thumbnail size="sm" src={assetUrl(url)} />
              <TextField
                label={index === 0 ? t("form.imageUrl") : ""}
                value={url}
                onChange={(e) =>
                  setImages((current) =>
                    current.map((u, i) => (i === index ? e.target.value : u)),
                  )
                }
                autoComplete="off"
                disabled={busy}
              />
              <Button
                className={styles.actionBtn}
                variant="danger"
                disabled={busy}
                onClick={() =>
                  setImages((current) => current.filter((_, i) => i !== index))
                }
              >
                {t("form.remove")}
              </Button>
            </div>
          ))}
          <Button
            className={styles.actionBtn}
            disabled={busy || images.length >= 50}
            onClick={() => setImages((current) => [...current, ""])}
          >
            {t("form.addImage")}
          </Button>
        </div>

        {initial && (
          <div className={styles.formWide}>
            <p className={styles.hint}>
              {t("form.usedBy", { count: initial.orderCount })}
            </p>
          </div>
        )}
      </div>

      <div className={styles.formActions}>
        <Button
          variant="secondary"
          onClick={() => cancel("/products")}
          disabled={busy}
        >
          {common("cancel")}
        </Button>
        <Button variant="primary" type="submit" busy={busy}>
          {busy ? common("saving") : initial ? common("saveChanges") : t("form.createProduct")}
        </Button>
      </div>
    </form>
  );
}
