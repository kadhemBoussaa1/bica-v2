"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { canAccess, DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { DataTable, type DataTableState } from "@repo/ui/data-table";
import { RoleBadge } from "@repo/ui/role-badge";
import { TableSkeleton } from "@repo/ui/skeleton";
import { formatDay } from "../../../i18n/formats";
import { useCurrentUser } from "../../auth/use-auth";
import { initials } from "../../nav/initials";
import records from "../../records/records.module.css";
import settings from "../settings.module.css";
import { useTRPC } from "../../trpc/client";
import { UserEditDialog } from "./user-edit-dialog";
import styles from "./users.module.css";

/**
 * The users module's half of the table vocabulary. `DataTable` is generic and
 * speaks in plain strings; the procedure's input is a closed union, and the
 * server rejects anything outside it regardless of what the client sends.
 */
interface UsersTableState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: "name" | "email" | "role" | "createdAt";
  filter: "all" | "active" | "banned";
}

const INITIAL_STATE: UsersTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "createdAt",
  sortDir: "desc",
  filter: "all",
};

/**
 * The accounts as the handoff draws them: one row per account with its
 * avatar, role, standing and two actions — its trace, and Edit, which is
 * where the role changes and where ban and delete live. `DataTable` still
 * owns the chips, the search, the skeleton and the pager; only the rows
 * are the module's own.
 */
export function UsersTable() {
  const t = useTranslations("users");
  const enums = useTranslations("enums");
  const trpc = useTRPC();
  const { user: me } = useCurrentUser();
  const [tableState, setTableState] = useState<UsersTableState>(INITIAL_STATE);

  const usersQuery = useQuery({
    ...trpc.user.list.queryOptions(tableState),
    // Keeps the previous page on screen while the next one loads, so paging
    // dims the table instead of blanking it.
    placeholderData: (prev) => prev,
  });

  type UserRow = NonNullable<typeof usersQuery.data>["rows"][number];

  const [editing, setEditing] = useState<UserRow | null>(null);

  const rolesQuery = useQuery(trpc.user.assignableRoles.queryOptions());

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      // The cast is the widening above running in reverse. Anything the server
      // does not recognise fails Zod validation there, not here.
      setTableState((current) => ({ ...current, ...next }) as UsersTableState),
    [],
  );

  const pageCount = usersQuery.data?.pageCount ?? 1;

  // Deleting the last row on the last page strands the pager on a page that no
  // longer exists. Adjusted during render rather than in an effect, so the
  // stranded page never reaches the DOM. Only clamp on settled data: while
  // fetching, `pageCount` still describes the previous query and would bounce
  // the user off a page that is fine.
  if (!usersQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  /**
   * The server is the authority on this (every procedure re-checks), but
   * offering Edit on a row the caller cannot touch would only end in an
   * error: never your own row, and only accounts your rank manages.
   */
  const canManage = (row: UserRow) => row.id !== me?.id && assignable.includes(row.role);

  const assignable = rolesQuery.data ?? [];

  const renderBody = (rows: readonly UserRow[]) => (
    <div className={styles.rows}>
      {rows.map((row) => {
        const senior = canAccess(row.role, "ADMIN");
        return (
          <div key={row.id} className={styles.row}>
            <span
              className={[styles.avatar, senior ? styles.avatarSenior : styles.avatarStaff]
                .filter(Boolean)
                .join(" ")}
              aria-hidden="true"
            >
              {initials(row.name)}
            </span>

            <span className={styles.identity}>
              <span className={styles.nameRow}>
                <span className={styles.name}>{row.name}</span>
                {row.id === me?.id && <span className={styles.self}>{t("youTag")}</span>}
              </span>
              <span className={styles.email}>{row.email}</span>
            </span>

            <span className={styles.roleCell}>
              <RoleBadge role={row.role} label={enums(`role.${row.role}`)} />
            </span>

            <span className={styles.standing}>
              <span
                className={[styles.status, row.banned ? styles.statusBanned : null]
                  .filter(Boolean)
                  .join(" ")}
              >
                <i className={styles.dot} aria-hidden="true" />
                {row.banned ? t("banned") : t("active")}
              </span>
              <span className={styles.created}>
                {t("createdOn", { date: formatDay(row.createdAt) })}
              </span>
            </span>

            <span className={styles.actions}>
              {/* Their trace; on every row, your own included. */}
              <Link href={`/settings/activity?actor=${encodeURIComponent(row.id)}`}>
                <Button size="dense">{t("activity")}</Button>
              </Link>
              {canManage(row) && (
                <Button size="dense" onClick={() => setEditing(row)}>
                  {t("edit")}
                </Button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );

  // Only the very first load has nothing to show. Every later fetch keeps the
  // previous page mounted and dims it, which is what `placeholderData` buys.
  if (usersQuery.isPending) {
    return <TableSkeleton />;
  }

  if (usersQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {usersQuery.error.message}
      </p>
    );
  }

  return (
    <>
      <DataTable
        rows={usersQuery.data.rows}
        columns={[]}
        rowKey={(row) => row.id}
        filters={[
          { key: "active", label: t("filters.active") },
          { key: "banned", label: t("filters.banned") },
        ]}
        facetCounts={usersQuery.data.facetCounts}
        total={usersQuery.data.total}
        pageCount={usersQuery.data.pageCount}
        loading={usersQuery.isFetching}
        state={tableState}
        onStateChange={onStateChange}
        renderBody={renderBody}
        flush
        searchPlaceholder={t("searchPlaceholder")}
        emptyMessage={t("emptyMessage")}
      />
      <p className={settings.sectionFoot}>{t("editHint")}</p>

      {editing && (
        <UserEditDialog
          user={editing}
          assignable={assignable}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
