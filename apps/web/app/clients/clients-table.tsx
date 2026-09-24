"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { canAccess, DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import {
  DataTable,
  type Column,
  type DataTableState,
} from "@repo/ui/data-table";
import { Dialog } from "@repo/ui/dialog";
import { TableSkeleton } from "@repo/ui/skeleton";
import { useCurrentUser } from "../auth/use-auth";
import { useTRPC } from "../trpc/client";
import records from "../records/records.module.css";
import styles from "../records/partners.module.css";
import {
  Coverage,
  CoverageBar,
  DuplicateTag,
  formatDate,
  PartnerStats,
} from "../records/partner-ui";
import { CLIENT_FIELDS, ClientPanel, clientFilled } from "./client-panel";

/**
 * The clients module's half of the table vocabulary. `DataTable` is generic and
 * speaks plain strings; the procedure's input is a closed union and the server
 * rejects anything outside it regardless of what the client sends.
 */
interface ClientsTableState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: "name" | "registeredAt" | "createdAt";
  filter: "all" | "withContact" | "withoutContact" | "duplicates" | "archived";
}

const INITIAL_STATE: ClientsTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  // Matches the server's default so the first render does not re-sort, and A->Z
  // is how you look a customer up by name.
  sortBy: "name",
  sortDir: "asc",
  filter: "all",
};

