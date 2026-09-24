"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import {
  canAccess,
  canAccessAny,
  recordInkUsageInput,
  updateInkUsageInput,
  type OrderStatus,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { SelectField, TextField } from "@repo/ui/field";
import { useCurrentUser } from "../auth/use-auth";
import { useTRPC } from "../trpc/client";
import records from "../records/records.module.css";
import styles from "./order-detail.module.css";
import { dateFormat } from "../../i18n/formats";

type Usage = inferRouterOutputs<AppRouter>["ink"]["usageForOrder"][number];

const qty = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const day = () => dateFormat({ dateStyle: "medium" });

/** Today as YYYY-MM-DD in local time — see RunForm. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The ink drawn from stock for an order, and the form to draw more.
 *
 * The consumable counterpart of the "Allocated paper" card above it — but
 * where paper is reserved and later consumed, ink has no reservation: the
 * quantity typed here comes off the colour's balance at once, and editing or
 * deleting the line moves the balance back (`InkService`). Gated like the
 * production entries: ADMIN+ and PRODUCTION, while the order is on the
 * floor; deleting a line is ADMIN+, as with production runs.
 */
export function OrderInks({
  orderId,
  status,
}: {
  orderId: string;
  status: OrderStatus;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const { user } = useCurrentUser();
  const usageQuery = useQuery(trpc.ink.usageForOrder.queryOptions({ orderId }));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Usage | null>(null);
  const [deleting, setDeleting] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRecord =
    user !== null &&
    canAccessAny(user.role, ["ADMIN", "PRODUCTION"]) &&
    status === "IN_PRODUCTION";
  const canDelete = user !== null && canAccess(user.role, "ADMIN");

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.ink.usageForOrder.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.ink.list.queryKey() }),
    ]);

  const remove = useMutation(
    trpc.ink.removeUsage.mutationOptions({
      onSuccess: async () => {
        setDeleting(null);
        await refresh();
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  const usages = usageQuery.data ?? [];
  const total = usages.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <section className={styles.card}>
      <div className={styles.sectionHead}>
        <h2 className={styles.cardTitle}>
          {t("inks.title")}
          {usages.length > 0 && ` (${usages.length})`}
        </h2>
        {canRecord && !open && editing === null && (
          <Button size="dense" onClick={() => setOpen(true)}>
            {t("inks.record")}
          </Button>
        )}
      </div>

      {error && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      {usageQuery.isPending && <p className={styles.quiet}>{t("loading")}</p>}
      {usageQuery.isError && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {usageQuery.error.message}
        </p>
      )}
      {usageQuery.isSuccess && usages.length === 0 && (
        <p className={styles.quiet}>{t("inks.empty")}</p>
      )}

      {usages.map((line) =>
        editing?.id === line.id ? (
          <div key={line.id} style={{ margin: "12px 0" }}>
            <InkUsageForm
              orderId={orderId}
              initial={line}
              onDone={async () => {
                setEditing(null);
                await refresh();
              }}
              onCancel={() => setEditing(null)}
            />
          </div>
        ) : (
          <div key={line.id} className={styles.row}>
            <span className={styles.rowDate}>{day().format(new Date(line.usedAt))}</span>
            <span className={styles.rowValue}>
              <span className={records.mono}>{line.colour.code}</span>
              {line.colour.name ? ` ${line.colour.name}` : ""}
              {" · "}
              {qty.format(line.quantity)} {enums(`inkUnit.${line.colour.unit}`)}
            </span>
            <span className={styles.rowMeta}>
              {line.recordedBy?.name ?? "—"}
              {line.note && <span className={styles.quiet}> · {line.note}</span>}
            </span>
            {(canRecord || canDelete) && (
              <span className={records.actions}>
                {canRecord && (
                  <Button
                    className={records.actionBtn}
                    onClick={() => {
                      setError(null);
                      setOpen(false);
                      setEditing(line);
                    }}
                  >
                    {common("edit")}
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="danger"
                    className={records.actionBtn}
                    onClick={() => {
                      setError(null);
                      setDeleting(line);
                    }}
                  >
                    {common("delete")}
                  </Button>
                )}
              </span>
            )}
          </div>
        ),
      )}

      {usages.length > 1 && (
        <p className={styles.quiet} style={{ marginTop: 8 }}>
          {t("inks.totalDrawn", { total: qty.format(total) })}
        </p>
      )}

      {canRecord && open && (
        <div style={{ marginTop: 16 }}>
          <InkUsageForm
            orderId={orderId}
            onDone={async () => {
              setOpen(false);
              await refresh();
            }}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}

      <Dialog
        open={deleting !== null}
        title={t("inks.deleteTitle")}
        confirmLabel={common("delete")}
        destructive
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
        onClose={() => !remove.isPending && setDeleting(null)}
      >
        {deleting &&
          t.rich("inks.deleteBody", {
            quantity: qty.format(deleting.quantity),
            unit: enums(`inkUnit.${deleting.colour.unit}`),
            code: deleting.colour.code,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
      </Dialog>
    </section>
  );
}

/**
 * Record or correct one line. On edit the colour is fixed — a line against
 * the wrong colour is deleted and re-recorded, so the ink returns to the
 * colour it came from (`updateInkUsageInput`).
 */
function InkUsageForm({
  orderId,
  initial,
  onDone,
  onCancel,
}: {
  orderId: string;
  initial?: Usage;
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const trpc = useTRPC();
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const [colourId, setColourId] = useState(initial?.colourId ?? "");
  const [quantity, setQuantity] = useState(initial ? String(initial.quantity) : "");
  const [usedAt, setUsedAt] = useState(
    initial ? new Date(initial.usedAt).toISOString().slice(0, 10) : today(),
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  // Only colours with ink left, and only when picking: an edit keeps its own.
  const coloursQuery = useQuery({
    ...trpc.ink.list.queryOptions({
      pageSize: 100,
      sortBy: "code",
      sortDir: "asc",
      filter: "inStock",
    }),
    enabled: initial === undefined,
  });
  const colours = coloursQuery.data?.rows ?? [];
  const chosen = colours.find((c) => c.id === colourId);
  const unit = initial
    ? enums(`inkUnit.${initial.colour.unit}`)
    : chosen
      ? enums(`inkUnit.${chosen.unit}`)
      : undefined;

  const record = useMutation(
    trpc.ink.recordUsage.mutationOptions({
      onSuccess: () => onDone(),
      onError: (cause) => setError(cause.message),
    }),
  );
  const update = useMutation(
    trpc.ink.updateUsage.mutationOptions({
      onSuccess: () => onDone(),
      onError: (cause) => setError(cause.message),
    }),
  );
  const busy = record.isPending || update.isPending;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const trimmed = quantity.trim();
    if (trimmed === "" || Number.isNaN(Number(trimmed))) {
      setError(t("inks.quantityMustBeNumber"));
      return;
    }
    const base = { quantity: Number(trimmed), usedAt, note };
    if (initial) {
      const parsed = updateInkUsageInput.safeParse({ id: initial.id, ...base });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? common("checkForm"));
        return;
      }
      update.mutate(parsed.data);
      return;
    }
    const parsed = recordInkUsageInput.safeParse({ orderId, colourId, ...base });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    record.mutate(parsed.data);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}
      <div className={records.formGrid}>
        {initial ? (
          <TextField
            label={t("inks.colour")}
            value={`${initial.colour.code}${initial.colour.name ? ` — ${initial.colour.name}` : ""}`}
            readOnly
            disabled
          />
        ) : (
          <SelectField
            label={t("inks.colour")}
            value={colourId}
            onChange={(e) => setColourId(e.target.value)}
            disabled={busy || coloursQuery.isPending}
            placeholder={
              coloursQuery.isPending
                ? t("loading")
                : colours.length === 0
                  ? t("inks.noColourInStock")
                  : t("inks.chooseColour")
            }
            options={colours.map((c) => ({
              value: c.id,
              label: t("inks.colourOption", {
                colour: `${c.code}${c.name ? ` — ${c.name}` : ""}`,
                stock: qty.format(c.stock),
                unit: enums(`inkUnit.${c.unit}`),
              }),
            }))}
          />
        )}
        <TextField
          label={t("inks.quantityUsed")}
          unit={unit}
          format="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("inks.date")}
          type="date"
          value={usedAt}
          onChange={(e) => setUsedAt(e.target.value)}
          disabled={busy}
        />
        <TextField
          label={t("inks.note")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
      </div>
      <div className={records.formActions}>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {common("cancel")}
        </Button>
        <Button variant="primary" type="submit" busy={busy}>
          {busy ? common("saving") : initial ? t("inks.saveLine") : t("inks.drawFromStock")}
        </Button>
      </div>
    </form>
  );
}
