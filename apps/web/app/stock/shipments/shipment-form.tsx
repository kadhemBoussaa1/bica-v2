"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { createShipmentInput, updateShipmentInput } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@repo/ui/field";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { useTRPC } from "../../trpc/client";
import styles from "../../records/records.module.css";

/**
 * What the form seeds from.
 *
 * `shipmentById` selects money only for ADMIN+ (`StockService.canReadPricing`),
 * so its output type no longer promises those columns. The edit route is
 * ADMIN-only — `NewRecordButton` hides the link and `updateShipment` is
 * `adminProcedure` — so the form does get them at runtime; they are spelled
 * out as optional here rather than widening the select back, which would hand
 * the warehouse a price it may not read.
 */
export type ShipmentFormValues = inferRouterOutputs<AppRouter>["stock"]["shipmentById"] & {
  price?: number | null;
  priceTotal?: number | null;
  currency?: string | null;
  transportPrice?: number | null;
};

const str = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

/**
 * A stored `@db.Date` arrives as an ISO string; the date input wants
 * "YYYY-MM-DD". Sliced rather than parsed through `new Date`, which would
 * shift the day on a machine east of UTC — the same trap `legacyDate` exists
 * to avoid in the importers.
 */
const dateValue = (value: string | null | undefined) =>
  value === null || value === undefined ? "" : value.slice(0, 10);

