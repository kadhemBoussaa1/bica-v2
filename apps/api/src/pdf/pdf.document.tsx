import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { PurchaseCategory } from "../generated/prisma/enums.js";
import { PAGE, RECEIPT_FILLER_ROWS, SHIP_TO } from "./pdf.identity";
import { ORDER_COLUMNS, RECEIPT_COLUMNS, orderShowsTotal, receiptShowsTotals } from "./pdf.columns";
import { day, ltrIsolate, money, orderedFigure, receivedFigure } from "./pdf.format";
import { Footer, Letterhead, Notes, PartyBox, styles, type Translate } from "./pdf.chrome";
import { LinesTable, type DocumentLine } from "./pdf.table";

export type { Translate } from "./pdf.chrome";
export type { DocumentLine } from "./pdf.table";

/*
 * The generated purchase order and goods receipt, as react-pdf documents.
 *
 * A faithful rebuild of the legacy Thymeleaf templates rather than a port:
 * react-pdf lays out with flexbox and has no `display: table`, no
 * `@page { @bottom-center }` running elements and no `position: fixed`, so the
 * structure is expressed in `View`s and the footer is a `fixed` block instead.
 * Every label, column, colour and measurement comes from those templates —
 * see pdf.identity.ts and pdf.columns.ts for the transcription. The shared
 * furniture lives in pdf.chrome.tsx, the lines table in pdf.table.tsx.
 *
 * Arabic works because the Noto Arabic face is registered and react-pdf
 * shapes and reorders the run; verified by rendering `طلب شراء` and reading
 * the glyphs back. `rtl` flips the row direction and text alignment, which is
 * what a right-to-left document needs beyond the shaping.
 */

/** Everything a document needs that is not a line. */
export interface DocumentHeader {
  numero: string;
  category: PurchaseCategory;
  currency: string;
  /** Issue date for an order, reception date for a receipt. */
  date: Date | null;
  supplier: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  notes: string | null;
}

function PartyBoxes({ header, rtl, t }: { header: DocumentHeader; rtl: boolean; t: Translate }) {
  const align = rtl ? ({ textAlign: "right" } as const) : ({} as const);
  return (
    <View style={[styles.boxRow, rtl ? { flexDirection: "row-reverse" } : {}]}>
      <PartyBox title={t("vendor")} rtl={rtl}>
        <Text style={[styles.boxStrong, align]}>{header.supplier.name}</Text>
        {header.supplier.address !== null && <Text style={align}>{header.supplier.address}</Text>}
        {header.supplier.phone !== null && (
          <Text style={align}>
            {t("phone")} {ltrIsolate(header.supplier.phone)}
          </Text>
        )}
        {header.supplier.email !== null && (
          <Text style={align}>
            {t("email")} {ltrIsolate(header.supplier.email)}
          </Text>
        )}
      </PartyBox>

      <PartyBox title={t("shipTo")} rtl={rtl}>
        <Text style={[styles.boxStrong, align]}>{SHIP_TO.name}</Text>
        {SHIP_TO.addressLines.map((addressLine) => (
          <Text key={addressLine} style={align}>
            {addressLine}
          </Text>
        ))}
        <Text style={align}>
          {t("phone")} {ltrIsolate(SHIP_TO.phone)}
        </Text>
      </PartyBox>
    </View>
  );
}

/** The generated purchase order. */
export function PurchaseOrderDocument({
  header,
  lines,
  totalHt,
  fontFamily,
  rtl,
  t,
}: {
  header: DocumentHeader;
  lines: readonly DocumentLine[];
  totalHt: number | null;
  fontFamily: string;
  rtl: boolean;
  t: Translate;
}) {
  const columns = ORDER_COLUMNS[header.category];
  return (
    <Document title={header.numero}>
      <Page size={PAGE.size} style={[styles.page, { fontFamily }]}>
        <Letterhead
          title={t("order.title")}
          infoRows={[
            { label: t("order.numberLabel"), value: header.numero },
            { label: t("order.dateLabel"), value: day(header.date) },
          ]}
          rtl={rtl}
          t={t}
        />
        <PartyBoxes header={header} rtl={rtl} t={t} />
        <LinesTable columns={columns} lines={lines} currency={header.currency} rtl={rtl} t={t} />

        {orderShowsTotal(header.category) && (
          <View style={styles.totalsWrap}>
            <View style={styles.totalsTable}>
              <View style={styles.totalsRow}>
                <Text style={[styles.totalsLabel, styles.totalsLast]}>{t("totalHt")}</Text>
                <Text style={[styles.totalsValue, styles.totalsLast]}>
                  {money(totalHt, header.currency)}
                </Text>
              </View>
            </View>
          </View>
        )}

        {header.notes !== null && header.notes !== "" && (
          <Notes notes={header.notes} rtl={rtl} t={t} />
        )}
        <Footer t={t} />
      </Page>
    </Document>
  );
}

/** The generated goods receipt. */
export function GoodsReceiptDocument({
  header,
  orderNumero,
  lines,
  totals,
  fontFamily,
  rtl,
  t,
}: {
  header: DocumentHeader;
  orderNumero: string;
  lines: readonly DocumentLine[];
  totals: { ordered: number | null; received: number | null; remaining: number | null };
  fontFamily: string;
  rtl: boolean;
  t: Translate;
}) {
  const columns = RECEIPT_COLUMNS[header.category];
  return (
    <Document title={header.numero}>
      <Page size={PAGE.size} style={[styles.page, { fontFamily }]}>
        <Letterhead
          title={t("receipt.title")}
          infoRows={[
            { label: t("receipt.dateLabel"), value: day(header.date) },
            { label: t("receipt.numberLabel"), value: header.numero },
            { label: t("receipt.orderLabel"), value: orderNumero },
          ]}
          rtl={rtl}
          t={t}
        />
        <PartyBoxes header={header} rtl={rtl} t={t} />
        <LinesTable
          columns={columns}
          lines={lines}
          currency={header.currency}
          rtl={rtl}
          t={t}
          filler={RECEIPT_FILLER_ROWS}
        />

        {receiptShowsTotals(header.category) && (
          <View style={styles.totalsWrap}>
            <View style={styles.totalsTable}>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>{t("totals.ordered")}</Text>
                <Text style={styles.totalsValue}>{orderedFigure(totals.ordered)}</Text>
              </View>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>{t("totals.received")}</Text>
                <Text style={styles.totalsValue}>{receivedFigure(totals.received)}</Text>
              </View>
              <View style={styles.totalsRow}>
                <Text style={[styles.totalsLabel, styles.totalsLast]}>{t("totals.remaining")}</Text>
                <Text style={[styles.totalsValue, styles.totalsLast]}>
                  {orderedFigure(totals.remaining)}
                </Text>
              </View>
            </View>
          </View>
        )}

        {header.notes !== null && header.notes !== "" && (
          <Notes notes={header.notes} rtl={rtl} t={t} />
        )}
        <Footer t={t} />
      </Page>
    </Document>
  );
}
