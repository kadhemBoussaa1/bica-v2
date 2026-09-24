"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SettingsRail } from "./settings-rail";
import styles from "./settings.module.css";

/**
 * True on the pages the rail belongs beside: the section roots and their
 * `/new` forms. The template editor and designer (`/settings/templates/<id>`
 * and deeper) need the whole width and render bare.
 */
function showsRail(pathname: string): boolean {
  const depth = pathname.split("/").filter(Boolean).length;
  return depth <= 2 || pathname.endsWith("/new");
}

/**
 * The two-column frame of the settings module: the rail, then the page. A
 * client component only because the rail's presence depends on the route;
 * the pages inside stay server components and pass straight through.
 */
export function SettingsFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (!showsRail(pathname)) return <>{children}</>;
  return (
    <div className={styles.frame}>
      {/*
        One panel holding both columns. `data-surface="panel"` tells anything
        inside that it is already on a panel, so the toolkit's table and the
        module's own sections drop their card chrome instead of stacking a
        second surface on this one.
      */}
      <div className={styles.columns} data-surface="panel">
        <SettingsRail />
        <div className={styles.main}>{children}</div>
      </div>
    </div>
  );
}
