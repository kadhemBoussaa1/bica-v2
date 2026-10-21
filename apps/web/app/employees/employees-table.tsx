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
import { EmployeeCard, type EmployeeRow } from "./employee-card";
import cardStyles from "./employee-card.module.css";
import { EmployeeDrawer } from "./employee-drawer";
import { employeeDisplayName } from "./employee-name";
import {
  contractEnd,
  ContractEndText,
  STATUS_TONE,
  statusOf,
  StatusPill,
  todayUtc,
} from "./employee-ui";
import { useEmployeesLayout, type EmployeesLayout } from "./use-employees-layout";
import styles from "./employees.module.css";

/*
 * Two views over the same list, never mixed on one screen:
 *
 * - `roster` (`/employees`), from `Employes Cartes.dc.html`: the staff on
 *   the roster, the module's main view, as ID cards or as rows. The header
 *   keeps the v3 tiles rather than the handoff's inline figures (the
 *   user's call): the head count, the suspended count (the way into the
 *   other view), and two that filter the list when pressed — contracts
 *   ending within `CONTRACT_ENDING_SOON_DAYS` and people with no account.
 *   A pressed tile also shows as a token above the list.
 * - `off` (`/employees/suspended`): everyone off the roster, split by a
 *   two-way control between the legacy `suspended` flag and this app's
 *   archive, as rows with the status column kept for the suspension date.
 *
 * The rows are `Employees v3.dc.html`'s sentence-like rows on the
 * banded-list shell: the person, their post and service, their contract and
 * when it ends. A card or a row opens the record page; editing and
 * archiving live there.
 *
 * A search can name someone in the other view (the top bar's "See all
 * results" always lands on `/employees`), so the facet counts — which
 * ignore the active facet — say how many match over there, with a link.
 *
 * The service control is a department, sent as scope so the counts narrow
 * to it; each view offers only the services it has people in, with their
 * head counts.
 *
 * The sort is fixed on the name: the handoffs draw no sortable columns, and
 * their two-line cells have no single value to sort a column by.
 */
export type EmployeesView = "roster" | "off";

/** The off-roster view's two answers; the roster view is `onRoster` only. */
export type OffRosterFilter = Exclude<EmployeeFacet, "onRoster">;

interface EmployeesTableState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: "lastName";
  filter: EmployeeFacet;
  department: string | null;
  /** The header's two filtering tiles; the roster view only. */
  endingSoon: boolean;
  withoutAccount: boolean;
}

const INITIAL_STATE: Omit<EmployeesTableState, "filter" | "pageSize"> = {
  page: 1,
  search: "",
  sortBy: "lastName",
  sortDir: "asc",
  department: null,
  endingSoon: false,
  withoutAccount: false,
};

/**
 * The roster's first page holds the whole roster today (37), so the cards
 * read as one board, as the handoff draws them; the pager takes over past it.
 */
const ROSTER_PAGE_SIZE: (typeof PAGE_SIZES)[number] = 50;

const OFF_KEYS: readonly OffRosterFilter[] = ["suspended", "archived"];

const LAYOUT_KEYS: readonly EmployeesLayout[] = ["cards", "list"];

/** The handoff's glyphs before the layout names; words are translated, glyphs are not. */
const LAYOUT_GLYPHS: Record<EmployeesLayout, string> = { cards: "▦", list: "☰" };

/** The service control's "every service" answer: no department is empty. */
const ALL_SERVICES = "";

/**
 * `startCreating` is the `/employees/new` deep link: the list with the form
 * already open. Closing it there goes back to the plain list URL.
 */
