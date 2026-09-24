"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createRollInput, PAPER_TYPES, updateRollInput } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { SelectField, TextField } from "@repo/ui/field";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { useTRPC } from "../trpc/client";
import { rollMoney } from "./roll-queries";
import styles from "../records/records.module.css";

export type RollFormValues = inferRouterOutputs<AppRouter>["stock"]["rollById"];

const str = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

export function RollForm({
  initial,
  shipmentId,
  onDone,
  onCancel,
}: {
  initial?: RollFormValues;
  /** Pre-selected when adding a reel from a shipment's own page. */
  shipmentId?: string;
  onDone?: (target: string) => void | Promise<void>;
  onCancel?: (target: string) => void;
}) {
  const t = useTranslations("stock");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const router = useRouter();
  // The route modal passes both; the full page falls through to navigation.
  const go = (target: string) => (onDone ? onDone(target) : router.push(target));
  const cancel = (target: string) => (onCancel ? onCancel(target) : router.push(target));
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [importShipmentId, setImportShipmentId] = useState(
    initial?.importShipmentId ?? shipmentId ?? "",
  );
  const [numero, setNumero] = useState(initial?.numero ?? "");
  const [numeroSource, setNumeroSource] = useState(initial?.numeroSource ?? "");
  const [paperGrade, setPaperGrade] = useState(initial?.paperGrade ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [poids, setPoids] = useState(str(initial?.poids));
  const [metrage, setMetrage] = useState(str(initial?.metrage));
  const [poidsRestant, setPoidsRestant] = useState(str(initial?.poidsRestant));
  const [metrageRestant, setMetrageRestant] = useState(str(initial?.metrageRestant));
  const [laize, setLaize] = useState(str(initial?.laize));
  const [grammage, setGrammage] = useState(str(initial?.grammage));
  const [paperType, setPaperType] = useState(initial?.paperType ?? "");
  // `createRoll` / `updateRoll` are `adminProcedure`, so only ADMIN+ ever
  // reaches this form — and only their `rollById` carries the money columns.
  // The accessor is what keeps that precondition explicit now that the row
  // type is the union of the priced and unpriced selects.
  const initialMoney = rollMoney(initial, true);
  const [price, setPrice] = useState(str(initialMoney.price));
  const [priceWithTransport, setPriceWithTransport] = useState(
    str(initialMoney.priceWithTransport),
  );
  const [qrCodeUrl, setQrCodeUrl] = useState(initial?.qrCodeUrl ?? "");
  const [error, setError] = useState<string | null>(null);

  const shipmentsQuery = useQuery(
    trpc.stock.listShipments.queryOptions({
      pageSize: 100,
      sortBy: "dateImport",
      sortDir: "desc",
      filter: "all",
    }),
  );
  const shipments = shipmentsQuery.data?.rows ?? [];

  /**
   * Weights are locked once anything depends on the reel — the server refuses
   * them, so the form disables them rather than letting a save fail. Mirrors
   * `StockService.assertRollWeightsEditable`; the server remains the
   * authority.
   */
  const lockReasons: string[] = [];
  if (initial) {
    if (initial.allocations.length > 0) {
      lockReasons.push(t("rolls.form.lockAllocations", { count: initial.allocations.length }));
    }
    if (initial.children.length > 0) {
      lockReasons.push(t("rolls.form.lockChildren", { count: initial.children.length }));
    }
    if (initial.parentId !== null) lockReasons.push(t("rolls.form.lockParent"));
    if (initial.consomme) lockReasons.push(t("rolls.form.lockConsumed"));
  }
  const weightsLocked = lockReasons.length > 0;

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: trpc.stock.listRolls.queryKey() });
    await queryClient.invalidateQueries({ queryKey: trpc.stock.rollById.queryKey() });
    await queryClient.invalidateQueries({ queryKey: trpc.stock.shipmentById.queryKey() });
    await queryClient.invalidateQueries({ queryKey: trpc.stock.listShipments.queryKey() });
    await go(initial ? `/stock/${initial.id}` : `/stock/shipments/${importShipmentId}`);
  };

  const create = useMutation(
    trpc.stock.createRoll.mutationOptions({
      onSuccess: done,
      onError: (cause) => setError(cause.message),
    }),
  );
  const update = useMutation(
    trpc.stock.updateRoll.mutationOptions({
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
        importShipmentId,
        numero,
        numeroSource,
        paperGrade,
        description,
        poids: num(t("rolls.form.weight"), poids),
        metrage: num(t("rolls.form.length"), metrage),
        laize: num(t("rolls.form.width"), laize),
        grammage: num(t("rolls.form.grammage"), grammage),
        paperType: paperType === "" ? undefined : paperType,
        price: num(t("rolls.form.price"), price),
        priceWithTransport: num(t("rolls.form.priceWithTransport"), priceWithTransport),
        qrCodeUrl,
      };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : common("checkForm"));
      return;
    }

    if (initial) {
      const parsed = updateRollInput.safeParse({
        ...raw,
        id: initial.id,
        // Only sent when editable, so a locked reel cannot smuggle a weight
        // through by having stale values in disabled inputs.
        ...(weightsLocked
          ? {}
          : {
              poidsRestant: (() => {
                const t = poidsRestant.trim();
                return t === "" ? undefined : Number(t);
              })(),
              metrageRestant: (() => {
                const t = metrageRestant.trim();
                return t === "" ? undefined : Number(t);
              })(),
            }),
      });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        setError(issue ? `${issue.path.join(".")}: ${issue.message}` : common("checkForm"));
        return;
      }
      update.mutate(parsed.data);
      return;
    }
    const parsed = createRollInput.safeParse(raw);
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
        <div className={styles.formWide}>
          <SelectField
            label={t("rolls.form.shipment")}
            value={importShipmentId}
            onChange={(e) => setImportShipmentId(e.target.value)}
            disabled={busy || shipmentsQuery.isPending}
            options={shipments.map((s) => ({
              value: s.id,
              label: `${s.numeroImport} — ${s.supplier.name}`,
            }))}
            placeholder={
              shipmentsQuery.isPending ? t("loadingOptions") : t("rolls.form.chooseShipment")
            }
          />
          <p className={styles.hint}>
            {t.rich("rolls.form.shipmentHint", {
              link: (chunks) => (
                <Link className={styles.inlineLink} href="/stock/shipments/new">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>

        <div>
          <TextField
            label={t("rolls.form.reelNumber")}
            format="mono"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
          <p className={styles.hint}>{t("rolls.form.reelNumberHint")}</p>
        </div>
        <TextField
          label={t("rolls.form.sourceNumber")}
          format="mono"
          value={numeroSource}
          onChange={(e) => setNumeroSource(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("rolls.form.grade")}
          value={paperGrade}
          onChange={(e) => setPaperGrade(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <SelectField
          label={t("rolls.form.paper")}
          value={paperType}
          onChange={(e) => setPaperType(e.target.value)}
          disabled={busy}
          allowEmpty
          placeholder={t("rolls.form.notSet")}
          options={PAPER_TYPES.map((v) => ({ value: v, label: enums(`paperType.${v}`) }))}
        />
        <TextField
          label={t("rolls.form.grammage")}
          unit="g/m²"
          format="numeric"
          value={grammage}
          onChange={(e) => setGrammage(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("rolls.form.width")}
          unit="mm"
          format="numeric"
          value={laize}
          onChange={(e) => setLaize(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <div className={styles.formWide}>
          <TextField
            label={t("rolls.form.description")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </div>

        <span className={styles.formSection}>{t("rolls.form.quantitySection")}</span>

        {weightsLocked && (
          <div className={styles.formWide}>
            <p className={[styles.notice, styles.error].filter(Boolean).join(" ")}>
              {t("rolls.form.weightsLocked", { reasons: lockReasons.join(", ") })}
            </p>
          </div>
        )}

        <TextField
          label={t("rolls.form.weight")}
          unit="kg"
          format="numeric"
          value={poids}
          onChange={(e) => setPoids(e.target.value)}
          autoComplete="off"
          disabled={busy || weightsLocked}
        />
        <TextField
          label={t("rolls.form.length")}
          unit="m"
          format="numeric"
          value={metrage}
          onChange={(e) => setMetrage(e.target.value)}
          autoComplete="off"
          disabled={busy || weightsLocked}
        />
        {initial ? (
          <>
            <TextField
              label={t("rolls.form.weightRemaining")}
              unit="kg"
              format="numeric"
              value={poidsRestant}
              onChange={(e) => setPoidsRestant(e.target.value)}
              autoComplete="off"
              disabled={busy || weightsLocked}
            />
            <TextField
              label={t("rolls.form.lengthRemaining")}
              unit="m"
              format="numeric"
              value={metrageRestant}
              onChange={(e) => setMetrageRestant(e.target.value)}
              autoComplete="off"
              disabled={busy || weightsLocked}
            />
          </>
        ) : (
          <div className={styles.formWide}>
            <p className={styles.hint}>{t("rolls.form.remainingHint")}</p>
          </div>
        )}

        <span className={styles.formSection}>{t("rolls.form.costSection")}</span>

        <TextField
          label={t("rolls.form.price")}
          format="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("rolls.form.priceWithTransport")}
          format="numeric"
          value={priceWithTransport}
          onChange={(e) => setPriceWithTransport(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <div className={styles.formWide}>
          <TextField
            label={t("rolls.form.qrCodeUrl")}
            value={qrCodeUrl}
            onChange={(e) => setQrCodeUrl(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </div>
      </div>

      <div className={styles.formActions}>
        <Button
          variant="secondary"
          onClick={() =>
            cancel(initial ? `/stock/${initial.id}` : `/stock/shipments/${shipmentId ?? ""}`)
          }
          disabled={busy}
        >
          {common("cancel")}
        </Button>
        <Button variant="primary" type="submit" busy={busy}>
          {busy ? common("saving") : initial ? common("saveChanges") : t("rolls.form.addReel")}
        </Button>
      </div>
    </form>
  );
}
