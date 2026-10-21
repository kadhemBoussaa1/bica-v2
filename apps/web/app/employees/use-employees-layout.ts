"use client";

import { useCallback, useSyncExternalStore } from "react";

/** The roster's two layouts, from `Employes Cartes.dc.html`. */
export type EmployeesLayout = "cards" | "list";

const STORAGE_KEY = "bicapack.employees.layout";

/*
 * localStorage as an external store, as `nav/use-sidebar.ts` does it: the
 * server snapshot is the default, so SSR and hydration agree, and two tabs
 * stay in step through the `storage` event. A per-browser convenience
 * only — nothing depends on it surviving.
 */

/** Subscribers in THIS tab, notified by the setter since `storage` will not be. */
const listeners = new Set<() => void>();

/** Where the choice lives while storage is blocked (private mode). */
let fallback: EmployeesLayout = "cards";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  listeners.add(onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    listeners.delete(onChange);
  };
}

function getSnapshot(): EmployeesLayout {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "cards" || stored === "list") return stored;
  } catch {
    // Blocked storage: the in-memory choice below.
  }
  return fallback;
}

function getServerSnapshot(): EmployeesLayout {
  return "cards";
}

/** The roster's layout, remembered per browser; cards until one is picked. */
export function useEmployeesLayout(): [EmployeesLayout, (next: EmployeesLayout) => void] {
  const layout = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setLayout = useCallback((next: EmployeesLayout) => {
    fallback = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Blocked storage: the choice lasts until the page is left.
    }
    for (const listener of listeners) listener();
  }, []);
  return [layout, setLayout];
}
