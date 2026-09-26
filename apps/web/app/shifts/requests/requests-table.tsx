"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { isoDayOf, type ShiftChangeStatus, type ShiftType } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { TextAreaField } from "@repo/ui/field";
import { TableSkeleton } from "@repo/ui/skeleton";
import { useToast } from "@repo/ui/toast";
import { formatDateTime } from "../../../i18n/formats";
import { useTRPC } from "../../trpc/client";
import records from "../../records/records.module.css";
import { Avatar } from "../../employees/avatar";
import { invalidateShiftQueries } from "../shift-queries";
import type { ChangeRow } from "../types";
import { employeeName } from "../../employees/employee-name";
import { formatShiftHours, formatWeekRange } from "../week";
import styles from "../shifts.module.css";

type Filter = "pending" | "accepted" | "rejected" | "withdrawn" | "all";
const FILTERS: readonly Filter[] = ["pending", "accepted", "rejected", "withdrawn", "all"];

const STATUS_TONE: Record<ShiftChangeStatus, string | undefined> = {
  PENDING: styles.pillWarn,
  ACCEPTED: styles.pillLive,
  REJECTED: styles.pillDanger,
  WITHDRAWN: styles.pillNeutral,
};

/**
 * The requests screen as the handoff draws it: filter pills with their
 * counts, a search, and one card per change — who, what they ask, from
 * which shift to which, the week, their words, and the decision. Pending
 * ones carry Accept and Refuse. Admins' own recorded changes are here too,
 * so the list doubles as the roster's history.
 *
 * Server-side list under a card body: the facets, search and paging are the
 * same `listChanges` the table used, so the counts are the server's.
 */
