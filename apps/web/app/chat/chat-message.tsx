"use client";

import { useTranslations } from "next-intl";
import { assetUrl } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { FileLink } from "@repo/ui/file-link";
import { Thumbnail } from "@repo/ui/thumbnail";
import { formatDateTime } from "../../i18n/formats";
import styles from "./chat.module.css";

export interface ChatAttachmentRow {
  id: string;
  url: string;
  contentType: string;
  filename: string;
  size: number;
}

/**
 * One notice, as the feed and the pinned strip both render it.
 *
 * Derived from the router's own output rather than hand-written, so the two
 * cannot drift — see the note in chat-room.tsx on `ChatMessageRow`.
 */
export interface ChatMessageRow {
  id: string;
  createdAt: Date | string;
  body: string | null;
  authorId: string | null;
  authorName: string;
  pinnedAt: Date | string | null;
  pinnedById: string | null;
  attachments: ChatAttachmentRow[];
}

function isImage(contentType: string): boolean {
  return contentType.startsWith("image/");
}

export function ChatMessage({
  message,
  mine,
  canPin,
  onTogglePin,
  pinBusy = false,
}: {
  message: ChatMessageRow;
  mine: boolean;
  /** ADMIN and above. UX only — `chat.setPinned` re-authorizes the session. */
  canPin: boolean;
  onTogglePin?: (message: ChatMessageRow) => void;
  pinBusy?: boolean;
}) {
  const t = useTranslations("chat");
  const pinned = message.pinnedAt !== null;

  const images = message.attachments.filter((a) => isImage(a.contentType));
  const files = message.attachments.filter((a) => !isImage(a.contentType));

  return (
    <article
      className={[
        styles.message,
        mine ? styles.messageMine : null,
        pinned ? styles.messagePinned : null,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.head}>
        <span className={styles.author}>{mine ? t("feed.you") : message.authorName}</span>
        <span className={styles.when}>{formatDateTime(message.createdAt)}</span>
        {pinned && <span className={styles.pinFlag}>{t("pinned.title")}</span>}

        {canPin && onTogglePin && (
          <span className={styles.headActions}>
            <Button
              variant="ghost"
              size="dense"
              busy={pinBusy}
              onClick={() => onTogglePin(message)}
            >
              {pinned ? t("pinned.unpin") : t("pinned.pin")}
            </Button>
          </span>
        )}
      </div>

      {/*
       * Plain text in braces: React escapes it, so a notice containing markup
       * renders as the characters someone typed. No markdown and no
       * dangerouslySetInnerHTML anywhere in this module — every signed-in role
       * can post here, and the feed is read by the whole plant.
       */}
      {message.body !== null && <p className={styles.body}>{message.body}</p>}

      {images.length > 0 && (
        <div className={styles.attachments}>
          {images.map((attachment) => {
            // `assetUrl` encodes the stored key; the legacy bucket holds
            // names with spaces, which an unencoded src 404s on.
            const href = assetUrl(attachment.url);
            return (
              <Thumbnail
                key={attachment.id}
                src={href}
                size="md"
                href={href}
                alt={attachment.filename}
              />
            );
          })}
        </div>
      )}

      {/*
       * Branching on the stored content type, not on the URL's extension —
       * which is the reason ChatAttachment carries the column. The S3 key is
       * `{epochMillis}_{sanitized}`, so `filename` is the only label worth
       * showing.
       */}
      {files.length > 0 && (
        <div className={styles.files}>
          {files.map((attachment) => (
            <FileLink
              key={attachment.id}
              href={assetUrl(attachment.url)}
              label={attachment.filename}
            />
          ))}
        </div>
      )}
    </article>
  );
}
