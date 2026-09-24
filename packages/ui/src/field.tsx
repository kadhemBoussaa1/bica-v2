import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";
import styles from "./components.module.css";

/** Touch (48px) by default; dense (36px) for desktop toolbars and table rows. */
export type FieldSize = "touch" | "dense";

interface CheckboxFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "type"
> {
  label: string;
  /** Helper text under the label, e.g. why the box is disabled. */
  hint?: string;
}

/**
 * A checkbox whose whole row is the target: a bordered 48px box with the
 * label beside the control rather than above it. The other fields'
 * `FieldShell` puts the label on its own line, which reads oddly for a
 * yes/no toggle.
 */
export function CheckboxField({
  label,
  hint,
  className,
  ...rest
}: CheckboxFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <label
      htmlFor={id}
      className={[styles.checkboxRow, className].filter(Boolean).join(" ")}
    >
      <input
        id={id}
        type="checkbox"
        className={styles.checkboxControl}
        aria-describedby={hintId}
        {...rest}
      />
      <span className={styles.checkboxLabel}>
        {label}
        {hint && (
          <span id={hintId} className={styles.checkboxHint}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

interface FieldShellProps {
  label: string;
  /** Rendered next to the label in neutral, e.g. "pcs" or "mm". */
  unit?: string;
  error?: string;
  htmlFor: string;
  /** Ties the message to its control via aria-describedby. */
  errorId?: string;
  children: ReactNode;
}

function FieldShell({
  label,
  unit,
  error,
  htmlFor,
  errorId,
  children,
}: FieldShellProps) {
  const labelClasses = [
    styles.fieldLabel,
    error ? styles.fieldLabelError : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.field}>
      <label className={labelClasses} htmlFor={htmlFor}>
        {label}
        {unit && <span className={styles.fieldUnit}> {unit}</span>}
      </label>
      {children}
      {error && (
        <span id={errorId} className={styles.fieldError}>
          {error}
        </span>
      )}
    </div>
  );
}

/** Numeric aligns right with tabular figures; mono keeps dates fixed-width. */
type ControlFormat = "text" | "numeric" | "mono";

function controlClasses(
  format: ControlFormat,
  size: FieldSize,
  error?: string,
) {
  return [
    styles.control,
    size === "dense" ? styles.controlDense : null,
    format === "numeric" ? styles.controlNumeric : null,
    format === "mono" ? styles.controlMono : null,
    error ? styles.controlError : null,
  ]
    .filter(Boolean)
    .join(" ");
}

interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "size"
> {
  label: string;
  unit?: string;
  error?: string;
  format?: ControlFormat;
  size?: FieldSize;
}

export function TextField({
  label,
  unit,
  error,
  format = "text",
  size = "touch",
  type = "text",
  ...rest
}: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <FieldShell
      label={label}
      unit={unit}
      error={error}
      htmlFor={id}
      errorId={errorId}
    >
      <input
        id={id}
        type={type}
        className={controlClasses(format, size, error)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
    </FieldShell>
  );
}

/**
 * A bare string is both the value and the label; the object form separates them
 * for stored values that are not display text — an enum like ACCESSOIRE, say.
 */
export type SelectOption = string | { value: string; label: string };

interface SelectFieldProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "id" | "size"
> {
  label: string;
  error?: string;
  options: readonly SelectOption[];
  /**
   * Renders an empty first option. Without one a select silently reports its
   * first option as chosen, so a required field would submit a value the user
   * never picked.
   *
   * Disabled by default, which is right for a required field. Pass
   * `allowEmpty` when blank is itself a valid answer, or the user cannot go
   * back to it after choosing something.
   */
  placeholder?: string;
  allowEmpty?: boolean;
  size?: FieldSize;
}

export function SelectField({
  label,
  error,
  options,
  placeholder,
  allowEmpty = false,
  size = "touch",
  ...rest
}: SelectFieldProps) {
  const id = useId();
  return (
    <FieldShell label={label} error={error} htmlFor={id}>
      <select
        id={id}
        className={controlClasses("text", size, error)}
        aria-invalid={error ? true : undefined}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled={!allowEmpty}>
            {placeholder}
          </option>
        )}
        {options.map((option) => {
          const value = typeof option === "string" ? option : option.value;
          const text = typeof option === "string" ? option : option.label;
          return (
            <option key={value} value={value}>
              {text}
            </option>
          );
        })}
      </select>
    </FieldShell>
  );
}

interface TextAreaFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id"
> {
  label: string;
  unit?: string;
  error?: string;
}

export function TextAreaField({
  label,
  unit,
  error,
  rows = 2,
  ...rest
}: TextAreaFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <FieldShell label={label} unit={unit} error={error} htmlFor={id} errorId={errorId}>
      <textarea
        id={id}
        rows={rows}
        className={[
          styles.control,
          styles.controlTextarea,
          error ? styles.controlError : null,
        ]
          .filter(Boolean)
          .join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
    </FieldShell>
  );
}
