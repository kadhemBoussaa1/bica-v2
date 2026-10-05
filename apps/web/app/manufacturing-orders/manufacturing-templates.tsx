"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { TableSkeleton } from "@repo/ui/skeleton";
import { useToast } from "@repo/ui/toast";
import { useTRPC } from "../trpc/client";
import records from "../records/records.module.css";
import { HandleIcons } from "./manufacturing-ui";
import { TemplateForm, type Template } from "./template-form";
import styles from "./manufacturing.module.css";

/** How many actions a card lists before "show the others". */
const PREVIEW = 6;

/**
 * The pipeline templates as cards: what each is for, its size at a glance
 * (a strip of one segment per action, tinted by what the action handles),
 * and its first actions. Archived ones stay listed, dimmed, and leave the
 * "Create OF" picker.
 */
export function ManufacturingTemplates() {
  const t = useTranslations("manufacturing");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { push } = useToast();
  // `null` is closed, `"new"` a blank form, a template its editor.
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const templatesQuery = useQuery(trpc.manufacturingTemplate.list.queryOptions());

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.manufacturingTemplate.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.manufacturing.summary.queryKey() }),
    ]);
  const options = {
    onSuccess: refresh,
    onError: (cause: { message: string }) => push({ title: cause.message, tone: "error" as const }),
  };
  const setActive = useMutation(trpc.manufacturingTemplate.setActive.mutationOptions(options));
  const duplicate = useMutation(trpc.manufacturingTemplate.create.mutationOptions(options));
  const busy = setActive.isPending || duplicate.isPending;

  if (templatesQuery.isPending) return <TableSkeleton />;
  if (templatesQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {templatesQuery.error.message}
      </p>
    );
  }

  const bold = (chunks: ReactNode) => <strong>{chunks}</strong>;
  const newButton = (
    <Button variant="primary" onClick={() => setEditing("new")}>
      {t("templates.new")}
    </Button>
  );

  return (
    <>
      {templatesQuery.data.length === 0 ? (
        <EmptyState title={t("templates.empty")} text={t("templates.emptyText")} actions={newButton} />
      ) : (
        <div className={styles.templatesTab}>
          <div className={styles.templatesHead}>
            <p className={styles.templatesIntro}>{t("templates.intro")}</p>
            {newButton}
          </div>
          <div className={styles.templates}>
            {templatesQuery.data.map((template) => {
              const open = expanded.has(template.id);
              const shown = open ? template.actions : template.actions.slice(0, PREVIEW);
              const hidden = template.actions.length - PREVIEW;
              return (
                <article
                  key={template.id}
                  className={[styles.template, template.active ? null : styles.templateArchived]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div>
                    <h2 className={styles.templateName}>
                      {template.name}
                      {!template.active && (
                        <span className={records.archivedTag}>{t("templates.archivedTag")}</span>
                      )}
                    </h2>
                    {template.description && (
                      <p className={styles.templateDescription}>{template.description}</p>
                    )}
                  </div>

                  <div className={styles.stats}>
                    <span className={styles.stat}>
                      {t.rich("templates.stats.actions", { count: template.actions.length, b: bold })}
                    </span>
                    <span className={styles.stat}>
                      {t.rich("templates.stats.machine", {
                        count: template.actions.filter((action) => action.handlesMachine).length,
                        b: bold,
                      })}
                    </span>
                    <span className={styles.stat}>
                      {t.rich("templates.stats.used", {
                        count: template._count.manufacturingOrders,
                        b: bold,
                      })}
                    </span>
                  </div>

                  <div className={styles.strip} aria-hidden>
                    {template.actions.map((action) => (
                      <span
                        key={action.id}
                        className={[
                          styles.seg,
                          action.handlesMachine
                            ? styles.seg_machine
                            : action.handlesAttachments
                              ? styles.seg_files
                              : styles.seg_plain,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        title={action.label}
                      />
                    ))}
                  </div>

                  <ol className={styles.templateSteps}>
                    {shown.map((action, index) => (
                      <li key={action.id} className={styles.templateStep}>
                        <span className={styles.templateStepNumber}>{index + 1}</span>
                        <span className={styles.templateStepLabel}>{action.label}</span>
                        <HandleIcons value={action} toned />
                      </li>
                    ))}
                  </ol>
                  {hidden > 0 && (
                    <button
                      type="button"
                      className={styles.linkBtn}
                      aria-expanded={open}
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (open) next.delete(template.id);
                          else next.add(template.id);
                          return next;
                        })
                      }
                    >
                      {open ? t("templates.showLess") : t("templates.showMore", { count: hidden })}
                    </button>
                  )}

                  <div className={styles.templateActions}>
                    <Button variant="dark" size="dense" disabled={busy} onClick={() => setEditing(template)}>
                      {t("templates.edit")}
                    </Button>
                    <Button
                      size="dense"
                      disabled={busy}
                      onClick={() =>
                        duplicate.mutate({
                          name: t("templates.copyName", { name: template.name }).slice(0, 120),
                          description: template.description ?? undefined,
                          actions: template.actions.map(
                            ({ label, handlesEmployees, handlesMachine, handlesAttachments }) => ({
                              label,
                              handlesEmployees,
                              handlesMachine,
                              handlesAttachments,
                            }),
                          ),
                        })
                      }
                    >
                      {t("templates.duplicate")}
                    </Button>
                    <span className={styles.spacer} />
                    <button
                      type="button"
                      className={[styles.quietBtn, template.active ? styles.quietDanger : null]
                        .filter(Boolean)
                        .join(" ")}
                      disabled={busy}
                      onClick={() => setActive.mutate({ id: template.id, active: !template.active })}
                    >
                      {template.active ? t("templates.archive") : t("templates.restore")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {editing !== null && (
        <TemplateForm
          // A fresh form per template: its state is seeded once, on mount.
          key={editing === "new" ? "new" : editing.id}
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
