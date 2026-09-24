"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { cutRollInput } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/field";
import type { FormNav } from "../records/form-nav";
import { useTRPC } from "../trpc/client";
import { invalidateRollQueries } from "./roll-queries";
import styles from "../records/records.module.css";
import { numberFormat } from "../../i18n/formats";

const metresFmt = () => numberFormat({ maximumFractionDigits: 2 });

/**
 * Cut a length off a reel into a new child reel (`stock.cut`). Opened from
 * the reel's page as a route modal, and from the order's reel picker for a
 * plain cut. The reel's free length is the ceiling; the server enforces it.
 */
export function RollCutForm({
  rollId,
  defaultMetres,
  onDone,
  onCancel,
}: { rollId: string; defaultMetres?: number } & FormNav) {
  const t = useTranslations("stock");
  const common = useTranslations("common");
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const rollQuery = useQuery(trpc.stock.rollById.queryOptions({ id: rollId }));
  const [metres, setMetres] = useState(defaultMetres === undefined ? "" : String(defaultMetres));
  const [error, setError] = useState<string | null>(null);

  const go = (target: string) => (onDone ? onDone(target) : router.push(target));
  const cancel = (target: string) => (onCancel ? onCancel(target) : router.push(target));

  const cut = useMutation(
    trpc.stock.cut.mutationOptions({
      onSuccess: async (child) => {
        await invalidateRollQueries(queryClient, trpc);
        await go(`/stock/${child.id}`);
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  if (rollQuery.isPending) return <p className={styles.muted}>{t("rolls.loading")}</p>;
  if (rollQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {rollQuery.error.message}
      </p>
    );
  }
  const roll = rollQuery.data;
  const free = Math.max(0, roll.metrageRestant - roll.metrageReserve);
  const name = roll.numero ?? t("rolls.detail.thisReel");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const trimmed = metres.trim();
    if (trimmed === "" || Number.isNaN(Number(trimmed))) {
      setError(t("mustBeNumber", { label: t("rolls.cut.metres") }));
      return;
    }
    const parsed = cutRollInput.safeParse({ rollId, metres: Number(trimmed) });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    cut.mutate(parsed.data);
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
            {t("rolls.cut.free", { metres: metresFmt().format(free), reel: name })}
          </p>
        </div>
        <TextField
          label={t("rolls.cut.metres")}
          unit="m"
          format="numeric"
          value={metres}
          onChange={(e) => setMetres(e.target.value)}
          autoComplete="off"
          autoFocus
          disabled={cut.isPending}
        />
        <div className={styles.formWide}>
          <p className={styles.hint}>{t("rolls.cut.childHint", { reel: name })}</p>
        </div>
      </div>
      <div className={styles.formActions}>
        <Button
          variant="secondary"
          onClick={() => cancel(`/stock/${rollId}`)}
          disabled={cut.isPending}
        >
          {common("cancel")}
        </Button>
        <Button variant="primary" type="submit" busy={cut.isPending}>
          {cut.isPending ? common("working") : t("rolls.cut.submit")}
        </Button>
      </div>
    </form>
  );
}
