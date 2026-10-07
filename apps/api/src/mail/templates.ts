/**
 * The emails, in French like the old app's (they go to fixed mailboxes; the
 * app's per-user language is a browser cookie the server does not know).
 * Each builder returns the subject, an HTML body on one shared layout, and
 * a plain-text part. The wording and the fields are the old Thymeleaf
 * templates'; the markup is ours (inline styles, one 650px card).
 *
 * Every value lands through `esc`: names and labels are typed by users.
 */

export interface MailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

type Tone = "blue" | "green" | "teal";

const TONES: Record<Tone, string> = {
  blue: "linear-gradient(135deg, #2980b9 0%, #3498db 100%)",
  green: "linear-gradient(135deg, #27ae60 0%, #2ecc71 100%)",
  teal: "linear-gradient(135deg, #16a085 0%, #1abc9c 100%)",
};

interface Row {
  label: string;
  value: string | null | undefined;
}

interface Section {
  title: string;
  rows: Row[];
}

interface Layout {
  tone: Tone;
  /** The card's heading and the line under it. */
  title: string;
  lead: string;
  /** "Bonjour," or "Bonjour Nom,". */
  greeting?: string;
  /** The sentence after the greeting. */
  intro: string;
  sections: Section[];
  /** A picture shown under the facts, as a link to the full size. */
  image?: { title: string; url: string | null };
  /** The button at the foot: where this is in the app. */
  link?: { label: string; href: string };
}

