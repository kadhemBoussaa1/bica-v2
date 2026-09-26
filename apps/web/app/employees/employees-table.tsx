"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CONTRACT_ENDING_SOON_DAYS, DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import type { EmployeeFacet } from "api/src/employee/employee.list";
import { Button } from "@repo/ui/button";
import { TableSkeleton } from "@repo/ui/skeleton";
import { DataTable, type DataTableState } from "@repo/ui/data-table";
import { formatDay } from "../../i18n/formats";
import { KpiRow, KpiTile } from "../records/kpi";
import { RecordActions } from "../records/new-record-button";
import { SegmentedFilter } from "../records/segmented-filter";
import { useTRPC } from "../trpc/client";
import records from "../records/records.module.css";
import shell from "../records/banded-list.module.css";
import { Avatar } from "./avatar";
import { EmployeeDrawer } from "./employee-drawer";
import { employeeName } from "./employee-name";
import {
  contractEnd,
  ContractEndText,
  STATUS_TONE,
  statusOf,
  StatusPill,
  todayUtc,
} from "./employee-ui";
import styles from "./employees.module.css";

/*
 * From `Employees v3.dc.html`. Sentence-like rows on the banded-list shell:
 * the person (photo, name, matricule and hire date), their post and
 * service, their contract and when it ends, and where they stand. The whole
 * row opens the record page; editing and archiving live there.
 *
 * Two filters, independent: the status control (the server's facets, with
 * counts) and the service chips (a department, sent as scope so the status
 * counts narrow to it). The header's figures describe the whole roster and
 * move with neither.
 *
 * The sort is fixed on the name: the handoff draws no sortable columns, and
 * its two-line cells have no single value to sort a column by.
 */
interface EmployeesTableState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: "lastName";
  filter: "all" | EmployeeFacet;
  department: string | null;
}

const INITIAL_STATE: EmployeesTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "lastName",
  sortDir: "asc",
  filter: "all",
  department: null,
};

const STATUS_KEYS: readonly ("all" | EmployeeFacet)[] = ["all", "onRoster", "suspended", "archived"];

/**
 * `startCreating` is the `/employees/new` deep link: the list with the form
 * already open. Closing it there goes back to the plain list URL.
 */
