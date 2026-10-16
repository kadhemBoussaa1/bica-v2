"use client";

import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";
import { controlClasses, FieldShell, type FieldSize } from "./field";
import { useUiStrings } from "./strings";
import styles from "./components.module.css";

/*
 * Dates read dd/mm/yyyy in every language (apps/web/i18n/formats.ts), but
 * `<input type="date">` draws the BROWSER's locale and no page can change
 * it: an English Chrome shows mm/dd/yyyy whatever the app speaks. So the
 * field is a text input in our format, and the native input survives only
 * as the calendar behind the button.
 *
 * The value in and out is the native one, "yyyy-mm-dd" for a complete real
 * date and "" otherwise, so swapping `TextField type="date"` for `DateField`
 * changes no caller's state.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const SEPARATOR = /[/.\-\s]/;

/** "2026-10-16" → "16/10/2026"; anything else → "". */
export function isoToDateText(iso: string): string {
  const match = ISO.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

/**
 * The day a typed text names, as "yyyy-mm-dd", or null when it names none.
 * Takes "16/10/2026", "1/2/2026", "16.10.2026" and "16102026"; the year must
 * have four digits — a two-digit one is a century guess, and a birth date
 * typed "85" must not land in 2085.
 */
export function dateTextToIso(text: string): string | null {
  const trimmed = text.trim();
  const match =
    /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/.exec(trimmed) ??
    /^(\d{2})(\d{2})(\d{4})$/.exec(trimmed);
  if (!match) return null;
  const [, d = "", m = "", y = ""] = match;
  const day = Number(d);
  const month = Number(m);
  const year = Number(y);
  if (year < 1900 || year > 2099 || month < 1 || month > 12) return null;
  // Day 0 of the next month is the last day of this one.
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Typing at the end of the field, shaped into dd/mm/yyyy: the slashes come
 * by themselves (a tablet's number pad has none), and a separator typed
 * after one digit closes that part, so "1/" becomes "01/". A slash appears
 * only once the next digit arrives, so backspace never fights it.
 */
export function maskDateText(raw: string): string {
  const iso = ISO.exec(raw.trim());
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const parts = [""];
  for (const char of raw) {
    const index = parts.length - 1;
    const part = parts[index] ?? "";
    if (char >= "0" && char <= "9") {
      if (part.length < (index < 2 ? 2 : 4)) parts[index] = part + char;
      else if (index < 2) parts.push(char);
    } else if (SEPARATOR.test(char) && index < 2 && part !== "") {
      parts[index] = part.padStart(2, "0");
      parts.push("");
    }
  }
  return parts.join("/");
}

/**
 * The text the field shows, kept apart from the ISO value its caller holds:
 * a half-typed date is text with no value yet, as in a native date input.
 */
function useDateText(value: string, onChange: (value: string) => void) {
  const [text, setText] = useState(() => isoToDateText(value));
  const [seen, setSeen] = useState(value);
  // Left the field since the last keystroke: only then is a short date wrong
  // rather than still being typed.
  const [settled, setSettled] = useState(false);

  // A value from outside (a reset, a default, a step button) replaces the
  // text, unless the text already says it, which covers every value this
  // field emitted itself, "" for a half-typed date included.
  if (value !== seen) {
    setSeen(value);
    if (value !== (dateTextToIso(text) ?? "")) setText(isoToDateText(value));
  }

  const commit = (next: string) => {
    setText(next);
    const iso = dateTextToIso(next) ?? "";
    if (iso !== value) onChange(iso);
  };

  return {
    text,
    invalid:
      text.trim() !== "" &&
      dateTextToIso(text) === null &&
      (settled || text.length >= 10),
    onTextChange(event: ChangeEvent<HTMLInputElement>) {
      const raw = event.target.value;
      // Masking a mid-text edit would jump the caret to the end, so only
      // typing at the end is shaped; anything else is tidied on blur.
      const typedAtEnd =
        raw.length > text.length && event.target.selectionStart === raw.length;
      setSettled(false);
      commit(
        typedAtEnd
          ? maskDateText(raw)
          : raw.replace(/[^\d/.\-\s]/g, "").slice(0, 10),
      );
    },
    onTextBlur() {
      setSettled(true);
      const iso = dateTextToIso(text);
      if (iso) setText(isoToDateText(iso));
    },
    onPick(iso: string) {
      setSettled(false);
      commit(isoToDateText(iso));
    },
  };
}

type DateText = ReturnType<typeof useDateText>;

interface DateInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange" | "size"
> {
  /** "yyyy-mm-dd", or "" for no date — what `<input type="date">` holds. */
  value: string;
  /** "yyyy-mm-dd" once the text names a real date, "" while it does not. */
  onChange: (value: string) => void;
  size?: FieldSize;
}

function DateControl({
  date,
  size,
  className,
  disabled,
  onBlur,
  ...rest
}: Omit<DateInputProps, "value" | "onChange"> & { date: DateText }) {
  const strings = useUiStrings();
  const picker = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const input = picker.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      // No showPicker (Safari before 16): a focused date input still
      // opens its picker on a touch device.
      input.focus();
    }
  };

  return (
    <div
      className={[styles.dateControl, size === "dense" ? styles.dateControlDense : null]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={strings.datePlaceholder}
        {...rest}
        className={[className, styles.dateText, date.invalid ? styles.dateTextInvalid : null]
          .filter(Boolean)
          .join(" ")}
        value={date.text}
        onChange={date.onTextChange}
        onBlur={(event) => {
          date.onTextBlur();
          onBlur?.(event);
        }}
        disabled={disabled}
      />
      {/* The calendar only: invisible, never hit, out of the tab order. It
          spans the field so the browser opens its popup under the field. */}
      <input
        ref={picker}
        type="date"
        className={styles.datePicker}
        tabIndex={-1}
        aria-hidden="true"
        value={dateTextToIso(date.text) ?? ""}
        onChange={(event) => date.onPick(event.target.value)}
        disabled={disabled}
      />
      <button
        type="button"
        className={styles.dateButton}
        onClick={openPicker}
        disabled={disabled}
        aria-label={strings.openCalendar}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      </button>
    </div>
  );
}

/**
 * A bare dd/mm/yyyy input, for a date that sits in a toolbar rather than a
 * form. `className` replaces the field look; a wrong date only reddens the
 * border, since there is no message line to put words on.
 */
export function DateInput({
  value,
  onChange,
  size = "touch",
  className,
  ...rest
}: DateInputProps) {
  const date = useDateText(value, onChange);
  return (
    <DateControl
      date={date}
      size={size}
      className={className ?? controlClasses("mono", size)}
      {...rest}
    />
  );
}

interface DateFieldProps extends DateInputProps {
  label: string;
  unit?: string;
  error?: string;
}

/** The labelled date field: `TextField`'s shell around a dd/mm/yyyy input. */
export function DateField({
  label,
  unit,
  error,
  size = "touch",
  value,
  onChange,
  "aria-invalid": ariaInvalid,
  ...rest
}: DateFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const strings = useUiStrings();
  const date = useDateText(value, onChange);
  const message = error ?? (date.invalid ? strings.invalidDate : undefined);
  return (
    <FieldShell label={label} unit={unit} error={message} htmlFor={id} errorId={errorId}>
      <DateControl
        date={date}
        id={id}
        size={size}
        className={controlClasses("mono", size, message)}
        aria-invalid={ariaInvalid ?? (message ? true : undefined)}
        aria-describedby={message ? errorId : undefined}
        {...rest}
      />
    </FieldShell>
  );
}
