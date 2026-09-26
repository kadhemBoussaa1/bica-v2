"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import {
  LAYOUT_ALIGNS,
  LAYOUT_REPEATS,
  PDF_LOCALES,
  SALES_INVOICE_COLUMN_KEYS,
  SALES_INVOICE_META_ROWS,
  SALES_INVOICE_PARTY_BOXES,
  canAccess,
  isPdfLocale,
  salesInvoiceLayoutSchema,
  type SalesInvoiceBlock,
  type SalesInvoiceColumn,
  type SalesInvoiceLayout,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@repo/ui/field";
import { useToast } from "@repo/ui/toast";
import { useCurrentUser } from "../../../auth/use-auth";
import { PdfCanvas } from "../../../documents/pdf-canvas";
import { usePdfPreview } from "../../../documents/use-pdf-preview";
import { Panel } from "../../../records/record-ui";
import { API_URL } from "../../../api-url";
import { useTRPC } from "../../../trpc/client";
import records from "../../../records/records.module.css";
import { blockNameKey, catalogue, withBlock, withoutBlock } from "../layout-edit";
import styles from "../templates.module.css";

type Template = inferRouterOutputs<AppRouter>["documentTemplate"]["byId"];

/** Loads the template, then hands it to the form — keyed so a publish re-seeds it. */
export function TemplateEditor({ id }: { id: string }) {
  const trpc = useTRPC();
  const t = useTranslations("templates");
  const { user } = useCurrentUser();
  const templateQuery = useQuery(trpc.documentTemplate.byId.queryOptions({ id }));

  if (user !== null && !canAccess(user.role, "SUPER_ADMIN")) {
    return <p className={records.notice}>{t("superAdminOnly")}</p>;
  }
  if (templateQuery.isPending) return <p className={records.muted}>{t("loading")}</p>;
  if (templateQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {templateQuery.error.message}
      </p>
    );
  }
  const template = templateQuery.data;
  return (
    <TemplateForm
      key={`${template.id}:${template.editing.version}:${template.editing.draft}`}
      template={template}
    />
  );
}

/**
 * The settings form over a stored layout — docs/sales-invoice-pdf-plan.md,
 * phase 2. It edits the same JSON the designer will drag around, validates it
 * with the same Zod schema the server saves through, and previews it by
 * posting it to the real renderer with the sample invoice.
 *
 * A block switched off leaves `layout.blocks`; the catalogue remembers where
 * it sat so switching it back on restores it rather than dropping it at 0,0.
 */
