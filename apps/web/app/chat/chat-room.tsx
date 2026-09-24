"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { canAccess, type ChatAttachmentInput } from "@repo/api-contract";
import { useCurrentUser } from "../auth/use-auth";
import { useTRPC } from "../trpc/client";
import { ChatComposer } from "./chat-composer";
import { ChatFeed } from "./chat-feed";
import type { ChatMessageRow } from "./chat-message";
import { PinnedStrip } from "./pinned-strip";
import { useLastSeen } from "./use-last-seen";
import styles from "./chat.module.css";
import records from "../records/records.module.css";

/**
 * The room: owns the polling, the merged message state and the last-seen
 * stamp — docs/chat-plan.md §6.
 *
 * Why the state is a Map rather than the query cache: the feed is assembled
 * from two sources that overlap. `chat.feed` supplies pages of history
 * (fetched once per page, never polled), `chat.since` supplies new arrivals
 * every 10s, and a message you post yourself arrives twice — once as the
 * mutation's own result, appended immediately, and once on the next poll,
 * which cannot know you already have it. De-duplicating by id is therefore
 * necessary, not defensive.
 *
 * `chat.feed` is deliberately NOT polled and NOT invalidated: refetching it
 * would replace the newest page wholesale, discarding every older page the
 * reader has loaded and jumping their scroll position.
 */
