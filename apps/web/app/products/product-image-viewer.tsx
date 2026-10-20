"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { assetUrl } from "@repo/api-contract";
import { FormDialog } from "@repo/ui/form-dialog";
import styles from "./product-image-viewer.module.css";

/**
 * A product's artwork, large, in a modal — the click target of the order
 * page's photos. One image at a time, whole (never cropped); with several,
 * arrows, a strip of thumbnails and the arrow keys step between them.
 *
 * Mounted only while open (`FormDialog` opens on mount): the caller keeps
 * the index it was opened on and unmounts it on `onClose`.
 */
export function ProductImageViewer({
  images,
  name,
  initialIndex = 0,
  onClose,
}: {
  /** Stored values, as on `Product.images`; encoded here with `assetUrl`. */
  images: readonly string[];
  /** The product's name: the dialog's title and the images' alt text. */
  name: string;
  initialIndex?: number;
  onClose: () => void;
}) {
  const t = useTranslations("products.viewer");
  const total = images.length;
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), total - 1));
  // Which source failed, so stepping to another image tries it afresh.
  const [failed, setFailed] = useState<string | null>(null);
  const src = assetUrl(images[index]);

  const step = (by: number) => setIndex((current) => (current + by + total) % total);

  // Arrow keys follow the reading direction: in Arabic, ← is "next".
  useEffect(() => {
    if (total < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const rtl = document.documentElement.dir === "rtl";
      const forward = (event.key === "ArrowRight") !== rtl;
      setIndex((current) => (current + (forward ? 1 : -1) + total) % total);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [total]);

  return (
    <FormDialog eyebrow={t("eyebrow")} title={name} onClose={onClose}>
      <div className={styles.viewer}>
        <div className={styles.stage}>
          {src && failed !== src ? (
            // S3 URL from the legacy bucket: next/image would re-proxy it.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              className={styles.image}
              src={src}
              alt={t("alt", { name, index: index + 1, total })}
              onError={() => setFailed(src)}
            />
          ) : (
            <span className={styles.unavailable}>{t("unavailable")}</span>
          )}
          {total > 1 && (
            <>
              <button
                type="button"
                className={[styles.arrow, styles.arrowPrev].filter(Boolean).join(" ")}
                onClick={() => step(-1)}
                aria-label={t("previous")}
              >
                <Chevron />
              </button>
              <button
                type="button"
                className={[styles.arrow, styles.arrowNext].filter(Boolean).join(" ")}
                onClick={() => step(1)}
                aria-label={t("next")}
              >
                <Chevron />
              </button>
            </>
          )}
        </div>

        <div className={styles.footer}>
          {total > 1 && (
            <span className={styles.counter} aria-live="polite">
              {t("counter", { index: index + 1, total })}
            </span>
          )}
          {src && (
            <a className={styles.original} href={src} target="_blank" rel="noreferrer">
              {t("openOriginal")}
              <span className={styles.external} aria-hidden>
                ↗
              </span>
            </a>
          )}
        </div>

        {total > 1 && (
          <div className={styles.strip} role="group" aria-label={t("thumbnails")}>
            {images.map((image, i) => {
              const thumb = assetUrl(image);
              return (
                <button
                  key={image}
                  type="button"
                  className={[styles.thumb, i === index ? styles.thumbOn : null]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setIndex(i)}
                  aria-label={t("show", { index: i + 1 })}
                  aria-pressed={i === index}
                >
                  {thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" loading="lazy" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </FormDialog>
  );
}

/** Points to the inline end; the previous arrow and RTL mirror it in CSS. */
function Chevron() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}