export function ShipmentForm({
  initial,
  onDone,
  onCancel,
}: {
  onDone?: (target: string) => void | Promise<void>;
  onCancel?: (target: string) => void;
  initial?: ShipmentFormValues;
}) {
  const t = useTranslations("stock");
  const common = useTranslations("common");
  const router = useRouter();
  // The route modal passes both; the full page falls through to navigation.
  const go = (target: string) => (onDone ? onDone(target) : router.push(target));
  const cancel = (target: string) => (onCancel ? onCancel(target) : router.push(target));
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [numeroImport, setNumeroImport] = useState(initial?.numeroImport ?? "");
  const [dateImport, setDateImport] = useState(dateValue(initial?.dateImport));
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [productName, setProductName] = useState(initial?.productName ?? "");
  // Numerics as strings: an empty number input has no numeric value, and
  // coercing "" to 0 would claim a real price or length of zero.
  const [totalMetrage, setTotalMetrage] = useState(str(initial?.totalMetrage));
  const [totalRolls, setTotalRolls] = useState(str(initial?.totalRolls));
  const [price, setPrice] = useState(str(initial?.price));
  const [priceTotal, setPriceTotal] = useState(str(initial?.priceTotal));
  const [currency, setCurrency] = useState(initial?.currency ?? "EUR");
  const [transportIncluded, setTransportIncluded] = useState(
    initial?.transportIncluded ?? false,
  );
  const [transportPrice, setTransportPrice] = useState(str(initial?.transportPrice));
  const [hasCertificate, setHasCertificate] = useState(initial?.hasCertificate ?? false);
  const [certificate, setCertificate] = useState(initial?.certificate ?? "");
  const [packingList, setPackingList] = useState(initial?.packingList ?? "");
  const [importFile, setImportFile] = useState(initial?.importFile ?? "");
  const [observations, setObservations] = useState(initial?.observations ?? "");
  const [error, setError] = useState<string | null>(null);

  // Active suppliers only: the picker must not offer one the API would reject.
  // An archived supplier already on this shipment is appended below.
  const suppliersQuery = useQuery(
    trpc.supplier.list.queryOptions({ pageSize: 100, sortBy: "name", sortDir: "asc" }),
  );
  const suppliers = (suppliersQuery.data?.rows ?? []).filter((s) => s.active);

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: trpc.stock.listShipments.queryKey() });
    await queryClient.invalidateQueries({ queryKey: trpc.stock.shipmentById.queryKey() });
    await go("/stock/shipments");
  };

  const create = useMutation(
    trpc.stock.createShipment.mutationOptions({
      onSuccess: done,
      onError: (cause) => setError(cause.message),
    }),
  );
  const update = useMutation(
    trpc.stock.updateShipment.mutationOptions({
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
      if (Number.isNaN(parsed)) throw new Error(t("mustBeNumber", { label }));
      return parsed;
    };

    let raw: Record<string, unknown>;
    try {
      raw = {
        numeroImport,
        dateImport: dateImport.trim() === "" ? undefined : dateImport,
        supplierId,
        productName,
        totalMetrage: num(t("shipments.form.totalLength"), totalMetrage),
        totalRolls: num(t("shipments.form.reelsDeclared"), totalRolls),
        price: num(t("shipments.form.unitPrice"), price),
        priceTotal: num(t("shipments.form.totalPrice"), priceTotal),
        currency,
        transportIncluded,
        transportPrice: num(t("shipments.form.transport"), transportPrice),
        hasCertificate,
        certificate,
        packingList,
        importFile,
        observations,
      };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : common("checkForm"));
      return;
    }

    if (initial) {
      const parsed = updateShipmentInput.safeParse({ ...raw, id: initial.id });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        setError(issue ? `${issue.path.join(".")}: ${issue.message}` : common("checkForm"));
        return;
      }
      update.mutate(parsed.data);
      return;
    }
    const parsed = createShipmentInput.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue ? `${issue.path.join(".")}: ${issue.message}` : common("checkForm"));
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
          label={t("shipments.form.shipmentNumber")}
          value={numeroImport}
          onChange={(e) => setNumeroImport(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("shipments.form.arrived")}
          type="date"
          format="mono"
          value={dateImport}
          onChange={(e) => setDateImport(e.target.value)}
          disabled={busy}
        />

        <div>
          <SelectField
            label={t("shipments.form.supplier")}
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            disabled={busy || suppliersQuery.isPending}
            /*
             * The query returns active suppliers. A shipment already linked to
             * an archived one would otherwise render blank and lose the link
             * on the next save, so its own value is appended when missing.
             */
            options={[
              ...suppliers.map((s) => ({ value: s.id, label: s.name })),
              ...(initial?.supplierId &&
              !suppliers.some((s) => s.id === initial.supplierId)
                ? [
                    {
                      value: initial.supplierId,
                      label: t("shipments.form.archivedSupplier", { name: initial.supplier.name }),
                    },
                  ]
                : []),
            ]}
            // Required, so blank is NOT selectable: the free-text fallback was
            // dropped because it recorded the same company two ways.
            placeholder={
              suppliersQuery.isPending ? t("loadingOptions") : t("shipments.form.chooseSupplier")
            }
          />
          <p className={styles.hint}>
            {t.rich("shipments.form.supplierHint", {
              link: (chunks) => (
                <Link className={styles.inlineLink} href="/suppliers/new">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>

        <div className={styles.formWide}>
          <TextField
            label={t("shipments.form.paper")}
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </div>

        <span className={styles.formSection}>{t("shipments.form.quantitySection")}</span>

        <TextField
          label={t("shipments.form.totalLength")}
          unit="m"
          format="numeric"
          value={totalMetrage}
          onChange={(e) => setTotalMetrage(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <div>
          <TextField
            label={t("shipments.form.reelsDeclared")}
            format="numeric"
            value={totalRolls}
            onChange={(e) => setTotalRolls(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
          <p className={styles.hint}>{t("shipments.form.reelsDeclaredHint")}</p>
        </div>
        <TextField
          label={t("shipments.form.unitPrice")}
          format="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("shipments.form.totalPrice")}
          format="numeric"
          value={priceTotal}
          onChange={(e) => setPriceTotal(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("shipments.form.currency")}
          format="mono"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("shipments.form.transport")}
          format="numeric"
          value={transportPrice}
          onChange={(e) => setTransportPrice(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <div className={styles.formWide}>
          <CheckboxField
            label={t("shipments.form.transportIncluded")}
            checked={transportIncluded}
            onChange={(e) => setTransportIncluded(e.target.checked)}
            disabled={busy}
          />
        </div>

        <span className={styles.formSection}>{t("shipments.form.documentsSection")}</span>

        <div className={styles.formWide}>
          <CheckboxField
            label={t("shipments.form.hasCertificate")}
            checked={hasCertificate}
            onChange={(e) => setHasCertificate(e.target.checked)}
            disabled={busy}
          />
        </div>
        <TextField
          label={t("shipments.form.certificate")}
          value={certificate}
          onChange={(e) => setCertificate(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("shipments.form.packingList")}
          value={packingList}
          onChange={(e) => setPackingList(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <div className={styles.formWide}>
          <TextField
            label={t("shipments.form.importFile")}
            value={importFile}
            onChange={(e) => setImportFile(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
          <p className={styles.hint}>{t("shipments.form.importFileHint")}</p>
        </div>

        <div className={styles.formWide}>
          <TextAreaField
            label={t("shipments.form.observations")}
            rows={3}
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            disabled={busy}
          />
        </div>

        {initial && initial.rollCount > 0 && (
          <div className={styles.formWide}>
            <p className={styles.hint}>
              {t("shipments.form.attachedHint", { count: initial.rollCount })}
            </p>
          </div>
        )}
      </div>

      <div className={styles.formActions}>
        <Button
          variant="secondary"
          onClick={() => cancel("/stock/shipments")}
          disabled={busy}
        >
          {common("cancel")}
        </Button>
        <Button variant="primary" type="submit" busy={busy}>
          {busy ? common("saving") : initial ? common("saveChanges") : t("shipments.form.createShipment")}
        </Button>
      </div>
    </form>
  );
}
