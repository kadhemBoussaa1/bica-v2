import { Document, Text, View } from "@react-pdf/renderer";
import {
  drawsOn,
  physicalAlign,
  withMention,
  type LayoutAlign,
  type SalesInvoiceBlock,
  type SalesInvoiceColumn,
  type SalesInvoiceLayout,
  type SalesInvoiceModel,
  type SalesInvoiceModelLine,
} from "@repo/api-contract";
import { PartyBox, styles, type Translate } from "./pdf.chrome";
import { currencyDigits, figure, isoDay, ltrIsolate, money, percent, unitMoney } from "./pdf.format";
import { ASSETS, INK } from "./pdf.identity";
import { FixedBlock, FlowBlock, LayoutPage, TemplateImage, mm, type PageContext } from "./pdf.layout";

/*
 * The sales invoice, drawn from a stored layout and a `SalesInvoiceModel`.
 *
 * Each block type binds to the model in exactly one way, here: the layout
 * says where a block sits and which of its options are on, never what data
 * it reads. The switch in `BlockBody` is exhaustive, so a block type added to
 * the contract does not compile until it is drawn.
 *
 * Figures print as the model carries them — stored totals, or
 * `invoiceTotals` of the draft being previewed — and are never recomputed.
 */

interface RenderContext extends PageContext {
  model: SalesInvoiceModel;
  rtl: boolean;
  t: Translate;
}

type BlockOf<T extends SalesInvoiceBlock["type"]> = Extract<SalesInvoiceBlock, { type: T }>;

const crossAlign = (align: LayoutAlign, rtl: boolean) => {
  const side = physicalAlign(align, rtl);
  return side === "left" ? "flex-start" : side === "right" ? "flex-end" : "center";
};

/** The number, or the word that stands in for it while there is none. */
function numeroOf({ model, t }: RenderContext): string {
  return model.numero === null ? t("invoice.draft") : ltrIsolate(model.numero);
}

function LetterheadBlock({ block, context }: { block: BlockOf<"letterhead">; context: RenderContext }) {
  const { model, rtl, t } = context;
  const textAlign = physicalAlign(block.placement.align, rtl);

  if (block.props.variant === "compact") {
    return (
      <Text
        style={{
          fontSize: 8,
          fontWeight: 700,
          color: INK.navy,
          textAlign,
          paddingBottom: 4,
          borderBottomWidth: 0.5,
          borderBottomColor: INK.hairline,
        }}
      >
        {t("invoice.compact", {
          company: model.issuer.name,
          title: t("invoice.title"),
          numero: numeroOf(context),
        })}
      </Text>
    );
  }

  return (
    <View style={{ alignItems: crossAlign(block.placement.align, rtl) }}>
      <View style={{ marginBottom: 8 }}>
        <TemplateImage src={ASSETS.logo} width={120} />
      </View>
      <Text style={[styles.companyName, { textAlign }]}>{model.issuer.name}</Text>
      {model.issuer.addressLines.map((line) => (
        <Text key={line} style={[styles.companyLine, { textAlign }]}>
          {line}
        </Text>
      ))}
      {model.issuer.phones.map((phone) => (
        <Text key={phone} style={[styles.companyLine, { textAlign }]}>
          {t("phone")} {ltrIsolate(phone)}
        </Text>
      ))}
      {model.issuer.emails.map((email) => (
        <Text key={email} style={[styles.companyLine, { textAlign }]}>
          {t("email")} {ltrIsolate(email)}
        </Text>
      ))}
    </View>
  );
}

