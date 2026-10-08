"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import {
  canAccess,
  canAccessAny,
  canAddOrderInks,
  canChangeOrderInks,
  recordInkUsageInput,
  updateInkUsageInput,
  type OrderKind,
  type OrderStatus,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { SelectField, TextField } from "@repo/ui/field";
import { useCurrentUser } from "../auth/use-auth";
import { useTRPC } from "../trpc/client";
import records from "../records/records.module.css";
import styles from "./order-detail.module.css";
import { dateFormat, numberFormat } from "../../i18n/formats";

type OrderInk = inferRouterOutputs<AppRouter>["ink"]["forOrder"][number];
type Usage = OrderInk["usages"][number];
type Colour = OrderInk["colour"];

const qty = () => numberFormat({ maximumFractionDigits: 3 });
const day = () => dateFormat({ dateStyle: "medium" });

/** Today as YYYY-MM-DD in local time — see RunForm. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The order's ink colours (docs/order-inks-plan.md): ADMIN+ chooses them from
 * the ink stock, the floor records the quantity used against each one.
 *
 * Where paper is reserved and later consumed, ink has no reservation: the
 * quantity typed here comes off the colour's balance at once, and editing or
 * deleting the line moves the balance back (`InkService`). Recording is ADMIN+
 * and PRODUCTION while the order is IN_PRODUCTION; deleting a line is ADMIN+,
 * as with production runs. A colour comes off the order only before
 * production and only while nothing was drawn for it.
 */
