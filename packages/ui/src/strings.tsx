"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The few words the toolkit says on its own: pager buttons, the "All" chip,
 * "Cancel" on a dialog, the loading label. The package has no translation
 * layer of its own — the app provides these through `UiStringsProvider`,
 * already translated, and everything else the components show comes from
 * the caller (labels, titles, messages).
 */
export interface UiStrings {
  all: string;
  prev: string;
  next: string;
  search: string;
  nothingMatches: string;
  cancel: string;
  working: string;
  close: string;
  dismiss: string;
  loading: string;
  /** "1–10 of 42". `total` is never 0 here; see `zeroOfZero`. */
  rangeOf: (start: number, end: number, total: number) => string;
  zeroOfZero: string;
  /** Labels the pager's rows-per-page picker. */
  perPage: string;
}

export const ENGLISH_UI_STRINGS: UiStrings = {
  all: "All",
  prev: "Prev",
  next: "Next",
  search: "Search",
  nothingMatches: "Nothing matches these filters.",
  cancel: "Cancel",
  working: "Working…",
  close: "Close",
  dismiss: "Dismiss",
  loading: "Loading",
  rangeOf: (start, end, total) => `${start}–${end} of ${total}`,
  zeroOfZero: "0 of 0",
  perPage: "Per page",
};

const UiStringsContext = createContext<UiStrings>(ENGLISH_UI_STRINGS);

export function UiStringsProvider({
  value,
  children,
}: {
  value: UiStrings;
  children: ReactNode;
}) {
  return <UiStringsContext.Provider value={value}>{children}</UiStringsContext.Provider>;
}

export function useUiStrings(): UiStrings {
  return useContext(UiStringsContext);
}
