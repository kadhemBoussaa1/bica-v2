import type { PdfLocale } from "./pdf-locale.js";

/**
 * The words the generated purchase orders and goods receipts print, in the
 * four languages the app speaks.
 *
 * These live in the contract rather than `apps/web/messages` because the API
 * renders these documents server-side: there is no browser to pass strings
 * in, so the renderer needs them itself, and `@repo/api-contract` is the one
 * package both apps already depend on. `@repo/ui` solves the same problem the
 * other way round (`UiStringsProvider`, English defaults plus caller
 * overrides) because it always has a caller; a PDF does not.
 *
 * French is the source of truth: the wording is transcribed from the legacy
 * Thymeleaf templates (`back-bica-pack`'s `bonDeCommande*.html` /
 * `bonDeReception*.html`) that produced every document a supplier has seen so
 * far. The other three are translated outward from it.
 *
 * `footer` takes `{website}` and `{taxId}`; the `invoice` block documents its own.
 */
export interface PdfMessages {
  order: { title: string; numberLabel: string; dateLabel: string };
  receipt: { title: string; numberLabel: string; dateLabel: string; orderLabel: string };
  /** `page` takes `{page}` and `{pages}`; `compact` takes `{company}`, `{title}` and `{numero}`. */
  invoice: {
    title: string;
    /** Stands in for the number, and is the watermark, while the invoice is a draft. */
    draft: string;
    numberLabel: string;
    dateLabel: string;
    dueLabel: string;
    paymentLabel: string;
    ordersLabel: string;
    issuer: string;
    billTo: string;
    noClient: string;
    taxIdLabel: string;
    totalHt: string;
    vat: string;
    totalTtc: string;
    /** The single totals row of an invoice with no VAT to break out. */
    totalDue: string;
    page: string;
    compact: string;
    paymentMethods: { VIREMENT: string; CHEQUE: string; ESPECES: string };
  };
  vendor: string;
  shipTo: string;
  phone: string;
  email: string;
  totalHt: string;
  totals: { ordered: string; received: string; remaining: string };
  observations: string;
  footer: string;
  columns: {
    designation: string;
    grammage: string;
    laize: string;
    length: string;
    width: string;
    height: string;
    thickness: string;
    quantity: string;
    quantityKg: string;
    unitPrice: string;
    total: string;
    totalHt: string;
    ordered: string;
    received: string;
    remaining: string;
    orderedKg: string;
    receivedKg: string;
    remainingKg: string;
    observation: string;
    position: string;
    product: string;
    discountPct: string;
    taxPct: string;
    net: string;
  };
}

const fr: PdfMessages = {
  order: { title: "BON DE COMMANDE", numberLabel: "Numéro BC :", dateLabel: "DATE CREATION:" },
  receipt: {
    title: "BON DE RÉCEPTION",
    numberLabel: "Numéro BR :",
    dateLabel: "DATE RÉCEPTION:",
    orderLabel: "Numéro BC :",
  },
  invoice: {
    title: "FACTURE",
    draft: "BROUILLON",
    numberLabel: "Facture N° :",
    dateLabel: "Date :",
    dueLabel: "Échéance :",
    paymentLabel: "Règlement :",
    ordersLabel: "Commande :",
    issuer: "ÉMETTEUR",
    billTo: "FACTURÉ À",
    noClient: "Client non renseigné",
    taxIdLabel: "MF :",
    totalHt: "TOTAL HT",
    vat: "TVA",
    totalTtc: "TOTAL TTC",
    totalDue: "NET À PAYER",
    page: "Page {page} / {pages}",
    compact: "{company} — {title} {numero}",
    paymentMethods: { VIREMENT: "Virement", CHEQUE: "Chèque", ESPECES: "Espèces" },
  },
  vendor: "FOURNISSEUR",
  shipTo: "ADDRESSE DE LIVRAISON",
  phone: "Tél:",
  email: "Email:",
  totalHt: "TOTAL HT",
  totals: {
    ordered: "QUANTITÉ TOTALE COMMANDÉE",
    received: "QUANTITÉ TOTALE REÇUE",
    remaining: "QUANTITÉ RESTANTE",
  },
  observations: "OBSERVATIONS",
  footer: "veuillez contacter {website} — Matricule Fiscale : {taxId}",
  columns: {
    designation: "DÉSIGNATION",
    grammage: "GRAMMAGE",
    laize: "LAIZE",
    length: "LONGUEUR",
    width: "LARGEUR",
    height: "HAUTEUR",
    thickness: "ÉPAISSEUR",
    quantity: "QUANTITÉ",
    quantityKg: "QUANTITÉ (Kg)",
    unitPrice: "PRIX UNIT.",
    total: "TOTAL",
    totalHt: "TOTAL HT",
    ordered: "QTE COMMANDÉE",
    received: "QTE REÇUE",
    remaining: "QTE RESTANTE",
    orderedKg: "QTE COMMANDÉE (Kg)",
    receivedKg: "QTE REÇUE (Kg)",
    remainingKg: "QTE RESTANTE (Kg)",
    observation: "OBSERVATION",
    position: "N°",
    product: "PRODUIT",
    discountPct: "REMISE",
    taxPct: "TVA",
    net: "NET HT",
  },
};