function TemplateForm({ template }: { template: Template }) {
  const trpc = useTRPC();
  const t = useTranslations("templates");
  const uiLocale = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [layout, setLayout] = useState<SalesInvoiceLayout>(template.layout);
  const [saved, setSaved] = useState(() => JSON.stringify(template.layout));
  const [name, setName] = useState(template.name);
  const [lang, setLang] = useState(isPdfLocale(uiLocale) ? uiLocale : "fr");
  const [status, setStatus] = useState<"ISSUED" | "DRAFT">("ISSUED");
  const [confirmPublish, setConfirmPublish] = useState(false);

  // Every block the form offers: the layout's own, then the known ones it
  // lacks. Built once from the layout as loaded, so an off block keeps the
  // placement it had when it was switched off.
  const [known, setKnown] = useState<SalesInvoiceBlock[]>(() => catalogue(template.layout));

  const parsed = useMemo(() => salesInvoiceLayoutSchema.safeParse(layout), [layout]);
  const serialized = JSON.stringify(layout);
  const dirty = serialized !== saved;
  const nextVersion = template.editing.draft
    ? template.editing.version
    : template.editing.version + 1;

  const preview = usePdfPreview(
    `${API_URL}/documents/sales-invoice/preview.pdf`,
    // An invalid layout sends nothing: the last good frame stays up.
    parsed.success ? JSON.stringify({ source: "sample", lang, status, layout: parsed.data }) : null,
  );

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.documentTemplate.byId.queryKey({ id: template.id }),
      }),
      queryClient.invalidateQueries({ queryKey: trpc.documentTemplate.list.queryKey() }),
    ]);

  const saveMutation = useMutation(
    trpc.documentTemplate.saveVersion.mutationOptions({
      onError: (cause) => toast.push({ title: cause.message, tone: "error" }),
    }),
  );
  const publishMutation = useMutation(
    trpc.documentTemplate.publish.mutationOptions({
      onError: (cause) => toast.push({ title: cause.message, tone: "error" }),
    }),
  );
  const renameMutation = useMutation(
    trpc.documentTemplate.rename.mutationOptions({
      onSuccess: async () => {
        toast.push({ title: t("editor.renamed"), tone: "success" });
        await invalidate();
      },
      onError: (cause) => toast.push({ title: cause.message, tone: "error" }),
    }),
  );
  const busy = saveMutation.isPending || publishMutation.isPending;

  const save = async () => {
    if (!parsed.success) return null;
    const result = await saveMutation.mutateAsync({ templateId: template.id, layout: parsed.data });
    setSaved(JSON.stringify(layout));
    return result;
  };

  const onSave = async () => {
    try {
      const result = await save();
      if (result)
        toast.push({ title: t("editor.savedToast", { version: result.version }), tone: "success" });
      await invalidate();
    } catch {
      // The mutation's onError has shown the message.
    }
  };

  const onPublish = async () => {
    try {
      // A published version with nothing new would have no draft to freeze.
      if (dirty || !template.editing.draft) await save();
      const result = await publishMutation.mutateAsync({ templateId: template.id });
      toast.push({
        title: t("editor.publishedToast", { version: result.version }),
        tone: "success",
      });
      setConfirmPublish(false);
      await invalidate();
    } catch {
      // Shown by onError; the dialog stays open.
    }
  };

  const setBlock = (id: string, change: (block: SalesInvoiceBlock) => SalesInvoiceBlock) => {
    setLayout((current) => ({
      ...current,
      blocks: current.blocks.map((block) => (block.id === id ? change(block) : block)),
    }));
    setKnown((current) => current.map((block) => (block.id === id ? change(block) : block)));
  };

  const toggle = (block: SalesInvoiceBlock, on: boolean) =>
    setLayout((current) => (on ? withBlock(current, block) : withoutBlock(current, block.id)));

  const setMargin = (key: "top" | "bottom" | "start" | "end", value: number) =>
    setLayout((current) => ({
      ...current,
      page: { ...current.page, margins: { ...current.page.margins, [key]: value } },
    }));

  // Problems grouped under the block they belong to; the rest shown on top.
  const issuesByBlock = new Map<string, string[]>();
  const pageIssues: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [root, index] = issue.path;
      const block =
        root === "blocks" && typeof index === "number" ? layout.blocks[index] : undefined;
      if (block)
        issuesByBlock.set(block.id, [...(issuesByBlock.get(block.id) ?? []), issue.message]);
      else pageIssues.push(issue.message);
    }
  }

  const present = new Set(layout.blocks.map((block) => block.id));
  const shown = [...layout.blocks, ...known.filter((block) => !present.has(block.id))];

  return (
    <div className={records.detailLayout}>
      <div className={records.detailMain}>
        <Panel title={t("editor.panels.template")}>
          <p className={styles.status}>
            {template.editing.draft
              ? t("editor.editingDraft", { version: template.editing.version })
              : t("editor.editingPublished", {
                  version: template.editing.version,
                  next: template.editing.version + 1,
                })}
          </p>
          <div className={styles.fieldGrid}>
            <TextField
              label={t("editor.name")}
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
            <Button
              disabled={name.trim() === "" || name.trim() === template.name}
              busy={renameMutation.isPending}
              onClick={() => renameMutation.mutate({ id: template.id, name: name.trim() })}
            >
              {t("editor.rename")}
            </Button>
          </div>
          <div className={styles.actionsRow}>
            <Button
              variant="primary"
              disabled={!dirty || !parsed.success}
              busy={saveMutation.isPending}
              onClick={() => void onSave()}
            >
              {dirty ? t("editor.save") : t("editor.saved")}
            </Button>
            <Button
              disabled={!parsed.success || busy || (!dirty && !template.editing.draft)}
              onClick={() => setConfirmPublish(true)}
            >
              {t("editor.publish")}
            </Button>
            {/* The designer loads the saved draft, so unsaved edits here would not follow. */}
            {dirty ? (
              <Button disabled title={t("designer.unsaved")}>
                {t("editor.openDesigner")}
              </Button>
            ) : (
              <Link href={`/settings/templates/${template.id}/designer`}>
                <Button>{t("editor.openDesigner")}</Button>
              </Link>
            )}
          </div>
        </Panel>

        <Panel title={t("editor.panels.page")}>
          <div className={styles.fieldGrid}>
            {(["top", "bottom", "start", "end"] as const).map((key) => (
              <MmField
                key={key}
                label={t(`editor.page.${key}`)}
                value={layout.page.margins[key]}
                onChange={(value) => setMargin(key, value)}
              />
            ))}
            <MmField
              label={t("editor.page.firstPageTop")}
              value={layout.page.firstPageTop ?? layout.page.margins.top}
              onChange={(value) =>
                setLayout((current) => ({
                  ...current,
                  page: { ...current.page, firstPageTop: value },
                }))
              }
            />
          </div>
          <p className={records.hint}>{t("editor.page.hint")}</p>
        </Panel>

        <Panel title={t("editor.panels.blocks")}>
          {pageIssues.length > 0 && (
            <div className={styles.issues} role="alert">
              {t("editor.invalid")}
              <ul>
                {pageIssues.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}
          <div className={styles.blockList}>
            {shown.map((block) => (
              <BlockCard
                key={block.id}
                block={block}
                on={present.has(block.id)}
                issues={issuesByBlock.get(block.id) ?? []}
                onToggle={(on) => toggle(block, on)}
                onChange={(change) => setBlock(block.id, change)}
              />
            ))}
          </div>
        </Panel>
      </div>

      <aside className={records.detailRail}>
        <Panel title={t("editor.panels.preview")}>
          <div className={styles.previewControls}>
            <SelectField
              size="dense"
              label={t("editor.previewLang")}
              value={lang}
              options={PDF_LOCALES.map((value) => ({ value, label: value.toUpperCase() }))}
              onChange={(event) => isPdfLocale(event.target.value) && setLang(event.target.value)}
            />
            <SelectField
              size="dense"
              label={t("editor.previewAs")}
              value={status}
              options={[
                { value: "ISSUED", label: t("editor.asIssued") },
                { value: "DRAFT", label: t("editor.asDraft") },
              ]}
              onChange={(event) => setStatus(event.target.value === "DRAFT" ? "DRAFT" : "ISSUED")}
            />
          </div>
          <PdfCanvas
            data={preview.data}
            stale={preview.pending || !parsed.success}
            label={t("editor.previewPage", { page: "{page}" })}
            errorLabel={t("editor.previewError")}
          />
          <p className={records.hint} aria-live="polite">
            {preview.error ?? t("editor.previewHint")}
          </p>
        </Panel>
      </aside>

      <Dialog
        open={confirmPublish}
        title={t("editor.publishTitle", { version: nextVersion })}
        confirmLabel={t("editor.publish")}
        busy={busy}
        onConfirm={() => void onPublish()}
        onClose={() => !busy && setConfirmPublish(false)}
      >
        <p className={records.muted}>
          {template.isDefault ? t("editor.publishBodyDefault") : t("editor.publishBody")}
        </p>
      </Dialog>
    </div>
  );
}

/** A millimetre figure. An emptied field reads as 0 rather than NaN. */
function MmField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <TextField
      size="dense"
      type="number"
      inputMode="decimal"
      step={0.5}
      min={0}
      label={label}
      unit="mm"
      value={String(value)}
      onChange={(event) =>
        onChange(Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0)
      }
    />
  );
}