export function ClientsTable() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { user: me } = useCurrentUser();
  const t = useTranslations("clients");
  const common = useTranslations("common");
  const [tableState, setTableState] =
    useState<ClientsTableState>(INITIAL_STATE);
  const [error, setError] = useState<string | null>(null);

  // Writes are ADMIN and above server-side. Mirroring that here only avoids
  // rendering a button whose one outcome is a FORBIDDEN error; the procedure
  // remains the boundary.
  const canWrite = me ? canAccess(me.role, "ADMIN") : false;

  const statsQuery = useQuery(trpc.client.stats.queryOptions());
  const clientsQuery = useQuery({
    ...trpc.client.list.queryOptions(tableState),
    // Keeps the previous page on screen while the next loads, so paging dims
    // the table instead of blanking it.
    placeholderData: (prev) => prev,
  });

  type ClientRow = NonNullable<typeof clientsQuery.data>["rows"][number];

  /**
   * The open record. The row object rather than its id, so the panel
   * survives the row paging or filtering out of view; when the row IS on
   * the current page, the fresh copy wins so an archive shows through.
   */
  const [opened, setOpened] = useState<ClientRow | null>(null);
  const rows = clientsQuery.data?.rows ?? [];
  const selected = opened
    ? (rows.find((row) => row.id === opened.id) ?? opened)
    : null;

  /** The row whose archive/restore is awaiting confirmation. */
  const [pending, setPending] = useState<ClientRow | null>(null);

  const setActive = useMutation(
    trpc.client.setActive.mutationOptions({
      onSuccess: () => {
        setPending(null);
        // Un-narrowed: prefix-matches every page/sort/filter combination, so no
        // stale page survives. The stats move too (archived count).
        return Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.client.list.queryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.client.stats.queryKey(),
          }),
        ]);
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      // The widening above in reverse. Anything the server does not recognise
      // fails Zod validation there, not here.
      setTableState(
        (current) => ({ ...current, ...next }) as ClientsTableState,
      ),
    [],
  );

  const pageCount = clientsQuery.data?.pageCount ?? 1;

  // Clamp during render rather than in an effect, so a stranded page never
  // reaches the DOM. Only on settled data: mid-fetch `pageCount` still
  // describes the previous query and would bounce the user off a valid page.
  if (!clientsQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  const nameColumn: Column<ClientRow> = {
    key: "name",
    header: t("columns.name"),
    width: "minmax(180px,1.6fr)",
    sortKey: "name",
    cell: (row) => (
      <div
        className={[records.name, row.active ? null : records.archivedRow]
          .filter(Boolean)
          .join(" ")}
      >
        {row.name}
        {!row.active && (
          <span className={records.archivedTag}>{t("archivedTag")}</span>
        )}
        {row.duplicateOf && (
          <>
            <br />
            <DuplicateTag />
          </>
        )}
      </div>
    ),
  };

  const chevronColumn: Column<ClientRow> = {
    key: "open",
    header: "",
    width: "16px",
    cell: () => (
      <span className={styles.chevron} aria-hidden="true">
        ›
      </span>
    ),
  };

  /*
   * Two layouts. With the panel closed the table has the width for the tax
   * ID and the date; with it open those two go — they are in the panel — and
   * the contact cell shrinks to a bar. The row stays scannable either way.
   */
  const columns: ReadonlyArray<Column<ClientRow>> = selected
    ? [
        nameColumn,
        {
          key: "contact",
          header: t("columns.contact"),
          width: "72px",
          cell: (row) => (
            <CoverageBar
              filled={clientFilled(row)}
              total={CLIENT_FIELDS.length}
            />
          ),
        },
        chevronColumn,
      ]
    : [
        nameColumn,
        {
          key: "taxId",
          header: t("columns.taxId"),
          width: "minmax(110px,0.8fr)",
          cell: (row) =>
            row.taxId ? (
              <span className={records.mono}>{row.taxId}</span>
            ) : (
              <span className={records.absent} />
            ),
        },
        {
          key: "contact",
          header: t("columns.contactOnFile"),
          width: "150px",
          cell: (row) => (
            <Coverage
              record={row}
              filled={clientFilled(row)}
              total={CLIENT_FIELDS.length}
            />
          ),
        },
        {
          key: "registeredAt",
          header: t("columns.since"),
          width: "110px",
          numeric: true,
          sortKey: "registeredAt",
          cell: (row) => {
            const date = formatDate(row.registeredAt);
            return date ? (
              <span className={records.date}>{date}</span>
            ) : (
              <span className={records.absent} />
            );
          },
        },
        chevronColumn,
      ];

  // Only the first load has nothing to show; later fetches keep the previous
  // page mounted and dimmed, which is what `placeholderData` buys.
  if (clientsQuery.isPending) {
    return <TableSkeleton />;
  }

  if (clientsQuery.isError) {
    return (
      <p
        className={[records.notice, records.error].filter(Boolean).join(" ")}
        role="alert"
      >
        {clientsQuery.error.message}
      </p>
    );
  }

  return (
    <>
      {error && (
        <p
          className={[records.notice, records.error].filter(Boolean).join(" ")}
          role="alert"
        >
          {error}
        </p>
      )}

      <PartnerStats noun={t("noun")} stats={statsQuery.data} />

      <div
        className={[styles.split, selected ? styles.splitOpen : null]
          .filter(Boolean)
          .join(" ")}
      >
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          filters={[
            { key: "withContact", label: t("filters.withContact") },
            { key: "withoutContact", label: t("filters.withoutContact") },
            { key: "duplicates", label: t("filters.duplicates") },
            { key: "archived", label: t("filters.archived") },
          ]}
          facetCounts={clientsQuery.data.facetCounts}
          total={clientsQuery.data.total}
          pageCount={clientsQuery.data.pageCount}
          loading={clientsQuery.isFetching}
          state={tableState}
          onStateChange={onStateChange}
          onRowClick={(row) => setOpened(selected?.id === row.id ? null : row)}
          selectedKey={selected?.id ?? null}
          searchPlaceholder={t("searchPlaceholder")}
          emptyMessage={t("emptyMessage")}
        />

        {selected && (
          <ClientPanel
            client={selected}
            canWrite={canWrite}
            onClose={() => setOpened(null)}
            onToggleActive={() => {
              setError(null);
              setPending(selected);
            }}
          />
        )}
      </div>

      <Dialog
        open={pending !== null}
        title={
          pending?.active ? t("archiveDialog.title") : t("restoreDialog.title")
        }
        confirmLabel={pending?.active ? common("archive") : common("restore")}
        destructive={pending?.active ?? false}
        busy={setActive.isPending}
        onConfirm={() =>
          pending &&
          setActive.mutate({ id: pending.id, active: !pending.active })
        }
        onClose={() => !setActive.isPending && setPending(null)}
      >
        {t.rich(pending?.active ? "archiveDialog.body" : "restoreDialog.body", {
          name: pending?.name ?? "",
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      </Dialog>
    </>
  );
}
