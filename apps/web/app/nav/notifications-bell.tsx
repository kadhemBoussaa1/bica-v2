"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  NOTIFICATION_BADGE_MAX,
  type NotificationEvent,
  type NotificationKind,
  type Role,
} from "@repo/api-contract";
import { Skeleton } from "@repo/ui/skeleton";
import { useToast } from "@repo/ui/toast";
import { formatDateTime, numberFormat } from "../../i18n/formats";
import { useTRPC } from "../trpc/client";
import { NAV_ICONS } from "./nav-icons";
import { describeNotification, notificationHref, type NotificationItem } from "./notification-text";
import { useNotificationStream } from "./use-notification-stream";
import { cx } from "./cx";
import styles from "./notifications.module.css";

/** One page of the bell. A PAGE_SIZES value, as the input requires. */
const PAGE_SIZE = 25;

/** Each row wears the icon of the module it opens, from the nav's own set. */
const KIND_ICON: Record<NotificationKind, string> = {
  ORDER_CREATED: "job-orders",
  QUOTE_CREATED: "job-orders",
  ORDER_IN_PRODUCTION: "production",
  SHIFT_WEEK_PUBLISHED: "shifts",
  TASK_ASSIGNED: "my-shifts",
  TASK_REASSIGNED_AWAY: "my-shifts",
  TASK_REOPENED: "my-shifts",
  TASK_DONE: "my-shifts",
};

/** A bell, on the nav glyphs' 18px grid. */
function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 12.5V8a4.5 4.5 0 0 1 9 0v4.5l1.25 1.5H3.25l1.25-1.5Z" />
      <path d="M7.25 15.5a1.75 1.75 0 0 0 3.5 0" />
    </svg>
  );
}

/**
 * The bell in the top bar — docs/notifications-plan.md §5.1.
 *
 * Every role has one. The badge is its own query, in the chat launcher's
 * shape (20 s poll, and again on window focus), so it stays right with the
 * stream closed; the stream (`useNotificationStream`) only makes it
 * immediate. The panel lists the caller's rows newest first — the API
 * scopes them to the kinds this role may read — and opens on the page the
 * row is about, marking it read on the way.
 *
 * Personal kinds also pop a toast. The stream says only which row and
 * whether to toast; the words come from the row, read through tRPC like the
 * bell's, so a popup and the bell never word one event differently.
 *
 * The panel is a popover under the bell and a full-width sheet on a phone,
 * with the chat launcher's dismissal rules: Escape, a click outside, and
 * navigating away all close it.
 */
