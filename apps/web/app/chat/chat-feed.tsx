"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { formatDay } from "../../i18n/formats";
import { ChatMessage, type ChatMessageRow } from "./chat-message";
import styles from "./chat.module.css";

/** How close to the bottom still counts as "reading the newest". */
const NEAR_BOTTOM_PX = 80;

/**
 * The scrolling stream — docs/chat-plan.md §6 "Scroll".
 *
 * Three behaviours, and each one exists because its absence is the thing that
 * makes a feed unusable:
 *
 * 1. Auto-scroll only when the reader is already AT the bottom. Yanking
 *    someone off the message they are reading because a new one arrived is
 *    the worst thing a feed does; when they are scrolled up, the arrival
 *    becomes a "N new" button instead.
 * 2. Position preservation when older messages are prepended. Adding content
 *    above the viewport moves everything down by exactly the height added, so
 *    the scroll offset is corrected by that delta in the same frame — hence
 *    useLayoutEffect, not useEffect, which would paint the jump first.
 * 3. Jump to the bottom on first load, with no animation: the newest notice
 *    is the point of the screen, and smooth-scrolling through a page of
 *    history to reach it is motion for its own sake.
 *
 * `messages` arrives OLDEST-FIRST here, the opposite of the server's
 * newest-first page order. The room reverses it once, deliberately: the
 * server sorts descending because that is what a keyset page of history
 * means, and the DOM is ordered ascending because that is what a chat column
 * looks like.
 */
export function ChatFeed({
  messages,
  meId,
  canPin,
  onTogglePin,
  pendingPinId,
  hasMore,
  loadingOlder,
  onLoadOlder,
  onReachBottom,
}: {
  messages: readonly ChatMessageRow[];
  meId: string | null;
  canPin: boolean;
  onTogglePin: (message: ChatMessageRow) => void;
  pendingPinId: string | null;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  /** Fired when the reader is at the bottom, so the room can clear unread. */
  onReachBottom: () => void;
}) {
  const t = useTranslations("chat");
  const scroller = useRef<HTMLDivElement>(null);
  const [unseen, setUnseen] = useState(0);

  // What the DOM looked like on the previous render, so the effects below can
  // tell "older prepended" from "newer appended" without the parent saying.
  const previous = useRef({ count: 0, firstId: "", height: 0, atBottom: true });
  const firstPaint = useRef(true);

  const newest = messages[messages.length - 1];
  const oldest = messages[0];

  const isNearBottom = () => {
    const el = scroller.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;

    const prev = previous.current;
    const grewAtTop = messages.length > prev.count && oldest?.id !== prev.firstId;

    if (firstPaint.current && messages.length > 0) {
      // Straight to the bottom, no animation.
      el.scrollTop = el.scrollHeight;
      firstPaint.current = false;
    } else if (grewAtTop) {
      // Older history went in above the viewport: hold the reader's place by
      // the exact height that was added.
      el.scrollTop += el.scrollHeight - prev.height;
    } else if (messages.length > prev.count) {
      // Newer arrived. Follow it only if they were already at the bottom.
      if (prev.atBottom) {
        el.scrollTop = el.scrollHeight;
      } else {
        setUnseen((n) => n + (messages.length - prev.count));
      }
    }

    previous.current = {
      count: messages.length,
      firstId: oldest?.id ?? "",
      height: el.scrollHeight,
      atBottom: isNearBottom(),
    };
  }, [messages, oldest?.id]);

  // Clearing unread is the room's business (it owns the last-seen stamp), so
  // report the newest message the reader has actually had on screen.
  useEffect(() => {
    if (unseen === 0 && newest) onReachBottom();
  }, [unseen, newest, onReachBottom]);

  const toBottom = () => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setUnseen(0);
  };

  return (
    <>
      <div
        ref={scroller}
        className={styles.feed}
        onScroll={() => {
          previous.current.atBottom = isNearBottom();
          if (isNearBottom()) setUnseen(0);
        }}
      >
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <EmptyState title={t("feed.empty")} text={t("feed.emptyText")} />
          </div>
        ) : (
          <>
            {hasMore ? (
              <div className={styles.older}>
                <Button variant="secondary" size="dense" busy={loadingOlder} onClick={onLoadOlder}>
                  {loadingOlder ? t("feed.loadingOlder") : t("feed.loadOlder")}
                </Button>
              </div>
            ) : (
              <span className={styles.feedStart}>{t("feed.start")}</span>
            )}

            {messages.map((message, index) => {
              /*
               * A separator whenever the day changes. Compared on the
               * formatted day rather than the raw timestamp so the boundary
               * follows the reader's own locale and timezone — the same string
               * the label shows is the thing being compared, so the two can
               * never disagree about where a day starts.
               */
              const previousMessage = messages[index - 1];
              const day = formatDay(message.createdAt);
              const newDay = !previousMessage || formatDay(previousMessage.createdAt) !== day;

              return (
                <Fragment key={message.id}>
                  {newDay && (
                    <span className={styles.daySeparator}>
                      <span className={styles.dayLabel}>{day}</span>
                    </span>
                  )}
                  <ChatMessage
                    message={message}
                    mine={meId !== null && message.authorId === meId}
                    canPin={canPin}
                    onTogglePin={onTogglePin}
                    pinBusy={pendingPinId === message.id}
                  />
                </Fragment>
              );
            })}
          </>
        )}
      </div>

      {unseen > 0 && (
        <div className={styles.newBar}>
          <Button variant="dark" size="dense" onClick={toBottom}>
            {t("feed.new", { count: unseen })}
          </Button>
        </div>
      )}
    </>
  );
}