export function ChatRoom({ variant = "page" }: { variant?: "page" | "panel" }) {
  const t = useTranslations("chat");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const { mark, markIfVisible } = useLastSeen();

  // Pages of history, oldest page last. Held here rather than in the cache
  // because "load older" accumulates pages and the cache would key each one
  // separately under its own cursor.
  const [olderPages, setOlderPages] = useState<ChatMessageRow[][]>([]);
  /*
   * The wire shape, not `Date`: there is no superjson transformer on this
   * app's tRPC link, so every date arrives as an ISO string however it is
   * typed on the server. `new Date(...)` happens where the cursor is sent.
   */
  const [cursor, setCursor] = useState<{ createdAt: string | Date; id: string } | null>(
    null,
  );
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [pendingPinId, setPendingPinId] = useState<string | null>(null);

  const canPin = user !== null && canAccess(user.role, "ADMIN");

  // The first (newest) page. One fetch, no interval: everything after this
  // arrives through `since`.
  const feedQuery = useQuery({
    ...trpc.chat.feed.queryOptions({}),
    staleTime: 0,
  });

  const firstPage = useMemo<ChatMessageRow[]>(
    () => feedQuery.data?.messages ?? [],
    [feedQuery.data],
  );

  /*
   * Arrivals the client has been told about but that are not in `feed`'s page:
   * poll results, plus rows returned by `post` and `setPinned`.
   *
   * Accumulated through a state SETTER only — never during render. React
   * Query's `select` looked like the natural place to merge each poll, but it
   * runs in the render phase, and calling a setter there is the cascading
   * render this repo's lint rejects. So the poll's data is folded in below
   * with a plain `useMemo` over whatever the query currently holds, and this
   * state carries only what no query would return again: the two mutation
   * results.
   */
  const [extra, setExtra] = useState<ChatMessageRow[]>([]);

  /**
   * Ascending (createdAt, id) — the DOM order of a chat column, and the exact
   * reverse of the server's page order. The id tiebreaker matters here for the
   * same reason it does in the keyset cursor: two notices can share a
   * millisecond, and a wobbling comparison would reshuffle the column between
   * renders.
   */
  const order = (a: ChatMessageRow, b: ChatMessageRow) => {
    const at = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return at !== 0 ? at : a.id.localeCompare(b.id);
  };

  /*
   * Where the poll continues from.
   *
   * Deliberately derived from everything EXCEPT the poll's own result:
   * `feed`'s page, the older pages, and the mutation results. Including the
   * poll would close a loop — its rows would move the cursor, which is its own
   * query key, which refetches — so the cursor advances when history loads or
   * this user posts, and otherwise holds still while the interval does the
   * work. `since` is inclusive-exclusive on (createdAt, id), so a held cursor
   * re-returns nothing it has already returned.
   */
  const sinceAfter = useMemo(() => {
    const known = [...olderPages.flat(), ...firstPage, ...extra];
    if (known.length === 0) return null;
    const last = known.reduce((a, b) => (order(a, b) >= 0 ? a : b));
    // The wire shape: dates cross as ISO strings, and the input schema
    // coerces them back.
    return { createdAt: new Date(last.createdAt), id: last.id };
  }, [olderPages, firstPage, extra]);

  /*
   * The poll. Always enabled, with `after` omitted while the room is still
   * empty — a cursor-less call is a cold read of the newest page, and the
   * server answers it rather than returning nothing (see ChatService.since).
   * Gating this on a non-null cursor would leave an empty room permanently
   * dead to the first post, which is the state every open tab is in after a
   * fresh deploy.
   *
   * `staleTime: 0` is load-bearing: the app's global default is 30s, and with
   * it inherited React Query would serve cache and this would never actually
   * poll.
   */
  const sinceQuery = useQuery({
    ...trpc.chat.since.queryOptions(sinceAfter ? { after: sinceAfter } : {}),
    staleTime: 0,
    refetchInterval: 10_000,
  });

  const merged = useMemo(() => {
    const byId = new Map<string, ChatMessageRow>();
    // Oldest first so the later sort is doing less work; order within the Map
    // does not matter, only that ids collapse.
    for (const page of [...olderPages].reverse()) {
      for (const message of page) byId.set(message.id, message);
    }
    for (const message of firstPage) byId.set(message.id, message);
    for (const message of sinceQuery.data ?? []) byId.set(message.id, message);
    // Last, so a freshly pinned row's flag wins over the copy the poll or the
    // page still holds unpinned.
    for (const message of extra) byId.set(message.id, message);

    return [...byId.values()].sort(order);
  }, [olderPages, firstPage, sinceQuery.data, extra]);

  const newest = merged[merged.length - 1];

  const pinnedQuery = useQuery({
    ...trpc.chat.pinned.queryOptions(),
    refetchInterval: 30_000,
  });

  const postMutation = useMutation(
    trpc.chat.post.mutationOptions({
      onSuccess: (message) => {
        setPostError(null);
        // Held here because the poll will never return it: the cursor above
        // advances past this row the moment it lands, so `since` correctly
        // considers it already delivered. De-duplication still matters for
        // the race where a poll was already in flight.
        setExtra((previous) => [...previous, message]);
        mark(message.createdAt);
      },
      onError: (error) => setPostError(error.message || t("composer.failed")),
    }),
  );

  const uploadMutation = useMutation(trpc.chat.createAttachmentUpload.mutationOptions());

  const pinMutation = useMutation(
    trpc.chat.setPinned.mutationOptions({
      onSuccess: (message) => {
        // The pinned strip is a separate query, so it is invalidated rather
        // than patched; the row itself is merged straight in so the flag
        // flips in the stream without waiting for a poll. A pin does not
        // change `createdAt`, so this never moves the poll's cursor.
        setExtra((previous) => [...previous, message]);
        void queryClient.invalidateQueries({ queryKey: trpc.chat.pinned.queryKey() });
      },
      onSettled: () => setPendingPinId(null),
    }),
  );

  const loadOlder = async () => {
    const from = cursor ?? feedQuery.data?.nextCursor ?? null;
    if (from === null) return;
    setLoadingOlder(true);
    try {
      const page = await queryClient.fetchQuery(
        trpc.chat.feed.queryOptions({
          cursor: { createdAt: new Date(from.createdAt), id: from.id },
        }),
      );
      setOlderPages((pages) => [...pages, page.messages]);
      setCursor(page.nextCursor ? page.nextCursor : null);
      setHasMore(page.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  };

  /*
   * Reaching the bottom marks read only while the tab is visible. The feed
   * auto-scrolls to its bottom, so a panel left open on a hidden tab would
   * otherwise mark every arriving notice as read and the badge would never
   * come back. Posting (below) always marks, visible or not: you wrote it.
   */
  const onReachBottom = useCallback(() => {
    if (newest) markIfVisible(newest.createdAt);
  }, [newest, markIfVisible]);

  const togglePin = (message: ChatMessageRow) => {
    setPendingPinId(message.id);
    pinMutation.mutate({ id: message.id, pinned: message.pinnedAt === null });
  };

  const post = (input: { body?: string; attachments: ChatAttachmentInput[] }) => {
    postMutation.mutate(input);
  };

  if (feedQuery.isPending) {
    return <p className={records.muted}>{t("feed.loading")}</p>;
  }

  if (feedQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {feedQuery.error.message || t("feed.error")}
      </p>
    );
  }

  const moreAvailable = olderPages.length === 0 ? feedQuery.data.hasMore : hasMore;

  return (
    <div
      className={[styles.room, variant === "panel" ? styles.roomPanel : null]
        .filter(Boolean)
        .join(" ")}
    >
      <PinnedStrip
        messages={pinnedQuery.data ?? []}
        canPin={canPin}
        onUnpin={togglePin}
        pendingId={pendingPinId}
      />

      <ChatFeed
        messages={merged}
        meId={user?.id ?? null}
        canPin={canPin}
        onTogglePin={togglePin}
        pendingPinId={pendingPinId}
        hasMore={moreAvailable}
        loadingOlder={loadingOlder}
        onLoadOlder={() => void loadOlder()}
        onReachBottom={onReachBottom}
      />

      <ChatComposer
        onPost={post}
        onRequestUpload={(file) =>
          uploadMutation.mutateAsync({
            filename: file.name,
            contentType: file.type as ChatAttachmentInput["contentType"],
            size: file.size,
          })
        }
        posting={postMutation.isPending}
        error={postError}
      />

    </div>
  );
}
