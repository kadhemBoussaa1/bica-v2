"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { canAccess } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { useCurrentUser } from "../../auth/use-auth";
import { useTRPC } from "../../trpc/client";
import { CreateTemplateDialog } from "./template-dialogs";

/**
 * The page's primary action: a new template, started from the default
 * one's newest layout. Super admins only, like every template write; the
 * button waits for the list (shared with the page below) to know which
 * template is the default.
 */
export function NewTemplateButton() {
  const t = useTranslations("templates");
  const trpc = useTRPC();
  const { user } = useCurrentUser();
  const [open, setOpen] = useState(false);

  const listQuery = useQuery({
    ...trpc.documentTemplate.list.queryOptions(),
    enabled: user !== null && canAccess(user.role, "SUPER_ADMIN"),
  });

  if (!user || !canAccess(user.role, "SUPER_ADMIN")) return null;
  const source = listQuery.data?.find((template) => template.isDefault) ?? listQuery.data?.[0];

  return (
    <>
      <Button variant="primary" disabled={source === undefined} onClick={() => setOpen(true)}>
        {t("newTemplate")}
      </Button>
      {open && source && (
        <CreateTemplateDialog source={source} mode="new" onClose={() => setOpen(false)} />
      )}
    </>
  );
}
