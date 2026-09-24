"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import {
  PURCHASE_CATEGORIES,
  createPurchaseOrderInput,
  updatePurchaseOrderInput,
} from "@repo/api-contract";
import type { PurchaseCategory } from "api/src/purchasing/purchasing.list";
import { Button } from "@repo/ui/button";
import { SelectField, TextField } from "@repo/ui/field";
import { useToast } from "@repo/ui/toast";
import {
  OrderLinesEditor,
  newOrderLine,
  toEditableOrderLine,
  toOrderLineInput,
  type EditableOrderLine,
} from "../purchasing-lines-editor";
import { useTRPC } from "../../trpc/client";
import styles from "../../records/records.module.css";
import type { FormNav } from "../../records/form-nav";

type PurchaseOrder = inferRouterOutputs<AppRouter>["purchaseOrder"]["byId"];

/** `@db.Date` arrives as an ISO timestamp at UTC midnight; the input wants its date part. */
function dateInput(value: string | Date | null): string {
  return value === null ? "" : new Date(value).toISOString().slice(0, 10);
}

/**
 * Create and edit for a purchase order — one form, like the purchase
 * invoice's. The number is not a field: the server allocates it from the
 * category's series, so the category picker is what decides the number a new
 * order gets, and it cannot change once the order exists.
 *
 * Once a receipt against the order holds something (`receiptsInUse`) the
 * lines and the supplier are frozen and this form sends no `lines` key at
 * all, editing the header alone. The server refuses both in that state;
 * disabling them here is what stops the operator discovering that only on
 * submit. The empty receipt every order is born with does not freeze them.
 */
