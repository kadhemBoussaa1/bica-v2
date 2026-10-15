"use client";

import Link from "next/link";
import { Fragment } from "react";
import { useTranslations } from "next-intl";
import records from "../../records/records.module.css";

interface ClientRef {
  id: string;
  name: string;
  active?: boolean;
}

/**
 * Whom an invoice bills: its own client, or — on an invoice billing orders
 * of several clients, which names none itself — each order's, in line
 * order. Empty only on a legacy invoice raised without a client.
 */
export function billedClients(invoice: {
  client: ClientRef | null;
  lines: ReadonlyArray<{ order: { client: ClientRef | null } | null }>;
}): ClientRef[] {
  if (invoice.client) return [invoice.client];
  const seen = new Map<string, ClientRef>();
  for (const line of invoice.lines) {
    const client = line.order?.client;
    if (client && !seen.has(client.id)) seen.set(client.id, client);
  }
  return [...seen.values()];
}

/** The billed clients as links, comma-separated; "no client" when there is none. */
export function BilledClients({ clients }: { clients: readonly ClientRef[] }) {
  const t = useTranslations("invoices");
  if (clients.length === 0) return <span className={records.muted}>{t("noClient")}</span>;
  return (
    <>
      {clients.map((client, index) => (
        <Fragment key={client.id}>
          {index > 0 && ", "}
          <Link className={records.inlineLink} href={`/clients/${client.id}`}>
            {client.name}
          </Link>
          {client.active === false && (
            <span className={records.archivedTag}>{t("archived")}</span>
          )}
        </Fragment>
      ))}
    </>
  );
}
