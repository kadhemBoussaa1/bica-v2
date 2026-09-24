import type { ReactNode } from "react";
import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import { ASSETS, COMPANY, INK, PAGE } from "./pdf.identity";
import { ltrIsolate } from "./pdf.format";

/*
 * The page furniture every generated document shares: the stylesheet, the
 * letterhead, a party box, the notes block and the fixed footer.
 *
 * Lifted out of pdf.document.tsx unchanged when the sales invoice arrived, so
 * a third document could reuse them. The purchase order and goods receipt
 * must render exactly as before — verified by rasterising both, in French and
 * Arabic, before and after the move.
 */

/** A translated string, resolved by the caller from the `pdf` namespace. */
export type Translate = (key: string, values?: Record<string, string>) => string;

export const styles = StyleSheet.create({
  page: {
    paddingTop: PAGE.margin,
    paddingBottom: PAGE.margin + 18,
    paddingHorizontal: PAGE.margin,
    fontSize: 8,
    color: INK.text,
    lineHeight: 1.4,
  },

  headerRow: { flexDirection: "row", marginBottom: 15 },
  headerLeft: { width: "55%", paddingRight: 15 },
  headerRight: { width: "45%", alignItems: "flex-end" },
  logo: { width: 120, marginBottom: 8 },
  companyName: { fontWeight: 700, fontSize: 9 },
  companyLine: { fontSize: 8, color: INK.textSoft },

  title: {
    fontSize: 20,
    fontWeight: 700,
    color: INK.navy,
    letterSpacing: 1.5,
    marginBottom: 12,
    textAlign: "right",
  },
  infoBox: { borderWidth: 1, borderColor: INK.navy, paddingVertical: 6, paddingHorizontal: 10 },
  infoRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 3 },
  infoLabel: { fontWeight: 700, fontSize: 8 },
  infoValue: { fontSize: 8, color: INK.textSoft, marginLeft: 6 },

  boxRow: { flexDirection: "row", marginBottom: 10 },
  box: { width: "50%", borderWidth: 1, borderColor: INK.hairline },
  boxHeader: {
    backgroundColor: INK.navy,
    color: INK.white,
    fontWeight: 700,
    fontSize: 8.5,
    letterSpacing: 0.4,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  boxBody: { padding: 10, fontSize: 8 },
  boxStrong: { fontWeight: 700, color: INK.navy },

  table: { borderWidth: 1, borderColor: INK.hairline, marginBottom: 10 },
  headCell: {
    backgroundColor: INK.navy,
    color: INK.white,
    fontWeight: 700,
    fontSize: 7.5,
    letterSpacing: 0.2,
    paddingVertical: 7,
    paddingHorizontal: 5,
    borderRightWidth: 1,
    borderRightColor: INK.navyDark,
  },
  row: { flexDirection: "row", borderTopWidth: 1, borderTopColor: INK.hairline },
  rowZebra: { backgroundColor: INK.zebra },
  cell: {
    paddingVertical: 6,
    paddingHorizontal: 5,
    fontSize: 8,
    borderRightWidth: 1,
    borderRightColor: INK.hairlineSoft,
  },

  totalsWrap: { alignItems: "flex-end", marginBottom: 15 },
  totalsTable: { width: 240, borderWidth: 1, borderColor: INK.hairline },
  totalsRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: INK.hairline },
  totalsLabel: { flex: 1, paddingVertical: 6, paddingHorizontal: 10, fontWeight: 700, fontSize: 8 },
  totalsValue: { width: 100, paddingVertical: 6, paddingHorizontal: 10, fontWeight: 700, fontSize: 8, textAlign: "right" },
  totalsLast: { backgroundColor: INK.navy, color: INK.white, fontSize: 8.5 },

  notesTitle: { fontSize: 8.5, fontWeight: 700, color: INK.navy, letterSpacing: 0.4, marginBottom: 6 },
  notesBody: { borderWidth: 1, borderColor: INK.hairline, padding: 10, fontSize: 8 },

  footer: {
    position: "absolute",
    bottom: PAGE.margin - 12,
    left: PAGE.margin,
    right: PAGE.margin,
    borderTopWidth: 0.5,
    borderTopColor: "#999999",
    paddingTop: 5,
    fontSize: 6.5,
    color: INK.footer,
    textAlign: "center",
  },
  fscLogo: { position: "absolute", bottom: 4, left: 6, width: 42 },
});

