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
  PartnerStats,
} from "../records/partner-ui";
import {
  SUPPLIER_FIELDS,
  SupplierPanel,
  supplierFilled,
} from "./supplier-panel";

interface SuppliersTableState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: "name" | "family" | "vatRate" | "createdAt";
  /**
   * "all", "unassigned", "duplicates", "archived", or a family `code`. Not a
   * closed union: families are rows now, so the valid set is data. The server
   * checks the value against the families that exist and rejects anything else.
   */
  filter: string;
}

const INITIAL_STATE: SuppliersTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "name",
  sortDir: "asc",
  filter: "all",
};

export function SuppliersTable() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { user: me } = useCurrentUser();
  const t = useTranslations("suppliers");
  const common = useTranslations("common");
  const [tableState, setTableState] =
    useState<SuppliersTableState>(INITIAL_STATE);
  const [error, setError] = useState<string | null>(null);

  // Mirrors the procedures' adminProcedure gate — UX only, see ClientsTable.
  const canWrite = me ? canAccess(me.role, "ADMIN") : false;

  // Chips are built from the families that exist. `includeInactive` so an
  // archived family whose suppliers are still assigned keeps its chip — without
  // it those rows would sit in no facet and the summed "All" count would
  // disagree with the pager.
  const familiesQuery = useQuery(
    trpc.supplierFamily.list.queryOptions({ includeInactive: true }),
  );
  const families = familiesQuery.data ?? [];

  const statsQuery = useQuery(trpc.supplier.stats.queryOptions());
  const suppliersQuery = useQuery({
    ...trpc.supplier.list.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });

  type SupplierRow = NonNullable<typeof suppliersQuery.data>["rows"][number];

  /** The open record — the row object, for the reasons given in ClientsTable. */
  const [opened, setOpened] = useState<SupplierRow | null>(null);
  const rows = suppliersQuery.data?.rows ?? [];
  const selected = opened
    ? (rows.find((row) => row.id === opened.id) ?? opened)
    : null;

  const [pending, setPending] = useState<SupplierRow | null>(null);

  const setActive = useMutation(
    trpc.supplier.setActive.mutationOptions({
      onSuccess: () => {
        setPending(null);
        return Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.supplier.list.queryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.supplier.stats.queryKey(),
          }),
        ]);
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState(
        (current) => ({ ...current, ...next }) as SuppliersTableState,
      ),
    [],
  );

  const pageCount = suppliersQuery.data?.pageCount ?? 1;

  if (!suppliersQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  const nameColumn: Column<SupplierRow> = {
    key: "name",
    header: t("columns.name"),
    width: "minmax(180px,1.5fr)",
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

  const chevronColumn: Column<SupplierRow> = {
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
   * Two layouts, as on the clients list: the panel open drops everything but
   * the name and a coverage bar, since the rest is in the panel.
   */
  const columns: ReadonlyArray<Column<SupplierRow>> = selected
    ? [
        nameColumn,
        {
          key: "contact",
          header: t("columns.contact"),
          width: "72px",
          cell: (row) => (
            <CoverageBar
              filled={supplierFilled(row)}
              total={SUPPLIER_FIELDS.length}
            />
          ),
        },
        chevronColumn,
      ]
    : [
        nameColumn,
        {
          key: "family",
          header: t("columns.family"),
          width: "110px",
          sortKey: "family",
          cell: (row) =>
            row.family ? (
              <span className={records.text}>{row.family.label}</span>
            ) : (
              <span className={records.absent} />
            ),
        },
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
              filled={supplierFilled(row)}
              total={SUPPLIER_FIELDS.length}
            />
          ),
        },
        {
          key: "vatRate",
          header: t("columns.vat"),
          width: "70px",
          numeric: true,
          sortKey: "vatRate",
          /*
           * Two migrated rows hold a value that was not a single rate — a VAT
           * number filed into the rate column, and "19% /7%". The importer kept
           * the original in `vatRateNote`, so surface it as a flag: these need
           * a human to enter the real rate.
           */
          cell: (row) => {
            if (row.vatRate !== null) {
              return <span className={records.date}>{row.vatRate}%</span>;
            }
            if (row.vatRateNote !== null) {
              return (
                <span
                  className={records.flag}
                  title={t("vatUnparsed", { value: row.vatRateNote })}
                >
                  {t("vatCheck")}
                </span>
              );
            }
            return <span className={records.absent} />;
          },
        },
        chevronColumn,
      ];

  if (suppliersQuery.isPending) {
    return <TableSkeleton />;
  }

  if (suppliersQuery.isError) {
    return (
      <p
        className={[records.notice, records.error].filter(Boolean).join(" ")}
        role="alert"
      >
        {suppliersQuery.error.message}
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
          /*
           * One chip per family, ordered by how common each is in the data,
           * plus "Unassigned" for the rows the legacy data left without one —
           * which also keeps the family facets partitioning the set, so the
           * All chip agrees with the pager. "Duplicates" overlaps them and is
           * left out of that sum server-side.
           */
          filters={[
            // Server-ordered by sortOrder then label, so the chips match the
            // picker rather than needing their own sort here.
            ...families.map((family) => ({
              key: family.code,
              label: family.label,
            })),
            { key: "unassigned", label: t("filters.unassigned") },
            { key: "duplicates", label: t("filters.duplicates") },
            { key: "archived", label: t("filters.archived") },
          ]}
          facetCounts={suppliersQuery.data.facetCounts}
          total={suppliersQuery.data.total}
          pageCount={suppliersQuery.data.pageCount}
          loading={suppliersQuery.isFetching}
          state={tableState}
          onStateChange={onStateChange}
          onRowClick={(row) => setOpened(selected?.id === row.id ? null : row)}
          selectedKey={selected?.id ?? null}
          searchPlaceholder={t("searchPlaceholder")}
          emptyMessage={t("emptyMessage")}
        />

        {selected && (
          <SupplierPanel
            supplier={selected}
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
