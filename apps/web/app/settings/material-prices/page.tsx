import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsHeader } from "../settings-header";
import { MaterialsProvider } from "./materials-provider";
import { MaterialsTable, NewMaterialButton } from "./materials-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("materials");
  return { title: t("metaTitle") };
}

/**
 * The paper and glue price catalogue the order form prefills from
 * (docs/raw-material-prices-plan.md §5). ADMIN and above, like every
 * procedure behind it; a material opens in a dialog, and `?material=<id>`
 * opens one directly — the activity trace links there.
 */
export default async function MaterialPricesPage({
  searchParams,
}: {
  searchParams: Promise<{ material?: string | string[] }>;
}) {
  const t = await getTranslations("materials");
  const material = (await searchParams).material;
  return (
    <MaterialsProvider initialId={typeof material === "string" && material !== "" ? material : null}>
      <SettingsHeader
        group="pricing"
        title={t("title")}
        intro={t("subtitle")}
        action={<NewMaterialButton />}
      />
      <MaterialsTable />
    </MaterialsProvider>
  );
}
