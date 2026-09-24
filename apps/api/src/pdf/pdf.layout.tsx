import { closeSync, openSync, readSync } from "node:fs";
import type { ReactNode } from "react";
import { Image, Page, View } from "@react-pdf/renderer";
import {
  A4_MM,
  PT_PER_MM,
  boxFor,
  type FixedPlacement,
  type FlowPlacement,
  type LayoutPage as PageGeometry,
} from "@repo/api-contract";
import { INK } from "./pdf.identity";

/*
 * A stored layout, drawn: the page template, a fixed block and a flow block.
 *
 * `Page.layout` (react-pdf 4.9, experimental) is confined to `LayoutPage`. If
 * it has to go, the fallback is the legacy engine with uniform padding and a
 * first-page spacer, which the two-class geometry maps onto exactly — nothing
 * outside this file would change.
 *
 * What the rendering spike settled (docs/sales-invoice-pdf-plan.md, step 0):
 *
 * - The flow region MUST be padding on a growing View, never a box with a
 *   height. Content is measured once inside the template; in a fixed-height
 *   box flex-shrink squashed forty rows onto page one.
 * - The template is called with `pageNumber` and `totalPages`, so page chrome
 *   needs no `render` prop. `totalPages` is undefined in the engine's first
 *   round; what is printed comes from the second.
 * - A `fixed` row inside a wrapping View repeats on every page it runs onto.
 *
 * And two things the first real render found, both about the template being
 * instantiated *after* the normal style and asset passes have run:
 *
 * - A unitless `lineHeight` is resolved where it is declared, against that
 *   node's own `fontSize` (or the 18pt default when it has none), and one
 *   inherited from the Page into the template is resolved twice: 1.4 on the
 *   page came out as 1.4 x 8 x 8 pt and spread a letterhead down the sheet.
 *   So the Page carries no `lineHeight`; every block sets `TEXT` — size and
 *   leading together, on one node — which resolves to the intended 11.2pt.
 * - An `Image` in the template is measured before it is fetched, so without
 *   an explicit height it collapses to nothing. `TemplateImage` reads the
 *   bundled PNG's own size and always passes both dimensions.
 */

/** Body text. Size and leading on the same node, always — see the note above. */
const TEXT = { fontSize: 8, lineHeight: 1.4 } as const;

/** Millimetres to PDF points. */
export const mm = (value: number): number => value * PT_PER_MM;

/** What the page template knows about the page it is drawing. */
export interface PageContext {
  pageNumber: number;
  /** Undefined in the engine's first round. */
  totalPages: number | undefined;
}

export function LayoutPage({
  page,
  rtl,
  fontFamily,
  chrome,
  overlay,
  children,
}: {
  page: PageGeometry;
  rtl: boolean;
  fontFamily: string;
  /** The fixed blocks of one page. Like a render prop, it may not use hooks. */
  chrome: (context: PageContext) => ReactNode;
  /** Fixed blocks drawn over the content rather than under it — a watermark, which zebra rows would otherwise cover. */
  overlay?: (context: PageContext) => ReactNode;
  children: ReactNode;
}) {
  const { margins } = page;
  return (
    <Page
      size="A4"
      // No `lineHeight` here — see the note at the top of this file.
      style={{ fontFamily, fontSize: TEXT.fontSize, color: INK.text }}
      layout={({ children: content, pageNumber, totalPages }) => (
        <View
          style={{
            flexGrow: 1,
            paddingTop: mm((pageNumber ?? 1) === 1 ? (page.firstPageTop ?? margins.top) : margins.top),
            // Never per page: see `document-layout.ts` on the two-round engine.
            paddingBottom: mm(margins.bottom),
            paddingLeft: mm(rtl ? margins.end : margins.start),
            paddingRight: mm(rtl ? margins.start : margins.end),
          }}
        >
          {chrome({ pageNumber: pageNumber ?? 1, totalPages })}
          {content}
          {overlay?.({ pageNumber: pageNumber ?? 1, totalPages })}
        </View>
      )}
    >
      {children}
    </Page>
  );
}

/** Page furniture at its own box. `minH` is a minimum: text grows past it. */
export function FixedBlock({
  placement,
  rtl,
  children,
}: {
  placement: FixedPlacement;
  rtl: boolean;
  children: ReactNode;
}) {
  const box = boxFor(placement, rtl);
  return (
    <View
      style={{
        position: "absolute",
        top: mm(placement.y),
        left: mm(box.left),
        width: mm(box.width),
        minHeight: mm(placement.minH),
        ...TEXT,
      }}
    >
      {children}
    </View>
  );
}

/**
 * Content at its place in the flow. The horizontal offset is a margin from
 * the region's physical left edge, so the region itself keeps one width on
 * every page — the engine measures content once, at that width.
 */
export function FlowBlock({
  placement,
  page,
  rtl,
  children,
}: {
  placement: FlowPlacement;
  page: PageGeometry;
  rtl: boolean;
  children: ReactNode;
}) {
  const box = boxFor(placement, rtl);
  const regionLeft = rtl ? page.margins.end : page.margins.start;
  return (
    <View
      wrap={!placement.keepTogether}
      style={{
        marginTop: mm(placement.spaceBefore),
        marginLeft: mm(Math.max(0, box.left - regionLeft)),
        width: mm(Math.min(box.width, A4_MM.width)),
        // Measured once inside the template; shrinking is never wanted.
        flexShrink: 0,
        ...TEXT,
      }}
    >
      {children}
    </View>
  );
}

const pngSizes = new Map<string, { width: number; height: number }>();

/** A PNG's pixel size, from its IHDR chunk. Read once per asset. */
function pngSize(path: string): { width: number; height: number } {
  let size = pngSizes.get(path);
  if (!size) {
    const header = Buffer.alloc(24);
    const file = openSync(path, "r");
    try {
      readSync(file, header, 0, 24, 0);
    } finally {
      closeSync(file);
    }
    size = { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
    pngSizes.set(path, size);
  }
  return size;
}

/** A bundled PNG at a given width in points, safe to use inside the page template. */
export function TemplateImage({ src, width }: { src: string; width: number }) {
  const size = pngSize(src);
  return <Image src={src} style={{ width, height: (width * size.height) / size.width }} />;
}