export function EmployeesTable({ startCreating = false }: { startCreating?: boolean }) {
  const t = useTranslations("employees");
  const trpc = useTRPC();
  const router = useRouter();
  const [tableState, setTableState] = useState<EmployeesTableState>(INITIAL_STATE);
  const [creating, setCreating] = useState(startCreating);

  const listQuery = useQuery({
    ...trpc.employee.list.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });
  const summaryQuery = useQuery(trpc.employee.summary.queryOptions());

  type EmployeeRow = NonNullable<typeof listQuery.data>["rows"][number];

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as EmployeesTableState),
    [],
  );

  const pageCount = listQuery.data?.pageCount ?? 1;
  if (!listQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  const closeCreate = () => {
    setCreating(false);
    if (startCreating) router.replace("/employees");
  };

  const today = todayUtc();

  const row = (employee: EmployeeRow): ReactNode => {
    const status = statusOf(employee);
    const end = contractEnd(employee.contractEndDate, today);
    return (
      <Link
        key={employee.id}
        href={`/employees/${employee.id}`}
        className={[shell.row, STATUS_TONE[status]].filter(Boolean).join(" ")}
      >
        <span className={shell.main}>
          <Avatar employee={employee} size="xl" />
          <span className={shell.mainText}>
            <span className={styles.name}>{employeeName(employee)}</span>
            {/* `<bdi>` per part: in Arabic a Latin matricule would otherwise
                land on the far side of the separator. */}
            <span className={shell.headMeta}>
              <bdi>{employee.matricule}</bdi>
              {employee.hireDate !== null && (
                <>
                  {" · "}
                  <bdi>{t("row.since", { date: formatDay(employee.hireDate) })}</bdi>
                </>
              )}
            </span>
          </span>
        </span>

        <span className={[styles.role, shell.col].filter(Boolean).join(" ")}>
          <span className={styles.roleTitle}>
            {employee.jobTitle ?? <span className={records.absent} />}
          </span>
          {employee.department !== null && (
            <span className={styles.roleMeta}>{employee.department}</span>
          )}
        </span>

        <span className={[styles.contract, shell.col].filter(Boolean).join(" ")}>
          <span className={styles.contractType}>
            {employee.employmentType ?? <span className={records.absent} />}
          </span>
          {/* An absent contract with no end says nothing; "open-ended" would
              claim a contract nobody recorded. */}
          {(employee.employmentType !== null || end.kind !== "open") && (
            <span
              className={[
                shell.meta,
                end.kind === "ends" && end.soon ? shell.danger : null,
                end.kind === "open" && employee.employmentType !== "CDI" ? styles.unrecorded : null,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <ContractEndText end={end} employmentType={employee.employmentType} />
            </span>
          )}
        </span>

        <span className={[styles.status, shell.col].filter(Boolean).join(" ")}>
          <StatusPill status={status} />
        </span>

        <span className={styles.chevron} aria-hidden>
          →
        </span>
      </Link>
    );
  };

  const renderBody = (rows: readonly EmployeeRow[]) => (
    <div className={shell.list}>
      <div className={shell.columns} aria-hidden>
        <span className={shell.main}>{t("columns.employee")}</span>
        <span className={styles.role}>{t("columns.role")}</span>
        <span className={styles.contract}>{t("columns.contract")}</span>
        <span className={styles.status}>{t("columns.status")}</span>
        <span className={styles.chevron} />
      </div>
      {rows.map(row)}
    </div>
  );

  const reset = () =>
    setTableState((current) => ({
      ...current,
      filter: "all",
      department: null,
      search: "",
      page: 1,
    }));

  const summary = summaryQuery.data;
  const ending = summary?.endingSoon;

  return (
    <>
      <header className={records.header}>
        <div className={records.heading}>
          <span className={records.eyebrow}>{t("eyebrow")}</span>
          <h1 className={records.title}>{t("title")}</h1>
        </div>
        <p className={records.subtitle}>{t("subtitle")}</p>
        <RecordActions>
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t("newEmployee")}
          </Button>
        </RecordActions>

        {summary && ending && (
          <div className={styles.figures}>
            <KpiRow>
              <KpiTile
                label={t("tiles.onRoster")}
                value={String(summary.onRoster)}
                meta={t("tiles.onRosterMeta", { total: summary.total })}
                tone="success"
              />
              <KpiTile
                label={t("tiles.suspended")}
                value={String(summary.suspended)}
                meta={t("tiles.suspendedMeta")}
              />
              <KpiTile
                label={t("tiles.endingSoon", { days: CONTRACT_ENDING_SOON_DAYS })}
                value={String(ending.count)}
                meta={
                  ending.count === 0 ? (
                    t("tiles.endingSoonNone")
                  ) : (
                    <>
                      {ending.people.map((person, index) => (
                        <span key={person.matricule}>
                          {index > 0 && ", "}
                          <bdi>{employeeName(person)}</bdi>
                        </span>
                      ))}
                      {ending.count > ending.people.length &&
                        t("tiles.endingSoonMore", { count: ending.count - ending.people.length })}
                    </>
                  )
                }
                tone={ending.count > 0 ? "danger" : "success"}
              />
              <KpiTile
                label={t("tiles.withoutAccount")}
                value={String(summary.withoutAccount)}
                meta={t("tiles.withoutAccountMeta")}
                tone={summary.withoutAccount > 0 ? "warning" : "success"}
              />
            </KpiRow>
          </div>
        )}
      </header>

      {listQuery.isPending ? (
        <TableSkeleton />
      ) : listQuery.isError ? (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {listQuery.error.message}
        </p>
      ) : (
        <DataTable
          rows={listQuery.data.rows}
          columns={[]}
          rowKey={(employee) => employee.id}
          renderBody={renderBody}
          flush
          total={listQuery.data.total}
          pageCount={listQuery.data.pageCount}
          loading={listQuery.isFetching}
          state={tableState}
          onStateChange={onStateChange}
          // Either filter changes which rows exist, so the pager goes back to
          // the first page — the rule the search follows.
          toolbar={
            <>
              <SegmentedFilter
                label={t("columns.status")}
                segments={STATUS_KEYS.map((key) => ({
                  key,
                  label: t(`filters.${key}`),
                  count: listQuery.data.facetCounts[key],
                }))}
                value={tableState.filter}
                onChange={(filter) => setTableState((current) => ({ ...current, filter, page: 1 }))}
              />
              {summary && summary.departments.length > 0 && (
                <div className={styles.services} role="group" aria-label={t("services.label")}>
                  {[null, ...summary.departments].map((department) => {
                    const active = tableState.department === department;
                    return (
                      <button
                        key={department ?? ""}
                        type="button"
                        className={[styles.service, active ? styles.serviceActive : null]
                          .filter(Boolean)
                          .join(" ")}
                        aria-pressed={active}
                        onClick={() =>
                          setTableState((current) => ({ ...current, department, page: 1 }))
                        }
                      >
                        {department ?? t("services.all")}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          }
          searchPlaceholder={t("searchPlaceholder")}
          emptyMessage={t("empty.title")}
          emptyText={t("empty.text")}
          emptyActions={
            <Button variant="secondary" onClick={reset}>
              {t("empty.reset")}
            </Button>
          }
        />
      )}

      {creating && (
        <EmployeeDrawer
          departments={summary?.departments ?? []}
          onClose={closeCreate}
          onSaved={(id) => router.push(`/employees/${id}`)}
        />
      )}
    </>
  );
}
