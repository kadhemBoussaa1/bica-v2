import { assetFileName } from "@repo/api-contract";
import styles from "./components.module.css";

interface FileLinkProps {
  /**
   * An already-encoded URL — pass `assetUrl(stored)`, not the raw column.
   * `null` renders the empty marker, so callers need no conditional.
   */
  href: string | null;
  /** Defaults to the file name at the end of the URL. */
  label?: string;
}

/**
 * A new-tab link to a non-image asset — an invoice, a certificate, a packing
 * list. Labelled with the file name rather than the URL, which is a 100-char
 * bucket path nobody reads.
 *
 * Renders the same `—` as a detail row's `Val` when there is no file, so a
 * missing document lines up with every other empty field on the panel.
 */
export function FileLink({ href, label }: FileLinkProps) {
  if (href === null) {
    return <span className={styles.fileLinkEmpty}>—</span>;
  }

  return (
    <a className={styles.fileLink} href={href} target="_blank" rel="noreferrer">
      {label ?? assetFileName(href)}
    </a>
  );
}
