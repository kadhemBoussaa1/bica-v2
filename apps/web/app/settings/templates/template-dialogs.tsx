"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "@repo/ui/dialog";
import { TextField } from "@repo/ui/field";
import { useToast } from "@repo/ui/toast";
import { useTRPC } from "../../trpc/client";
import records from "../../records/records.module.css";

/**
 * Names a new template and creates it from `source`'s newest layout. The
 * one creation path there is: the header's "New template" seeds it with the
 * default template, a row's "Duplicate" with that row. Rendered only while
 * open — mounting it is opening it.
 */
export function CreateTemplateDialog({
  source,
  mode,
  onClose,
}: {
  source: { id: string; name: string };
  mode: "new" | "duplicate";
  onClose: () => void;
}) {
  const t = useTranslations("templates");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");

  const create = useMutation(
    trpc.documentTemplate.create.mutationOptions({
      onSuccess: async () => {
        toast.push({ title: t("list.created"), tone: "success" });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.documentTemplate.list.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.settings.summary.queryKey() }),
        ]);
        onClose();
      },
      onError: (cause) => toast.push({ title: cause.message, tone: "error" }),
    }),
  );

  return (
    <Dialog
      open
      title={mode === "new" ? t("list.newTitle") : t("list.duplicateTitle", { name: source.name })}
      confirmLabel={t("list.create")}
      busy={create.isPending}
      onConfirm={() => {
        if (name.trim() !== "") create.mutate({ name: name.trim(), fromTemplateId: source.id });
      }}
      onClose={() => !create.isPending && onClose()}
    >
      <p className={records.muted}>{mode === "new" ? t("list.newBody") : t("list.duplicateBody")}</p>
      <TextField
        label={t("list.name")}
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
      />
    </Dialog>
  );
}
