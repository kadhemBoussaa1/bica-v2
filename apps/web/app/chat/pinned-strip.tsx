"use client";

import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import { formatDateTime } from "../../i18n/formats";
import type { ChatMessageRow } from "./chat-message";
import styles from "./chat.module.css";

/**
 * The notices held above the flow — docs/chat-plan.md §6.
 *
 * Deliberately terse: author, when, and the body. A pinned notice is a
 * reminder of something already read in the stream below, so repeating its
 * attachments here would double every photo on the screen. Tapping through to
 * the full row is not offered either — the stream holds it, and a pinned
 * notice that is also the newest would then appear twice with two different
 * affordances.
 *
 * Renders nothing at all when nothing is pinned. An empty panel above a busy
 * feed is chrome that never earns its space; the plan's `pinned.empty` string
 * exists for the admin-facing case where a pin was just removed.
 */
export function PinnedStrip({
  messages,
  canPin,
  onUnpin,
  pendingId,
}: {
  messages: readonly ChatMessageRow[];
  canPin: boolean;
  onUnpin?: (message: ChatMessageRow) => void;
  pendingId?: string | null;
}) {
  const t = useTranslations("chat");

  if (messages.length === 0) return null;

  return (
    <section className={styles.pinned} aria-label={t("pinned.title")}>
      <div className={styles.pinnedHead}>
        <span className={styles.pinnedTitle}>{t("pinned.title")}</span>
      </div>

      <div className={styles.pinnedList}>
        {messages.map((message) => (
          <article key={message.id} className={styles.pinnedItem}>
            <div className={styles.pinnedMeta}>
              <span className={styles.author}>{message.authorName}</span>
              <span className={styles.when}>{formatDateTime(message.createdAt)}</span>
              {canPin && onUnpin && (
                <span className={styles.headActions}>
                  <Button
                    variant="ghost"
                    size="dense"
                    busy={pendingId === message.id}
                    onClick={() => onUnpin(message)}
                  >
                    {t("pinned.unpin")}
                  </Button>
                </span>
              )}
            </div>
            {message.body !== null && <p className={styles.body}>{message.body}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
