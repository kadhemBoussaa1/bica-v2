"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RouteModal } from "../../route-modal";
import { EditSupplier } from "../../../suppliers/[id]/edit-supplier";

/**
 * Intercepts every in-app navigation to `/suppliers/<segment>`, not only real
 * ids: a static sibling such as `/suppliers/families` must be linked with a
 * plain `<a>`, or it opens here as a supplier that does not exist.
 */
export default function Modal() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("suppliers");
  return (
    <RouteModal path={`/suppliers/${id}`} eyebrow={t("eyebrow")} title={t("editTitle")}>
      {(nav) => <EditSupplier id={id} {...nav} />}
    </RouteModal>
  );
}
