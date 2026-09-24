import { z } from "zod";

/**
 * Where a generated document's blocks sit on the page, as data — the part of
 * a template that is the same for every document kind. The block types and
 * their bindings are per kind (`document-layout-sales-invoice.ts`).
 *
 * Everything is in millimetres on a portrait A4, measured from the page's
 * inline-start edge: `x` is a start offset, not a left one, so one stored
 * layout prints both ways round. `boxFor` is the single place that turns it
 * into a physical `left`; nothing else may mirror.
 *
 * Two placement modes:
 *
 * - `fixed` — page furniture with a box of its own (`x, y, w, minH`), drawn on
 *   the pages `repeat` names. `minH` is a minimum: text grows past it.
 * - `flow` — the document's content, in array order, inside the page margins.
 *   A flow block has no `y`; it follows whatever came before it, which is what
 *   lets a 40-line table push the totals to page two.
 *
 * Page geometry has two classes only, **first** and **other**. The pagination
 * engine (`Page.layout` in react-pdf 4.9) runs exactly two rounds — once with
 * the page count unknown, once with the first round's count, never re-checked
 * — so a flow region that was shorter on the last page could push a row onto a
 * new page and leave "last" chrome on a page that no longer is. The bottom
 * margin is therefore reserved on every page, and `repeat: "last"` decides
 * only what is *drawn* in it. The first page is known in both rounds, so a
 * taller first-page top is safe.
 *
 * Every number and array here is bounded. From the template settings onward a
 * layout is client-supplied, and an unbounded one is an expensive render.
 */

/** The `schemaVersion` a layout written today carries. */
export const LAYOUT_SCHEMA_VERSION = 1;

/** Portrait A4, in millimetres. */
export const A4_MM = { width: 210, height: 297 } as const;

/** PDF points per millimetre. */
export const PT_PER_MM = 72 / 25.4;

const mmX = z.number().min(0).max(A4_MM.width);
const mmY = z.number().min(0).max(A4_MM.height);

export const pageSchema = z.object({
  size: z.literal("A4"),
  /** The flow region's inset on every page; `bottom` is never per-page. */
  margins: z.object({
    top: mmY,
    bottom: mmY,
    start: mmX,
    end: mmX,
  }),
  /** Replaces `margins.top` on page one, to clear a full letterhead. */
  firstPageTop: mmY.optional(),
});
export type LayoutPage = z.infer<typeof pageSchema>;

/** Inline alignment inside a block's box; `start` follows the language. */
export const LAYOUT_ALIGNS = ["start", "center", "end"] as const;
export type LayoutAlign = (typeof LAYOUT_ALIGNS)[number];

/** Which pages a fixed block is drawn on. */
export const LAYOUT_REPEATS = ["all", "first", "notFirst", "last"] as const;
export type LayoutRepeat = (typeof LAYOUT_REPEATS)[number];

export const fixedPlacement = z.object({
  mode: z.literal("fixed"),
  x: mmX,
  y: mmY,
  w: mmX.min(1),
  minH: mmY,
  align: z.enum(LAYOUT_ALIGNS),
  repeat: z.enum(LAYOUT_REPEATS),
});
export type FixedPlacement = z.infer<typeof fixedPlacement>;

export const flowPlacement = z.object({
  mode: z.literal("flow"),
  x: mmX,
  w: mmX.min(1),
  align: z.enum(LAYOUT_ALIGNS),
  /** Gap above the block, in mm. */
  spaceBefore: z.number().min(0).max(100),
  /** Never split across pages; the lines table is the one block that must. */
  keepTogether: z.boolean(),
});
export type FlowPlacement = z.infer<typeof flowPlacement>;

export type Placement = FixedPlacement | FlowPlacement;

/** The two page classes whose geometry can differ. */
export type PageClass = "first" | "other";

/** The page classes a `repeat` value can land on. */
export function pageClassesOf(repeat: LayoutRepeat): readonly PageClass[] {
  if (repeat === "first") return ["first"];
  if (repeat === "notFirst") return ["other"];
  // A one-page document's last page is its first.
  return ["first", "other"];
}

/** The flow region of a page class: `top` and `bottom` are y coordinates in mm. */
export function flowRegion(page: LayoutPage, pageClass: PageClass): { top: number; bottom: number } {
  const top = pageClass === "first" ? (page.firstPageTop ?? page.margins.top) : page.margins.top;
  return { top, bottom: A4_MM.height - page.margins.bottom };
}

/** Whether a fixed block is drawn on this page. `totalPages` is unknown in the engine's first round. */
export function drawsOn(
  repeat: LayoutRepeat,
  pageNumber: number,
  totalPages: number | undefined,
): boolean {
  switch (repeat) {
    case "all":
      return true;
    case "first":
      return pageNumber === 1;
    case "notFirst":
      return pageNumber > 1;
    case "last":
      return totalPages !== undefined && pageNumber === totalPages;
  }
}

/**
 * A placement's physical horizontal box, in mm. The one place a layout is
 * mirrored for a right-to-left document: `left = 210 - x - w`. It always
 * answers with a physical `left`, so a renderer never has to know which way
 * the page reads.
 */
export function boxFor(placement: Placement, rtl: boolean): { left: number; width: number } {
  const left = rtl ? A4_MM.width - placement.x - placement.w : placement.x;
  return { left, width: placement.w };
}

/** `start`/`end` resolved to the physical side for this reading direction. */
export function physicalAlign(align: LayoutAlign, rtl: boolean): "left" | "center" | "right" {
  if (align === "center") return "center";
  return (align === "start") !== rtl ? "left" : "right";
}

/**
 * The geometry problems of one placement, as messages; empty when it is sound.
 * `overlay` is for a block meant to sit on top of the content (a watermark),
 * which is exempt from the keep-clear rule and from nothing else.
 */
export function placementIssues(
  page: LayoutPage,
  placement: Placement,
  overlay = false,
): string[] {
  const issues: string[] = [];
  if (placement.x + placement.w > A4_MM.width + 1e-6) {
    issues.push("The block runs past the page's edge");
  }

  if (placement.mode === "flow") {
    if (
      placement.x < page.margins.start - 1e-6 ||
      placement.x + placement.w > A4_MM.width - page.margins.end + 1e-6
    ) {
      issues.push("A flow block must sit inside the side margins");
    }
    return issues;
  }

  if (placement.y + placement.minH > A4_MM.height + 1e-6) {
    issues.push("The block runs past the bottom of the page");
  }
  if (overlay) return issues;
  const bottomBand = A4_MM.height - page.margins.bottom;
  if (placement.repeat === "last" && placement.y < bottomBand - 1e-6) {
    // The band is reserved on every page precisely so this block can never
    // change the page count; anywhere else it would sit on top of content.
    issues.push("A last-page block must sit inside the bottom margin");
    return issues;
  }
  for (const pageClass of pageClassesOf(placement.repeat)) {
    const region = flowRegion(page, pageClass);
    const above = placement.y + placement.minH <= region.top + 1e-6;
    const below = placement.y >= region.bottom - 1e-6;
    if (!above && !below) {
      issues.push(
        pageClass === "first"
          ? "The block overlaps the content area of the first page"
          : "The block overlaps the content area of the following pages",
      );
    }
  }
  return issues;
}
