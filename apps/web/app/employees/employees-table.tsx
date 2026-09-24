"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { canAccess, DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TableSkeleton } from "@repo/ui/skeleton";
import { DataTable, type Column, type DataTableState } from "@repo/ui/data-table";
import { Dialog } from "@repo/ui/dialog";
import { formatDay } from "../../i18n/formats";
import { useCurrentUser } from "../auth/use-auth";
import { useTRPC } from "../trpc/client";
import styles from "../records/records.module.css";

interface EmployeesTableState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: "lastName" | "matricule" | "department" | "hireDate" | "createdAt";
  filter: "all" | "onRoster" | "suspended" | "archived";
}

const INITIAL_STATE: EmployeesTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "lastName",
  sortDir: "asc",
  filter: "all",
};

export function EmployeesTable() {
  const t = useTranslations("employees");
  const common = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { user: me } = useCurrentUser();
  const canWrite = me ? canAccess(me.role, "ADMIN") : false;
  const [error, setError] = useState<string | null>(null);
  const [tableState, setTableState] = useState<EmployeesTableState>(INITIAL_STATE);

  const employeesQuery = useQuery({
    ...trpc.employee.list.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });

  type EmployeeRow = NonNullable<typeof employeesQuery.data>["rows"][number];

  const [pending, setPending] = useState<EmployeeRow | null>(null);

  const setActive = useMutation(
    trpc.employee.setActive.mutationOptions({
      onSuccess: () => {
        setPending(null);
        return queryClient.invalidateQueries({ queryKey: trpc.employee.list.queryKey() });
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as EmployeesTableState),
    [],
  );

  const pageCount = employeesQuery.data?.pageCount ?? 1;
  if (!employeesQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  const columns: ReadonlyArray<Column<EmployeeRow>> = [
    {
      key: "name",
      header: t("columns.employee"),
      width: "minmax(170px,1.5fr)",
      sortKey: "lastName",
      cell: (row) => (
        <div
          className={[styles.name, row.active ? null : styles.archivedRow]
            .filter(Boolean)
            .join(" ")}
        >
          {[row.lastName, row.firstName].filter(Boolean).join(" ") || "—"}
          {!row.active && <span className={styles.archivedTag}>{t("archivedTag")}</span>}
        </div>
      ),
    },
    {
      key: "matricule",
      header: t("columns.matricule"),
      width: "110px",
      sortKey: "matricule",
      cell: (row) => <span className={styles.mono}>{row.matricule}</span>,
    },
    {
      key: "jobTitle",
      header: t("columns.jobTitle"),
      width: "minmax(150px,1.2fr)",
      cell: (row) =>
        row.jobTitle ? (
          <span className={styles.text}>{row.jobTitle}</span>
        ) : (
          <span className={styles.absent} />
        ),
    },
    {
      key: "department",
      header: t("columns.department"),
      width: "125px",
      sortKey: "department",
      cell: (row) =>
        row.department ? (
          <span className={styles.text}>{row.department}</span>
        ) : (
          <span className={styles.absent} />
        ),
    },
    {
      key: "status",
      header: t("columns.status"),
      width: "95px",
      // `suspended` is the legacy roster flag, distinct from `active` (this
      // app's archive). Someone can be suspended and still an active record.
      cell: (row) => (
        <span className={row.suspended ? styles.flag : styles.date}>
          {row.suspended ? t("suspended") : t("onRoster")}
        </span>
      ),
    },
    {
      key: "hireDate",
      header: t("columns.hired"),
      width: "100px",
      numeric: true,
      sortKey: "hireDate",
      cell: (row) =>
        row.hireDate ? (
          <span className={styles.date}>{formatDay(row.hireDate)}</span>
        ) : (
          <span className={styles.absent} />
        ),
    },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "",
            width: "150px",
            cell: (row: EmployeeRow) => (
              <div className={styles.actions}>
                <Link href={`/employees/${row.id}`}>
                  <Button className={styles.actionBtn}>{common("edit")}</Button>
                </Link>
                <Button
                  variant={row.active ? "danger" : "secondary"}
                  className={styles.actionBtn}
                  onClick={() => {
                    setError(null);
                    setPending(row);
                  }}
                >
                  {row.active ? common("archive") : common("restore")}
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  if (employeesQuery.isPending) return <TableSkeleton />;

  if (employeesQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {employeesQuery.error.message}
      </p>
    );
  }

  return (
    <>
      {error && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <DataTable
        rows={employeesQuery.data.rows}
        columns={columns}
        rowKey={(row) => row.id}
        filters={[
          { key: "onRoster", label: t("filters.onRoster") },
          { key: "suspended", label: t("filters.suspended") },
          { key: "archived", label: t("filters.archived") },
        ]}
        facetCounts={employeesQuery.data.facetCounts}
        total={employeesQuery.data.total}
        pageCount={employeesQuery.data.pageCount}
        loading={employeesQuery.isFetching}
        state={tableState}
        onStateChange={onStateChange}
        searchPlaceholder={t("searchPlaceholder")}
        emptyMessage={t("emptyMessage")}
      />

      <Dialog
        open={pending !== null}
        title={pending?.active ? t("archiveTitle") : t("restoreTitle")}
        confirmLabel={pending?.active ? common("archive") : common("restore")}
        destructive={pending?.active ?? false}
        busy={setActive.isPending}
        onConfirm={() =>
          pending && setActive.mutate({ id: pending.id, active: !pending.active })
        }
        onClose={() => !setActive.isPending && setPending(null)}
      >
        {pending?.active
          ? t.rich("archiveBody", {
              name: [pending.lastName, pending.firstName].filter(Boolean).join(" "),
              strong: (chunks) => <strong>{chunks}</strong>,
            })
          : t.rich("restoreBody", {
              name: [pending?.lastName, pending?.firstName].filter(Boolean).join(" "),
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
      </Dialog>
    </>
  );
}
