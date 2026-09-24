"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { FormDialog } from "@repo/ui/form-dialog";

/**
 * A creation form opened as a dialog over the current page.
 *
 * The pages under `@modal/(.)…/new` intercept in-app navigation to a `/new`
 * URL (see docs/form-dialogs.md): the URL changes, this renders the same form
 * the full page would, and Back or Cancel returns to wherever the user was.
 * A hard load of the same URL never reaches here — Next renders the full
 * page — so deep links and refreshes still work.
 *
 * `path` guards against Next's partial rendering: on a soft navigation away
 * from the modal (a sidebar link, or the form's own "done" replace), a slot
 * with no match keeps its previous content, so the dialog would stay open
 * over the new page. Rendering nothing once the URL no longer matches is
 * what closes it.
 */
export function RouteModal({
  path,
  eyebrow,
  title,
  size,
  children,
}: {
  path: string;
  eyebrow: string;
  title: string;
  size?: "default" | "wide";
  children: (nav: {
    /** Where the form would have gone on success: the list, or the new record. */
    onDone: (target: string) => void;
    onCancel: () => void;
  }) => ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  if (pathname !== path) return null;

  const nav = {
    // Replace rather than push: the `/new` entry gives way to the result, so
    // Back from the new record lands where the user started, not on the form.
    onDone: (target: string) => router.replace(target),
    onCancel: () => router.back(),
  };

  return (
    <FormDialog eyebrow={eyebrow} title={title} size={size} onClose={nav.onCancel}>
      {children(nav)}
    </FormDialog>
  );
}