function MetaBlock({ block, context }: { block: BlockOf<"meta">; context: RenderContext }) {
  const { model, rtl, t } = context;
  const align = block.placement.align;

  // A row with nothing to say is omitted rather than printed with a dash.
  const rows = block.props.rows.flatMap((row): { label: string; value: string }[] => {
    switch (row) {
      case "number":
        return [{ label: t("invoice.numberLabel"), value: numeroOf(context) }];
      case "issuedAt":
        return model.issuedAt === null
          ? []
          : [{ label: t("invoice.dateLabel"), value: ltrIsolate(isoDay(model.issuedAt)) }];
      case "dueAt":
        return model.dueAt === null
          ? []
          : [{ label: t("invoice.dueLabel"), value: ltrIsolate(isoDay(model.dueAt)) }];
      case "paymentMethod":
        return model.paymentMethod === null
          ? []
          : [
              {
                label: t("invoice.paymentLabel"),
                value: t(`invoice.paymentMethods.${model.paymentMethod}`),
              },
            ];
      case "orders":
        return model.orderNumeros.length === 0
          ? []
          : [
              {
                label: t("invoice.ordersLabel"),
                value: model.orderNumeros.map(ltrIsolate).join(", "),
              },
            ];
    }
  });

  const justifyContent =
    align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start";
  return (
    <View>
      {block.props.showTitle && (
        // Its own leading, declared with its own size: the block's 11.2pt
        // would give a 20pt title a line box shorter than its glyphs.
        <Text
          style={[
            styles.title,
            // The Arabic face is taller than its em.
            { lineHeight: rtl ? 1.7 : 1.2, textAlign: physicalAlign(align, rtl) },
          ]}
        >
          {t("invoice.title")}
        </Text>
      )}
      {rows.length > 0 && (
        <View style={styles.infoBox}>
          {rows.map((row) => (
            // Reversing the row swaps which physical side `flex-end` means, so
            // one `justifyContent` serves both reading directions.
            <View
              key={row.label}
              style={{ flexDirection: rtl ? "row-reverse" : "row", justifyContent, marginBottom: 3 }}
            >
              <Text style={styles.infoLabel}>{row.label}</Text>
              <Text
                style={{
                  fontSize: 8,
                  color: INK.textSoft,
                  ...(rtl ? { marginRight: 6 } : { marginLeft: 6 }),
                }}
              >
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function PartiesBlock({ block, context }: { block: BlockOf<"parties">; context: RenderContext }) {
  const { model, rtl, t } = context;
  const textAlign = physicalAlign(block.placement.align, rtl);
  const width = `${100 / block.props.boxes.length}%`;

  return (
    <View style={{ flexDirection: rtl ? "row-reverse" : "row" }}>
      {block.props.boxes.map((box) =>
        box === "issuer" ? (
          <PartyBox key={box} title={t("invoice.issuer")} rtl={rtl} width={width}>
            <Text style={[styles.boxStrong, { textAlign }]}>{model.issuer.name}</Text>
            {model.issuer.addressLines.map((line) => (
              <Text key={line} style={{ textAlign }}>
                {line}
              </Text>
            ))}
            <Text style={{ textAlign }}>
              {t("invoice.taxIdLabel")} {ltrIsolate(model.issuer.taxId)}
            </Text>
          </PartyBox>
        ) : (
          <PartyBox key={box} title={t("invoice.billTo")} rtl={rtl} width={width}>
            {model.client === null ? (
              <Text style={{ textAlign, color: INK.footer }}>{t("invoice.noClient")}</Text>
            ) : (
              <>
                <Text style={[styles.boxStrong, { textAlign }]}>{model.client.name}</Text>
                {model.client.address !== null && (
                  <Text style={{ textAlign }}>{model.client.address}</Text>
                )}
                {/* Empty on every migrated client: the row is omitted, not dashed. */}
                {model.client.taxId !== null && (
                  <Text style={{ textAlign }}>
                    {t("invoice.taxIdLabel")} {ltrIsolate(model.client.taxId)}
                  </Text>
                )}
                {model.client.phone !== null && (
                  <Text style={{ textAlign }}>
                    {t("phone")} {ltrIsolate(model.client.phone)}
                  </Text>
                )}
                {model.client.email !== null && (
                  <Text style={{ textAlign }}>
                    {t("email")} {ltrIsolate(model.client.email)}
                  </Text>
                )}
              </>
            )}
          </PartyBox>
        ),
      )}
    </View>
  );
}

/** What a hide-when-empty column looks at: a figure that is absent or zero says nothing. */
function isBlank(line: SalesInvoiceModelLine, key: SalesInvoiceColumn["key"]): boolean {
  switch (key) {
    case "position":
      return false;
    case "product":
      return line.product === null;
    case "designation":
      return withMention(line.description ?? line.product, line.mention) === "";
    default: {
      const value = line[key];
      return value === null || value === 0;
    }
  }
}

function lineCell(
  line: SalesInvoiceModelLine,
  key: SalesInvoiceColumn["key"],
  currency: string | null,
): string {
  const digits = currencyDigits(currency);
  switch (key) {
    case "position":
      return String(line.position);
    case "product":
      return line.product ?? "-";
    case "designation":
      // The legacy rows keep the full spec in `description` and a short name
      // in `product`; a line with only the short name still needs a label.
      return withMention(line.description ?? line.product, line.mention) || "-";
    case "quantity":
      return figure(line.quantity);
    case "unitPrice":
      return unitMoney(line.unitPrice, currency, digits);
    case "discountPct":
      return percent(line.discountPct);
    case "taxPct":
      return percent(line.taxPct);
    case "net":
      return money(line.net, currency, digits);
    case "total":
      return money(line.total, currency, digits);
  }
}

function LinesBlock({ block, context }: { block: BlockOf<"lines">; context: RenderContext }) {
  const { model, rtl, t } = context;
  const columns = block.props.columns.filter(
    (column) => !column.hideWhenEmpty || model.lines.some((line) => !isBlank(line, column.key)),
  );
  const flexDirection = rtl ? "row-reverse" : "row";
  // Widths are weights: when a column drops out the rest scale to fill.
  const cellStyle = (column: SalesInvoiceColumn) => ({
    flexGrow: column.w,
    flexShrink: 0,
    flexBasis: 0,
    textAlign: physicalAlign(column.align, rtl),
  });

  return (
    <View style={[styles.table, { marginBottom: 0 }]}>
      {/* `fixed`: repeated on every page the table runs onto. */}
      <View style={{ flexDirection }} fixed minPresenceAhead={40}>
        {columns.map((column) => (
          <Text key={column.key} style={[styles.headCell, cellStyle(column)]}>
            {t(`columns.${column.key}`)}
          </Text>
        ))}
      </View>
      {model.lines.map((line, index) => (
        <View
          key={line.position}
          wrap={false}
          style={[
            styles.row,
            { flexDirection },
            block.props.zebra && index % 2 === 1 ? styles.rowZebra : {},
          ]}
        >
          {columns.map((column) => (
            <Text key={column.key} style={[styles.cell, cellStyle(column)]}>
              {lineCell(line, column.key, model.currency)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function TotalsBlock({ block, context }: { block: BlockOf<"totals">; context: RenderContext }) {
  const { model, rtl, t } = context;
  const digits = currencyDigits(model.currency);
  const { totalHt, vatAmount, totalTtc } = model.totals;
  const showVat = block.props.vat === "always" || (vatAmount !== null && vatAmount !== 0);

  const rows = showVat
    ? [
        { label: t("invoice.totalHt"), value: totalHt },
        { label: t("invoice.vat"), value: vatAmount },
        { label: t("invoice.totalTtc"), value: totalTtc },
      ]
    : [{ label: t("invoice.totalDue"), value: totalTtc }];

  return (
    <View style={{ borderWidth: 1, borderColor: INK.hairline }}>
      {rows.map((row, index) => {
        const last = index === rows.length - 1 ? styles.totalsLast : {};
        return (
          <View
            key={row.label}
            style={[
              { flexDirection: rtl ? "row-reverse" : "row" },
              index > 0 ? { borderTopWidth: 1, borderTopColor: INK.hairline } : {},
            ]}
          >
            <Text style={[styles.totalsLabel, last, { textAlign: physicalAlign("start", rtl) }]}>
              {row.label}
            </Text>
            <Text
              style={[
                styles.totalsValue,
                last,
                { width: "48%", textAlign: physicalAlign("end", rtl) },
              ]}
            >
              {money(row.value, model.currency, digits)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function NotesBlock({ block, context }: { block: BlockOf<"notes">; context: RenderContext }) {
  const textAlign = physicalAlign(block.placement.align, context.rtl);
  if (block.props.text === "") return null;
  return (
    <View>
      {block.props.title !== "" && (
        <Text style={[styles.notesTitle, { textAlign }]}>{block.props.title}</Text>
      )}
      <Text style={[styles.notesBody, { textAlign }]}>{block.props.text}</Text>
    </View>
  );
}

function FooterBlock({ block, context }: { block: BlockOf<"footer">; context: RenderContext }) {
  const { model, rtl, t } = context;
  return (
    <Text
      style={{
        borderTopWidth: 0.5,
        borderTopColor: "#999999",
        paddingTop: 5,
        fontSize: 6.5,
        color: INK.footer,
        textAlign: physicalAlign(block.placement.align, rtl),
      }}
    >
      {block.props.text !== ""
        ? block.props.text
        : t("footer", {
            website: ltrIsolate(model.issuer.website),
            taxId: ltrIsolate(model.issuer.taxId),
          })}
    </Text>
  );
}

function BlockBody({ block, context }: { block: SalesInvoiceBlock; context: RenderContext }) {
  const { model, rtl, t, pageNumber, totalPages } = context;
  switch (block.type) {
    case "letterhead":
      return <LetterheadBlock block={block} context={context} />;
    case "logo":
      return (
        <TemplateImage
          src={block.props.asset === "fsc" ? ASSETS.fscLogo : ASSETS.logo}
          width={mm(block.placement.w)}
        />
      );
    case "meta":
      return <MetaBlock block={block} context={context} />;
    case "parties":
      return <PartiesBlock block={block} context={context} />;
    case "lines":
      return <LinesBlock block={block} context={context} />;
    case "totals":
      return <TotalsBlock block={block} context={context} />;
    case "notes":
      return <NotesBlock block={block} context={context} />;
    case "footer":
      return <FooterBlock block={block} context={context} />;
    case "pageNumber":
      return (
        <Text
          style={{
            fontSize: 7,
            color: INK.footer,
            textAlign: physicalAlign(block.placement.align, rtl),
          }}
        >
          {t("invoice.page", {
            page: ltrIsolate(String(pageNumber)),
            pages: ltrIsolate(totalPages === undefined ? "" : String(totalPages)),
          })}
        </Text>
      );
    case "watermark":
      if (block.props.when === "draft" && model.status !== "DRAFT") return null;
      return (
        <Text
          // One line, whatever the word: "BROUILLON" at a fixed 84pt broke in
          // two. A bold capital runs to about 0.72 em.
          hyphenationCallback={(word) => [word]}
          style={{
            fontSize: Math.max(
              36,
              Math.min(96, mm(block.placement.w) / (t("invoice.draft").length * 0.72)),
            ),
            fontWeight: 700,
            color: "#c0392b",
            opacity: 0.12,
            lineHeight: 1.7,
            textAlign: "center",
            transform: "rotate(-28deg)",
          }}
        >
          {t("invoice.draft")}
        </Text>
      );
    default: {
      const unreachable: never = block;
      return unreachable;
    }
  }
}

/** The generated sales invoice. */
export function SalesInvoiceDocument({
  model,
  layout,
  fontFamily,
  rtl,
  t,
}: {
  model: SalesInvoiceModel;
  layout: SalesInvoiceLayout;
  fontFamily: string;
  rtl: boolean;
  t: Translate;
}) {
  // The watermark goes over the content; everything else under it.
  const fixedBlocks = (page: PageContext, over: boolean) => {
    const context: RenderContext = { ...page, model, rtl, t };
    return layout.blocks.map((block) =>
      block.placement.mode === "fixed" &&
      (block.type === "watermark") === over &&
      drawsOn(block.placement.repeat, page.pageNumber, page.totalPages) ? (
        <FixedBlock key={block.id} placement={block.placement} rtl={rtl}>
          <BlockBody block={block} context={context} />
        </FixedBlock>
      ) : null,
    );
  };

  return (
    <Document title={model.numero ?? t("invoice.draft")}>
      <LayoutPage
        page={layout.page}
        rtl={rtl}
        fontFamily={fontFamily}
        chrome={(page) => fixedBlocks(page, false)}
        overlay={(page) => fixedBlocks(page, true)}
      >
        {layout.blocks.map((block) =>
          block.placement.mode === "flow" ? (
            <FlowBlock key={block.id} placement={block.placement} page={layout.page} rtl={rtl}>
              {/* Flow content is laid out once, before pagination: it has no page of its own. */}
              <BlockBody
                block={block}
                context={{ pageNumber: 1, totalPages: undefined, model, rtl, t }}
              />
            </FlowBlock>
          ) : null,
        )}
      </LayoutPage>
    </Document>
  );
}
