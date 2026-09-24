import {
  DEFAULT_SALES_INVOICE_LAYOUT,
  type SalesInvoiceBlock,
  type SalesInvoiceLayout,
} from "@repo/api-contract";

/*
 * Pure edits over a sales invoice layout, shared by the settings form and the
 * designer so the two cannot disagree about what "switch a block on" means.
 */

/**
 * A last-page note — bank details, payment terms — offered even though the
 * built-in layout has none. It sits in the bottom margin, where a
 * `repeat: "last"` block must (see `placementIssues`), so switching it on is
 * valid as it comes.
 */
const LAST_PAGE_NOTE: SalesInvoiceBlock = {
  id: "last-page-note",
  type: "notes",
  placement: { mode: "fixed", x: 30, y: 274, w: 135, minH: 8, align: "start", repeat: "last" },
  props: { title: "", text: "" },
};

/** Every block the editors offer: the layout's own, then the known ones it lacks. */
export function catalogue(layout: SalesInvoiceLayout): SalesInvoiceBlock[] {
  const ids = new Set(layout.blocks.map((block) => block.id));
  const hasNotes = layout.blocks.some((block) => block.type === "notes");
  return [
    ...layout.blocks,
    ...DEFAULT_SALES_INVOICE_LAYOUT.blocks.filter((block) => !ids.has(block.id)),
    ...(hasNotes || ids.has(LAST_PAGE_NOTE.id) ? [] : [LAST_PAGE_NOTE]),
  ];
}

/** The order flow blocks read in; a block switched back on returns to its place in it. */
const FLOW_ORDER: readonly SalesInvoiceBlock["type"][] = [
  "meta",
  "parties",
  "lines",
  "totals",
  "notes",
];

export function withBlock(
  layout: SalesInvoiceLayout,
  block: SalesInvoiceBlock,
): SalesInvoiceLayout {
  if (layout.blocks.some((existing) => existing.id === block.id)) return layout;
  if (block.placement.mode === "fixed") return { ...layout, blocks: [...layout.blocks, block] };

  // Array order IS the flow order, so a flow block cannot simply be appended:
  // the parties box would land under the totals.
  const rank = FLOW_ORDER.indexOf(block.type);
  const at = layout.blocks.findIndex(
    (existing) => existing.placement.mode === "flow" && FLOW_ORDER.indexOf(existing.type) > rank,
  );
  const blocks = [...layout.blocks];
  blocks.splice(at === -1 ? blocks.length : at, 0, block);
  return { ...layout, blocks };
}

export function withoutBlock(layout: SalesInvoiceLayout, id: string): SalesInvoiceLayout {
  return { ...layout, blocks: layout.blocks.filter((block) => block.id !== id) };
}

/** The `templates.editor.blockNames` key for a block: two types read differently by their props. */
export function blockNameKey(block: SalesInvoiceBlock): string {
  if (block.type === "letterhead") {
    return block.props.variant === "compact" ? "letterheadCompact" : "letterhead";
  }
  if (block.type === "logo") return block.props.asset === "fsc" ? "logoFsc" : "logoCompany";
  return block.type;
}
