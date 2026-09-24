"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { RollForm } from "../../roll-form";
import type { FormNav } from "../../../records/form-nav";
import { useTRPC } from "../../../trpc/client";
import styles from "../../../records/records.module.css";

/** Fetches before rendering the form — see EditSupplier for why. */
/** `nav` comes from the route modal; the full page leaves it unset. */
export function EditRoll({ id, ...nav }: { id: string } & FormNav) {
  const t = useTranslations("stock");
  const trpc = useTRPC();
  const rollQuery = useQuery(trpc.stock.rollById.queryOptions({ id }));

  if (rollQuery.isPending) return <p className={styles.muted}>{t("rolls.loading")}</p>;

  if (rollQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {rollQuery.error.message}
      </p>
    );
  }

  return <RollForm initial={rollQuery.data} {...nav} />;
}
