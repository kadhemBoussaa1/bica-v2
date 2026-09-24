import type { SVGProps } from "react";
import type { PurchaseCategory } from "api/src/purchasing/purchasing.list";

/**
 * One glyph per purchase category, for the facet chips. Hand-authored on a
 * 16px grid with a 1.5px stroke, in the sidebar's manner (`nav-icons.tsx`):
 * literal about the thing bought — a reel, an ink drop, a pallet — rather
 * than a generic tag. All `currentColor`, so a chip's own colour drives the
 * glyph and the label together, active or not.
 */
function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

/** Paper — a reel seen from the side: the core and the wound sheet. */
function PaperIcon() {
  return (
    <Svg>
      <circle cx="8" cy="8" r="5.75" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="M13.75 8h-1.5" />
    </Svg>
  );
}

/** Ink — a drop. */
function InkIcon() {
  return (
    <Svg>
      <path d="M8 2.25c2.2 3 4 5.2 4 7.5a4 4 0 0 1-8 0c0-2.3 1.8-4.5 4-7.5z" />
    </Svg>
  );
}

/** Plates — a flexo cliché: the plate with its raised image. */
function PlateIcon() {
  return (
    <Svg>
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1" />
      <path d="M5 6.25h3M5 9.25h6" />
    </Svg>
  );
}

/** Glue — a tube, nozzle up. */
function GlueIcon() {
  return (
    <Svg>
      <path d="M7 2.25h2v2.5H7z" />
      <path d="M5.25 4.75h5.5v8.5a.5.5 0 0 1-.5.5h-4.5a.5.5 0 0 1-.5-.5z" />
      <path d="M5.25 8.25h5.5" />
    </Svg>
  );
}

/** Boxes — a carton, its flaps open. */
function BoxesIcon() {
  return (
    <Svg>
      <path d="M2.75 6.25h10.5v7.5H2.75z" />
      <path d="M2.75 6.25 4.5 3h7l1.75 3.25" />
      <path d="M8 3v3.25" />
    </Svg>
  );
}

/** Pallets — the deck boards over their two bearers. */
function PalletsIcon() {
  return (
    <Svg>
      <path d="M2.25 8.75h11.5" />
      <path d="M2.25 6.25h11.5M2.25 11.25h11.5" />
      <path d="M4.5 6.25v5M8 6.25v5M11.5 6.25v5" />
    </Svg>
  );
}

/** Stretch film — a roll on its core with the film peeling off. */
function StretchFilmIcon() {
  return (
    <Svg>
      <rect x="3.25" y="2.25" width="5.5" height="11.5" rx="2.75" />
      <path d="M8.75 5.75h4.5v8h-4.5" />
    </Svg>
  );
}

/** Transport — a lorry, the sidebar's shipments truck at chip size. */
function TransportIcon() {
  return (
    <Svg>
      <path d="M1.75 4.25h7v7h-7zM8.75 6.75h3l2.5 2.5v2h-5.5z" />
      <circle cx="4.5" cy="12.75" r="1.25" />
      <circle cx="11.25" cy="12.75" r="1.25" />
    </Svg>
  );
}

/** Misc — three dots: whatever fits no other shelf. */
function MiscIcon() {
  return (
    <Svg>
      <circle cx="3.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export const CATEGORY_ICONS: Record<PurchaseCategory, () => React.JSX.Element> = {
  PAPER: PaperIcon,
  INK: InkIcon,
  PLATE: PlateIcon,
  GLUE: GlueIcon,
  BOXES: BoxesIcon,
  PALLETS: PalletsIcon,
  STRETCH_FILM: StretchFilmIcon,
  TRANSPORT: TransportIcon,
  MISC: MiscIcon,
};

export function CategoryIcon({ category }: { category: PurchaseCategory }) {
  const Icon = CATEGORY_ICONS[category];
  return <Icon />;
}