export function NotificationsBell({ role }: { role: Role }) {
  const t = useTranslations("notifications");
  const enums = useTranslations("enums");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const { push } = useToast();

  // The pathname it was opened on, like the chat launcher: any other
  // pathname reads as closed, so navigating closes it without an effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const [unreadOnly, setUnreadOnly] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const countQuery = useQuery({
    ...trpc.notification.unreadCount.queryOptions(),
    staleTime: 10_000,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });
  const listQuery = useInfiniteQuery(
    trpc.notification.list.infiniteQueryOptions(
      { take: PAGE_SIZE, unreadOnly },
      { getNextPageParam: (last) => last.nextCursor, enabled: open },
    ),
  );
  const markRead = useMutation(
    trpc.notification.markRead.mutationOptions({
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.notification.list.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.notification.unreadCount.queryKey() });
      },
    }),
  );

  // Opening a row reads it, and closes the panel even when the link stays
  // on this pathname (another week of "My shifts", say).
  const visit = (item: NotificationItem) => {
    if (!item.readAt) markRead.mutate({ ids: [item.id] });
    setOpenedOn(null);
  };

  /*
   * A toast for a personal kind: read the row it names (the newest unread
   * page is enough — it arrived a moment ago), then word it like the bell.
   * A row already gone from that page (read elsewhere, or a burst of more
   * than ten) gets no toast; the bell has it.
   */
  const toastFor = async (event: NotificationEvent) => {
    if (!event.toast) return;
    const page = await queryClient
      .fetchQuery({
        ...trpc.notification.list.queryOptions({ take: 10, unreadOnly: true }),
        staleTime: 0,
      })
      .catch(() => null);
    const item = page?.items.find((row) => row.id === event.id);
    if (!item) return;
    const { title, detail } = describeNotification(item, t, enums);
    push({
      title,
      text: detail ?? undefined,
      tone: "info",
      duration: 8000,
      action: {
        label: t("open"),
        onClick: () => {
          markRead.mutate({ ids: [item.id] });
          router.push(notificationHref(item, role));
        },
      },
    });
  };
  useNotificationStream({ onEvent: (event) => void toastFor(event) });

  const close = useCallback(() => {
    setOpenedOn(null);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setOpenedOn(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  const unread = countQuery.data ?? 0;
  const badge =
    unread > NOTIFICATION_BADGE_MAX
      ? `${numberFormat().format(NOTIFICATION_BADGE_MAX)}+`
      : numberFormat().format(unread);
  const items = listQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={cx(styles.bell, open && styles.bellOpen)}
        onClick={() => setOpenedOn(open ? null : pathname)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread > 0 ? t("bellUnread", { count: unread }) : t("bell")}
        title={t("bell")}
      >
        <BellIcon />
        {unread > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Phones only: the sheet covers the page, so it gets a scrim. */}
          <div className={styles.scrim} aria-hidden="true" />
          <div className={styles.panel} role="dialog" aria-modal="false" aria-label={t("title")}>
            <div className={styles.head}>
              <span className={styles.title}>{t("title")}</span>
              <button
                type="button"
                className={styles.markAll}
                onClick={() => markRead.mutate({ all: true })}
                disabled={unread === 0 || markRead.isPending}
              >
                {t("markAllRead")}
              </button>
            </div>
            <div className={styles.filters} role="group" aria-label={t("filter")}>
              {[false, true].map((only) => (
                <button
                  key={String(only)}
                  type="button"
                  className={cx(styles.chip, unreadOnly === only && styles.chipOn)}
                  aria-pressed={unreadOnly === only}
                  onClick={() => setUnreadOnly(only)}
                >
                  {only ? t("unread") : t("all")}
                </button>
              ))}
            </div>

            <div className={styles.list}>
              {listQuery.isPending ? (
                <div className={styles.loading} aria-busy="true">
                  {[70, 55, 80].map((width) => (
                    <div key={width} className={styles.loadingRow}>
                      <Skeleton width={`${width}%`} height={12} />
                      <Skeleton width="40%" height={10} />
                    </div>
                  ))}
                </div>
              ) : listQuery.isError ? (
                <p className={styles.notice} role="alert">
                  {t("loadError")}
                </p>
              ) : items.length === 0 ? (
                <div className={styles.empty}>
                  <span className={styles.emptyTitle}>
                    {unreadOnly ? t("caughtUp") : t("empty")}
                  </span>
                  <span className={styles.emptyHint}>
                    {unreadOnly ? t("caughtUpHint") : t("emptyHint")}
                  </span>
                </div>
              ) : (
                <ul className={styles.rows}>
                  {items.map((item) => {
                    const { title, detail } = describeNotification(item, t, enums);
                    const Icon = NAV_ICONS[KIND_ICON[item.kind]];
                    const meta = [item.actorName, formatDateTime(item.createdAt)]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <li key={item.id}>
                        <Link
                          href={notificationHref(item, role)}
                          className={cx(styles.row, !item.readAt && styles.rowUnread)}
                          onClick={() => visit(item)}
                        >
                          <span className={styles.rowIcon} aria-hidden="true">
                            {Icon ? <Icon /> : null}
                          </span>
                          <span className={styles.rowBody}>
                            <span className={styles.rowTitle}>
                              {!item.readAt && (
                                <span className="sr-only">{`${t("unread")}: `}</span>
                              )}
                              {title}
                            </span>
                            {detail && <span className={styles.rowDetail}>{detail}</span>}
                            <span className={styles.rowMeta}>{meta}</span>
                          </span>
                          {!item.readAt && <span className={styles.rowDot} aria-hidden="true" />}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              {listQuery.hasNextPage && (
                <button
                  type="button"
                  className={styles.more}
                  onClick={() => void listQuery.fetchNextPage()}
                  disabled={listQuery.isFetchingNextPage}
                >
                  {t("older")}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
