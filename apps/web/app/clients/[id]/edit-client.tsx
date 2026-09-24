"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ClientForm } from "../client-form";
import type { FormNav } from "../../records/form-nav";
import { useTRPC } from "../../trpc/client";
import styles from "../../records/records.module.css";

/**
 * Fetches the row before rendering the form, so the inputs mount with their real
 * values instead of filling in after the fact — an uncontrolled-to-controlled
 * flip would lose whatever the user typed in the meantime.
 */
/** `nav` comes from the route modal; the full page leaves it unset. */
export function EditClient({ id, ...nav }: { id: string } & FormNav) {
  const t = useTranslations("clients");
  const trpc = useTRPC();
  const clientQuery = useQuery(trpc.client.byId.queryOptions({ id }));

  if (clientQuery.isPending) {
    return <p className={styles.muted}>{t("loadingClient")}</p>;
  }

  if (clientQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {clientQuery.error.message}
      </p>
    );
  }

  return <ClientForm initial={clientQuery.data} {...nav} />;
}