export function PurchaseOrderForm({
  initial,
  onDone,
  onCancel,
}: { initial?: PurchaseOrder } & FormNav) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const go = (target: string) => (onDone ? onDone(target) : router.push(target));
  const cancel = (target: string) => (onCancel ? onCancel(target) : router.push(target));
  const { push } = useToast();
  const t = useTranslations("purchasing");
  const common = useTranslations("common");
  const enums = useTranslations("enums");

  // Frozen lines and supplier: a delivery has been recorded, so the
  // quantities it was checked against must not move under it, and the
  // supplier who made it cannot change.
  const linesLocked = (initial?.receiptsInUse ?? 0) > 0;

  const [category, setCategory] = useState<PurchaseCategory | "">(initial?.category ?? "");
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [issuedAt, setIssuedAt] = useState(
    dateInput(initial?.issuedAt ?? null) || new Date().toISOString().slice(0, 10),
  );
  const [expectedAt, setExpectedAt] = useState(dateInput(initial?.expectedAt ?? null));
  const [currency, setCurrency] = useState(initial?.currency ?? "TND");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [createdByName, setCreatedByName] = useState(initial?.createdByName ?? "");
  const [lines, setLines] = useState<EditableOrderLine[]>(() =>
    initial && initial.lines.length > 0
      ? initial.lines.map((line, index) => toEditableOrderLine(line, index + 1))
      : [newOrderLine(1)],
  );
  const [error, setError] = useState<string | null>(null);

  // Active suppliers only: the server refuses an archived one, so the picker
  // must not offer it. One already on this order is appended below.
  const suppliersQuery = useQuery(
    trpc.supplier.list.queryOptions({ pageSize: 100, sortBy: "name", sortDir: "asc" }),
  );
  const suppliers = (suppliersQuery.data?.rows ?? []).filter((s) => s.active);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.purchaseOrder.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.purchaseOrder.byId.queryKey() }),
    ]);

  const create = useMutation(
    trpc.purchaseOrder.create.mutationOptions({
      onSuccess: async (created) => {
        push({ title: t("orders.created", { numero: created.numero }), tone: "success" });
        await invalidate();
        await go(`/purchasing/orders/${created.id}`);
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const update = useMutation(
    trpc.purchaseOrder.update.mutationOptions({
      onSuccess: async (saved) => {
        push({ title: t("orders.saved", { numero: saved.numero }), tone: "success" });
        await invalidate();
        await go(`/purchasing/orders/${saved.id}`);
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const busy = create.isPending || update.isPending;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const header = {
      category,
      supplierId,
      issuedAt,
      expectedAt: expectedAt || null,
      currency,
      address: address.trim() || null,
      notes: notes.trim() || null,
      createdByName: createdByName.trim() || null,
    };
    // Omitted entirely when frozen: the update schema makes `lines` optional
    // precisely so a header-only edit is expressible.
    const drawn = linesLocked
      ? {}
      : { lines: lines.map((line, i) => toOrderLineInput(line, i + 1)) };

    // Parsed against its own schema per branch rather than through a shared
    // object: the two differ in whether `lines` may be absent, and a union
    // of the two would lose that distinction at the mutate call.
    const fail = (issue: { path: PropertyKey[]; message: string } | undefined) => {
      setError(issue ? `${issue.path.join(".")}: ${issue.message}` : common("checkForm"));
    };

    if (initial) {
      const parsed = updatePurchaseOrderInput.safeParse({ ...header, ...drawn, id: initial.id });
      if (!parsed.success) return fail(parsed.error.issues[0]);
      update.mutate(parsed.data);
      return;
    }
    const parsed = createPurchaseOrderInput.safeParse({ ...header, ...drawn });
    if (!parsed.success) return fail(parsed.error.issues[0]);
    create.mutate(parsed.data);
  }

  return (
    <form
      className={[styles.formPanel, styles.formPanelWide].filter(Boolean).join(" ")}
      onSubmit={handleSubmit}
      noValidate
    >
      {error && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <div className={styles.formGrid}>
        <span className={styles.formSection}>{t("orders.form.detailsSection")}</span>

        <div>
          <SelectField
            label={t("fields.category")}
            value={category}
            onChange={(e) => setCategory(e.target.value as PurchaseCategory)}
            // The category picks the number series, so it is fixed for the
            // life of the order — changing it would leave the number lying.
            disabled={busy || initial !== undefined}
            options={PURCHASE_CATEGORIES.map((value) => ({
              value,
              label: enums(`purchaseCategory.${value}`),
            }))}
            placeholder={t("orders.form.chooseCategory")}
          />
          {initial === undefined && (
            <p className={styles.hint}>{t("orders.form.categoryHint")}</p>
          )}
        </div>

        <div>
          <SelectField
            label={t("fields.supplier")}
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            disabled={busy || suppliersQuery.isPending || linesLocked}
            options={[
              ...suppliers.map((s) => ({ value: s.id, label: s.name })),
              ...(initial && !suppliers.some((s) => s.id === initial.supplierId)
                ? [{ value: initial.supplierId, label: `${initial.supplier.name} (${t("archived")})` }]
                : []),
            ]}
            placeholder={
              suppliersQuery.isPending ? common("loading") : t("orders.form.chooseSupplier")
            }
          />
          <p className={styles.hint}>
            {linesLocked ? t("orders.form.supplierLocked") : t("orders.form.supplierHint")}
          </p>
        </div>

        <TextField
          label={t("fields.currency")}
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />

        <TextField
          label={t("fields.issued")}
          type="date"
          format="mono"
          value={issuedAt}
          onChange={(e) => setIssuedAt(e.target.value)}
          disabled={busy}
        />
        <TextField
          label={t("fields.expected")}
          type="date"
          format="mono"
          value={expectedAt}
          onChange={(e) => setExpectedAt(e.target.value)}
          disabled={busy}
        />
        <TextField
          label={t("fields.raisedBy")}
          value={createdByName}
          onChange={(e) => setCreatedByName(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />

        <TextField
          label={t("fields.deliveryAddress")}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("fields.notes")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />

        <span className={styles.formSection}>{t("orders.form.linesSection")}</span>
        <div className={styles.formWide}>
          {linesLocked ? (
            <p className={styles.muted}>{t("orders.linesLocked")}</p>
          ) : (
            <OrderLinesEditor
              lines={lines}
              category={category}
              currency={currency}
              onChange={setLines}
              busy={busy}
            />
          )}
        </div>
      </div>

      <div className={styles.formActions}>
        <Button
          variant="secondary"
          onClick={() =>
            cancel(initial ? `/purchasing/orders/${initial.id}` : "/purchasing/orders")
          }
          disabled={busy}
        >
          {common("cancel")}
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          {initial ? common("saveChanges") : t("orders.form.submit")}
        </Button>
      </div>
    </form>
  );
}