export function Letterhead({
  title,
  infoRows,
  rtl,
  t,
}: {
  title: string;
  infoRows: ReadonlyArray<{ label: string; value: string }>;
  rtl: boolean;
  t: Translate;
}) {
  return (
    <View style={[styles.headerRow, rtl ? { flexDirection: "row-reverse" } : {}]}>
      <View style={[styles.headerLeft, rtl ? { alignItems: "flex-end" } : {}]}>
        <Image style={styles.logo} src={ASSETS.logo} />
        <Text style={styles.companyName}>{COMPANY.name}</Text>
        {COMPANY.addressLines.map((addressLine) => (
          <Text key={addressLine} style={styles.companyLine}>
            {addressLine}
          </Text>
        ))}
        {/*
          Isolated: a phone number beside an Arabic label otherwise reverses
          to `164 402 58 216+`, and an email splits around the `@`. See
          `ltrIsolate`.
        */}
        {COMPANY.phones.map((phone) => (
          <Text key={phone} style={styles.companyLine}>
            {t("phone")} {ltrIsolate(phone)}
          </Text>
        ))}
        {COMPANY.emails.map((email) => (
          <Text key={email} style={styles.companyLine}>
            {t("email")} {ltrIsolate(email)}
          </Text>
        ))}
      </View>

      <View style={[styles.headerRight, rtl ? { alignItems: "flex-start" } : {}]}>
        <Text style={[styles.title, rtl ? { textAlign: "left" } : {}]}>{title}</Text>
        <View style={styles.infoBox}>
          {infoRows.map((info) => (
            <View key={info.label} style={styles.infoRow}>
              <Text style={styles.infoLabel}>{info.label}</Text>
              <Text style={styles.infoValue}>{info.value}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * One titled box of a party row — the vendor, the delivery address, a client.
 * The caller supplies the lines; the navy header and the frame are the same
 * on every document.
 */
export function PartyBox({
  title,
  rtl,
  width = "50%",
  children,
}: {
  title: string;
  rtl: boolean;
  width?: string | number;
  children: ReactNode;
}) {
  const align = rtl ? ({ textAlign: "right" } as const) : ({} as const);
  return (
    <View style={[styles.box, { width }]}>
      <Text style={[styles.boxHeader, align]}>{title}</Text>
      <View style={styles.boxBody}>{children}</View>
    </View>
  );
}

export function Footer({ t }: { t: Translate }) {
  return (
    <>
      <Image style={styles.fscLogo} src={ASSETS.fscLogo} fixed />
      {/*
        Both interpolations are isolated: the Arabic footer split the tax ID
        into `1862322` … `ISAM000` around its label, which is the one figure
        on the page that must not be garbled.
      */}
      <Text style={styles.footer} fixed>
        {t("footer", {
          website: ltrIsolate(COMPANY.website),
          taxId: ltrIsolate(COMPANY.taxId),
        })}
      </Text>
    </>
  );
}

export function Notes({ notes, rtl, t }: { notes: string; rtl: boolean; t: Translate }) {
  const align = rtl ? ({ textAlign: "right" } as const) : ({} as const);
  return (
    <View style={{ marginBottom: 15 }}>
      <Text style={[styles.notesTitle, align]}>{t("observations")}</Text>
      <Text style={[styles.notesBody, align]}>{notes}</Text>
    </View>
  );
}
