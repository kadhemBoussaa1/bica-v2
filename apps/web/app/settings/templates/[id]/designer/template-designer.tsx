"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import {
  A4_MM,
  LAYOUT_ALIGNS,
  LAYOUT_REPEATS,
  boxFor,
  canAccess,
  drawsOn,
  flowRegion,
  isPdfLocale,
  salesInvoiceLayoutSchema,
  type Placement,
  type SalesInvoiceBlock,
  type SalesInvoiceLayout,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { SelectField, TextField } from "@repo/ui/field";
import { Tabs } from "@repo/ui/tabs";
import { useToast } from "@repo/ui/toast";
import { useCurrentUser } from "../../../../auth/use-auth";
import { PdfCanvas } from "../../../../documents/pdf-canvas";
import { usePdfPreview } from "../../../../documents/use-pdf-preview";
import { Panel } from "../../../../records/record-ui";
import { API_URL } from "../../../../purchasing/document-preview";
import { useTRPC } from "../../../../trpc/client";
import records from "../../../../records/records.module.css";
import { blockNameKey } from "../../layout-edit";
import form from "../../templates.module.css";
import styles from "./designer.module.css";

type Template = inferRouterOutputs<AppRouter>["documentTemplate"]["byId"];

/** Which page of a three-page invoice the stage shows. */
type PageTab = "first" | "middle" | "last";
const PAGE_OF: Record<PageTab, number> = { first: 1, middle: 2, last: 3 };
const PAGES = 3;

/**
 * How tall a flow block is drawn, in mm. Flow blocks have no height in the
 * layout — the content decides — so the stage shows a nominal one. It places
 * nothing: only `x`, `w` and the order are real, and those are what a drag
 * changes. The preview beside the stage is the truth about heights.
 */
const NOMINAL_HEIGHT: Record<SalesInvoiceBlock["type"], number> = {
  letterhead: 40,
  logo: 16,
  meta: 34,
  parties: 28,
  lines: 78,
  totals: 22,
  notes: 20,
  footer: 6,
  pageNumber: 5,
  watermark: 60,
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
/** Snap to the millimetre. */
const snap = (value: number) => Math.round(value);

export function TemplateDesigner({ id }: { id: string }) {
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
    <Designer
      key={`${template.id}:${template.editing.version}:${template.editing.draft}`}
      template={template}
    />
  );
}

interface Drag {
  id: string;
  kind: "move" | "resize";
  startX: number;
  startY: number;
  origin: Placement;
  /** Millimetres per CSS pixel, fixed at pointer-down so a reflow mid-drag cannot skew it. */
  mmPerPx: number;
}

/**
 * The drag-and-drop designer — docs/sales-invoice-pdf-plan.md, phase 3.
 *
 * The same layout JSON as the settings form, the same Zod validation, the
 * same preview endpoint; what it adds is geometry you can see. Fixed blocks
 * move and resize freely. Flow blocks cannot be given a `y` — the content
 * flows — so dragging one sideways changes `x`, its handle changes `w`, and
 * dragging it past a neighbour reorders them.
 *
 * Native pointer events with `setPointerCapture`, no drag library: the whole
 * interaction is "add a delta in mm to a placement", and capture gives
 * mouse, touch and pen the same path. Snap is 1 mm; arrows nudge 1 mm, 5 with
 * Shift; the resize handle is a 48 px target.
 *
 * The stage draws in physical millimetres. `boxFor` is the only thing that
 * mirrors, exactly as in the renderer, so the "Arabic mirror" toggle shows
 * what the PDF will do — and a drag in the mirrored view converts back
 * through the same sign.
 */
