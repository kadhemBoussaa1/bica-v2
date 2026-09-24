import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TableSkeleton } from "@repo/ui/skeleton";
import { SettingsHeader } from "../settings-header";
import { ActivityView } from "./activity-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("activity");
  return { title: t("metaTitle") };
}

export default async function ActivityPage() {
  const t = await getTranslations("activity");
  return (
    <>
      {/* No intro: the rail's hint beside it already reads "Who did what,
          and when", and the chips below name what the list holds. */}
      <SettingsHeader group="access" title={t("title")} />
      <Suspense fallback={<TableSkeleton />}>
        <ActivityView />
      </Suspense>
    </>
  );
}
