import { getTranslations } from "next-intl/server";
import { LabelsSheet } from "./labels-sheet";

/**
 * Printable reel labels — one 10 × 10 cm sheet per reel.
 *
 * `@page` is declared inline here rather than in a CSS module: a module's
 * `@page` is not scoped by the module system (it is an at-rule, not a class),
 * so it would set the paper size for every route in the app the moment this
 * chunk loaded.
 */
export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ shipment?: string; rolls?: string }>;
}) {
  const { shipment, rolls } = await searchParams;
  const t = await getTranslations("stock");

  return (
    <>
      <style>{"@page{size:100mm 100mm;margin:0}"}</style>
      <LabelsSheet
        shipmentId={shipment}
        rollIds={rolls ? rolls.split(",").filter(Boolean) : undefined}
        title={t("labels.title")}
      />
    </>
  );
}
