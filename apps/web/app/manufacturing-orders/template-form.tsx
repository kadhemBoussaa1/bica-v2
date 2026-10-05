"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { MANUFACTURING_ACTIONS_MAX, MANUFACTURING_LABEL_MAX } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { useTRPC } from "../trpc/client";
import records from "../records/records.module.css";
import { HANDLE_KEYS, HandleGlyph, type Handles } from "./manufacturing-ui";
import styles from "./manufacturing.module.css";

export type Template = inferRouterOutputs<AppRouter>["manufacturingTemplate"]["list"][number];

/** A row being edited. `key` is React's, never sent: rows are saved as a whole set. */
interface Row extends Handles {
  key: number;
  label: string;
}

/** A new action offers its people by default: nearly every step names who does it. */
const FRESH: Handles = { handlesEmployees: true, handlesMachine: false, handlesAttachments: false };

/** Row keys only have to differ from one another, so one counter serves every form. */
let nextKey = 0;
const keyed = (row: Handles & { label: string }): Row => ({ ...row, key: nextKey++ });

/**
 * A template's editor, as a side panel over the list: its name, when to use
 * it, and its actions in order — each a name and three switches, movable and
 * removable, with a line at the foot to type the next one. Saving replaces
 * the template's actions wholesale; no OF opened from it changes.
 *
 * A native `<dialog>`, so the browser supplies the focus trap, Escape and
 * the inertness of the page behind it.
 */
