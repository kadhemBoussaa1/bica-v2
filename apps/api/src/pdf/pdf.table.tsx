import { Text, View } from "@react-pdf/renderer";
import { styles, type Translate } from "./pdf.chrome";
import type { LineColumn } from "./pdf.columns";
import { figure, money, orderedFigure, receivedFigure } from "./pdf.format";

/*
 * The purchasing lines table: one row shape for the order and the receipt,
 * with the columns chosen per category in pdf.columns.ts.
 */

/** One row of either table; unused fields are simply absent. */
export interface DocumentLine {
  designation: string;
  grammage?: number | null;
  laize?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  thickness?: number | null;
  quantity?: number | null;
  unitPrice?: number | null;
  total?: number | null;
  ordered?: number | null;
  received?: number | null;
  remaining?: number | null;
  notes?: string | null;
}

/** The value a column shows for a line, formatted as the legacy template did. */
function cellText(line: DocumentLine, column: LineColumn, currency: string): string {
  switch (column.field) {
    case "designation":
      return line.designation;
    case "notes":
      return line.notes ?? "-";
    case "ordered":
      return orderedFigure(line.ordered);
    case "received":
      return receivedFigure(line.received);
    case "remaining":
      return orderedFigure(line.remaining);
    case "unitPrice":
      return money(line.unitPrice, currency);
    case "total":
      return money(line.total, currency);
    case "quantity":
      return figure(line.quantity, column.unit);
    default:
      return figure(line[column.field], column.unit);
  }
}

export function LinesTable({
  columns,
  lines,
  currency,
  rtl,
  t,
  filler = 0,
}: {
  columns: readonly LineColumn[];
  lines: readonly DocumentLine[];
  currency: string;
  rtl: boolean;
  t: Translate;
  /** Pad to this many rows with blanks, so a printed note has space to write on. */
  filler?: number;
}) {
  const direction = rtl ? "row-reverse" : "row";
  const blanks = Math.max(0, filler - lines.length);

  return (
    <View style={styles.table}>
      <View style={{ flexDirection: direction }}>
        {columns.map((column) => (
          <Text
            key={column.key}
            style={[
              styles.headCell,
              { flex: column.flex, textAlign: rtl && column.align === "left" ? "right" : column.align },
            ]}
          >
            {t(column.key)}
          </Text>
        ))}
      </View>

      {lines.map((line, index) => (
        <View
          key={index}
          style={[styles.row, { flexDirection: direction }, index % 2 === 1 ? styles.rowZebra : {}]}
          wrap={false}
        >
          {columns.map((column) => (
            <Text
              key={column.key}
              style={[
                styles.cell,
                { flex: column.flex, textAlign: rtl && column.align === "left" ? "right" : column.align },
              ]}
            >
              {cellText(line, column, currency)}
            </Text>
          ))}
        </View>
      ))}

      {Array.from({ length: blanks }, (_, index) => (
        <View key={`blank-${index}`} style={[styles.row, { flexDirection: direction }]}>
          {columns.map((column) => (
            <Text key={column.key} style={[styles.cell, { flex: column.flex }]}>
              {" "}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}