export function EmployeesTable({
  view = "roster",
  startCreating = false,
  initialSearch = "",
  initialFilter = "suspended",
}: {
  view?: EmployeesView;
  startCreating?: boolean;
  /** The page's `?search=`, the table's first search — see list-search.ts. */
  initialSearch?: string;
  /** The off-roster view's `?filter=`; ignored on the roster. */
  initialFilter?: OffRosterFilter;
}) {
  const t = useTranslations("employees");
  const trpc = useTRPC();
  const router = useRouter();
  const [tableState, setTableState] = useState<EmployeesTableState>({
    ...INITIAL_STATE,
    filter: view === "roster" ? "onRoster" : initialFilter,
    pageSize: view === "roster" ? ROSTER_PAGE_SIZE : DEFAULT_PAGE_SIZE,
    search: initialSearch,
  });
  const [creating, setCreating] = useState(startCreating);
  const [storedLayout, setLayout] = useEmployeesLayout();
  // Cards are the roster's; the off-roster view is rows only.
  const layout: EmployeesLayout = view === "roster" ? storedLayout : "list";

  const listQuery = useQuery({
    ...trpc.employee.list.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });
  const summaryQuery = useQuery(trpc.employee.summary.queryOptions());

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
            <span className={styles.name}>{employeeDisplayName(employee)}</span>
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

        {view === "off" && (
          <span className={[styles.status, shell.col].filter(Boolean).join(" ")}>
            <StatusPill status={status} />
            {status === "suspended" && employee.suspendedAt !== null && (
              <span className={[styles.statusMeta, shell.meta].filter(Boolean).join(" ")}>
                {t("row.since", { date: formatDay(employee.suspendedAt) })}
              </span>
            )}
          </span>
        )}

        <span className={styles.chevron} aria-hidden>
          →
        </span>
      </Link>
    );
  };

  // How many the same search finds in the other view, and the way there;
  // null when it finds nobody, or nothing is searched.
  const facetCounts = listQuery.data?.facetCounts;
  const elsewhereCount = !facetCounts
    ? 0
    : view === "roster"
      ? facetCounts.suspended + facetCounts.archived
      : facetCounts.onRoster;
  const elsewhere =
    tableState.search === "" || !facetCounts || elsewhereCount === 0
      ? null
      : view === "roster"
        ? {
            label: t("elsewhere.off", { count: elsewhereCount }),
            href: `/employees/suspended?${new URLSearchParams({
              search: tableState.search,
              ...(facetCounts.suspended === 0 ? { filter: "archived" } : {}),
            }).toString()}`,
          }
        : {
            label: t("elsewhere.roster", { count: elsewhereCount }),
            href: `/employees?${new URLSearchParams({ search: tableState.search }).toString()}`,
          };

  const summary = summaryQuery.data;
  const ending = summary?.endingSoon ?? { count: 0, people: [] };
  const services = summary ? summary.services[view] : [];

  // Either changes which rows exist, so the pager goes back to the first page.
  const toggle = (flag: "endingSoon" | "withoutAccount") =>
    setTableState((current) => ({ ...current, [flag]: !current[flag], page: 1 }));

  // The pressed tiles, as tokens that lift them again.
  const tokens = [
    ...(tableState.endingSoon
      ? [{ key: "endingSoon" as const, label: t("tokens.endingSoon", { days: CONTRACT_ENDING_SOON_DAYS }) }]
      : []),
    ...(tableState.withoutAccount
      ? [{ key: "withoutAccount" as const, label: t("tokens.withoutAccount") }]
      : []),
  ];

  // Only drawn with rows: on an empty list the empty state carries the link
  // and the reset.
  const renderBody = (rows: readonly EmployeeRow[]) => (
    <div className={shell.list}>
      {elsewhere !== null && (
        <Link className={styles.elsewhere} href={elsewhere.href}>
          {elsewhere.label}
        </Link>
      )}
      {view === "roster" && (
        <>
          {tokens.length > 0 && (
            <div className={styles.tokens}>
              {tokens.map((token) => (
                <button
                  key={token.key}
                  type="button"
                  className={styles.token}
                  aria-label={t("tokens.remove", { filter: token.label })}
                  onClick={() => toggle(token.key)}
                >
                  {token.label}
                  <span className={styles.tokenRemove} aria-hidden>
                    ×
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className={styles.shown}>{t("shown", { count: listQuery.data?.total ?? rows.length })}</p>
        </>
      )}
      {layout === "cards" ? (
        <div className={cardStyles.grid}>
          {rows.map((employee) => (
            <EmployeeCard key={employee.id} employee={employee} today={today} />
          ))}
        </div>
      ) : (
        <>
          <div className={shell.columns} aria-hidden>
            <span className={shell.main}>{t("columns.employee")}</span>
            <span className={styles.role}>{t("columns.role")}</span>
            <span className={styles.contract}>{t("columns.contract")}</span>
            {view === "off" && <span className={styles.status}>{t("columns.status")}</span>}
            <span className={styles.chevron} />
          </div>
          {rows.map(row)}
        </>
      )}
    </div>
  );

  // The view's status stays: clearing filters never crosses into the other view.
  const reset = () =>
    setTableState((current) => ({
      ...current,
      department: null,
      endingSoon: false,
      withoutAccount: false,
      search: "",
      page: 1,
    }));

  return (
    <>
      <header className={records.header}>
        <div className={records.heading}>
          <span className={records.eyebrow}>{view === "roster" ? t("eyebrow") : t("title")}</span>
          <h1 className={records.title}>{view === "roster" ? t("title") : t("off.title")}</h1>
        </div>
        <p className={records.subtitle}>
          {view === "roster" ? t("subtitle") : t("off.subtitle")}
        </p>
        {view === "roster" && (
          <RecordActions>
            <Button variant="primary" onClick={() => setCreating(true)}>
              {t("newEmployee")}
            </Button>
          </RecordActions>
        )}

        {view === "roster" && summary && (
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
                meta={t("tiles.suspendedOpen", { archived: summary.archived })}
                href="/employees/suspended"
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
                          <bdi>{employeeDisplayName(person)}</bdi>
                        </span>
                      ))}
                      {ending.count > ending.people.length &&
                        t("tiles.endingSoonMore", { count: ending.count - ending.people.length })}
                    </>
                  )
                }
                tone={ending.count > 0 ? "danger" : "success"}
                toggle={{
                  pressed: tableState.endingSoon,
                  onToggle: () => toggle("endingSoon"),
                  hint: t("tiles.filterHint"),
                  disabled: ending.count === 0 && !tableState.endingSoon,
                }}
              />
              <KpiTile
                label={t("tiles.withoutAccount")}
                value={String(summary.withoutAccount)}
                meta={t("tiles.withoutAccountMeta")}
                tone={summary.withoutAccount > 0 ? "warning" : "success"}
                toggle={{
                  pressed: tableState.withoutAccount,
                  onToggle: () => toggle("withoutAccount"),
                  hint: t("tiles.filterHint"),
                  disabled: summary.withoutAccount === 0 && !tableState.withoutAccount,
                }}
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
          // Every control changes which rows exist, so the pager goes back to
          // the first page — the rule the search follows. The layout does not.
          toolbar={
            <>
              {view === "off" && (
                <SegmentedFilter<EmployeeFacet>
                  label={t("columns.status")}
                  segments={OFF_KEYS.map((key) => ({
                    key,
                    label: t(`filters.${key}`),
                    count: listQuery.data.facetCounts[key],
                  }))}
                  value={tableState.filter}
                  onChange={(filter) =>
                    setTableState((current) => ({ ...current, filter, page: 1 }))
                  }
                />
              )}
              {summary && services.length > 0 && (
                <SegmentedFilter
                  label={t("services.label")}
                  segments={[
                    {
                      key: ALL_SERVICES,
                      label: t("services.all"),
                      count:
                        view === "roster" ? summary.onRoster : summary.suspended + summary.archived,
                    },
                    ...services.map((service) => ({
                      key: service.name,
                      label: service.name,
                      count: service.count,
                    })),
                  ]}
                  value={tableState.department ?? ALL_SERVICES}
                  onChange={(key) =>
                    setTableState((current) => ({
                      ...current,
                      department: key === ALL_SERVICES ? null : key,
                      page: 1,
                    }))
                  }
                />
              )}
              {view === "roster" && (
                <SegmentedFilter
                  label={t("layout.label")}
                  segments={LAYOUT_KEYS.map((key) => ({
                    key,
                    label: `${LAYOUT_GLYPHS[key]} ${t(`layout.${key}`)}`,
                  }))}
                  value={layout}
                  onChange={setLayout}
                />
              )}
            </>
          }
          searchPlaceholder={t("searchPlaceholder")}
          emptyMessage={t("empty.title")}
          emptyText={t("empty.text")}
          emptyActions={
            <>
              {elsewhere !== null && (
                <Link href={elsewhere.href}>
                  <Button variant="primary">{elsewhere.label}</Button>
                </Link>
              )}
              <Button variant="secondary" onClick={reset}>
                {t("empty.reset")}
              </Button>
            </>
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
