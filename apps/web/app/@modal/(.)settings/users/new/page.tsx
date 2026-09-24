"use client";

import { useTranslations } from "next-intl";
import { RouteModal } from "../../../route-modal";
import { NewUserForm } from "../../../../settings/users/new/new-user-form";

export default function Modal() {
  const t = useTranslations("users");
  return (
    <RouteModal path="/settings/users/new" eyebrow={t("eyebrow")} title={t("newUser")}>
      {(nav) => <NewUserForm {...nav} />}
    </RouteModal>
  );
}