/** The web app's origin, for the links in a mail: the API's CORS origin. */
export function appUrl(path: string): string {
  const base = (process.env.CORS_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}

export function esc(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `dd/mm/yyyy`, the app's one date form. Takes a Date or a `YYYY-MM-DD` string. */
export function frDay(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const iso = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : null;
}

/** A moment in plant time, `dd/mm/yyyy HH:mm`. */
export function frMoment(value: Date | null | undefined): string | null {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Tunis",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

/** French grouping for a figure: `12 500`. */
export function frNumber(value: number | null | undefined, digits = 0): string | null {
  if (value === null || value === undefined) return null;
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(value);
}

const DASH = "—";

function render(layout: Layout): { html: string; text: string } {
  const greeting = layout.greeting ?? "Bonjour,";
  const sections = layout.sections
    .map(
      (section) => `
        <h2 style="margin:22px 0 8px;font-size:15px;color:#2c3e50;border-bottom:1px solid #e6e6e6;padding-bottom:6px;">${esc(section.title)}</h2>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
          ${section.rows
            .map(
              (row) => `
            <tr>
              <td style="padding:6px 0;width:42%;color:#555;font-size:14px;vertical-align:top;">${esc(row.label)}</td>
              <td style="padding:6px 0;color:#2c3e50;font-size:14px;font-weight:600;vertical-align:top;">${esc(row.value || DASH)}</td>
            </tr>`,
            )
            .join("")}
        </table>`,
    )
    .join("");
  const image = layout.image
    ? `
        <h2 style="margin:22px 0 8px;font-size:15px;color:#2c3e50;border-bottom:1px solid #e6e6e6;padding-bottom:6px;">${esc(layout.image.title)}</h2>
        ${
          layout.image.url
            ? `<a href="${esc(layout.image.url)}"><img src="${esc(layout.image.url)}" alt="" style="max-width:100%;max-height:260px;border-radius:6px;border:1px solid #e6e6e6;"></a>`
            : `<p style="margin:0;color:#888;font-size:13px;">${esc(layout.image.title)} non disponible</p>`
        }`
    : "";
  const button = layout.link
    ? `
        <p style="margin:26px 0 0;">
          <a href="${esc(layout.link.href)}" style="display:inline-block;padding:11px 20px;background:#1a1714;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">${esc(layout.link.label)}</a>
        </p>`
    : "";

  const html = `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(layout.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Segoe UI',Arial,sans-serif;line-height:1.6;color:#333;">
  <div style="max-width:650px;margin:20px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
    <div style="background:${TONES[layout.tone]};color:#ffffff;padding:22px 20px 18px;text-align:center;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.85;"><strong>BICA-PACK</strong> &bull; Système de gestion</div>
      <h1 style="margin:8px 0 2px;font-size:22px;font-weight:600;">${esc(layout.title)}</h1>
      <p style="margin:0;font-size:13px;opacity:0.9;">${esc(layout.lead)}</p>
    </div>
    <div style="padding:24px 20px 22px;">
      <p style="font-size:16px;margin:0 0 18px;">${esc(greeting)}</p>
      <p style="margin:0;font-size:14px;">${esc(layout.intro)}</p>
      ${sections}
      ${image}
      ${button}
    </div>
    <div style="padding:14px 20px 18px;background:#f8f9fa;border-top:1px solid #e6e6e6;font-size:12px;color:#888;text-align:center;">
      Cette notification a été générée automatiquement par le système de gestion BICA-PACK.<br>
      Ceci est un email automatique, merci de ne pas répondre directement.
    </div>
  </div>
</body>
</html>`;

  const text = [
    layout.title,
    layout.lead,
    "",
    greeting,
    layout.intro,
    ...layout.sections.flatMap((section) => [
      "",
      section.title,
      ...section.rows.map((row) => `  ${row.label} : ${row.value || DASH}`),
    ]),
    ...(layout.image ? ["", `${layout.image.title} : ${layout.image.url ?? "non disponible"}`] : []),
    ...(layout.link ? ["", `${layout.link.label} : ${layout.link.href}`] : []),
    "",
    "Cette notification a été générée automatiquement par le système de gestion BICA-PACK.",
  ].join("\n");

  return { html, text };
}

// ---- the emails --------------------------------------------------------------

export interface OrderCreatedMail {
  to: string[];
  id: string;
  numero: string;
  kind: "ORDER" | "QUOTE";
  clientName: string | null;
  productName: string;
  quantite: number;
  unit: string;
}

/** 1 — "Nouvelle commande créée", for an order or a quote. */
export function orderCreatedMail(input: OrderCreatedMail): MailMessage {
  const quote = input.kind === "QUOTE";
  const what = quote ? "offre de prix" : "commande";
  const body = render({
    tone: "blue",
    title: quote ? "Nouvelle offre de prix créée" : "Nouvelle commande créée",
    lead: quote ? "Une nouvelle offre de prix vient d’être enregistrée" : "Une nouvelle commande vient d’être enregistrée",
    intro: `Une nouvelle ${what} a été créée dans le système BICA-PACK.`,
    sections: [
      {
        title: quote ? "Détails de l’offre de prix" : "Détails de la commande",
        rows: [
          { label: quote ? "Numéro de l’offre" : "Numéro de commande", value: input.numero },
          { label: "Client", value: input.clientName },
          { label: "Produit", value: input.productName },
          { label: "Quantité", value: `${frNumber(input.quantite)} ${input.unit}` },
        ],
      },
    ],
    link: { label: "Ouvrir la commande", href: appUrl(`/orders/${input.id}`) },
  });
  return {
    to: input.to,
    subject: `${quote ? "Nouvelle offre de prix créée" : "Nouvelle commande créée"} - ${input.numero}`,
    ...body,
  };
}

export interface PurchaseOrderCreatedMail {
  to: string[];
  id: string;
  numero: string;
  categoryLabel: string;
  supplierName: string;
}

/** 2 — "Nouveau bon de commande créé", every purchase category. */
export function purchaseOrderCreatedMail(input: PurchaseOrderCreatedMail): MailMessage {
  const body = render({
    tone: "green",
    title: "Nouveau bon de commande créé",
    lead: "Un nouveau bon de commande vient d’être enregistré",
    intro: "Un nouveau bon de commande a été créé dans le système BICA-PACK.",
    sections: [
      {
        title: "Détails du bon de commande",
        rows: [
          { label: "Type", value: input.categoryLabel },
          { label: "Numéro", value: input.numero },
          { label: "Fournisseur", value: input.supplierName },
        ],
      },
    ],
    link: { label: "Ouvrir le bon de commande", href: appUrl(`/purchasing/orders/${input.id}`) },
  });
  return {
    to: input.to,
    subject: `Nouveau bon de commande créé - ${input.categoryLabel} - ${input.numero}`,
    ...body,
  };
}

export interface ProductionRecordedMail {
  to: string[];
  orderId: string;
  numero: string;
  clientName: string | null;
  productName: string;
  stageLabel: string;
  quantity: number | null;
  unit: string;
  /** `YYYY-MM-DD`. */
  day: string;
  machineName: string | null;
  imageUrl: string | null;
}

/** 3 — "Nouvelle production". */
export function productionRecordedMail(input: ProductionRecordedMail): MailMessage {
  const body = render({
    tone: "blue",
    title: "Nouvelle production sur commande",
    lead: "Une nouvelle quantité produite vient d’être enregistrée",
    intro: "Une nouvelle production a été enregistrée dans le système BICA-PACK.",
    sections: [
      {
        title: "Détails de la commande",
        rows: [
          { label: "Numéro de commande", value: input.numero },
          { label: "Client", value: input.clientName },
          { label: "Produit", value: input.productName },
        ],
      },
      {
        title: "Production enregistrée",
        rows: [
          { label: "Étape", value: input.stageLabel },
          {
            label: "Quantité produite",
            value: input.quantity === null ? null : `${frNumber(input.quantity, 2)} ${input.unit}`,
          },
          { label: "Date de production", value: frDay(input.day) },
          { label: "Machine", value: input.machineName },
        ],
      },
    ],
    image: { title: "Image de la commande", url: input.imageUrl },
    link: { label: "Ouvrir la commande", href: appUrl(`/orders/${input.orderId}`) },
  });
  return { to: input.to, subject: `Nouvelle production - ${input.numero}`, ...body };
}

export interface ActionAssignedMail {
  to: string[];
  employeeName: string;
  ofId: string;
  ofNumero: string;
  actionNumber: number;
  actionLabel: string;
  orderNumero: string;
  clientName: string | null;
  productName: string;
}

/** 4 — "Action à réaliser", to the person assigned. */
export function actionAssignedMail(input: ActionAssignedMail): MailMessage {
  const body = render({
    tone: "blue",
    title: "Action à réaliser",
    lead: "Une action de production vous a été assignée",
    greeting: `Bonjour ${input.employeeName},`,
    intro:
      "Une action de production vous a été assignée dans le système BICA-PACK. Merci de la prendre en charge.",
    sections: [
      {
        title: "Action assignée",
        rows: [
          { label: "Numéro", value: String(input.actionNumber) },
          { label: "Action", value: input.actionLabel },
          { label: "Ordre de fabrication", value: input.ofNumero },
        ],
      },
      {
        title: "Commande concernée",
        rows: [
          { label: "Numéro de commande", value: input.orderNumero },
          { label: "Client", value: input.clientName },
          { label: "Produit", value: input.productName },
        ],
      },
    ],
    link: { label: "Ouvrir l’ordre de fabrication", href: appUrl(`/manufacturing-orders/${input.ofId}`) },
  });
  return {
    to: input.to,
    subject: `Action à réaliser - ${input.orderNumero} - ${input.actionLabel}`,
    ...body,
  };
}

export interface NewEmployeeMail {
  to: string[];
  id: string;
  fullName: string;
  matricule: string;
  department: string | null;
  jobTitle: string | null;
  hireDate: Date | null;
  employmentType: string | null;
  photoUrl: string | null;
}

/** 5 — "Nouvelle recrue". */
export function newEmployeeMail(input: NewEmployeeMail): MailMessage {
  const body = render({
    tone: "teal",
    title: "Nouvelle recrue",
    lead: "Un nouvel employé vient d’être ajouté au système",
    intro: "Une nouvelle recrue vient d’être ajoutée dans le système BICA-PACK.",
    sections: [
      {
        title: "Informations de l’employé",
        rows: [
          { label: "Nom complet", value: input.fullName },
          { label: "Matricule", value: input.matricule },
          { label: "Département", value: input.department },
          { label: "Poste", value: input.jobTitle },
          { label: "Date d’embauche", value: frDay(input.hireDate) },
          { label: "Type de contrat", value: input.employmentType },
        ],
      },
    ],
    image: { title: "Photo employé", url: input.photoUrl },
    link: { label: "Ouvrir la fiche", href: appUrl(`/employees/${input.id}`) },
  });
  return { to: input.to, subject: `Nouvelle recrue - ${input.fullName}`, ...body };
}
