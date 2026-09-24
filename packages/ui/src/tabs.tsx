"use client";

import styles from "./components.module.css";

export interface Tab<K extends string = string> {
  key: K;
  label: string;
}

interface TabsProps<K extends string> {
  tabs: readonly Tab<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Names the tab list for assistive tech, e.g. "Client record sections". */
  label: string;
}

/**
 * A row of text tabs under a hairline, the active one marked with a 2px
 * orange rule. Controlled: the caller owns which tab is open. Scrolls
 * sideways on a narrow screen rather than wrapping.
 */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  label,
}: TabsProps<K>) {
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={[styles.tab, active ? styles.tabActive : null]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onChange(tab.key)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