const en: PdfMessages = {
  order: { title: "PURCHASE ORDER", numberLabel: "PO No.:", dateLabel: "DATE RAISED:" },
  receipt: {
    title: "GOODS RECEIPT",
    numberLabel: "GR No.:",
    dateLabel: "DATE RECEIVED:",
    orderLabel: "PO No.:",
  },
  invoice: {
    title: "INVOICE",
    draft: "DRAFT",
    numberLabel: "Invoice No.:",
    dateLabel: "Date:",
    dueLabel: "Due:",
    paymentLabel: "Payment:",
    ordersLabel: "Order:",
    issuer: "FROM",
    billTo: "BILL TO",
    noClient: "No client recorded",
    taxIdLabel: "Tax ID:",
    totalHt: "TOTAL EXCL. VAT",
    vat: "VAT",
    totalTtc: "TOTAL INCL. VAT",
    totalDue: "AMOUNT DUE",
    page: "Page {page} / {pages}",
    compact: "{company} — {title} {numero}",
    paymentMethods: { VIREMENT: "Bank transfer", CHEQUE: "Cheque", ESPECES: "Cash" },
  },
  vendor: "SUPPLIER",
  shipTo: "DELIVERY ADDRESS",
  phone: "Tel:",
  email: "Email:",
  totalHt: "TOTAL EXCL. VAT",
  totals: {
    ordered: "TOTAL QUANTITY ORDERED",
    received: "TOTAL QUANTITY RECEIVED",
    remaining: "QUANTITY OUTSTANDING",
  },
  observations: "NOTES",
  footer: "please contact {website} — Tax ID: {taxId}",
  columns: {
    designation: "DESCRIPTION",
    grammage: "GRAMMAGE",
    laize: "WEB WIDTH",
    length: "LENGTH",
    width: "WIDTH",
    height: "HEIGHT",
    thickness: "THICKNESS",
    quantity: "QUANTITY",
    quantityKg: "QUANTITY (kg)",
    unitPrice: "UNIT PRICE",
    total: "TOTAL",
    totalHt: "TOTAL EXCL. VAT",
    ordered: "QTY ORDERED",
    received: "QTY RECEIVED",
    remaining: "QTY OUTSTANDING",
    orderedKg: "QTY ORDERED (kg)",
    receivedKg: "QTY RECEIVED (kg)",
    remainingKg: "QTY OUTSTANDING (kg)",
    observation: "NOTE",
    position: "No.",
    product: "PRODUCT",
    discountPct: "DISC.",
    taxPct: "VAT",
    net: "NET",
  },
};

const ar: PdfMessages = {
  order: { title: "طلب شراء", numberLabel: "رقم الطلب:", dateLabel: "تاريخ الإنشاء:" },
  receipt: {
    title: "وصل استلام",
    numberLabel: "رقم الوصل:",
    dateLabel: "تاريخ الاستلام:",
    orderLabel: "رقم الطلب:",
  },
  invoice: {
    title: "فاتورة",
    draft: "مسودة",
    numberLabel: "فاتورة رقم:",
    dateLabel: "التاريخ:",
    dueLabel: "تاريخ الاستحقاق:",
    paymentLabel: "طريقة الدفع:",
    ordersLabel: "الطلبية:",
    issuer: "المُصدر",
    billTo: "فاتورة إلى",
    noClient: "الحريف غير مسجَّل",
    taxIdLabel: "المعرّف الجبائي:",
    totalHt: "المجموع دون الأداء",
    vat: "الأداء على القيمة المضافة",
    totalTtc: "المجموع باعتبار الأداء",
    totalDue: "الصافي للدفع",
    page: "صفحة {page} من {pages}",
    compact: "{company} — {title} {numero}",
    paymentMethods: { VIREMENT: "تحويل بنكي", CHEQUE: "صك", ESPECES: "نقدًا" },
  },
  vendor: "المورد",
  shipTo: "عنوان التسليم",
  phone: "هاتف:",
  email: "البريد:",
  totalHt: "المجموع دون ضريبة",
  totals: {
    ordered: "إجمالي الكمية المطلوبة",
    received: "إجمالي الكمية المستلمة",
    remaining: "الكمية المتبقية",
  },
  observations: "ملاحظات",
  footer: "للتواصل {website} — المعرّف الجبائي: {taxId}",
  columns: {
    designation: "البيان",
    grammage: "الغرامَاج",
    laize: "عرض البكرة",
    length: "الطول",
    width: "العرض",
    height: "الارتفاع",
    thickness: "السماكة",
    quantity: "الكمية",
    quantityKg: "الكمية (كغ)",
    unitPrice: "سعر الوحدة",
    total: "المجموع",
    totalHt: "المجموع دون ضريبة",
    ordered: "الكمية المطلوبة",
    received: "الكمية المستلمة",
    remaining: "الكمية المتبقية",
    orderedKg: "المطلوبة (كغ)",
    receivedKg: "المستلمة (كغ)",
    remainingKg: "المتبقية (كغ)",
    observation: "ملاحظة",
    position: "ع.ر",
    product: "المنتوج",
    discountPct: "التخفيض",
    taxPct: "الأداء",
    net: "الصافي",
  },
};

