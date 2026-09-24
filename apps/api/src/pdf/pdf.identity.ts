/**
 * The company block, palette and geometry the generated purchase orders and
 * goods receipts carry.
 *
 * Ported from the legacy Thymeleaf templates (`back-bica-pack`'s
 * `src/main/resources/templates/bonDeCommande*.html` and
 * `bonDeReception*.html`), which openhtmltopdf rendered. The wording,
 * letterhead, navy palette and A4/10mm geometry are all theirs — a supplier
 * who has seen the old documents should recognise these.
 *
 * The legacy templates carried two different tax IDs; `1862322SAM000` is the
 * one on the PO and GR templates specifically, and is the one confirmed for
 * these documents.
 */

/** Sender block, top-left under the logo. */
export const COMPANY = {
  name: "BICA PAWN PACKAGING",
  addressLines: ["Z.I BEMBLA ROUTE JEMMEL", "5021 TUNISIE"],
  phones: ["+216 58 402 164", "+33 7 53 83 98 22"],
  emails: ["sabrine.achek@bicapack.com", "ala.trabelsi@bicapack.com"],
  /** Footer line, verbatim from the legacy templates. */
  website: "www.bicapack.com",
  taxId: "1862322SAM000",
} as const;

/**
 * Delivery address box, top-right of the vendor row. Deliberately its own
 * constant rather than reusing `COMPANY`: the legacy templates print a
 * shorter name and one phone here, and the two blocks are not the same text.
 */
export const SHIP_TO = {
  name: "BICAPACK",
  addressLines: ["Z.I BEMBLA ROUTE JEMMEL", "5021 TUNISIE"],
  phone: "+216 58 402 164",
} as const;

/** The legacy palette. Navy headers on white, grey hairlines, zebra rows. */
export const INK = {
  navy: "#1a3a5f",
  navyDark: "#0f2442",
  text: "#2c3e50",
  textSoft: "#34495e",
  hairline: "#dee2e6",
  hairlineSoft: "#e9ecef",
  zebra: "#f8f9fa",
  footer: "#666666",
  white: "#ffffff",
} as const;

/**
 * A4 with 10mm margins, as `@page { size: A4; margin: 10mm }` in the legacy
 * CSS. react-pdf takes points, and 10mm is 28.35pt.
 */
export const PAGE = {
  size: "A4",
  margin: 28.35,
} as const;

/**
 * Blank rows padded onto a goods receipt's table so the printed note has
 * space to write on — the legacy templates emit
 * `#numbers.sequence(bon.lignes.size(), 12)`, i.e. filler up to 12 rows.
 * A receipt with more lines than that simply gets none.
 */
export const RECEIPT_FILLER_ROWS = 12;

/** Where the vendored fonts and logos live, resolved from the API's cwd. */
export const ASSETS = {
  latinRegular: "assets/pdf/fonts/NotoSans-Regular.ttf",
  latinBold: "assets/pdf/fonts/NotoSans-Bold.ttf",
  arabicRegular: "assets/pdf/fonts/NotoSansArabic-Regular.ttf",
  arabicBold: "assets/pdf/fonts/NotoSansArabic-Bold.ttf",
  logo: "assets/pdf/bicapack-logo.png",
  fscLogo: "assets/pdf/fsc-logo.png",
} as const;
