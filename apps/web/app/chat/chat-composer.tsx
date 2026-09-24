"use client";

import { useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import {
  CHAT_ATTACHMENTS_MAX,
  CHAT_BODY_MAX,
  CHAT_CONTENT_TYPES,
  UPLOAD_MAX_BYTES,
  type ChatAttachmentInput,
} from "@repo/api-contract";
import { TextAreaField } from "@repo/ui/field";
import { FileUploadField, type FileUploadTicket } from "@repo/ui/file-upload";
import styles from "./chat.module.css";

/**
 * Write a notice and attach files to it — docs/chat-plan.md §6.
 *
 * The attachment list is local state, not a form field: files are uploaded to
 * S3 the moment they are chosen (the browser PUTs straight to a presigned
 * URL), and `post` only records the URLs afterwards. An abandoned composer
 * therefore orphans an S3 object, which is the same accepted trade-off every
 * other upload in this app makes.
 */
export function ChatComposer({
  onPost,
  onRequestUpload,
  posting,
  error,
}: {
  onPost: (input: { body?: string; attachments: ChatAttachmentInput[] }) => void;
  onRequestUpload: (file: File) => Promise<FileUploadTicket>;
  posting: boolean;
  error: string | null;
}) {
  const t = useTranslations("chat");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachmentInput[]>([]);
  /*
   * FileUploadField holds a single value, so the composer renders one field
   * for the NEXT slot and keeps confirmed attachments as chips above it. The
   * key is bumped after each success to reset the field to empty without
   * reaching into the component — it owns its own `value` prop, and passing
   * `null` back would leave its internal error state behind.
   */
  const [slot, setSlot] = useState(0);
  /*
   * The File's own metadata, captured when the upload is REQUESTED. The
   * ticket that comes back carries only the URL, and `onChange` fires later
   * with just that string — by which point the File is out of scope. Without
   * this the row could not record a content type or a filename, and the feed
   * would be back to sniffing extensions.
   */
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const full = attachments.length >= CHAT_ATTACHMENTS_MAX;
  const trimmed = body.trim();
  const canPost = !posting && (trimmed.length > 0 || attachments.length > 0);

  const submit = () => {
    if (!canPost) return;
    onPost({
      body: trimmed.length > 0 ? trimmed : undefined,
      attachments,
    });
    setBody("");
    setAttachments([]);
    setSlot((n) => n + 1);
  };

  /*
   * Enter sends, Shift+Enter breaks the line. `isComposing` is the guard that
   * matters for Arabic and for any IME: the first Enter commits the
   * candidate text and must not also post a half-typed notice.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <section className={styles.composer}>
      {attachments.length > 0 && (
        <div className={styles.chips}>
          {attachments.map((attachment) => (
            <span key={attachment.url} className={styles.chip}>
              <span className={styles.chipName}>{attachment.filename}</span>
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={t("composer.remove", { filename: attachment.filename })}
                onClick={() =>
                  setAttachments((list) => list.filter((a) => a.url !== attachment.url))
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/*
        * The affordance line the reference shows above the input. Labels, not
        * buttons: @-mentions and #-document references are not built, and a
        * control that looks clickable but is not is worse than a hint that
        * tells you the two characters the composer understands.
        */}
      <p className={styles.composerAffordances} aria-hidden="true">
        <span className={styles.affordance}>{t("composer.mention")}</span>
        <span className={styles.affordanceSep}>·</span>
        <span className={styles.affordance}>{t("composer.document")}</span>
      </p>

      <div className={styles.composerBar}>
        <TextAreaField
          label={t("composer.label")}
          placeholder={t("composer.short")}
          rows={1}
          maxLength={CHAT_BODY_MAX}
          value={body}
          disabled={posting}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
        />

        {/*
          * Attach lives ON the bar, between the input and send — the reference
          * puts the paperclip inside the composer, and an earlier attempt that
          * left this in a row below and dragged it up with a negative margin
          * drew the button on top of the textarea.
          */}
        {!full && (
          <span className={styles.attachSlot}>
            <FileUploadField
              key={slot}
              label={t("upload.label")}
              value={null}
              size="dense"
              disabled={posting}
              contentTypes={CHAT_CONTENT_TYPES}
              maxBytes={UPLOAD_MAX_BYTES}
              strings={{
                choose: t("upload.choose"),
                replace: t("upload.replace"),
                remove: t("upload.remove"),
                uploading: t("upload.uploading"),
                failed: t("upload.failed"),
                tooLarge: t("upload.tooLarge"),
                wrongType: t("upload.wrongType"),
              }}
              onRequestUpload={(file) => {
                setPendingFile(file);
                return onRequestUpload(file);
              }}
              onChange={(url) => {
                if (url === null || pendingFile === null) return;
                const file = pendingFile;
                setAttachments((list) =>
                  list.length >= CHAT_ATTACHMENTS_MAX
                    ? list
                    : [
                        ...list,
                        {
                          url,
                          // Narrowed by the field's own `contentTypes` check
                          // before the upload was allowed to start.
                          contentType: file.type as ChatAttachmentInput["contentType"],
                          filename: file.name,
                          size: file.size,
                        },
                      ],
                );
                setPendingFile(null);
                setSlot((n) => n + 1);
              }}
            />
          </span>
        )}

        {/* Send is an icon button at the end of the bar, like the reference —
            the label lives in `aria-label`, since a 38px circle has no room
            for a word and the arrow is unambiguous. */}
        <button
          type="button"
          className={styles.sendButton}
          onClick={submit}
          disabled={!canPost}
          aria-label={posting ? t("composer.sending") : t("composer.send")}
        >
          {posting ? (
            <span className={styles.sendSpinner} aria-hidden="true" />
          ) : (
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
              strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4.5 12 20 4.5 14.5 20 12 13.5 4.5 12Z" />
            </svg>
          )}
        </button>
      </div>

      <p className={styles.hint}>{full ? t("composer.attachmentsFull") : t("composer.hint")}</p>

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
