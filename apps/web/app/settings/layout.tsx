import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { SettingsFrame } from "./settings-frame";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("metaTitle") };
}

/**
 * The settings module (the "Settings v3" handoff, rail approach): a second
 * rail, private to the module, beside every page in it — users, activity,
 * document templates (`SETTINGS_CHILDREN` in nav/nav-items.ts) — with each
 * section's live figure. The rail steps aside on the template editor, which
 * needs the whole width; see `SettingsFrame`.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <SettingsFrame>{children}</SettingsFrame>;
}
