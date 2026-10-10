"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { PRODUCT_IMAGE_CONTENT_TYPES, UPLOAD_MAX_BYTES } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { useFileUpload } from "@repo/ui/file-upload";
import { useTRPC } from "../trpc/client";
import styles from "./products.module.css";

/**
 * Upload artwork from the computer: a button that opens the picker (several
 * files at once) and a drop target around `children` — the gallery the caller
 * draws. Each file is PUT straight to S3 and its URL handed to `onUploaded`;
 * the caller decides whether that means "add to the form" (product form) or
 * "save on the product now" (order page). Nothing is written to a record here.
 */
export function ProductImageUpload({
  onUploaded,
  disabled = false,
  busy: callerBusy = false,
  children,
}: {
  onUploaded: (url: string) => void;
  disabled?: boolean;
  /** The caller's own save is in flight — the order page's `addImage`. */
  busy?: boolean;
  children?: ReactNode;
}) {
  const trpc = useTRPC();
  const t = useTranslations("products");
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  // Counts successful uploads, so a batch stops at the first file that fails
  // and its error stays on screen instead of being cleared by the next file.
  const landed = useRef(0);

  const mint = useMutation(trpc.product.createImageUpload.mutationOptions());
  const { busy, error, upload } = useFileUpload({
    onChange: (url) => {
      if (url === null) return;
      landed.current += 1;
      onUploaded(url);
    },
    onRequestUpload: (file) =>
      mint.mutateAsync({
        filename: file.name,
        // `useFileUpload` has already refused anything outside the list.
        contentType: file.type as (typeof PRODUCT_IMAGE_CONTENT_TYPES)[number],
        size: file.size,
      }),
    contentTypes: PRODUCT_IMAGE_CONTENT_TYPES,
    maxBytes: UPLOAD_MAX_BYTES,
    strings: {
      failed: t("form.uploadFailed"),
      tooLarge: t("form.uploadTooLarge"),
      wrongType: t("form.uploadWrongType"),
    },
  });

  const inert = disabled || busy || callerBusy;

  const uploadAll = async (files: File[]) => {
    for (const file of files) {
      const before = landed.current;
      await upload(file);
      if (landed.current === before) break;
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    if (!inert) void uploadAll(Array.from(event.dataTransfer.files));
  };

  return (
    <div
      className={[styles.imageDrop, over ? styles.imageDropOver : null].filter(Boolean).join(" ")}
      onDragOver={(event) => {
        event.preventDefault();
        if (!inert) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {children}
      <div className={styles.imageDropActions}>
        <Button onClick={() => inputRef.current?.click()} busy={busy || callerBusy} disabled={inert}>
          {busy ? t("form.uploading") : t("form.addImage")}
        </Button>
        <span className={styles.imageDropHint}>{t("form.imageTypes")}</span>
      </div>
      {error && (
        <span className={styles.imageDropError} role="alert">
          {error}
        </span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={PRODUCT_IMAGE_CONTENT_TYPES.join(",")}
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Cleared so picking the same file again still fires.
          event.target.value = "";
          void uploadAll(files);
        }}
      />
    </div>
  );
}
