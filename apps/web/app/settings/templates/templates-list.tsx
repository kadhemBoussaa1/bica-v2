"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { canAccess } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useToast } from "@repo/ui/toast";
import { formatDay } from "../../../i18n/formats";
import { useCurrentUser } from "../../auth/use-auth";
import records from "../../records/records.module.css";
import settings from "../settings.module.css";
import { useTRPC } from "../../trpc/client";
import { CreateTemplateDialog } from "./template-dialogs";
import styles from "./templates.module.css";

type Template = inferRouterOutputs<AppRouter>["documentTemplate"]["list"][number];
type Version = Template["versions"][number];

/**
 * Every document template with its version history, one glass section
 * each: a sketch of the sheet, the kind and name, then the versions newest
 * first — which one invoices were printed with, and that a published one
 * is never rewritten. The primary action continues the draft when there is
 * one, else opens the editor (where saving starts a draft).
 */
export function TemplatesList() {
  const trpc = useTRPC();
  const t = useTranslations("templates");
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useCurrentUser();
  const canWrite = user !== null && canAccess(user.role, "SUPER_ADMIN");

  const listQuery = useQuery(trpc.documentTemplate.list.queryOptions());
  const [copying, setCopying] = useState<Template | null>(null);
  const [defaulting, setDefaulting] = useState<Template | null>(null);

  const defaultMutation = useMutation(
    trpc.documentTemplate.setDefault.mutationOptions({
      onSuccess: async (result) => {
        toast.push({ title: t("list.madeDefault", { name: result.name }), tone: "success" });
        setDefaulting(null);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.documentTemplate.list.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.settings.summary.queryKey() }),
        ]);
      },
      onError: (cause) => toast.push({ title: cause.message, tone: "error" }),
    }),
  );

  if (listQuery.isPending) return <p className={records.muted}>{t("loading")}</p>;
  if (listQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {listQuery.error.message}
      </p>
    );
  }

  /** The second line of a version: when and by whom, or that it is still a draft. */
  const metaFor = (version: Version): string => {
    if (version.publishedAt === null) {
      return version.createdBy
        ? t("list.metaDraftBy", { name: version.createdBy.name })
        : t("list.metaDraftBuiltIn");
    }
    const date = formatDay(version.publishedAt);
    return version.createdBy
      ? t("list.metaPublishedBy", { date, name: version.createdBy.name })
      : t("list.metaPublishedBuiltIn", { date });
  };

  return (
    <>
      {!canWrite && <p className={records.notice}>{t("superAdminOnly")}</p>}

      {listQuery.data.map((template) => {
        const newest = template.versions[0];
        const draft = newest && newest.publishedAt === null ? newest : null;
        const published = template.versions.some((version) => version.publishedAt !== null);
        return (
          <section key={template.id} className={settings.section} aria-label={template.name}>
            <div className={styles.template}>
              {/* A sketch of the sheet, not a render: the letterhead mark, a
                  few lines, the navy table band and the total. Decorative. */}
              <div className={styles.sheet} aria-hidden="true">
                <span className={styles.sheetLogo} />
                <span className={[styles.sheetLine, styles.sheetLineLong].filter(Boolean).join(" ")} />
                <span className={[styles.sheetLine, styles.sheetLineShort].filter(Boolean).join(" ")} />
                <span className={styles.sheetBand} />
                <span className={styles.sheetLine} />
                <span className={styles.sheetLine} />
                <span className={styles.sheetLine} />
                <span className={styles.sheetFill} />
                <span className={styles.sheetTotal} />
              </div>

              <div className={styles.templateBody}>
                <div className={styles.kind}>{t(`kinds.${template.kind}`)}</div>
                <div className={styles.nameRow}>
                  <h2 className={styles.name}>{template.name}</h2>
                  {template.isDefault && <span className={styles.tag}>{t("list.default")}</span>}
                </div>

                <ul className={styles.versions} aria-label={t("list.versions")}>
                  {template.versions.map((version) => (
                    <li key={version.id} className={styles.version}>
                      <span
                        className={[
                          styles.versionBadge,
                          version.publishedAt === null ? styles.versionDraft : styles.versionPublished,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {t("list.version", { version: version.version })}
                      </span>
                      <span className={styles.versionText}>
                        <span className={styles.versionState}>
                          {version.publishedAt === null ? t("list.draft") : t("list.publishedState")}
                        </span>
                        <span className={styles.versionMeta}>{metaFor(version)}</span>
                      </span>
                      <span className={styles.versionUses}>
                        {t("list.invoices", { count: version.invoiceCount })}
                      </span>
                    </li>
                  ))}
                </ul>

                {canWrite && (
                  <div className={styles.actions}>
                    <Link href={`/settings/templates/${template.id}`}>
                      <Button variant="primary">
                        {draft ? t("list.continueDraft", { version: draft.version }) : t("list.edit")}
                      </Button>
                    </Link>
                    <Button onClick={() => setCopying(template)}>{t("list.duplicate")}</Button>
                    {!template.isDefault && published && (
                      <Button onClick={() => setDefaulting(template)}>{t("list.setDefault")}</Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        );
      })}

      {copying && (
        <CreateTemplateDialog source={copying} mode="duplicate" onClose={() => setCopying(null)} />
      )}

      <Dialog
        open={defaulting !== null}
        title={t("list.defaultTitle", { name: defaulting?.name ?? "" })}
        confirmLabel={t("list.setDefault")}
        busy={defaultMutation.isPending}
        onConfirm={() => defaulting && defaultMutation.mutate({ id: defaulting.id })}
        onClose={() => !defaultMutation.isPending && setDefaulting(null)}
      >
        <p className={records.muted}>{t("list.defaultBody")}</p>
      </Dialog>
    </>
  );
}
