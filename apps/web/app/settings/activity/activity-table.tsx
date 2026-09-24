"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import { DataTable, type Column, type DataTableState } from "@repo/ui/data-table";
import { TableSkeleton } from "@repo/ui/skeleton";
import type { AuditFacet, AuditSortKey } from "api/src/audit/audit.list";
import { useTRPC } from "../../trpc/client";
import records from "../../records/records.module.css";
import styles from "./activity.module.css";
import {
  actionLabel,
  ActivityPanel,
  EntityLink,
  formatDateTime,
  KindBadge,
  OutcomeBadge,
} from "./activity-ui";

interface ActivityTableState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: AuditSortKey;
  filter: "all" | AuditFacet;
}

interface ActivityTableProps {
  /** Narrow to one user's rows (`/settings/activity?actor=`). */
  actorId?: string;
  /** Narrow to one record's rows, including what was raised from it (`?entity=`). */
  entityId?: string;
}

export function ActivityTable({ actorId, entityId }: ActivityTableProps) {
  const trpc = useTRPC();
  const t = useTranslations("activity");

  // An entity timeline opens on writes: `order.byId` carries `{ id }`, so
  // every page view is a row on that order and "all" is mostly reads. The
  // chips are still there for a reader who wants them.
  const [tableState, setTableState] = useState<ActivityTableState>({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    search: "",
    sortBy: "at",
    sortDir: "desc",
    filter: entityId ? "mutation" : "all",
  });

  const listQuery = useQuery({
    ...trpc.audit.list.queryOptions({ ...tableState, actorId, entityId }),
    placeholderData: (prev) => prev,
  });

  // Names the prefilter bar: the actor list is small and cached.
  const actorsQuery = useQuery({
    ...trpc.audit.actors.queryOptions(),
    enabled: actorId !== undefined,
  });

  type AuditRow = NonNullable<typeof listQuery.data>["rows"][number];

  const [openedId, setOpenedId] = useState<string | null>(null);

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as ActivityTableState),
    [],
  );

  const pageCount = listQuery.data?.pageCount ?? 1;
  if (!listQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  const columns: ReadonlyArray<Column<AuditRow>> = [
    {
      key: "at",
      header: t("columns.when"),
      width: "150px",
      sortKey: "at",
      cell: (row) => <span className={records.date}>{formatDateTime(row.at)}</span>,
    },
    {
      key: "actor",
      header: t("columns.user"),
      width: "minmax(130px,1fr)",
      sortKey: "actor",
      cell: (row) =>
        row.actorName ? (
          <div className={styles.actor}>
            <span className={styles.actorName}>{row.actorName}</span>
            <span className={styles.actorEmail}>{row.actorEmail}</span>
          </div>
        ) : (
          <span className={records.muted}>{t("anonymous")}</span>
        ),
    },
    {
      key: "action",
      header: t("columns.action"),
      width: "minmax(170px,1.6fr)",
      sortKey: "action",
      cell: (row) => {
        const label = actionLabel(t, row.action);
        return (
          <div className={styles.action}>
            <KindBadge kind={row.kind} />
            <div style={{ minWidth: 0 }}>
              {label ? (
                <>
                  <div className={styles.actionLabel}>{label}</div>
                  <div className={styles.path}>{row.action}</div>
                </>
              ) : (
                <div className={styles.path}>{row.action}</div>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: "entity",
      header: t("columns.entity"),
      width: "minmax(110px,1fr)",
      cell: (row) => <EntityLink row={row} />,
    },
    {
      key: "outcome",
      header: t("columns.outcome"),
      width: "88px",
      cell: (row) => (
        <div className={styles.outcome}>
          <OutcomeBadge outcome={row.outcome} />
          {row.errorCode && <span className={styles.code}>{row.errorCode}</span>}
        </div>
      ),
    },
    {
      key: "durationMs",
      header: t("columns.time"),
      width: "64px",
      numeric: true,
      sortKey: "durationMs",
      cell: (row) => <span className={records.date}>{t("duration", { ms: String(row.durationMs) })}</span>,
    },
    {
      key: "open",
      header: "",
      width: "16px",
      cell: () => (
        <span className={styles.chevron} aria-hidden="true">
          ›
        </span>
      ),
    },
  ];

  if (listQuery.isPending) {
    return <TableSkeleton />;
  }

  if (listQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {listQuery.error.message}
      </p>
    );
  }

  const rows = listQuery.data.rows;
  const actor = actorId
    ? actorsQuery.data?.find((candidate) => candidate.actorId === actorId)
    : undefined;
  // The entity's label as the rows recorded it; the first hit is as good as any.
  const entityLabel = entityId
    ? (rows.find((row) => row.entityId === entityId && row.entityLabel)?.entityLabel ?? entityId)
    : null;

  return (
    <>
      {(actorId || entityId) && (
        <p className={styles.filterBar}>
          {actorId && (
            <span>
              {t.rich("showingByActor", {
                actor: actor ? (actor.actorName ?? actor.actorEmail ?? actorId) : actorId,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </span>
          )}
          {entityId && (
            <span>
              {t.rich("showingForEntity", {
                entity: entityLabel ?? entityId,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </span>
          )}
          <Link className={records.inlineLink} href="/settings/activity">
            {t("clear")}
          </Link>
        </p>
      )}

      <div className={[styles.split, openedId ? styles.splitOpen : null].filter(Boolean).join(" ")}>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          filters={[
            { key: "query", label: t("filters.reads") },
            { key: "mutation", label: t("filters.writes") },
            { key: "auth", label: t("filters.signIns") },
            { key: "error", label: t("filters.errors") },
          ]}
          facetCounts={listQuery.data.facetCounts}
          total={listQuery.data.total}
          pageCount={listQuery.data.pageCount}
          loading={listQuery.isFetching}
          state={tableState}
          onStateChange={onStateChange}
          onRowClick={(row) => setOpenedId(openedId === row.id ? null : row.id)}
          selectedKey={openedId}
          density="dense"
          searchPlaceholder={t("searchPlaceholder")}
          emptyMessage={t("emptyMessage")}
        />

        {openedId && <ActivityPanel id={openedId} onClose={() => setOpenedId(null)} />}
      </div>
    </>
  );
}