export function TemplateForm({ template, onClose }: { template: Template | null; onClose: () => void }) {
  const t = useTranslations("manufacturing");
  const common = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    (template?.actions ?? []).map(({ label, handlesEmployees, handlesMachine, handlesAttachments }) =>
      keyed({ label, handlesEmployees, handlesMachine, handlesAttachments }),
    ),
  );
  const [newStep, setNewStep] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const options = {
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.manufacturingTemplate.list.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.manufacturing.summary.queryKey() }),
      ]);
      onClose();
    },
    onError: (cause: { message: string }) => setError(cause.message),
  };
  const create = useMutation(trpc.manufacturingTemplate.create.mutationOptions(options));
  const update = useMutation(trpc.manufacturingTemplate.update.mutationOptions(options));
  const busy = create.isPending || update.isPending;

  const patch = (key: number, change: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const move = (index: number, by: -1 | 1) =>
    setRows((current) => {
      const next = [...current];
      const [row] = next.splice(index, 1);
      if (row) next.splice(index + by, 0, row);
      return next;
    });
  const addStep = () => {
    const label = newStep.trim();
    if (label === "" || rows.length >= MANUFACTURING_ACTIONS_MAX) return;
    setRows((current) => [...current, keyed({ label, ...FRESH })]);
    setNewStep("");
  };

  const count = (key: keyof Handles) => rows.filter((row) => row[key]).length;
  const problem =
    name.trim() === ""
      ? t("templates.footerNeedName")
      : rows.length === 0
        ? t("templates.footerNeedAction")
        : rows.some((row) => row.label.trim() === "")
          ? t("templates.footerNeedLabels")
          : null;

  const save = () => {
    if (problem !== null) return;
    setError(null);
    const input = {
      name: name.trim(),
      description,
      actions: rows.map(({ label, handlesEmployees, handlesMachine, handlesAttachments }) => ({
        label: label.trim(),
        handlesEmployees,
        handlesMachine,
        handlesAttachments,
      })),
    };
    if (template) update.mutate({ id: template.id, ...input });
    else create.mutate(input);
  };

  const bold = (chunks: ReactNode) => <strong>{chunks}</strong>;
  const close = () => {
    if (!busy) dialogRef.current?.close();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.drawer}
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      aria-labelledby="template-drawer-title"
    >
      <div className={styles.drawerHead}>
        <div className={styles.drawerHeading}>
          <span className={records.eyebrow}>{t("tabs.templates")}</span>
          <h2 id="template-drawer-title" className={styles.drawerTitle}>
            {template ? t("templates.editTitle") : t("templates.createTitle")}
          </h2>
        </div>
        <button type="button" className={styles.drawerClose} onClick={close} aria-label={common("close")}>
          ×
        </button>
      </div>

      <div className={styles.drawerBody}>
        {error && (
          <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
            {error}
          </p>
        )}

        <label className={styles.labelled}>
          <span className={styles.labelText}>{t("templates.name")}</span>
          <input
            className={[styles.input, styles.inputStrong].filter(Boolean).join(" ")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("templates.namePlaceholder")}
            maxLength={120}
            disabled={busy}
            autoFocus
          />
        </label>
        <label className={styles.labelled}>
          <span className={styles.labelText}>
            {t("templates.description")} <span className={styles.optional}>{t("templates.optional")}</span>
          </span>
          <input
            className={styles.input}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("templates.descriptionPlaceholder")}
            maxLength={500}
            disabled={busy}
          />
        </label>

        <div className={styles.stats}>
          <span className={styles.statSolid}>
            {t.rich("templates.stats.actions", { count: rows.length, b: bold })}
          </span>
          <span className={styles.statSolid}>
            {t.rich("templates.stats.employees", { count: count("handlesEmployees"), b: bold })}
          </span>
          <span className={styles.statSolid}>
            {t.rich("templates.stats.machine", { count: count("handlesMachine"), b: bold })}
          </span>
          <span className={styles.statSolid}>
            {t.rich("templates.stats.files", { count: count("handlesAttachments"), b: bold })}
          </span>
        </div>

        <div className={styles.rows}>
          <div className={styles.rowsHead} aria-hidden>
            <span className={styles.rowOrder}>{t("templates.colOrder")}</span>
            <span className={styles.rowGrow}>{t("templates.colAction")}</span>
            <span className={styles.rowToggles}>{t("templates.colHandles")}</span>
            <span className={styles.rowEnd} />
          </div>
          {rows.map((row, index) => (
            <div key={row.key} className={styles.row}>
              <span className={styles.rowOrder}>
                <span className={styles.rowNumber}>{index + 1}</span>
                <span className={styles.rowArrows}>
                  <button
                    type="button"
                    className={styles.arrow}
                    aria-label={t("templates.moveUp")}
                    title={t("templates.moveUp")}
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className={styles.arrow}
                    aria-label={t("templates.moveDown")}
                    title={t("templates.moveDown")}
                    disabled={busy || index === rows.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ▼
                  </button>
                </span>
              </span>
              <input
                className={[styles.input, styles.rowInput].filter(Boolean).join(" ")}
                value={row.label}
                onChange={(event) => patch(row.key, { label: event.target.value })}
                aria-label={t("templates.actionName", { n: index + 1 })}
                maxLength={MANUFACTURING_LABEL_MAX}
                disabled={busy}
              />
              <span className={styles.rowToggles}>
                {HANDLE_KEYS.map(([key, handle]) => (
                  <button
                    key={key}
                    type="button"
                    className={[styles.toggle, row[key] ? styles.toggleOn : null].filter(Boolean).join(" ")}
                    aria-pressed={row[key]}
                    title={t(`handles.${handle}`)}
                    disabled={busy}
                    onClick={() => patch(row.key, { [key]: !row[key] })}
                  >
                    <HandleGlyph name={handle} />
                    {t(`handlesShort.${handle}`)}
                  </button>
                ))}
              </span>
              <button
                type="button"
                className={[styles.rowEnd, styles.rowRemove].filter(Boolean).join(" ")}
                aria-label={t("templates.remove")}
                title={t("templates.remove")}
                disabled={busy}
                onClick={() => setRows((current) => current.filter((other) => other.key !== row.key))}
              >
                ×
              </button>
            </div>
          ))}
          <div className={styles.rowNew}>
            <input
              className={styles.rowNewInput}
              value={newStep}
              onChange={(event) => setNewStep(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addStep();
                }
              }}
              placeholder={t("templates.newStepPlaceholder")}
              aria-label={t("templates.newStepPlaceholder")}
              maxLength={MANUFACTURING_LABEL_MAX}
              disabled={busy || rows.length >= MANUFACTURING_ACTIONS_MAX}
            />
            <Button variant="dark" size="dense" disabled={busy || newStep.trim() === ""} onClick={addStep}>
              {t("templates.addStep")}
            </Button>
          </div>
        </div>

        <p className={styles.infoNote}>
          {template
            ? t("templates.noteUsed", { count: template._count.manufacturingOrders })
            : t("templates.noteNew")}
        </p>
      </div>

      <div className={styles.drawerFoot}>
        <span className={styles.drawerStatus}>
          {problem ?? t("templates.footerReady", { count: rows.length })}
        </span>
        <Button variant="secondary" onClick={close} disabled={busy}>
          {common("cancel")}
        </Button>
        <Button variant="primary" busy={busy} disabled={problem !== null} onClick={save}>
          {template ? t("templates.save") : t("templates.create")}
        </Button>
      </div>
    </dialog>
  );
}
