import { useTranslations } from "next-intl";
import type {
  ManufacturingActionStatus,
  ManufacturingOrderStatus,
} from "@repo/api-contract";
import shell from "../records/banded-list.module.css";
import { formatDateTime, formatDay as day } from "../../i18n/formats";
import styles from "./manufacturing.module.css";

/*
 * Shared bits of the manufacturing-order screens — the list, the templates
 * tab, the OF page and the order page's card — from
 * "Ordres de fabrication v3.dc.html".
 */

/** The app's date formats, with the dash every empty field shows. */
export function formatDay(value: string | Date | null): string {
  return value === null ? "—" : day(value);
}

export function formatMoment(value: string | Date | null): string {
  return value === null ? "—" : formatDateTime(value);
}

/*
 * A status is a tone: colour AND dot shape, so the set survives a grayscale
 * print. The tones are the banded lists' (`--state-*` variables), set on
 * whatever carries the class and read by the pill inside it.
 */
export const ORDER_TONE: Record<ManufacturingOrderStatus, string | undefined> = {
  DRAFT: shell.toneNeutral,
  IN_PROGRESS: shell.tonePending,
  DONE: shell.toneSuccess,
  CANCELLED: shell.toneDanger,
};

export const ACTION_TONE: Record<ManufacturingActionStatus, string | undefined> = {
  WAITING: shell.toneNeutral,
  IN_PROGRESS: shell.tonePending,
  DONE: shell.toneSuccess,
  SKIPPED: shell.toneWarning,
};

function Pill({ tone, label }: { tone: string | undefined; label: string }) {
  return (
    <span className={[shell.pill, tone].filter(Boolean).join(" ")}>
      <i className={shell.pillDot} aria-hidden />
      {label}
    </span>
  );
}

export function ActionStatusPill({ status }: { status: ManufacturingActionStatus }) {
  const enums = useTranslations("enums");
  return <Pill tone={ACTION_TONE[status]} label={enums(`manufacturingActionStatus.${status}`)} />;
}

export function OrderStatusPill({ status }: { status: ManufacturingOrderStatus }) {
  const enums = useTranslations("enums");
  return <Pill tone={ORDER_TONE[status]} label={enums(`manufacturingOrderStatus.${status}`)} />;
}

/** The three switches of an action or a template row. */
export interface Handles {
  handlesEmployees: boolean;
  handlesMachine: boolean;
  handlesAttachments: boolean;
}

export type HandleKey = keyof Handles;
export type HandleName = "employees" | "machine" | "attachments";

export const HANDLE_KEYS = [
  ["handlesEmployees", "employees"],
  ["handlesMachine", "machine"],
  ["handlesAttachments", "attachments"],
] as const satisfies readonly (readonly [HandleKey, HandleName])[];

/** One glyph per field an action can offer: a person, a machine, a paper clip. */
const HANDLE_PATHS: Record<HandleName, string> = {
  employees: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2 M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  machine:
    "M6 9V3h12v6 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v7H6z",
  attachments:
    "m21.4 11-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6a4 4 0 1 1 5.7 5.7l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5",
};

const FILE_PATH = "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6";

function Glyph({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

export function HandleGlyph({ name }: { name: HandleName }) {
  return <Glyph path={HANDLE_PATHS[name]} />;
}

export function FileGlyph() {
  return <Glyph path={FILE_PATH} />;
}

/**
 * What an action offers, as small icon tiles. `toned` colours them by field
 * (machine blue, files orange), as on a template card; plain otherwise.
 */
export function HandleIcons({ value, toned = false }: { value: Handles; toned?: boolean }) {
  const t = useTranslations("manufacturing");
  const on = HANDLE_KEYS.filter(([key]) => value[key]);
  if (on.length === 0) return null;
  return (
    <span className={styles.caps}>
      {on.map(([key, name]) => (
        <span
          key={key}
          className={[styles.cap, toned ? styles[`cap_${name}`] : null].filter(Boolean).join(" ")}
          title={t(`handles.${name}`)}
        >
          <HandleGlyph name={name} />
        </span>
      ))}
    </span>
  );
}
