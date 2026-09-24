"use client";

import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { assetFileName } from "@repo/api-contract";
import styles from "./components.module.css";
import { useFileUpload, type FileUploadTicket } from "./file-upload";

export interface FileDropzoneStrings {
  /** Above the button while the zone is empty: "Drop the PDF here". */
  drop: string;
  choose: string;
  /** The three actions under an attached file. */
  open: string;
  download: string;
  remove: string;
  uploading: string;
  failed: string;
  tooLarge: string;
  wrongType: string;
  /** The empty zone's text when the slot is locked and nothing was attached. */
  none?: string;
}

interface FileDropzoneProps {
  /** The stored column, already encoded for display — `assetUrl(stored)`; `null` when empty. */
  value: string | null;
  /** The public URL after an upload, `null` on removal. The caller persists it. */
  onChange: (url: string | null) => void;
  onRequestUpload: (file: File) => Promise<FileUploadTicket>;
  contentTypes: readonly string[];
  maxBytes: number;
  strings: FileDropzoneStrings;
  /** The line under the file name once one is attached: its kind, whether it is saved. */
  meta?: string;
  /** Draws the empty zone's dashed edge in orange: this paper must be attached. */
  required?: boolean;
  /**
   * The slot no longer takes a file: no drop, no picker, no remove. What is
   * attached can still be opened and downloaded; an empty slot says so.
   */
  locked?: boolean;
  /** Extra buttons on the attached file's action row, after open / download. */
  actions?: ReactNode;
  /** Names the zone for assistive tech; the visible title belongs to the caller's card. */
  label: string;
  disabled?: boolean;
}

/**
 * A document slot the size of a card: an empty dashed zone that takes a
 * drop or opens the picker, or the attached file as a row with a page glyph
 * and its actions. The same two-step contract as `FileUploadField` — this
 * uploads, the caller's own mutation stores the URL — with the same
 * `useFileUpload` underneath; only the rendering differs, for the record
 * pages where the paper is the subject rather than one field among many.
 */
export function FileDropzone({
  value,
  onChange,
  onRequestUpload,
  contentTypes,
  maxBytes,
  strings,
  meta,
  required = false,
  locked = false,
  actions,
  label,
  disabled = false,
}: FileDropzoneProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const { busy, error, upload, reset } = useFileUpload({
    onChange,
    onRequestUpload,
    contentTypes,
    maxBytes,
    strings,
  });

  const inert = disabled || busy || locked;
  const actionClasses = [styles.btn, styles.btnSecondary, styles.btnDense, styles.dropzoneAction]
    .filter(Boolean)
    .join(" ");

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    if (inert) return;
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  };

  return (
    <div className={styles.dropzone}>
      {!locked && (
        <input
          ref={inputRef}
          id={id}
          type="file"
          className={styles.fileUploadInput}
          accept={contentTypes.join(",")}
          disabled={inert}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      )}

      {value === null ? (
        <div
          className={[
            styles.dropzoneEmpty,
            required && !locked ? styles.dropzoneRequired : null,
            over ? styles.dropzoneOver : null,
            locked ? styles.dropzoneLocked : null,
          ]
            .filter(Boolean)
            .join(" ")}
          onDragOver={(event) => {
            event.preventDefault();
            if (!inert) setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          {locked ? (
            <span className={styles.dropzoneText}>{strings.none ?? strings.drop}</span>
          ) : (
            <>
              <svg
                className={styles.dropzoneIcon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 16V4M7 9l5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
              <span className={styles.dropzoneText}>{strings.drop}</span>
              <button
                type="button"
                className={[styles.btn, styles.btnSecondary, styles.btnDense].filter(Boolean).join(" ")}
                disabled={inert}
                onClick={() => inputRef.current?.click()}
              >
                {busy ? strings.uploading : strings.choose}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className={styles.dropzoneFile}>
          <div className={styles.dropzoneFileRow}>
            <span className={styles.dropzonePage} aria-hidden="true">
              <span className={styles.dropzonePageLine} />
              <span className={[styles.dropzonePageLine, styles.dropzonePageLineShort].filter(Boolean).join(" ")} />
              <span className={styles.dropzonePageFoot} />
            </span>
            <span className={styles.dropzoneFileText}>
              {/* `bdi`: a Latin name with leading digits reorders inside an RTL page. */}
              <span className={styles.dropzoneFileName}>
                <bdi>{assetFileName(value)}</bdi>
              </span>
              {meta && <span className={styles.dropzoneFileMeta}>{meta}</span>}
            </span>
          </div>
          <div className={styles.dropzoneActions}>
            <a className={actionClasses} href={value} target="_blank" rel="noreferrer">
              {strings.open}
            </a>
            {/* `download` is advisory across origins; the browser may still open it. */}
            <a className={actionClasses} href={value} download={assetFileName(value)}>
              {strings.download}
            </a>
            {actions}
            {!locked && (
              <button
                type="button"
                className={[actionClasses, styles.dropzoneRemove].filter(Boolean).join(" ")}
                disabled={disabled || busy}
                onClick={() => {
                  reset();
                  onChange(null);
                }}
              >
                {strings.remove}
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <span id={errorId} className={styles.fieldError}>
          {error}
        </span>
      )}
    </div>
  );
}