export function RequestsTable({ initialFilter = "pending" }: { initialFilter?: Filter }) {
  const t = useTranslations("shifts");
  const enums = useTranslations("enums");
  const common = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { push } = useToast();

  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [accepting, setAccepting] = useState<ChangeRow | null>(null);
  const [rejecting, setRejecting] = useState<ChangeRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Debounced search, page reset on any change of what is listed.
  useEffect(() => {
    const id = setTimeout(() => {
      setTerm(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const changesQuery = useQuery({
    ...trpc.shift.listChanges.queryOptions({
      page,
      pageSize: 25,
      search: term,
      sortBy: "createdAt",
      sortDir: "desc",
      filter,
    }),
    placeholderData: (prev) => prev,
  });

  const settle = async (title: string) => {
    setAccepting(null);
    setRejecting(null);
    setRejectReason("");
    push({ title, tone: "success" });
    await invalidateShiftQueries(queryClient, trpc);
  };
  const fail = (cause: { message: string }) => {
    setAccepting(null);
    setRejecting(null);
    push({ title: cause.message, tone: "error" });
    return invalidateShiftQueries(queryClient, trpc);
  };
  const accept = useMutation(
    trpc.shift.accept.mutationOptions({
      onSuccess: (r, _v, ctx) => {
        void ctx;
        return settle(t("requests.accepted") + (r.ticketsRemoved > 0 ? ` · ${t("board.ticketsRemoved", { count: r.ticketsRemoved })}` : ""));
      },
      onError: fail,
    }),
  );
  const reject = useMutation(
    trpc.shift.reject.mutationOptions({
      onSuccess: () => settle(t("requests.rejected")),
      onError: fail,
    }),
  );

  const typeLabel = (type: ShiftType) => `${enums(`shiftType.${type}`)} ${formatShiftHours(type)}`;
  const counts = changesQuery.data?.facetCounts;
  const rows = changesQuery.data?.rows ?? [];
  const pageCount = changesQuery.data?.pageCount ?? 1;
  const pending = counts?.pending ?? 0;

  const sentence = (row: ChangeRow) => {
    const byAdmin = row.requestedBy !== null && row.decidedBy !== null && row.requestedBy.id === row.decidedBy.id && row.status === "ACCEPTED" && row.reason === null;
    if (byAdmin || row.kind === "REPLACE" || row.kind === "REMOVE" || row.kind === "ADD") return t("requests.sentence.admin");
    if (row.kind === "SWAP" && row.counterpart) return t("requests.sentence.swap", { name: employeeName(row.counterpart) });
    return t("requests.sentence.move");
  };
  const decided = (row: ChangeRow) => {
    if (row.status === "PENDING" || !row.decidedAt) return null;
    const date = formatDateTime(row.decidedAt);
    if (row.status === "WITHDRAWN") return t("requests.decided.withdrawn", { date });
    if (row.decisionReason === "superseded") return t("requests.superseded");
    const name = row.decidedBy?.name ?? "—";
    if (row.status === "ACCEPTED") {
      return row.requestedBy && row.decidedBy && row.requestedBy.id === row.decidedBy.id
        ? t("requests.decided.recorded", { name })
        : t("requests.decided.accepted", { name, date });
    }
    return t("requests.decided.rejected", { name, date }) + (row.decisionReason ? ` — ${row.decisionReason}` : "");
  };

  return (
    <>
      <p className={records.subtitle}>
        {pending > 0 ? t("requests.sentencePending", { count: pending }) : t("requests.sentenceNone")}
      </p>

      <div className={styles.filterBar}>
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className={[styles.filterPill, filter === key ? styles.filterPillOn : null].filter(Boolean).join(" ")}
            aria-pressed={filter === key}
            onClick={() => {
              setFilter(key);
              setPage(1);
            }}
          >
            {t(`requests.filters.${key}`)}{" "}
            <span className={styles.filterCount}>{counts ? counts[key] : ""}</span>
          </button>
        ))}
        <span className={styles.spacer} />
        <input
          type="search"
          className={styles.pickerInput}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("board.searchPlaceholder")}
          aria-label={common("search")}
        />
      </div>

      {changesQuery.isPending ? (
        <TableSkeleton />
      ) : changesQuery.isError ? (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {changesQuery.error.message}
        </p>
      ) : rows.length === 0 ? (
        <div className={styles.reqEmpty}>
          <div className={styles.reqEmptyTitle}>
            {filter === "pending" ? t("requests.emptyPendingTitle") : t("requests.emptyTitle")}
          </div>
          <div className={styles.reqEmptyBody}>
            {filter === "pending" ? t("requests.emptyPendingBody") : t("requests.emptyBody")}
          </div>
        </div>
      ) : (
        <div className={[styles.reqList, changesQuery.isFetching ? styles.dim : null].filter(Boolean).join(" ")}>
          {rows.map((row) => {
            const isPending = row.status === "PENDING";
            const note = decided(row);
            return (
              <article
                key={row.id}
                className={[styles.reqCard, isPending ? styles.reqCardPending : null].filter(Boolean).join(" ")}
              >
                <Avatar employee={row.employee} size="lg" />
                <div className={styles.reqMain}>
                  <div className={styles.reqLine}>
                    <strong>{employeeName(row.employee)}</strong> <span>{sentence(row)}</span>
                  </div>
                  <div className={styles.reqRoute}>
                    <span className={styles.reqChip}>
                      {row.fromType ? typeLabel(row.fromType) : t("requests.unplaced")}
                    </span>
                    <span className={styles.reqArrow}>{t("requests.arrow")}</span>
                    <span className={[styles.reqChip, styles.reqChipTo].filter(Boolean).join(" ")}>
                      {row.toType ? typeLabel(row.toType) : t("requests.removed")}
                    </span>
                    <span className={styles.reqPeriod}>
                      {t("requests.period", { range: formatWeekRange(isoDayOf(row.week.weekStart)) })}
                    </span>
                  </div>
                  {row.reason && <div className={styles.reqReason}>« {row.reason} »</div>}
                  <div className={styles.reqMeta}>
                    {t("requests.requestedOn", { date: formatDateTime(row.createdAt) })}
                    {note ? ` · ${note}` : ""}
                  </div>
                </div>
                <div className={styles.reqSide}>
                  <span className={[styles.pill, STATUS_TONE[row.status]].filter(Boolean).join(" ")}>
                    {enums(`shiftChangeStatus.${row.status}`)}
                  </span>
                  {isPending && (
                    <div className={styles.reqActions}>
                      <Button
                        size="dense"
                        onClick={() => {
                          setRejectReason("");
                          setRejecting(row);
                        }}
                      >
                        {t("requests.reject")}
                      </Button>
                      <Button size="dense" variant="primary" onClick={() => setAccepting(row)}>
                        {t("requests.accept")}
                      </Button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {pageCount > 1 && (
        <div className={styles.pager}>
          <Button size="dense" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {common("prev")}
          </Button>
          <span className={styles.pickerCount}>
            {page} / {pageCount}
          </span>
          <Button size="dense" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
            {common("next")}
          </Button>
        </div>
      )}

      <Dialog
        open={accepting !== null}
        title={t("requests.acceptTitle")}
        confirmLabel={t("requests.accept")}
        busy={accept.isPending}
        onConfirm={() => accepting && accept.mutate({ changeId: accepting.id })}
        onClose={() => !accept.isPending && setAccepting(null)}
      >
        {accepting &&
          t.rich("requests.acceptBody", {
            name: employeeName(accepting.employee),
            kind: enums(`shiftChangeKind.${accepting.kind}`).toLowerCase(),
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
      </Dialog>

      <Dialog
        open={rejecting !== null}
        title={t("requests.rejectTitle")}
        confirmLabel={t("requests.reject")}
        destructive
        busy={reject.isPending}
        onConfirm={() => rejecting && reject.mutate({ changeId: rejecting.id, reason: rejectReason })}
        onClose={() => !reject.isPending && setRejecting(null)}
      >
        <TextAreaField
          label={t("requests.rejectReason")}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          rows={2}
          disabled={reject.isPending}
        />
      </Dialog>
    </>
  );
}
