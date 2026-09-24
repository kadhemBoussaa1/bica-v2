"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { MachineForm } from "../machine-form";
import type { FormNav } from "../../records/form-nav";
import { useTRPC } from "../../trpc/client";
import styles from "../../records/records.module.css";

/** Fetches before rendering the form — see EditClient for why. */
/** `nav` comes from the route modal; the full page leaves it unset. */
export function EditMachine({ id, ...nav }: { id: string } & FormNav) {
  const t = useTranslations("machines");
  const trpc = useTRPC();
  const query = useQuery(trpc.machine.byId.queryOptions({ id }));

  if (query.isPending) return <p className={styles.muted}>{t("loadingMachine")}</p>;

  if (query.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {query.error.message}
      </p>
    );
  }

  return <MachineForm initial={query.data} {...nav} />;
}
