"use client";

import { useState } from "react";
import styles from "./components.module.css";

interface ThumbnailProps {
  /**
   * An already-encoded URL — pass `assetUrl(stored)`, not the raw column.
   * `null` renders the placeholder, so callers need no conditional.
   */
  src: string | null;
  size: "sm" | "md";
  /** Wraps the image in a new-tab link. Usually the same value as `src`. */
  href?: string | null;
  alt?: string;
}

/**
 * A preview of a legacy S3 asset.
 *
 * Plain `<img>`, not `next/image`: these are DB-sourced URLs on a bucket this
 * app does not own, and the optimizer 400s on any host that is not
 * pre-allowlisted. They are also thumbnails, so there is nothing to optimize.
 */
export function Thumbnail({ src, size, href, alt = "" }: ThumbnailProps) {
  // Reset on `src` change, so editing a broken URL back to a good one in a form
  // shows the new image instead of staying stuck on the placeholder.
  const [failed, setFailed] = useState<string | null>(null);

  const sizeClass = size === "sm" ? styles.thumbSm : styles.thumbMd;

  if (src === null || failed === src) {
    const classes = [styles.thumbEmpty, sizeClass].filter(Boolean).join(" ");
    return <span className={classes} aria-hidden />;
  }

  const classes = [styles.thumb, sizeClass].filter(Boolean).join(" ");

  // No `next/next/no-img-element` disable here: unlike the app, this package
  // lints with the react-internal config, which has no Next plugin loaded.
  const img = (
    <img
      className={classes}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(src)}
    />
  );

  if (href === null || href === undefined) return img;

  return (
    <a href={href} target="_blank" rel="noreferrer">
      {img}
    </a>
  );
}
