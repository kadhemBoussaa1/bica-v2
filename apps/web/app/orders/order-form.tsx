"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  createOrderInput,
  ORDER_KINDS,
  priceOrder,
  productSpecFromRow,
  TYPE_IMPRESSIONS,
  toPricingInputs,
  updateOrderInput,
  type ProductSpec,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { SelectField, TextField } from "@repo/ui/field";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { ProductSpecFields } from "../products/product-spec-fields";
import { useTRPC } from "../trpc/client";
import styles from "../records/records.module.css";
import orderStyles from "./orders.module.css";

/**
 * The order as the edit form needs it — the PRICED shape.
 *
 * `order.byId` returns a union now (the server omits every money column for
 * callers who may not read pricing — see `ORDER_LIST_SELECT` in
 * order.list.ts), but this form is only ever reached through the ADMIN-gated
 * edit route, and it must round-trip every pricing input on save. Narrowing
 * to the priced branch here states that requirement in the type rather than
 * spreading `in` checks across 40 fields.
 */
export type OrderFormValues = Extract<
  inferRouterOutputs<AppRouter>["order"]["byId"],
  { orderTotal: unknown }
>;

/**
 * A row from `product.forClient` or `order.byId`'s `product` — whatever the
 * caller has on hand — normalised to what `productSpecFromRow` and the
 * picker's option label need. Both shapes already carry these fields.
 */
type ProductOption = {
  id: string;
  name: string;
  active: boolean;
} & Parameters<typeof productSpecFromRow>[0];

const str = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

/** The flat DB names carried in `nums`, matching `ORDER_DETAIL_SELECT`'s inputs. */
const NUM_KEYS = [
  "quantite",
  "paperKiloPrice",
  "profitMarginPct",
  "lossMarginPct",
  "handleGlueKiloPrice",
  "handleGlueWeightG",
  "sideGlueKiloPrice",
  "sideGlueWeightG",
  "baseAdhesiveKiloPrice",
  "baseAdhesiveWeightG",
  "piecesPerParcel",
  "kilosPerParcel",
  "parcelPrice",
  "transportCost",
] as const;

const numFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 });
const money = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const parcels = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Renders a live figure, or a dash — never 0 for something that is not priced yet. */
function Figure({
  value,
  fmt,
  suffix,
}: {
  value: number | null;
  fmt: Intl.NumberFormat;
  suffix?: string;
}) {
  if (value === null) return <span className={styles.absent} />;
  return (
    <>
      {fmt.format(value)}
      {suffix ? ` ${suffix}` : ""}
    </>
  );
}

