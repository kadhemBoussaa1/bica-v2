"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { isPricingLocked, type PricingSlot } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { useToast } from "@repo/ui/toast";
import { numberFormat } from "../../i18n/formats";
import records from "../records/records.module.css";
import { useTRPC } from "../trpc/client";
import styles from "./order-detail.module.css";

type PricedOrder = Extract<inferRouterOutputs<AppRouter>["order"]["byId"], { orderTotal: unknown }>;
type Line = PricedOrder["materialPrices"][number];

const kilo = () => numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 4 });
const grams = () => numberFormat({ maximumFractionDigits: 3 });
const money = () => numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A stored catalogue line the catalogue has moved past since. */
export function isStaleLine(line: Line): boolean {
  const current = line.material?.prices[0];
  return !line.manual && line.material?.active === true && current !== undefined && current.id !== line.sourcePriceId;
}

/**
 * The order's paper and glue lines on its detail page: each material, the
 * kilo price the order is calculated with and where that price came from
 * (docs/raw-material-prices-plan.md §5). On an open order whose catalogue
 * prices moved since it was saved, a notice and "Update prices" — the only
 * way a catalogue change reaches a saved order, and only on request.
 */
export function OrderMaterialPrices({ order, canWrite }: { order: PricedOrder; canWrite: boolean }) {
  const t = useTranslations("orders");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { push } = useToast();

  const locked = isPricingLocked(order);
  const p = order.product;
  const line = (slot: PricingSlot) => order.materialPrices.find((entry) => entry.slot === slot) ?? null;
  const stale = locked ? [] : order.materialPrices.filter(isStaleLine);

  const refresh = useMutation(
    trpc.order.refreshMaterialPrices.mutationOptions({
      onSuccess: async (result) => {
        await queryClient.invalidateQueries({ queryKey: trpc.order.byId.queryKey({ id: order.id }) });
        await queryClient.invalidateQueries({ queryKey: trpc.order.list.queryKey() });
        push({
          title: t("lines.updated"),
          text: t("lines.updatedTotal", {
            before: result.before === null ? "—" : money().format(result.before),
            after: result.after === null ? "—" : money().format(result.after),
          }),
          tone: "success",
        });
      },
      onError: (cause) => push({ title: cause.message, tone: "error" }),
    }),
  );

  const rows: { slot: PricingSlot; label: string; weight: number | null; shown: boolean }[] = [
    { slot: "PAPER", label: t("pricing.paperPrice"), weight: null, shown: true },
    {
      slot: "HANDLE_GLUE",
      label: t("pricing.handleGlue"),
      weight: order.handleGlueWeightG,
      shown: p.hasHandle || line("HANDLE_GLUE") !== null,
    },
    {
      slot: "SIDE_GLUE",
      label: t("pricing.sideGlue"),
      weight: order.sideGlueWeightG,
      shown: p.typeSac !== "SOUS_PLAT" || line("SIDE_GLUE") !== null,
    },
    {
      slot: "BASE_ADHESIVE",
      label: t("pricing.baseAdhesive"),
      weight: order.baseAdhesiveWeightG,
      shown: p.typeSac !== "SOUS_PLAT" || line("BASE_ADHESIVE") !== null,
    },
  ];

  return (
    <>
      {rows
        .filter((row) => row.shown)
        .map((row) => {
          const entry = line(row.slot);
          const material = entry ? (entry.label ?? null) : null;
          return (
            <div key={row.slot} className={styles.moneyRow}>
              <span className={styles.moneyLabel}>{row.label}</span>
              <span className={[styles.lineValue, entry ? null : styles.absent].filter(Boolean).join(" ")}>
                {entry ? (
                  <>
                    {kilo().format(entry.kiloPrice)}
                    <span className={styles.unit}> /kg</span>
                    {row.weight !== null && ` · ${grams().format(row.weight)} g`}
                    {material && (
                      <span className={styles.lineMaterial}>
                        {" · "}
                        {[material, entry.supplierName].filter(Boolean).join(" · ")}
                      </span>
                    )}{" "}
                    <SourceBadge line={entry} />
                  </>
                ) : (
                  "—"
                )}
              </span>
            </div>
          );
        })}

      {locked ? (
        <p className={styles.hint}>{t("lines.lockedDetail")}</p>
      ) : stale.length > 0 ? (
        <div className={styles.staleNotice} role="status">
          <span>
            <strong>{t("lines.staleTitle")}</strong> {t("lines.staleText", { count: stale.length })}
          </span>
          {canWrite && (
            <Button
              size="dense"
              variant="primary"
              busy={refresh.isPending}
              onClick={() => refresh.mutate({ orderId: order.id })}
            >
              {t("lines.updatePrices")}
            </Button>
          )}
        </div>
      ) : null}
    </>
  );
}

/** Where a line's price came from: the catalogue, typed by hand, or from before the catalogue. */
function SourceBadge({ line }: { line: Line }) {
  const t = useTranslations("orders");
  const [label, tone] =
    line.material === null
      ? [t("lines.badgeCarried"), records.statusNeutral]
      : line.manual
        ? [t("lines.badgeManual"), records.statusActive]
        : isStaleLine(line)
          ? [t("lines.badgeStale"), records.statusWarning]
          : [t("lines.badgeCatalogue"), records.statusInfo];
  return <span className={[records.statusBadge, tone].filter(Boolean).join(" ")}>{label}</span>;
}