function BlockCard({
  block,
  on,
  issues,
  onToggle,
  onChange,
}: {
  block: SalesInvoiceBlock;
  on: boolean;
  issues: string[];
  onToggle: (on: boolean) => void;
  onChange: (change: (block: SalesInvoiceBlock) => SalesInvoiceBlock) => void;
}) {
  const t = useTranslations("templates.editor");
  // One lines table, always: the schema requires exactly one.
  const required = block.type === "lines";

  return (
    <section
      className={styles.block}
      data-off={on ? undefined : ""}
      data-invalid={issues.length > 0 ? "" : undefined}
    >
      <div className={styles.blockHead}>
        <h3 className={styles.blockName}>{t(`blockNames.${blockNameKey(block)}`)}</h3>
        <span className={styles.blockMeta}>
          {block.placement.mode === "fixed" ? t(`repeats.${block.placement.repeat}`) : null}
        </span>
        {required ? (
          <span className={styles.blockMeta}>{t("block.required")}</span>
        ) : (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={on}
              onChange={(event) => onToggle(event.target.checked)}
            />
            {t("block.show")}
          </label>
        )}
      </div>

      {issues.length > 0 && (
        <ul className={styles.issues} role="alert">
          {issues.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {on && (
        <div className={styles.blockBody}>
          <BlockOptions block={block} onChange={onChange} />
          <PlacementFields block={block} onChange={onChange} />
        </div>
      )}
    </section>
  );
}

/** The options each block type has. Exhaustive: a new block type does not compile until it is handled. */
function BlockOptions({
  block,
  onChange,
}: {
  block: SalesInvoiceBlock;
  onChange: (change: (block: SalesInvoiceBlock) => SalesInvoiceBlock) => void;
}) {
  const t = useTranslations("templates.editor");

  switch (block.type) {
    case "letterhead":
    case "logo":
    case "pageNumber":
      return null;

    case "meta":
      return (
        <div className={styles.checks}>
          <Check
            label={t("meta.showTitle")}
            checked={block.props.showTitle}
            onChange={(showTitle) =>
              onChange((b) => (b.type === "meta" ? { ...b, props: { ...b.props, showTitle } } : b))
            }
          />
          {SALES_INVOICE_META_ROWS.map((row) => (
            <Check
              key={row}
              label={t(`meta.${row}`)}
              checked={block.props.rows.includes(row)}
              onChange={(checked) =>
                onChange((b) =>
                  b.type === "meta"
                    ? {
                        ...b,
                        props: {
                          ...b.props,
                          // Catalogue order, so ticking a row back on never reorders the box.
                          rows: SALES_INVOICE_META_ROWS.filter((candidate) =>
                            candidate === row ? checked : b.props.rows.includes(candidate),
                          ),
                        },
                      }
                    : b,
                )
              }
            />
          ))}
        </div>
      );

    case "parties":
      return (
        <div className={styles.checks}>
          {SALES_INVOICE_PARTY_BOXES.map((box) => (
            <Check
              key={box}
              label={t(`parties.${box}`)}
              checked={block.props.boxes.includes(box)}
              onChange={(checked) =>
                onChange((b) => {
                  if (b.type !== "parties") return b;
                  const boxes = SALES_INVOICE_PARTY_BOXES.filter((candidate) =>
                    candidate === box ? checked : b.props.boxes.includes(candidate),
                  );
                  // At least one box: an empty parties block is switched off instead.
                  return boxes.length === 0 ? b : { ...b, props: { boxes } };
                })
              }
            />
          ))}
        </div>
      );

    case "lines":
      return <ColumnsTable block={block} onChange={onChange} />;

    case "totals":
      return (
        <div className={styles.fieldGrid}>
          <SelectField
            size="dense"
            label={t("totals.vat")}
            value={block.props.vat}
            options={[
              { value: "auto", label: t("totals.vatAuto") },
              { value: "always", label: t("totals.vatAlways") },
            ]}
            onChange={(event) =>
              onChange((b) =>
                b.type === "totals"
                  ? { ...b, props: { vat: event.target.value === "always" ? "always" : "auto" } }
                  : b,
              )
            }
          />
        </div>
      );

    case "notes":
      return (
        <>
          <TextField
            size="dense"
            label={t("notes.title")}
            value={block.props.title}
            maxLength={120}
            onChange={(event) =>
              onChange((b) =>
                b.type === "notes" ? { ...b, props: { ...b.props, title: event.target.value } } : b,
              )
            }
          />
          <TextAreaField
            label={t("notes.text")}
            rows={3}
            value={block.props.text}
            maxLength={1500}
            onChange={(event) =>
              onChange((b) =>
                b.type === "notes" ? { ...b, props: { ...b.props, text: event.target.value } } : b,
              )
            }
          />
          <p className={records.hint}>{t("notes.hint")}</p>
        </>
      );

    case "footer":
      return (
        <>
          <TextField
            size="dense"
            label={t("footer.text")}
            value={block.props.text}
            maxLength={500}
            onChange={(event) =>
              onChange((b) =>
                b.type === "footer" ? { ...b, props: { text: event.target.value } } : b,
              )
            }
          />
          <p className={records.hint}>{t("footer.hint")}</p>
        </>
      );

    case "watermark":
      return (
        <div className={styles.fieldGrid}>
          <SelectField
            size="dense"
            label={t("watermark.when")}
            value={block.props.when}
            options={[
              { value: "draft", label: t("watermark.draft") },
              { value: "always", label: t("watermark.always") },
            ]}
            onChange={(event) =>
              onChange((b) =>
                b.type === "watermark"
                  ? { ...b, props: { when: event.target.value === "always" ? "always" : "draft" } }
                  : b,
              )
            }
          />
        </div>
      );

    default: {
      const unreachable: never = block;
      return unreachable;
    }
  }
}

/** Which columns the lines table shows, how wide, and which hide when empty. */
function ColumnsTable({
  block,
  onChange,
}: {
  block: Extract<SalesInvoiceBlock, { type: "lines" }>;
  onChange: (change: (block: SalesInvoiceBlock) => SalesInvoiceBlock) => void;
}) {
  const t = useTranslations("templates.editor");
  const byKey = new Map(block.props.columns.map((column) => [column.key, column]));

  const setColumns = (change: (columns: SalesInvoiceColumn[]) => SalesInvoiceColumn[]) =>
    onChange((b) =>
      b.type === "lines" ? { ...b, props: { ...b.props, columns: change(b.props.columns) } } : b,
    );

  return (
    <>
      <Check
        label={t("lines.zebra")}
        checked={block.props.zebra}
        onChange={(zebra) =>
          onChange((b) => (b.type === "lines" ? { ...b, props: { ...b.props, zebra } } : b))
        }
      />
      <table className={styles.columns}>
        <thead>
          <tr>
            <th>{t("lines.column")}</th>
            <th>{t("lines.width")}</th>
            <th>{t("lines.hideWhenEmpty")}</th>
          </tr>
        </thead>
        <tbody>
          {SALES_INVOICE_COLUMN_KEYS.map((key) => {
            const column = byKey.get(key);
            return (
              <tr key={key}>
                <td>
                  <Check
                    label={t(`lines.columns.${key}`)}
                    checked={column !== undefined}
                    onChange={(checked) =>
                      setColumns((columns) =>
                        checked
                          ? // Catalogue order, so the table reads the same however it was built.
                            SALES_INVOICE_COLUMN_KEYS.flatMap((candidate) => {
                              const existing = columns.find((c) => c.key === candidate);
                              if (existing) return [existing];
                              return candidate === key
                                ? [
                                    {
                                      key,
                                      w: 20,
                                      align:
                                        key === "designation" || key === "product"
                                          ? "start"
                                          : "end",
                                    } as const,
                                  ]
                                : [];
                            })
                          : columns.length > 1
                            ? columns.filter((c) => c.key !== key)
                            : columns,
                      )
                    }
                  />
                </td>
                <td>
                  {column && (
                    <input
                      className={styles.columnWidth}
                      type="number"
                      inputMode="decimal"
                      min={4}
                      step={1}
                      aria-label={`${t(`lines.columns.${key}`)} — ${t("lines.width")} (mm)`}
                      value={String(column.w)}
                      onChange={(event) => {
                        const w = Number.isFinite(event.target.valueAsNumber)
                          ? event.target.valueAsNumber
                          : 0;
                        setColumns((columns) =>
                          columns.map((c) => (c.key === key ? { ...c, w } : c)),
                        );
                      }}
                    />
                  )}
                </td>
                <td>
                  {column && (
                    <Check
                      label=""
                      ariaLabel={`${t(`lines.columns.${key}`)} — ${t("lines.hideWhenEmpty")}`}
                      checked={column.hideWhenEmpty ?? false}
                      onChange={(hideWhenEmpty) =>
                        setColumns((columns) =>
                          columns.map((c) => (c.key === key ? { ...c, hideWhenEmpty } : c)),
                        )
                      }
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/** The block's box, in numbers. The designer drags the same values. */
function PlacementFields({
  block,
  onChange,
}: {
  block: SalesInvoiceBlock;
  onChange: (change: (block: SalesInvoiceBlock) => SalesInvoiceBlock) => void;
}) {
  const t = useTranslations("templates.editor");
  const { placement } = block;

  // Placement keys differ by mode, and a block's allowed modes by type; the
  // spread keeps each block's own placement shape, which the cast restates.
  const set = (patch: Record<string, number | string | boolean>) =>
    onChange((b) => ({ ...b, placement: { ...b.placement, ...patch } }) as SalesInvoiceBlock);

  return (
    <details className={styles.position}>
      <summary>{t("block.position")}</summary>
      <div className={styles.fieldGrid}>
        <MmField label={t("block.x")} value={placement.x} onChange={(x) => set({ x })} />
        {placement.mode === "fixed" && (
          <MmField label={t("block.y")} value={placement.y} onChange={(y) => set({ y })} />
        )}
        <MmField label={t("block.w")} value={placement.w} onChange={(w) => set({ w })} />
        {placement.mode === "fixed" ? (
          <MmField
            label={t("block.minH")}
            value={placement.minH}
            onChange={(minH) => set({ minH })}
          />
        ) : (
          <MmField
            label={t("block.spaceBefore")}
            value={placement.spaceBefore}
            onChange={(spaceBefore) => set({ spaceBefore })}
          />
        )}
        <SelectField
          size="dense"
          label={t("block.align")}
          value={placement.align}
          options={LAYOUT_ALIGNS.map((value) => ({ value, label: t(`aligns.${value}`) }))}
          onChange={(event) => set({ align: event.target.value })}
        />
        {placement.mode === "fixed" && (
          <SelectField
            size="dense"
            label={t("block.repeat")}
            value={placement.repeat}
            options={LAYOUT_REPEATS.map((value) => ({ value, label: t(`repeats.${value}`) }))}
            onChange={(event) => set({ repeat: event.target.value })}
          />
        )}
      </div>
      {placement.mode === "flow" && block.type !== "lines" && (
        <Check
          label={t("block.keepTogether")}
          checked={placement.keepTogether}
          onChange={(keepTogether) => set({ keepTogether })}
        />
      )}
    </details>
  );
}

function Check({
  label,
  ariaLabel,
  checked,
  onChange,
}: {
  label: string;
  ariaLabel?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.toggle}>
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