export function OrderForm({
  initial,
  onDone,
  onCancel,
}: {
  onDone?: (target: string) => void | Promise<void>;
  onCancel?: (target: string) => void;
  initial?: OrderFormValues;
}) {
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const router = useRouter();
  // The route modal passes both; the full page falls through to navigation.
  const go = (target: string) => (onDone ? onDone(target) : router.push(target));
  const cancel = (target: string) => (onCancel ? onCancel(target) : router.push(target));
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Which of the three steps is showing, and whether the current one has been
  // submitted incomplete — see the block above `goStep`.
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [touched, setTouched] = useState(false);

  const [numero, setNumero] = useState(initial?.numero ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [clientId, setClientId] = useState(initial?.clientId ?? "");

  const [nums, setNums] = useState<Record<(typeof NUM_KEYS)[number], string>>({
    quantite: str(initial?.quantite),
    paperKiloPrice: str(initial?.paperKiloPrice),
    profitMarginPct: str(initial?.profitMarginPct),
    lossMarginPct: str(initial?.lossMarginPct),
    handleGlueKiloPrice: str(initial?.handleGlueKiloPrice),
    handleGlueWeightG: str(initial?.handleGlueWeightG),
    sideGlueKiloPrice: str(initial?.sideGlueKiloPrice),
    sideGlueWeightG: str(initial?.sideGlueWeightG),
    baseAdhesiveKiloPrice: str(initial?.baseAdhesiveKiloPrice),
    baseAdhesiveWeightG: str(initial?.baseAdhesiveWeightG),
    piecesPerParcel: str(initial?.piecesPerParcel),
    kilosPerParcel: str(initial?.kilosPerParcel),
    parcelPrice: str(initial?.parcelPrice),
    transportCost: str(initial?.transportCost),
  });
  const n = (key: (typeof NUM_KEYS)[number]) => nums[key];
  const setN = (key: (typeof NUM_KEYS)[number], value: string) =>
    setNums((current) => ({ ...current, [key]: value }));

  // `status` and `exportStatus` are not form fields: they move exclusively
  // through the transition panel on the order's detail page
  // (`OrderTransitions`). `kind` is a field on CREATE only — quote or order is
  // chosen once, and afterwards only "Accept quote" changes it — see
  // `OrderService`'s doc comments on `create`/`transition`/`acceptQuote`.
  const [kind, setKind] = useState<(typeof ORDER_KINDS)[number]>("ORDER");
  const [typeImpression, setTypeImpression] = useState(
    initial?.typeImpression ?? "",
  );

  // ---- product: existing or new -----------------------------------------

  const [productMode, setProductMode] = useState<"existing" | "new">(
    "existing",
  );
  const [existingProductId, setExistingProductId] = useState(
    initial?.productId ?? "",
  );
  const [newName, setNewName] = useState("");
  const [newTypeSac, setNewTypeSac] = useState("");
  const [newWidthCm, setNewWidthCm] = useState("");
  const [newLengthCm, setNewLengthCm] = useState("");
  const [newGussetCm, setNewGussetCm] = useState("");
  const [newPleatWidthCm, setNewPleatWidthCm] = useState("");
  const [newPleatLengthCm, setNewPleatLengthCm] = useState("");
  const [newGrammage, setNewGrammage] = useState("");
  const [newPaperType, setNewPaperType] = useState("");
  const [newHasHandle, setNewHasHandle] = useState(false);
  const [newHandleWeightG, setNewHandleWeightG] = useState("");

  const [error, setError] = useState<string | null>(null);

  // Pickers. Page size 100 covers every current list.
  const clientsQuery = useQuery(
    trpc.client.list.queryOptions({
      pageSize: 100,
      sortBy: "name",
      sortDir: "asc",
    }),
  );
  const clients = clientsQuery.data?.rows ?? [];

  // Always enabled: a client-less order still offers the shared products.
  const productsQuery = useQuery(
    trpc.product.forClient.queryOptions({
      clientId: clientId === "" ? null : clientId,
    }),
  );
  const clientProducts = productsQuery.data ?? [];

  /**
   * Falls back to the order's current product when it is not in the picker's
   * result — archived, or belonging to a different client — so it stays
   * visible and selected while editing rather than silently disappearing.
   *
   * Depends on `productsQuery.data` directly, not the `clientProducts ?? []`
   * local: React Query keeps that reference stable across renders when the
   * result has not changed, whereas `?? []` allocates a new empty array on
   * every render while the query is loading, which would recompute this on
   * every keystroke elsewhere in the form.
   */
  const selectedProduct: ProductOption | null = useMemo(() => {
    const fromList = productsQuery.data?.find(
      (p) => p.id === existingProductId,
    );
    if (fromList) return fromList;
    if (initial?.product && initial.product.id === existingProductId) {
      return initial.product;
    }
    return null;
  }, [productsQuery.data, existingProductId, initial]);

  const done = async (orderId: string) => {
    await queryClient.invalidateQueries({
      queryKey: trpc.order.list.queryKey(),
    });
    await queryClient.invalidateQueries({
      queryKey: trpc.order.byId.queryKey(),
    });
    await queryClient.invalidateQueries({
      queryKey: trpc.product.list.queryKey(),
    });
    await queryClient.invalidateQueries({
      queryKey: trpc.product.forClient.queryKey(),
    });
    await go(`/orders/${orderId}`);
  };

  // Print inks moved to `OrderColours` on the detail page (2026-09-18), so a
  // save is one call again: `order.setColours` is `adminProcedure` while this
  // form is not, and firing it from here failed for any non-admin editing an
  // order — as well as making the save two non-atomic writes.
  const create = useMutation(
    trpc.order.create.mutationOptions({
      onSuccess: async (saved) => done(saved.id),
      onError: (cause) => setError(cause.message),
    }),
  );
  const update = useMutation(
    trpc.order.update.mutationOptions({
      onSuccess: async (saved) => done(saved.id),
      onError: (cause) => setError(cause.message),
    }),
  );

  const busy = create.isPending || update.isPending;

  // ---- live figures --------------------------------------------------

  /**
   * The spec priced live: from the picked existing product, or from the
   * strings in the "new product" section. Incomplete — a missing field, or a
   * non-positive width/length/grammage, which is the state of the 11 migrated
   * grammage-0 products — yields `null` rather than a spec that would price
   * to a unit cost of 0.
   */
  const liveSpec: ProductSpec | null = useMemo(() => {
    if (productMode === "existing") {
      if (!selectedProduct) return null;
      const spec = productSpecFromRow(selectedProduct);
      return spec.widthCm > 0 && spec.lengthCm > 0 && spec.grammage > 0
        ? spec
        : null;
    }

    if (
      newTypeSac === "" ||
      newWidthCm === "" ||
      newLengthCm === "" ||
      newGrammage === ""
    ) {
      return null;
    }
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    const width = num(newWidthCm);
    const length = num(newLengthCm);
    const grammage = num(newGrammage);
    if (width === null || length === null || grammage === null) return null;
    if (!(width > 0 && length > 0 && grammage > 0)) return null;
    return {
      typeSac: newTypeSac as ProductSpec["typeSac"],
      widthCm: width,
      lengthCm: length,
      gussetCm: num(newGussetCm),
      pleatWidthCm: num(newPleatWidthCm),
      pleatLengthCm: num(newPleatLengthCm),
      grammage,
      hasHandle: newHasHandle,
      handleWeightG: num(newHandleWeightG),
    };
  }, [
    productMode,
    selectedProduct,
    newTypeSac,
    newWidthCm,
    newLengthCm,
    newGussetCm,
    newPleatWidthCm,
    newPleatLengthCm,
    newGrammage,
    newHasHandle,
    newHandleWeightG,
  ]);

  const liveInputs = useMemo(() => {
    // Reads `nums` directly, not through the `n(key)` closure: `n` is
    // recreated every render and is not itself a dependency this memo can
    // declare, whereas `nums` is the actual reactive value it needs.
    const num = (key: (typeof NUM_KEYS)[number]) => {
      const trimmed = nums[key].trim();
      return trimmed === "" ? undefined : Number(trimmed);
    };
    const line = (
      kiloKey: (typeof NUM_KEYS)[number],
      weightKey: (typeof NUM_KEYS)[number],
    ) => ({
      kiloPrice: num(kiloKey),
      weightG: num(weightKey),
    });
    return toPricingInputs(
      {
        paperKiloPrice: num("paperKiloPrice"),
        profitMarginPct: num("profitMarginPct"),
        lossMarginPct: num("lossMarginPct"),
        handleGlue: line("handleGlueKiloPrice", "handleGlueWeightG"),
        sideGlue: line("sideGlueKiloPrice", "sideGlueWeightG"),
        baseAdhesive: line("baseAdhesiveKiloPrice", "baseAdhesiveWeightG"),
        piecesPerParcel: num("piecesPerParcel"),
        kilosPerParcel: num("kilosPerParcel"),
        parcelPrice: num("parcelPrice"),
        transportCost: num("transportCost"),
      },
      num("quantite") ?? null,
      initial?.legacyGlueCostPerUnit ?? null,
    );
  }, [nums, initial?.legacyGlueCostPerUnit]);

  const figures = liveSpec ? priceOrder(liveSpec, liveInputs) : null;
  const legacyGlueInEffect =
    figures !== null &&
    figures.glueCostPerUnit > 0 &&
    (initial?.legacyGlueCostPerUnit ?? null) !== null &&
    !(liveInputs.handleGlue.kiloPrice && liveInputs.handleGlue.weightG) &&
    !(liveInputs.sideGlue.kiloPrice && liveInputs.sideGlue.weightG) &&
    !(liveInputs.baseAdhesive.kiloPrice && liveInputs.baseAdhesive.weightG);

  const incompleteReason =
    liveSpec !== null
      ? null
      : productMode === "existing"
        ? selectedProduct
          ? t("form.specIncomplete")
          : t("form.pickProductForFigures")
        : t("form.fillSpecForFigures");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    // Parse every numeric field once, naming the first bad key.
    const parsed: Partial<Record<(typeof NUM_KEYS)[number], number>> = {};
    for (const key of NUM_KEYS) {
      const trimmed = n(key).trim();
      if (trimmed === "") continue;
      if (Number.isNaN(Number(trimmed))) {
        setError(t("form.mustBeNumber", { field: key }));
        return;
      }
      parsed[key] = Number(trimmed);
    }

    if (productMode === "existing" && existingProductId === "") {
      setError(t("form.pickProductOrNew"));
      return;
    }

    const line = (
      kiloKey: (typeof NUM_KEYS)[number],
      weightKey: (typeof NUM_KEYS)[number],
    ) => ({
      kiloPrice: parsed[kiloKey],
      weightG: parsed[weightKey],
    });

    const raw = {
      // `numero` is an update-only field: `createOrderInput` has none, and
      // the server allocates it. Spread rather than set, so the create
      // payload does not carry an empty string the schema would reject.
      ...(initial ? { numero } : { kind }),
      description,
      clientId: clientId === "" ? undefined : clientId,
      product:
        productMode === "existing"
          ? { mode: "existing" as const, id: existingProductId }
          : {
              mode: "new" as const,
              name: newName,
              clientId: clientId === "" ? undefined : clientId,
              typeSac: newTypeSac === "" ? undefined : newTypeSac,
              widthCm:
                newWidthCm.trim() === "" ? undefined : Number(newWidthCm),
              lengthCm:
                newLengthCm.trim() === "" ? undefined : Number(newLengthCm),
              gussetCm:
                newGussetCm.trim() === "" ? undefined : Number(newGussetCm),
              pleatWidthCm:
                newPleatWidthCm.trim() === ""
                  ? undefined
                  : Number(newPleatWidthCm),
              pleatLengthCm:
                newPleatLengthCm.trim() === ""
                  ? undefined
                  : Number(newPleatLengthCm),
              grammage:
                newGrammage.trim() === "" ? undefined : Number(newGrammage),
              paperType: newPaperType === "" ? undefined : newPaperType,
              hasHandle: newHasHandle,
              handleWeightG:
                newHandleWeightG.trim() === ""
                  ? undefined
                  : Number(newHandleWeightG),
            },
      quantite: parsed.quantite ?? 0,
      paperKiloPrice: parsed.paperKiloPrice,
      profitMarginPct: parsed.profitMarginPct,
      lossMarginPct: parsed.lossMarginPct,
      handleGlue: line("handleGlueKiloPrice", "handleGlueWeightG"),
      sideGlue: line("sideGlueKiloPrice", "sideGlueWeightG"),
      baseAdhesive: line("baseAdhesiveKiloPrice", "baseAdhesiveWeightG"),
      piecesPerParcel: parsed.piecesPerParcel,
      kilosPerParcel: parsed.kilosPerParcel,
      parcelPrice: parsed.parcelPrice,
      transportCost: parsed.transportCost,
      typeImpression: typeImpression === "" ? undefined : typeImpression,
      // Artwork is not editable here; omitted so update preserves it and
      // create gets the schema's empty-array default.
    };

    if (initial) {
      const result = updateOrderInput.safeParse({ ...raw, id: initial.id });
      if (!result.success) {
        const issue = result.error.issues[0];
        setError(
          issue
            ? `${issue.path.join(".")}: ${issue.message}`
            : common("checkForm"),
        );
        return;
      }
      update.mutate(result.data);
      return;
    }
    const result = createOrderInput.safeParse(raw);
    if (!result.success) {
      const issue = result.error.issues[0];
      setError(
        issue
          ? `${issue.path.join(".")}: ${issue.message}`
          : common("checkForm"),
      );
      return;
    }
    create.mutate(result.data);
  }

  const money$ = (
    key: (typeof NUM_KEYS)[number],
    label: string,
    unit?: string,
    error?: string,
  ) => (
    <TextField
      label={label}
      unit={unit}
      error={error}
      format="numeric"
      value={n(key)}
      onChange={(e) => setN(key, e.target.value)}
      autoComplete="off"
      disabled={busy}
    />
  );

  const section = (title: string, hint?: ReactNode) => (
    <>
      <span className={styles.formSection}>{title}</span>
      {hint && (
        <p className={[styles.hint, styles.formWide].filter(Boolean).join(" ")}>
          {hint}
        </p>
      )}
    </>
  );

  const quantityUnit = liveSpec
    ? liveSpec.typeSac === "SOUS_PLAT"
      ? "kg"
      : "pcs"
    : "pcs";

  /*
   * The three steps of "Order create v3.dc.html". The sections were already
   * these three groups in one scroll; the handoff turns them into one visible
   * step at a time with a rail that can jump between them.
   *
   * `touched` is per-step and reset on every move, exactly as the handoff
   * does it: pressing Continue on an incomplete step marks it touched, which
   * is what turns the offending fields red. Arriving at a step fresh never
   * shows errors for fields nobody has filled in yet.
   */
  const stepQuantity = Number(n("quantite").trim());
  const stepValid: Record<1 | 2 | 3, boolean> = {
    1: clientId !== "" && n("quantite").trim() !== "" && stepQuantity > 0,
    // Step 2 is answered by whichever product mode is showing: an existing
    // product needs a pick, a new one needs enough spec to price — which is
    // exactly what `liveSpec` already means.
    2: productMode === "existing" ? existingProductId !== "" : liveSpec !== null,
    3: liveSpec !== null && Number(n("paperKiloPrice").trim()) > 0,
  };

  /*
   * The footer's running "still needed" list. Each entry names a field the
   * user can act on, in the order the steps ask for them, so the hint reads
   * as a path through the form rather than an unordered set of complaints.
   */
  const missing: string[] = [];
  if (clientId === "") missing.push(t("form.needClient"));
  if (!(stepQuantity > 0)) missing.push(t("form.needQuantity"));
  if (!stepValid[2]) missing.push(t("form.needProduct"));
  if (!(Number(n("paperKiloPrice").trim()) > 0)) missing.push(t("form.needPaperPrice"));

  /*
   * Selling at or below cost. The handoff warns when the profit margin does
   * not exceed the loss margin: the loss margin inflates the cost and the
   * profit margin is applied to that inflated figure, so an order with
   * profit <= loss earns nothing for the work. Not an error — a negotiated
   * job may genuinely run at cost — so it is a warning the user can ignore.
   *
   * Only once both are actually entered: two empty fields are 0 and 0, which
   * is not a margin mistake, just an unfilled form.
   */
  const profitPct = Number(n("profitMarginPct").trim());
  const lossPct = Number(n("lossMarginPct").trim());
  const marginWarning =
    n("profitMarginPct").trim() !== "" &&
    Number.isFinite(profitPct) &&
    Number.isFinite(lossPct) &&
    profitPct <= lossPct;

  const goStep = (next: 1 | 2 | 3) => {
    setStep(next);
    setTouched(false);
    setError(null);
  };

  /*
   * Continue advances only through a valid step; on the last step the button
   * submits the form instead, so the browser's own submit path — and the Zod
   * parse in `handleSubmit` — stays the single place an order is created.
   */
  const onContinue = () => {
    if (!stepValid[step]) {
      setTouched(true);
      return;
    }
    goStep((step + 1) as 1 | 2 | 3);
  };

  const STEPS = [
    { n: 1 as const, label: t("form.stepOrder") },
    { n: 2 as const, label: t("form.stepProduct") },
    { n: 3 as const, label: t("form.stepPricing") },
  ];

  return (
    <div className={styles.formWithAside}>
      <form className={styles.formPanelWide} onSubmit={handleSubmit} noValidate>
        {error && (
          <p
            className={[styles.notice, styles.error].filter(Boolean).join(" ")}
            role="alert"
          >
            {error}
          </p>
        )}

        {/*
          The step rail. Every step is reachable at any time — the handoff
          lets the rail jump freely, and on an edit the whole order already
          exists, so refusing to show step 3 until step 1 "passes" would lock
          someone out of the fields they opened the form to change. Continue
          is what enforces the order; the rail is navigation.
        */}
        <nav className={orderStyles.steps} aria-label={t("form.stepsLabel")}>
          {STEPS.map((entry) => {
            const on = step === entry.n;
            const done = !on && stepValid[entry.n];
            return (
              <button
                key={entry.n}
                type="button"
                className={[
                  orderStyles.step,
                  on ? orderStyles.stepOn : null,
                  done ? orderStyles.stepDone : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => goStep(entry.n)}
                disabled={busy}
                aria-current={on ? "step" : undefined}
              >
                <span className={orderStyles.stepMark} aria-hidden="true">
                  {done ? "✓" : entry.n}
                </span>
                <span className={orderStyles.stepText}>
                  <span className={orderStyles.stepKicker}>
                    {t("form.stepN", { n: entry.n })}
                  </span>
                  <span className={orderStyles.stepLabel}>{entry.label}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div
          className={[styles.formGrid, orderStyles.stepPanel].filter(Boolean).join(" ")}
          hidden={step !== 1}
        >
          {section(t("form.sectionOrder"))}
          {/*
            Only when editing. A new order's number is allocated by the server
            from `OrderCounter` (2026-09-18), so on create there is nothing to
            show and nothing to type: the number exists once the order does.
            An existing order has one, and it stays correctable here.
          */}
          {initial && (
            <TextField
              label={t("form.orderNumber")}
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          )}
          {/*
            Only when creating: quote or order is decided once. An existing
            quote becomes an order through "Accept quote" on its page, which
            stamps who accepted it and when — not by editing a field.
          */}
          {!initial && (
            <SelectField
              label={t("form.kind")}
              value={kind}
              onChange={(e) => setKind(e.target.value as (typeof ORDER_KINDS)[number])}
              disabled={busy}
              options={ORDER_KINDS.map((k) => ({ value: k, label: enums(`orderKind.${k}`) }))}
            />
          )}
          <SelectField
            label={t("form.client")}
            error={touched && clientId === "" ? t("form.needClientError") : undefined}
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              // A different client's product catalogue: the previous pick
              // may no longer apply.
              setExistingProductId("");
            }}
            disabled={busy || clientsQuery.isPending}
            allowEmpty
            placeholder={clientsQuery.isPending ? t("loading") : t("noClient")}
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
          />
          {money$(
            "quantite",
            t("form.quantity"),
            quantityUnit,
            touched && !(stepQuantity > 0) ? t("form.needQuantityError") : undefined,
          )}
          <div className={styles.formWide}>
            <TextField
              label={t("form.description")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </div>
          {!initial && kind === "QUOTE" && (
            <p className={[styles.hint, styles.formWide].filter(Boolean).join(" ")}>
              {t("form.kindQuoteHint")}
            </p>
          )}
        </div>

        {/*
          Steps stay mounted and are hidden rather than unmounted: a field the
          user filled on step 1 must still be there when they come back from
          step 3, and unmounting would reset every uncontrolled input on the
          way. `hidden` also keeps them out of the accessibility tree and out
          of tab order, so only the visible step is reachable by keyboard.
        */}
        <div
          className={[styles.formGrid, orderStyles.stepPanel].filter(Boolean).join(" ")}
          hidden={step !== 2}
        >
          {section(t("form.sectionProduct"))}
          <div className={styles.formWide}>
            <SelectField
              label={t("form.choose")}
              value={productMode}
              onChange={(e) =>
                setProductMode(e.target.value as "existing" | "new")
              }
              disabled={busy}
              options={[
                { value: "existing", label: t("form.existingProduct") },
                { value: "new", label: t("form.newProduct") },
              ]}
            />
          </div>

          {productMode === "existing" ? (
            <>
              <div className={styles.formWide}>
                <SelectField
                  label={t("form.product")}
                  error={
                    touched && existingProductId === ""
                      ? t("form.needProductError")
                      : undefined
                  }
                  value={existingProductId}
                  onChange={(e) => setExistingProductId(e.target.value)}
                  disabled={busy || productsQuery.isPending}
                  allowEmpty
                  placeholder={
                    productsQuery.isPending
                      ? t("loading")
                      : clientProducts.length === 0
                        ? t("form.noSharedProducts")
                        : t("form.chooseProduct")
                  }
                  options={[
                    ...clientProducts
                      .filter((p) => p.clientId !== null)
                      .map((p) => ({
                        value: p.id,
                        label: `${p.name} — ${p.widthCm}×${p.lengthCm}${
                          p.typeSac === "SOUS_PLAT" ? "" : `×${p.gussetCm ?? 0}`
                        } ${p.grammage}g`,
                      })),
                    ...clientProducts
                      .filter((p) => p.clientId === null)
                      .map((p) => ({
                        value: p.id,
                        label: `${p.name} — ${p.widthCm}×${p.lengthCm}${
                          p.typeSac === "SOUS_PLAT" ? "" : `×${p.gussetCm ?? 0}`
                        } ${p.grammage}g ${t("form.sharedSuffix")}`,
                      })),
                    ...(initial?.product &&
                    !clientProducts.some((p) => p.id === initial.product.id)
                      ? [
                          {
                            value: initial.product.id,
                            label: `${initial.product.name} ${t("form.currentSuffix")}`,
                          },
                        ]
                      : []),
                  ]}
                />
                {selectedProduct && (
                  <p className={styles.hint}>
                    {enums(`typeSac.${selectedProduct.typeSac}`)} ·{" "}
                    {selectedProduct.widthCm}×{selectedProduct.lengthCm}
                    {selectedProduct.typeSac !== "SOUS_PLAT"
                      ? `×${selectedProduct.gussetCm ?? 0}`
                      : ""}{" "}
                    · {selectedProduct.grammage} g/m²
                    {selectedProduct.hasHandle
                      ? ` · ${t("form.handleWithWeight", {
                          weight: selectedProduct.handleWeightG ?? 0,
                        })}`
                      : ""}
                    {!selectedProduct.active && ` · ${t("archivedTag")}`}
                    {initial && (
                      <>
                        {" — "}
                        <a
                          className={styles.inlineLink}
                          href={`/products/${selectedProduct.id}`}
                        >
                          {t("form.editProduct")}
                        </a>
                      </>
                    )}
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <TextField
                label={t("form.productName")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoComplete="off"
                disabled={busy}
              />
              <ProductSpecFields
                typeSac={newTypeSac}
                setTypeSac={setNewTypeSac}
                widthCm={newWidthCm}
                setWidthCm={setNewWidthCm}
                lengthCm={newLengthCm}
                setLengthCm={setNewLengthCm}
                gussetCm={newGussetCm}
                setGussetCm={setNewGussetCm}
                pleatWidthCm={newPleatWidthCm}
                setPleatWidthCm={setNewPleatWidthCm}
                pleatLengthCm={newPleatLengthCm}
                setPleatLengthCm={setNewPleatLengthCm}
                grammage={newGrammage}
                setGrammage={setNewGrammage}
                paperType={newPaperType}
                setPaperType={setNewPaperType}
                hasHandle={newHasHandle}
                setHasHandle={setNewHasHandle}
                handleWeightG={newHandleWeightG}
                setHandleWeightG={setNewHandleWeightG}
                disabled={busy}
              />
              <p
                className={[styles.hint, styles.formWide]
                  .filter(Boolean)
                  .join(" ")}
              >
                {t("form.reuseSpecHint")}
              </p>
            </>
          )}

        </div>

        <div
          className={[styles.formGrid, orderStyles.stepPanel].filter(Boolean).join(" ")}
          hidden={step !== 3}
        >
          {section(t("form.sectionPricing"))}
          {money$(
            "paperKiloPrice",
            t("pricing.paperPrice"),
            "/kg",
            touched && !(Number(n("paperKiloPrice").trim()) > 0)
              ? t("form.needPaperPriceError")
              : undefined,
          )}
          {money$("profitMarginPct", t("pricing.profitMargin"), "%")}
          {money$("lossMarginPct", t("pricing.lossMargin"), "%")}
          {(!liveSpec || liveSpec.hasHandle) && (
            <>
              {money$("handleGlueKiloPrice", t("pricing.handleGluePrice"), "/kg")}
              {money$("handleGlueWeightG", t("pricing.handleGluePerUnit"), "g")}
            </>
          )}
          {money$("sideGlueKiloPrice", t("pricing.sideGluePrice"), "/kg")}
          {money$("sideGlueWeightG", t("pricing.sideGluePerUnit"), "g")}
          {money$("baseAdhesiveKiloPrice", t("pricing.baseAdhesivePrice"), "/kg")}
          {money$("baseAdhesiveWeightG", t("pricing.baseAdhesivePerUnit"), "g")}
          {initial?.legacyGlueCostPerUnit != null && (
            <p
              className={[styles.hint, styles.formWide]
                .filter(Boolean)
                .join(" ")}
            >
              {t("form.legacyGlueHint", {
                value: numFmt.format(initial.legacyGlueCostPerUnit),
              })}
            </p>
          )}
          {liveSpec?.typeSac === "SOUS_PLAT"
            ? money$("kilosPerParcel", t("pricing.kilosPerParcel"))
            : money$("piecesPerParcel", t("pricing.piecesPerParcel"))}
          {money$("parcelPrice", t("pricing.parcelPrice"))}
          {money$("transportCost", t("pricing.transportPerParcel"))}

          {/* No "Production" section: the paper need is computed and shown on
              the detail page, and reservations are made from stock there. */}
          {section(t("form.sectionPrinting"))}
          <SelectField
            label={t("form.method")}
            value={typeImpression}
            onChange={(e) => setTypeImpression(e.target.value)}
            disabled={busy}
            allowEmpty
            placeholder={t("form.notSet")}
            options={TYPE_IMPRESSIONS.map((v) => ({
              value: v,
              label: enums(`typeImpression.${v}`),
            }))}
          />
        </div>

        {/*
          The footer's running "still needed" list, from the handoff. It names
          what is outstanding across the whole form, not just this step, so
          the last step does not hide a gap left on the first.
        */}
        <p className={orderStyles.needs}>
          {missing.length === 0
            ? t("form.needsNothing")
            : t("form.needs", { fields: missing.join(", ") })}
        </p>

        <div className={styles.formActions}>
          <Button
            variant="secondary"
            onClick={() =>
              cancel(initial ? `/orders/${initial.id}` : "/orders")
            }
            disabled={busy}
          >
            {common("cancel")}
          </Button>
          {step > 1 && (
            <Button
              variant="secondary"
              onClick={() => goStep((step - 1) as 1 | 2 | 3)}
              disabled={busy}
            >
              {t("form.back")}
            </Button>
          )}
          {/*
            Continue on the first two steps, submit on the last — and the two
            carry DIFFERENT `key`s, which is load-bearing, not decoration.
            
            Without them React sees one <button> in the same slot and reuses
            the DOM node across the re-render. A real mouse click is two
            events: the click from mousedown runs `onContinue`, the step
            advances to 3, React turns that very node into the submit button,
            and the mouseup then completes a click on it — submitting from
            step 2 and creating an order with no pricing at all. Distinct
            keys force an unmount and a fresh mount, so the node the user
            pressed is never the node that ends up submitting.

            `type` alone does not save this: the element reported
            type="button" throughout, because the submit came from the
            replacement element, not the one that was clicked.
          */}
          {step < 3 ? (
            <Button
              key="continue"
              variant="primary"
              disabled={busy}
              onClick={onContinue}
            >
              {t("form.continue")}
            </Button>
          ) : (
            <Button key="submit" variant="primary" type="submit" busy={busy}>
              {busy
                ? common("saving")
                : initial
                  ? common("saveChanges")
                  : t("form.createOrder")}
            </Button>
          )}
        </div>
      </form>

      <aside className={styles.formAside}>
        <section className={styles.detailPanel}>
          <h2 className={styles.detailTitle}>{t("form.liveFigures")}</h2>
          {/*
            Selling at or below cost — see `marginWarning`. A warning, not a
            block: a negotiated job may deliberately run at cost, so it names
            the two figures and leaves the decision to the user.
          */}
          {marginWarning && (
            <p className={orderStyles.marginWarning} role="status">
              <strong className={orderStyles.marginWarningTitle}>
                {t("form.marginWarningTitle")}
              </strong>
              {t("form.marginWarning", {
                profit: numFmt.format(profitPct),
                loss: numFmt.format(lossPct),
              })}
            </p>
          )}
          {incompleteReason ? (
            <p className={styles.hint}>{incompleteReason}</p>
          ) : (
            <>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>{t("spec.productionWidth")}</span>
                <span className={styles.detailValue}>
                  <Figure
                    value={figures?.dimensions.productionWidthCm ?? null}
                    fmt={numFmt}
                    suffix="cm"
                  />
                </span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>{t("spec.cuttingLength")}</span>
                <span className={styles.detailValue}>
                  <Figure
                    value={figures?.dimensions.cuttingLengthCm ?? null}
                    fmt={numFmt}
                    suffix="cm"
                  />
                </span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>{t("spec.unitWeight")}</span>
                <span className={styles.detailValue}>
                  <Figure
                    value={figures?.dimensions.unitWeightG ?? null}
                    fmt={numFmt}
                    suffix="g"
                  />
                </span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>{t("pricing.unitPrice")}</span>
                <span className={styles.detailValue}>
                  <Figure value={figures?.unitPrice ?? null} fmt={numFmt} />
                </span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>{t("pricing.withMargins")}</span>
                <span className={styles.detailValue}>
                  <Figure
                    value={figures?.unitPriceWithMargins ?? null}
                    fmt={numFmt}
                  />
                </span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>
                  {t("pricing.gluePerUnit")}
                  {legacyGlueInEffect ? ` ${t("pricing.legacySuffix")}` : ""}
                </span>
                <span className={styles.detailValue}>
                  <Figure
                    value={figures?.glueCostPerUnit ?? null}
                    fmt={numFmt}
                  />
                </span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>{t("pricing.finalUnitPrice")}</span>
                <span className={styles.detailValue}>
                  <Figure
                    value={figures?.finalUnitPrice ?? null}
                    fmt={numFmt}
                  />
                </span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>{t("pricing.parcelBase")}</span>
                <span className={styles.detailValue}>
                  <Figure
                    value={figures?.baseParcelPrice ?? null}
                    fmt={money}
                  />
                </span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>{t("pricing.parcelFinal")}</span>
                <span className={styles.detailValue}>
                  <Figure
                    value={figures?.finalParcelPrice ?? null}
                    fmt={money}
                  />
                </span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>{t("pricing.parcels")}</span>
                <span className={styles.detailValue}>
                  <Figure value={figures?.parcelCount ?? null} fmt={parcels} />
                </span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>{t("pricing.total")}</span>
                <span
                  className={[styles.detailValue, styles.detailTotal].join(" ")}
                >
                  <Figure value={figures?.orderTotal ?? null} fmt={money} />
                </span>
              </div>
            </>
          )}
        </section>
      </aside>
    </div>
  );
}