const es: PdfMessages = {
  order: { title: "PEDIDO DE COMPRA", numberLabel: "N.º pedido:", dateLabel: "FECHA DE EMISIÓN:" },
  receipt: {
    title: "ALBARÁN DE ENTRADA",
    numberLabel: "N.º albarán:",
    dateLabel: "FECHA DE RECEPCIÓN:",
    orderLabel: "N.º pedido:",
  },
  invoice: {
    title: "FACTURA",
    draft: "BORRADOR",
    numberLabel: "Factura n.º:",
    dateLabel: "Fecha:",
    dueLabel: "Vencimiento:",
    paymentLabel: "Pago:",
    ordersLabel: "Pedido:",
    issuer: "EMISOR",
    billTo: "FACTURAR A",
    noClient: "Cliente no indicado",
    taxIdLabel: "N.º fiscal:",
    totalHt: "TOTAL SIN IVA",
    vat: "IVA",
    totalTtc: "TOTAL CON IVA",
    totalDue: "TOTAL A PAGAR",
    page: "Página {page} / {pages}",
    compact: "{company} — {title} {numero}",
    paymentMethods: { VIREMENT: "Transferencia", CHEQUE: "Cheque", ESPECES: "Efectivo" },
  },
  vendor: "PROVEEDOR",
  shipTo: "DIRECCIÓN DE ENTREGA",
  phone: "Tel:",
  email: "Correo:",
  totalHt: "TOTAL SIN IVA",
  totals: {
    ordered: "CANTIDAD TOTAL PEDIDA",
    received: "CANTIDAD TOTAL RECIBIDA",
    remaining: "CANTIDAD PENDIENTE",
  },
  observations: "OBSERVACIONES",
  footer: "contacte con {website} — N.º fiscal: {taxId}",
  columns: {
    designation: "DESIGNACIÓN",
    grammage: "GRAMAJE",
    laize: "ANCHO BOBINA",
    length: "LARGO",
    width: "ANCHO",
    height: "ALTO",
    thickness: "ESPESOR",
    quantity: "CANTIDAD",
    quantityKg: "CANTIDAD (kg)",
    unitPrice: "PRECIO UNIT.",
    total: "TOTAL",
    totalHt: "TOTAL SIN IVA",
    ordered: "CANT. PEDIDA",
    received: "CANT. RECIBIDA",
    remaining: "CANT. PENDIENTE",
    orderedKg: "PEDIDA (kg)",
    receivedKg: "RECIBIDA (kg)",
    remainingKg: "PENDIENTE (kg)",
    observation: "OBSERVACIÓN",
    position: "N.º",
    product: "PRODUCTO",
    discountPct: "DTO.",
    taxPct: "IVA",
    net: "NETO",
  },
};

export const PDF_MESSAGES = { fr, en, ar, es } as const satisfies Record<PdfLocale, PdfMessages>;

/**
 * A dotted-key lookup into one locale's messages, with `{placeholder}`
 * substitution — the same call shape `useTranslations` gives the web, so the
 * document components read alike on both sides.
 *
 * A missing key returns the key itself rather than throwing: a document with
 * one odd label still prints, which is the right failure for a delivery note
 * someone is waiting on.
 */
export function pdfTranslator(locale: PdfLocale) {
  const messages = PDF_MESSAGES[locale];
  return (key: string, values?: Record<string, string>): string => {
    const found = key
      .split(".")
      .reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), messages);
    if (typeof found !== "string") return key;
    if (!values) return found;
    return Object.entries(values).reduce(
      (text, [name, value]) => text.split(`{${name}}`).join(value),
      found,
    );
  };
}

/** Arabic is the only right-to-left language here. */
export function isRtl(locale: PdfLocale): boolean {
  return locale === "ar";
}