export function OrderInks({
  orderId,
  status,
  kind,
}: {
  orderId: string;
  status: OrderStatus;
  kind: OrderKind;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const { user } = useCurrentUser();
  const inksQuery = useQuery(trpc.ink.forOrder.queryOptions({ orderId }));
  const [recording, setRecording] = useState<string | null>(null);
  const [editing, setEditing] = useState<Usage | null>(null);
  const [deleting, setDeleting] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mirrors the procedures' gates — UX only; the server decides.
  const isAdmin = user !== null && canAccess(user.role, "ADMIN");
  const canRecord =
    user !== null &&
    canAccessAny(user.role, ["ADMIN", "PRODUCTION"]) &&
    status === "IN_PRODUCTION";
  const canAdd = isAdmin && canAddOrderInks(kind, status);
  const canRemove = isAdmin && canChangeOrderInks(kind, status);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.ink.forOrder.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.ink.choicesForOrder.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.ink.list.queryKey() }),
    ]);

  const removeLine = useMutation(
    trpc.ink.removeUsage.mutationOptions({
      onSuccess: async () => {
        setDeleting(null);
        await refresh();
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const removeColour = useMutation(
    trpc.ink.removeFromOrder.mutationOptions({
      onSuccess: () => refresh(),
      onError: (cause) => setError(cause.message),
    }),
  );

  const inks = inksQuery.data ?? [];
  const unit = (colour: Colour) => enums(`inkUnit.${colour.unit}`);

  return (
    <section className={styles.card}>
      <div className={styles.sectionHead}>
        <h2 className={styles.cardTitle}>
          {t("inks.title")}
          {inks.length > 0 && ` (${inks.length})`}
        </h2>
      </div>

      {error && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      {inksQuery.isPending && <p className={styles.quiet}>{t("loading")}</p>}
      {inksQuery.isError && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {inksQuery.error.message}
        </p>
      )}
      {inksQuery.isSuccess && inks.length === 0 && (
        <p className={styles.quiet}>
          {kind === "QUOTE"
            ? t("inks.quoteNote")
            : isAdmin
              ? t("inks.noneChosen")
              : t("inks.noneAssigned")}
        </p>
      )}

      {inks.map((ink) => (
        <div key={ink.id} className={styles.inkBlock}>
          <div className={styles.inkHead}>
            <span
              className={styles.inkSwatch}
              style={ink.colour.hex ? { background: ink.colour.hex } : undefined}
              aria-hidden
            />
            <span className={styles.inkName}>
              <span className={records.mono}>{ink.colour.code}</span>
              {ink.colour.name ? ` ${ink.colour.name}` : ""}
            </span>
            <span className={styles.inkFigures}>
              {t("inks.usedOnOrder", {
                used: qty().format(ink.used),
                unit: unit(ink.colour),
              })}
              {" · "}
              {t("inks.stockLeft", {
                stock: qty().format(ink.colour.stock),
                unit: unit(ink.colour),
              })}
            </span>
            {!ink.colour.active && <span className={styles.inkArchived}>{t("inks.archived")}</span>}
            {canRecord && ink.colour.active && recording !== ink.colour.id && (
              <Button
                size="dense"
                onClick={() => {
                  setError(null);
                  setEditing(null);
                  setRecording(ink.colour.id);
                }}
              >
                {t("inks.addQuantity")}
              </Button>
            )}
            {canRemove && ink.usages.length === 0 && (
              <Button
                size="dense"
                variant="secondary"
                busy={
                  removeColour.isPending &&
                  removeColour.variables?.colourId === ink.colour.id
                }
                onClick={() => {
                  setError(null);
                  removeColour.mutate({ orderId, colourId: ink.colour.id });
                }}
              >
                {t("inks.removeColour")}
              </Button>
            )}
          </div>

          <div className={styles.inkLines}>
            {canRecord && recording === ink.colour.id && (
              <div className={styles.inkForm}>
                <InkUsageForm
                  orderId={orderId}
                  colour={ink.colour}
                  onDone={async () => {
                    setRecording(null);
                    await refresh();
                  }}
                  onCancel={() => setRecording(null)}
                />
              </div>
            )}

            {ink.usages.map((line) =>
              editing?.id === line.id ? (
                <div key={line.id} className={styles.inkForm}>
                  <InkUsageForm
                    orderId={orderId}
                    colour={ink.colour}
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
                    {qty().format(line.quantity)} {unit(ink.colour)}
                  </span>
                  <span className={styles.rowMeta}>
                    {line.recordedBy?.name ?? "—"}
                    {line.note && <span className={styles.quiet}> · {line.note}</span>}
                  </span>
                  {(canRecord || isAdmin) && (
                    <span className={records.actions}>
                      {canRecord && (
                        <Button
                          className={records.actionBtn}
                          onClick={() => {
                            setError(null);
                            setRecording(null);
                            setEditing(line);
                          }}
                        >
                          {common("edit")}
                        </Button>
                      )}
                      {isAdmin && (
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
          </div>
        </div>
      ))}

      {canAdd && inksQuery.isSuccess && (
        <AddColour orderId={orderId} onAdded={refresh} onError={setError} />
      )}

      <Dialog
        open={deleting !== null}
        title={t("inks.deleteTitle")}
        confirmLabel={common("delete")}
        destructive
        busy={removeLine.isPending}
        onConfirm={() => deleting && removeLine.mutate({ id: deleting.id })}
        onClose={() => !removeLine.isPending && setDeleting(null)}
      >
        {deleting &&
          t.rich("inks.deleteBody", {
            quantity: qty().format(deleting.quantity),
            unit: enums(`inkUnit.${deleting.colour.unit}`),
            code: deleting.colour.code,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
      </Dialog>
    </section>
  );
}

/**
 * ADMIN+ picks one more colour for the order: every active colour it does not
 * have yet, out-of-stock ones included — a job can be planned before the ink
 * is delivered.
 */
function AddColour({
  orderId,
  onAdded,
  onError,
}: {
  orderId: string;
  onAdded: () => Promise<unknown>;
  onError: (message: string | null) => void;
}) {
  const trpc = useTRPC();
  const t = useTranslations("orders");
  const enums = useTranslations("enums");
  const choicesQuery = useQuery(trpc.ink.choicesForOrder.queryOptions({ orderId }));
  const [colourId, setColourId] = useState("");
  const choices = choicesQuery.data ?? [];

  const add = useMutation(
    trpc.ink.addToOrder.mutationOptions({
      onSuccess: async () => {
        setColourId("");
        await onAdded();
      },
      onError: (cause) => onError(cause.message),
    }),
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onError(null);
    if (!colourId) return;
    add.mutate({ orderId, colourIds: [colourId] });
  }

  return (
    <form className={styles.inkAdd} onSubmit={handleSubmit} noValidate>
      <SelectField
        label={t("inks.addColour")}
        value={colourId}
        onChange={(e) => setColourId(e.target.value)}
        disabled={add.isPending || choicesQuery.isPending}
        placeholder={
          choicesQuery.isPending
            ? t("loading")
            : choices.length === 0
              ? t("inks.noChoice")
              : t("inks.chooseColour")
        }
        options={choices.map((c) => {
          const colour = `${c.code}${c.name ? ` — ${c.name}` : ""}`;
          return {
            value: c.id,
            label:
              c.stock > 0
                ? t("inks.colourOption", {
                    colour,
                    stock: qty().format(c.stock),
                    unit: enums(`inkUnit.${c.unit}`),
                  })
                : t("inks.colourOptionOut", { colour }),
          };
        })}
      />
      <Button type="submit" variant="secondary" busy={add.isPending} disabled={!colourId}>
        {t("inks.add")}
      </Button>
    </form>
  );
}

/**
 * Record or correct one line, the colour fixed by the block it opens in. A
 * line against the wrong colour is deleted and re-recorded, so the ink
 * returns to the colour it came from (`updateInkUsageInput`).
 */
function InkUsageForm({
  orderId,
  colour,
  initial,
  onDone,
  onCancel,
}: {
  orderId: string;
  colour: Colour;
  initial?: Usage;
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const trpc = useTRPC();
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const [quantity, setQuantity] = useState(initial ? String(initial.quantity) : "");
  const [usedAt, setUsedAt] = useState(
    initial ? new Date(initial.usedAt).toISOString().slice(0, 10) : today(),
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState<string | null>(null);

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
    const parsed = recordInkUsageInput.safeParse({ orderId, colourId: colour.id, ...base });
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
        <TextField
          label={t("inks.quantityUsed")}
          unit={enums(`inkUnit.${colour.unit}`)}
          format="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          autoComplete="off"
          autoFocus
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
          {initial ? t("inks.saveLine") : t("inks.drawFromStock")}
        </Button>
      </div>
    </form>
  );
}
