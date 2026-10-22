"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { controlClasses, FieldShell, type FieldSize } from "./field";
import { useUiStrings } from "./strings";
import styles from "./components.module.css";

/**
 * `keywords` is searched as well as the label, for words a row means but
 * does not show. A disabled option is listed but cannot be chosen, when the
 * server would refuse it and the label says why.
 */
export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
  keywords?: string;
}

interface ComboboxFieldProps {
  label: string;
  /** The chosen option's value; "" when none is. */
  value: string;
  onChange: (value: string) => void;
  options: readonly ComboboxOption[];
  /** Shown on the closed field while nothing is chosen. */
  placeholder?: string;
  /**
   * Lists the placeholder first, as a choice, when blank is itself an answer
   * — "no client". Without it, nothing chosen cannot be chosen back.
   */
  allowEmpty?: boolean;
  /** The search box at the top of the open list. */
  searchPlaceholder?: string;
  /** The line under a search nothing matches. */
  noMatch?: (search: string) => string;
  disabled?: boolean;
  error?: string;
  size?: FieldSize;
}

/**
 * Case, accents and spaces aside, and a typed x for the sizes' ×: "1665 c"
 * finds 1665C, "rouge" finds ROUGE, "28x17" finds 28×17×28.
 */
function searchable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/×/g, "x")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** The gap between the field and its list, and the list's tallest. */
const GAP = 8;
const MAX_HEIGHT = 360;

/**
 * A select whose list opens with a search at its top, for lists too long to
 * scroll — a hundred ink colours, say. Closed, it is a control like the
 * others; open, the search takes the keyboard: arrows move, Enter chooses,
 * Escape closes.
 *
 * The list is a popover in the browser's top layer, placed against the field
 * by script — under it, or over it when the screen has more room there — so
 * no card, glass panel or scrolling dialog around the field can clip it.
 */
export function ComboboxField({
  label,
  value,
  onChange,
  options,
  placeholder,
  allowEmpty = false,
  searchPlaceholder,
  noMatch,
  disabled = false,
  error,
  size = "touch",
}: ComboboxFieldProps) {
  const strings = useUiStrings();
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const matching = (text: string): readonly ComboboxOption[] => {
    const term = searchable(text);
    if (term === "") return allowEmpty ? [{ value: "", label: placeholder ?? "" }, ...options] : options;
    return options.filter((option) => searchable(`${option.label} ${option.keywords ?? ""}`).includes(term));
  };
  const shown = matching(search);
  const chosen = options.find((option) => option.value === value);

  /** The first option of `list` that can be chosen from `from` on, stepping by `step`. */
  const nextEnabled = (list: readonly ComboboxOption[], from: number, step: 1 | -1) => {
    for (let index = from; index >= 0 && index < list.length; index += step) {
      if (!list[index]?.disabled) return index;
    }
    return -1;
  };

  /** The list opens on the chosen option; a search starts at its first match. */
  function searchFor(text: string) {
    const list = matching(text);
    const at = text === "" ? list.findIndex((option) => option.value === value) : -1;
    setSearch(text);
    setActive(at !== -1 ? at : nextEnabled(list, 0, 1));
  }

  function openList(initial = "") {
    if (disabled) return;
    searchFor(initial);
    setOpen(true);
  }

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function choose(option: ComboboxOption | undefined) {
    if (!option || option.disabled) return;
    onChange(option.value);
    close(true);
  }

  // Into the top layer and next to the field, then the search takes focus.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!open || !panel || !trigger) return;
    const place = () => {
      const box = trigger.getBoundingClientRect();
      const below = window.innerHeight - box.bottom - GAP * 2;
      const above = box.top - GAP * 2;
      const downwards = below >= Math.min(MAX_HEIGHT, panel.scrollHeight) || below >= above;
      panel.style.left = `${box.left}px`;
      panel.style.width = `${box.width}px`;
      panel.style.maxHeight = `${Math.max(160, Math.min(MAX_HEIGHT, downwards ? below : above))}px`;
      panel.style.top = downwards ? `${box.bottom + GAP}px` : "auto";
      panel.style.bottom = downwards ? "auto" : `${window.innerHeight - box.top + GAP}px`;
    };
    if (!panel.matches(":popover-open")) panel.showPopover();
    place();
    searchRef.current?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      if (panel.matches(":popover-open")) panel.hidePopover();
    };
  }, [open]);

  // Closes on a press outside the field and its list.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  // The highlighted option stays in sight as the arrows move it.
  useEffect(() => {
    if (open && active >= 0) {
      document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [open, active, id]);

  function onTriggerKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openList();
    } else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Typing on the closed field starts the search with that letter.
      event.preventDefault();
      openList(event.key);
    }
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = nextEnabled(shown, active + step, step);
      if (next !== -1) setActive(next);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(shown[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  }

  return (
    <FieldShell label={label} error={error} htmlFor={id}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={[controlClasses("text", size, error), styles.comboTrigger].filter(Boolean).join(" ")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={error ? true : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onTriggerKey}
      >
        <span className={[styles.comboValue, chosen ? null : styles.comboPlaceholder].filter(Boolean).join(" ")}>
          {chosen?.label ?? placeholder ?? ""}
        </span>
        <svg className={styles.comboChevron} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div ref={panelRef} popover="manual" className={styles.comboPanel}>
        {open && (
          <>
            <input
              ref={searchRef}
              type="search"
              className={[controlClasses("text", "dense"), styles.comboSearch].filter(Boolean).join(" ")}
              value={search}
              onChange={(event) => searchFor(event.target.value)}
              onKeyDown={onSearchKey}
              placeholder={searchPlaceholder ?? strings.search}
              aria-label={label}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 ? optionId(active) : undefined}
              autoComplete="off"
            />
            <ul id={listId} role="listbox" aria-label={label} className={styles.comboList}>
              {shown.map((option, index) => {
                const selected = option.value === value;
                return (
                  <li
                    key={option.value}
                    id={optionId(index)}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={option.disabled || undefined}
                    className={[
                      styles.comboOption,
                      index === active ? styles.comboOptionActive : null,
                      selected ? styles.comboOptionSelected : null,
                      option.disabled ? styles.comboOptionDisabled : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onPointerMove={() => {
                      if (!option.disabled && index !== active) setActive(index);
                    }}
                    // Keep focus in the search while the press lands.
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => choose(option)}
                  >
                    <span className={styles.comboOptionLabel}>{option.label}</span>
                    {selected && (
                      <svg className={styles.comboCheck} viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </li>
                );
              })}
            </ul>
            {shown.length === 0 && (
              <p className={styles.comboEmpty} role="status">
                {noMatch ? noMatch(search.trim()) : strings.nothingMatches}
              </p>
            )}
          </>
        )}
      </div>
    </FieldShell>
  );
}