function Designer({ template }: { template: Template }) {
  const trpc = useTRPC();
  const t = useTranslations("templates");
  const uiLocale = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [layout, setLayout] = useState<SalesInvoiceLayout>(template.layout);
  const [saved, setSaved] = useState(() => JSON.stringify(template.layout));
  const [tab, setTab] = useState<PageTab>("first");
  const [mirrored, setMirrored] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const parsed = useMemo(() => salesInvoiceLayoutSchema.safeParse(layout), [layout]);
  const dirty = JSON.stringify(layout) !== saved;
  const lang = mirrored ? "ar" : isPdfLocale(uiLocale) && uiLocale !== "ar" ? uiLocale : "fr";

  const preview = usePdfPreview(
    `${API_URL}/documents/sales-invoice/preview.pdf`,
    // Nothing is sent mid-drag or while invalid: the last good frame stays.
    parsed.success && draggingId === null
      ? JSON.stringify({ source: "sample", lang, status: "ISSUED", layout: parsed.data })
      : null,
  );

  const saveMutation = useMutation(
    trpc.documentTemplate.saveVersion.mutationOptions({
      onSuccess: async (result) => {
        setSaved(JSON.stringify(layout));
        toast.push({ title: t("editor.savedToast", { version: result.version }), tone: "success" });
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.documentTemplate.byId.queryKey({ id: template.id }),
          }),
          queryClient.invalidateQueries({ queryKey: trpc.documentTemplate.list.queryKey() }),
        ]);
      },
      onError: (cause) => toast.push({ title: cause.message, tone: "error" }),
    }),
  );

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

  const pageNumber = PAGE_OF[tab];
  const region = flowRegion(layout.page, tab === "first" ? "first" : "other");

  // Where each flow block is drawn: stacked from the top of the flow region
  // at its nominal height. Same on every tab — it is a diagram of the order.
  const flowBlocks = layout.blocks.filter((block) => block.placement.mode === "flow");
  const slots = new Map<string, { top: number; height: number }>();
  {
    let cursor = region.top;
    for (const block of flowBlocks) {
      if (block.placement.mode !== "flow") continue;
      cursor += block.placement.spaceBefore;
      const height = NOMINAL_HEIGHT[block.type];
      slots.set(block.id, { top: cursor, height });
      cursor += height;
    }
  }

  const visible = layout.blocks.filter(
    (block) =>
      block.placement.mode === "flow" || drawsOn(block.placement.repeat, pageNumber, PAGES),
  );
  const selected = layout.blocks.find((block) => block.id === selectedId) ?? null;

  const setPlacement = (id: string, change: (placement: Placement) => Placement) =>
    setLayout((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        // Each block type allows its own placement modes and `change` keeps
        // the mode it was given; the cast restates what the spread preserves.
        block.id === id
          ? ({ ...block, placement: change(block.placement) } as SalesInvoiceBlock)
          : block,
      ),
    }));

  /** Moves a flow block to position `to` among the flow blocks, leaving every fixed block where it is in the array. */
  const reorderFlow = (id: string, to: number) =>
    setLayout((current) => {
      const flows = current.blocks.filter((block) => block.placement.mode === "flow");
      const from = flows.findIndex((block) => block.id === id);
      const target = clamp(to, 0, flows.length - 1);
      if (from === -1 || from === target) return current;
      const moved = flows.splice(from, 1)[0];
      if (!moved) return current;
      flows.splice(target, 0, moved);
      let next = 0;
      return {
        ...current,
        blocks: current.blocks.map((block) =>
          block.placement.mode === "flow" ? (flows[next++] ?? block) : block,
        ),
      };
    });

  const moveBy = (origin: Placement, dxMm: number, dyMm: number): Placement => {
    // In the mirrored view the start edge is the right one: moving the box
    // right brings it closer to the start.
    const sign = mirrored ? -1 : 1;
    const x = clamp(snap(origin.x + sign * dxMm), 0, A4_MM.width - origin.w);
    if (origin.mode === "flow") return { ...origin, x };
    return { ...origin, x, y: clamp(snap(origin.y + dyMm), 0, A4_MM.height - origin.minH) };
  };

  const resizeBy = (origin: Placement, dxMm: number, dyMm: number): Placement => {
    const sign = mirrored ? -1 : 1;
    const w = clamp(snap(origin.w + sign * dxMm), 4, A4_MM.width - origin.x);
    if (origin.mode === "flow") return { ...origin, w };
    return { ...origin, w, minH: clamp(snap(origin.minH + dyMm), 0, A4_MM.height - origin.y) };
  };

  const onPointerDown = (
    event: PointerEvent<HTMLElement>,
    block: SalesInvoiceBlock,
    kind: Drag["kind"],
  ) => {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: block.id,
      kind,
      startX: event.clientX,
      startY: event.clientY,
      origin: block.placement,
      mmPerPx: A4_MM.width / rect.width,
    };
    setSelectedId(block.id);
    setDraggingId(block.id);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active) return;
    const dx = (event.clientX - active.startX) * active.mmPerPx;
    const dy = (event.clientY - active.startY) * active.mmPerPx;
    setPlacement(active.id, () =>
      active.kind === "move" ? moveBy(active.origin, dx, dy) : resizeBy(active.origin, dx, dy),
    );

    // A flow block dragged past the middle of a neighbour takes its place.
    if (active.kind === "move" && active.origin.mode === "flow") {
      const rect = stage.current?.getBoundingClientRect();
      if (!rect) return;
      const pointerY = (event.clientY - rect.top) * active.mmPerPx;
      const others = flowBlocks.filter((block) => block.id !== active.id);
      const to = others.filter((block) => {
        const slot = slots.get(block.id);
        return slot !== undefined && slot.top + slot.height / 2 < pointerY;
      }).length;
      reorderFlow(active.id, to);
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
    setDraggingId(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, block: SalesInvoiceBlock) => {
    const step = event.shiftKey ? 5 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    const [dx, dy] = move;
    // Up and down have no `y` to change on a flow block: they reorder it.
    if (block.placement.mode === "flow" && dy !== 0) {
      const index = flowBlocks.findIndex((candidate) => candidate.id === block.id);
      reorderFlow(block.id, index + Math.sign(dy));
      return;
    }
    setPlacement(block.id, (placement) => moveBy(placement, dx, dy));
  };

  /** A block's box on the stage, in percent of the sheet — so the stage needs no resize listener. */
  const boxOf = (block: SalesInvoiceBlock) => {
    const { left, width } = boxFor(block.placement, mirrored);
    const slot = slots.get(block.id);
    const top = block.placement.mode === "fixed" ? block.placement.y : (slot?.top ?? region.top);
    const height =
      block.placement.mode === "fixed"
        ? Math.max(block.placement.minH, 3)
        : (slot?.height ?? NOMINAL_HEIGHT[block.type]);
    return { left, top, width, height };
  };
  const pct = (box: { left: number; top: number; width: number; height: number }) => ({
    left: `${(box.left / A4_MM.width) * 100}%`,
    top: `${(box.top / A4_MM.height) * 100}%`,
    width: `${(box.width / A4_MM.width) * 100}%`,
    height: `${(box.height / A4_MM.height) * 100}%`,
  });

  const { margins } = layout.page;
  const regionLeft = mirrored ? margins.end : margins.start;
  const selectedBox = selected && visible.includes(selected) ? boxOf(selected) : null;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <Panel title={t("designer.panels.stage")}>
          <div className={styles.toolbar}>
            <Tabs
              label={t("designer.pageTabs")}
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "first", label: t("designer.pages.first") },
                { key: "middle", label: t("designer.pages.middle") },
                { key: "last", label: t("designer.pages.last") },
              ]}
            />
            <span className={styles.toolbarSpacer} />
            <label className={form.toggle}>
              <input
                type="checkbox"
                checked={mirrored}
                onChange={(event) => setMirrored(event.target.checked)}
              />
              {t("designer.mirror")}
            </label>
            <Button
              variant="primary"
              size="dense"
              disabled={!dirty || !parsed.success}
              busy={saveMutation.isPending}
              onClick={() =>
                parsed.success &&
                saveMutation.mutate({ templateId: template.id, layout: parsed.data })
              }
            >
              {dirty ? t("editor.save") : t("editor.saved")}
            </Button>
          </div>

          {pageIssues.length > 0 && (
            <div className={form.issues} role="alert">
              {t("editor.invalid")}
              <ul>
                {pageIssues.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.stageWrap}>
            {/* Physical geometry: left-to-right whatever the app's language. */}
            <div
              ref={stage}
              dir="ltr"
              className={styles.stage}
              onPointerDown={() => setSelectedId(null)}
            >
              <div
                className={styles.margin}
                style={{ top: 0, height: `${(region.top / A4_MM.height) * 100}%` }}
              />
              <div
                className={styles.margin}
                style={{ bottom: 0, height: `${(margins.bottom / A4_MM.height) * 100}%` }}
              />
              <div
                className={styles.region}
                style={pct({
                  left: regionLeft,
                  top: region.top,
                  width: A4_MM.width - margins.start - margins.end,
                  height: region.bottom - region.top,
                })}
              />

              {visible.map((block) => (
                <div
                  key={block.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={block.id === selectedId}
                  aria-label={t("designer.blockLabel", {
                    name: t(`editor.blockNames.${blockNameKey(block)}`),
                    x: block.placement.x,
                    w: block.placement.w,
                  })}
                  className={styles.block}
                  data-mode={block.placement.mode}
                  data-overlay={block.type === "watermark" ? "" : undefined}
                  data-selected={block.id === selectedId ? "" : undefined}
                  data-invalid={issuesByBlock.has(block.id) ? "" : undefined}
                  data-dragging={block.id === draggingId ? "" : undefined}
                  style={pct(boxOf(block))}
                  onPointerDown={(event) => onPointerDown(event, block, "move")}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  onKeyDown={(event) => onKeyDown(event, block)}
                  onFocus={() => setSelectedId(block.id)}
                >
                  {t(`editor.blockNames.${blockNameKey(block)}`)}
                </div>
              ))}

              {selected && selectedBox && (
                <div
                  className={styles.handle}
                  data-mirrored={mirrored ? "" : undefined}
                  aria-hidden="true"
                  style={{
                    // Centred on the block's end corner: bottom right, or
                    // bottom left when mirrored.
                    left: `calc(${((selectedBox.left + (mirrored ? 0 : selectedBox.width)) / A4_MM.width) * 100}% - 24px)`,
                    top: `calc(${((selectedBox.top + selectedBox.height) / A4_MM.height) * 100}% - 24px)`,
                  }}
                  onPointerDown={(event) => onPointerDown(event, selected, "resize")}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                />
              )}
            </div>
          </div>

          <div className={styles.legend}>
            <span>
              <span className={styles.swatch} />
              {t("designer.legend.fixed")}
            </span>
            <span>
              <span className={styles.swatch} data-mode="flow" />
              {t("designer.legend.flow")}
            </span>
            <span>{t("designer.legend.keys")}</span>
          </div>
        </Panel>
      </div>

      <aside className={styles.rail}>
        <Panel title={t("designer.panels.inspector")}>
          {selected ? (
            <Inspector
              block={selected}
              issues={issuesByBlock.get(selected.id) ?? []}
              onChange={(change) => setPlacement(selected.id, change)}
            />
          ) : (
            <p className={records.hint}>{t("designer.nothingSelected")}</p>
          )}
        </Panel>

        <Panel title={t("editor.panels.preview")}>
          <PdfCanvas
            data={preview.data}
            stale={preview.pending || !parsed.success || draggingId !== null}
            label={t("editor.previewPage", { page: "{page}" })}
            errorLabel={t("editor.previewError")}
          />
          <p className={records.hint} aria-live="polite">
            {preview.error ?? t("designer.previewHint")}
          </p>
        </Panel>
      </aside>
    </div>
  );
}

/** The selected block's box in numbers — the precise way to set what a drag approximates. */
function Inspector({
  block,
  issues,
  onChange,
}: {
  block: SalesInvoiceBlock;
  issues: string[];
  onChange: (change: (placement: Placement) => Placement) => void;
}) {
  const t = useTranslations("templates");
  const { placement } = block;

  const field = (
    label: string,
    value: number,
    apply: (placement: Placement, value: number) => Placement,
  ) => (
    <TextField
      size="dense"
      type="number"
      inputMode="decimal"
      step={0.5}
      min={0}
      label={label}
      unit="mm"
      value={String(value)}
      onChange={(event) => {
        const next = Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0;
        onChange((current) => apply(current, next));
      }}
    />
  );

  return (
    <>
      <h3 className={styles.inspectorName}>{t(`editor.blockNames.${blockNameKey(block)}`)}</h3>
      {issues.length > 0 && (
        <ul className={form.issues} role="alert">
          {issues.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      <div className={form.fieldGrid}>
        {field(t("editor.block.x"), placement.x, (p, x) => ({ ...p, x }))}
        {placement.mode === "fixed" &&
          field(t("editor.block.y"), placement.y, (p, y) => (p.mode === "fixed" ? { ...p, y } : p))}
        {field(t("editor.block.w"), placement.w, (p, w) => ({ ...p, w }))}
        {placement.mode === "fixed"
          ? field(t("editor.block.minH"), placement.minH, (p, minH) =>
              p.mode === "fixed" ? { ...p, minH } : p,
            )
          : field(t("editor.block.spaceBefore"), placement.spaceBefore, (p, spaceBefore) =>
              p.mode === "flow" ? { ...p, spaceBefore } : p,
            )}
        <SelectField
          size="dense"
          label={t("editor.block.align")}
          value={placement.align}
          options={LAYOUT_ALIGNS.map((value) => ({ value, label: t(`editor.aligns.${value}`) }))}
          onChange={(event) => {
            const align = LAYOUT_ALIGNS.find((value) => value === event.target.value);
            if (align) onChange((current) => ({ ...current, align }));
          }}
        />
        {placement.mode === "fixed" && (
          <SelectField
            size="dense"
            label={t("editor.block.repeat")}
            value={placement.repeat}
            options={LAYOUT_REPEATS.map((value) => ({
              value,
              label: t(`editor.repeats.${value}`),
            }))}
            onChange={(event) => {
              const repeat = LAYOUT_REPEATS.find((value) => value === event.target.value);
              if (repeat)
                onChange((current) =>
                  current.mode === "fixed" ? { ...current, repeat } : current,
                );
            }}
          />
        )}
      </div>
    </>
  );
}
