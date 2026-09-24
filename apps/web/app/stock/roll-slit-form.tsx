"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { slitRollInput } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/field";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import type { FormNav } from "../records/form-nav";
import { useTRPC } from "../trpc/client";
import { invalidateRollQueries } from "./roll-queries";
import styles from "../records/records.module.css";
import { numberFormat } from "../../i18n/formats";

type Roll = inferRouterOutputs<AppRouter>["stock"]["rollById"];

const metresFmt = () => numberFormat({ maximumFractionDigits: 2 });
const MAX_BANDS = 8;

/**
 * Slit a reel lengthwise into bands (`stock.slit`). The mother is retired
 * and each band becomes a reel of the mother's remaining length. Opened
 * from the reel's page, and from the order's reel picker with the first
 * band prefilled to the order's production width.
 */
export function RollSlitForm({
  rollId,
  prefillWidthMm,
  onDone,
  onCancel,
}: { rollId: string; prefillWidthMm?: number } & FormNav) {
  const t = useTranslations("stock");
  const trpc = useTRPC();
  const rollQuery = useQuery(trpc.stock.rollById.queryOptions({ id: rollId }));

  if (rollQuery.isPending) return <p className={styles.muted}>{t("rolls.loading")}</p>;
  if (rollQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {rollQuery.error.message}
      </p>
    );
  }
  // The fields start from the reel's width, so they mount once it is known.
  return (
    <SlitFields
      roll={rollQuery.data}
      prefillWidthMm={prefillWidthMm}
      onDone={onDone}
      onCancel={onCancel}
    />
  );
}

function SlitFields({
  roll,
  prefillWidthMm,
  onDone,
  onCancel,
}: { roll: Roll; prefillWidthMm?: number } & FormNav) {
  const t = useTranslations("stock");
  const common = useTranslations("common");
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const laize = roll.laize;
  const [widths, setWidths] = useState<string[]>(() => {
    if (prefillWidthMm !== undefined && laize !== null && prefillWidthMm < laize) {
      return [String(prefillWidthMm), String(laize - prefillWidthMm)];
    }
    return ["", ""];
  });
  const [error, setError] = useState<string | null>(null);

  const go = (target: string) => (onDone ? onDone(target) : router.push(target));
  const cancel = (target: string) => (onCancel ? onCancel(target) : router.push(target));

  const slit = useMutation(
    trpc.stock.slit.mutationOptions({
      onSuccess: async (mother) => {
        await invalidateRollQueries(queryClient, trpc);
        await go(`/stock/${mother.id}`);
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  const numbers = widths.map((w) => (w.trim() === "" ? 0 : Number(w)));
  const sum = numbers.reduce((total, n) => total + (Number.isFinite(n) ? n : 0), 0);
  const trim = laize === null ? null : laize - sum;
  const name = roll.numero ?? t("rolls.detail.thisReel");

  const setWidth = (index: number, value: string) =>
    setWidths((current) => current.map((w, i) => (i === index ? value : w)));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    for (const [index, w] of widths.entries()) {
      if (w.trim() === "" || Number.isNaN(Number(w))) {
        setError(t("mustBeNumber", { label: t("rolls.slit.width", { n: index + 1 }) }));
        return;
      }
    }
    if (trim !== null && trim < 0) {
      setError(t("rolls.slit.over"));
      return;
    }
    const parsed = slitRollInput.safeParse({
      rollId: roll.id,
      widthsMm: widths.map((w) => Number(w)),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    slit.mutate(parsed.data);
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
          <p className={styles.hint}>
            {laize === null
              ? t("rolls.slit.noWidth", { reel: name })
              : t("rolls.slit.motherHint", {
                  reel: name,
                  width: laize,
                  metres: metresFmt().format(roll.metrageRestant),
                })}
          </p>
        </div>
        {widths.map((w, index) => (
          <TextField
            key={index}
            label={t("rolls.slit.width", { n: index + 1 })}
            unit="mm"
            format="numeric"
            value={w}
            onChange={(e) => setWidth(index, e.target.value)}
            autoComplete="off"
            autoFocus={index === 0}
            disabled={slit.isPending}
          />
        ))}
        <div className={styles.formWide}>
          <p
            className={[styles.hint, trim !== null && trim < 0 ? styles.error : null]
              .filter(Boolean)
              .join(" ")}
          >
            {trim === null
              ? ""
              : trim < 0
                ? t("rolls.slit.over")
                : t("rolls.slit.trim", { mm: trim })}
          </p>
          <span className={styles.actions}>
            {widths.length < MAX_BANDS && (
              <Button
                className={styles.actionBtn}
                onClick={() => setWidths((current) => [...current, ""])}
                disabled={slit.isPending}
              >
                {t("rolls.slit.addBand")}
              </Button>
            )}
            {widths.length > 2 && (
              <Button
                className={styles.actionBtn}
                onClick={() => setWidths((current) => current.slice(0, -1))}
                disabled={slit.isPending}
              >
                {t("rolls.slit.removeBand")}
              </Button>
            )}
          </span>
        </div>
      </div>
      <div className={styles.formActions}>
        <Button
          variant="secondary"
          onClick={() => cancel(`/stock/${roll.id}`)}
          disabled={slit.isPending}
        >
          {common("cancel")}
        </Button>
        <Button variant="primary" type="submit" busy={slit.isPending} disabled={laize === null}>
          {slit.isPending ? common("working") : t("rolls.slit.submit")}
        </Button>
      </div>
    </form>
  );
}
