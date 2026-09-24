"use client";

import { useId, useRef, useState } from "react";
import { assetFileName } from "@repo/api-contract";
import styles from "./components.module.css";
import type { FieldSize } from "./field";

/** What the server hands back for one upload: where to PUT, and what to store. */
export interface FileUploadTicket {
  uploadUrl: string;
  url: string;
}

export interface FileUploadStrings {
  /** Button label when there is no file yet. */
  choose: string;
  /** Button label when one is already attached. */
  replace: string;
  /** Clears the field. */
  remove: string;
  uploading: string;
  /** Shown when the browser blocks the PUT — nearly always bucket CORS. */
  failed: string;
  tooLarge: string;
  wrongType: string;
}

export interface FileUploadOptions {
  onChange: (url: string | null) => void;
  onRequestUpload: (file: File) => Promise<FileUploadTicket>;
  contentTypes: readonly string[];
  maxBytes: number;
  strings: Pick<FileUploadStrings, "failed" | "tooLarge" | "wrongType">;
}

/**
 * The upload itself, shared by `FileUploadField` and `FileDropzone`: check
 * the type and size locally, mint the presigned PUT, send the bytes straight
 * to S3, hand the resulting URL to the caller. `busy` and `error` are the
 * state the two renderings draw; `reset` clears the error before a removal.
 */
export function useFileUpload({
  onChange,
  onRequestUpload,
  contentTypes,
  maxBytes,
  strings,
}: FileUploadOptions) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);

    if (!contentTypes.includes(file.type)) {
      setError(strings.wrongType);
      return;
    }
    if (file.size > maxBytes) {
      setError(strings.tooLarge);
      return;
    }

    setBusy(true);
    try {
      const ticket = await onRequestUpload(file);
      const response = await fetch(ticket.uploadUrl, {
        method: "PUT",
        body: file,
        // Must match the type signed into the URL, or S3 rejects the PUT.
        headers: { "Content-Type": file.type },
      });
      if (!response.ok) {
        throw new Error(`S3 refused the upload (${response.status})`);
      }
      onChange(ticket.url);
    } catch (cause) {
      // A blocked PUT usually means the bucket has no CORS rule for this
      // origin, which surfaces as an opaque TypeError rather than a status.
      setError(cause instanceof Error && cause.message ? cause.message : strings.failed);
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, upload, reset: () => setError(null) };
}

interface FileUploadFieldProps {
  label: string;
  /**
   * The stored column, already encoded for display — pass `assetUrl(stored)`.
   * `null` when there is no file.
   */
  value: string | null;
  /**
   * Called with the public URL after a successful upload, and with `null` when
   * the user removes the file. The caller saves it through its own mutation:
   * this component never writes to a record.
   */
  onChange: (url: string | null) => void;
  /**
   * Mints a presigned PUT for this file. Separate from `onChange` because the
   * gate lives on the server — the procedure re-checks that the record still
   * accepts a document before handing out a capability.
   */
  onRequestUpload: (file: File) => Promise<FileUploadTicket>;
  /** Mirrors the contract's `UPLOAD_CONTENT_TYPES`; also the `accept` filter. */
  contentTypes: readonly string[];
  maxBytes: number;
  strings: FileUploadStrings;
  size?: FieldSize;
  disabled?: boolean;
}

/**
 * Attach a scan to a record: pick a file, PUT it straight to S3, hand the
 * resulting URL back to the caller.
 *
 * The bytes never touch the API — the browser uploads to a presigned URL the
 * server minted, so tRPC stays the whole HTTP surface (no multipart body, no
 * Express controller). Two steps, deliberately: this component uploads, and
 * the caller's own update mutation stores the URL, which keeps every rank and
 * status rule in the one place that already owns it. An abandoned upload
 * therefore leaves an orphaned object and an unchanged row, never a
 * half-written record.
 *
 * Type and size are checked here for a quick, local error, but the server
 * signs the content type into the URL and S3 refuses a mismatch — the client
 * check is courtesy, not the boundary.
 *
 * No translation layer in this package: every word arrives in `strings`,
 * already translated.
 */
export function FileUploadField({
  label,
  value,
  onChange,
  onRequestUpload,
  contentTypes,
  maxBytes,
  strings,
  size = "touch",
  disabled = false,
}: FileUploadFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const { busy, error, upload, reset } = useFileUpload({
    onChange,
    onRequestUpload,
    contentTypes,
    maxBytes,
    strings,
  });

  const buttonClasses = [
    styles.btn,
    styles.btnSecondary,
    size === "dense" ? styles.btnDense : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.field}>
      <span className={[styles.fieldLabel, error ? styles.fieldLabelError : null].filter(Boolean).join(" ")}>
        {label}
      </span>

      <div className={styles.fileUploadRow}>
        {value !== null && (
          <a className={styles.fileLink} href={value} target="_blank" rel="noreferrer">
            {assetFileName(value)}
          </a>
        )}

        <input
          ref={inputRef}
          id={id}
          type="file"
          className={styles.fileUploadInput}
          accept={contentTypes.join(",")}
          disabled={disabled || busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared at once so the same file can be chosen again after a failure.
            event.target.value = "";
            if (file) void upload(file);
          }}
        />

        <div className={styles.fileUploadActions}>
          <button
            type="button"
            className={buttonClasses}
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? strings.uploading : value === null ? strings.choose : strings.replace}
          </button>

          {value !== null && !busy && (
            <button
              type="button"
              className={buttonClasses}
              disabled={disabled}
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

      {error && (
        <span id={errorId} className={styles.fieldError}>
          {error}
        </span>
      )}
    </div>
  );
}
