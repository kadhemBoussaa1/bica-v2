"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import {
  availableOrderTransitions,
  canAcceptQuote,
  kindAllowsTransition,
  canSeeOrderStatus,
  type OrderKind,
  type OrderStatus,
  type OrderTransition,
  type SalesInvoiceStatus,
  type ShipmentStatus,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { TextField } from "@repo/ui/field";
import { useToast } from "@repo/ui/toast";
import { useCurrentUser } from "../auth/use-auth";
import { useTRPC } from "../trpc/client";
import styles from "../records/records.module.css";
import detail from "./order-detail.module.css";

/** The invoice billing this order, when the caller may see it (ADMIN+). */
export interface OrderInvoiceRef {
  id: string;
  numero: string | null;
  status: SalesInvoiceStatus;
}

/** A shipment carrying this order's parcels — on the unpriced select, so every caller has it. */
export interface OrderShipmentRef {
  id: string;
  numero: string | null;
  status: ShipmentStatus;
}

/**
 * The lifecycle actions in the detail page's rail — the visible payoff of
 * docs/order-lifecycle-plan.md §2.4 and §3. Renders only the transitions
 * `availableOrderTransitions` says this role may perform from the order's
 * current status (so an illegal action is never offered, only ever
 * server-rejected as a defence in depth) and, separately, "Accept quote" for
 * a `QUOTE` still in `DRAFT`.
 *
 * Four rows of the table are not bare status flips (docs/sales-invoice-plan.md
 * §7, docs/export-plan.md Step 8). `INVOICEABLE -> INVOICED` is not offered
 * here at all: an invoice is raised from the invoices page, where the
 * client's orders are picked together. The other three are dispatched to the
 * invoice and shipment modules instead of the generic transition mutation:
 * `INVOICED -> INVOICEABLE` takes this order off its draft invoice (the
 * draft keeps its other orders), `INVOICED -> READY_FOR_EXPORT` creates the
 * draft shipment for the order's invoice and opens it, and
 * `READY_FOR_EXPORT -> INVOICED` discards that shipment. The table stays the
 * one authority for labels and roles either way, and the server refuses a
 * bare `order.transition` on all four.
 *
 * `draftInvoice` is undefined below ADMIN (the priced select carries the
 * invoices): the rail then offers "Create shipment" on every INVOICED order
 * and the server's guards are the only check — it either creates the
 * shipment or explains why not.
 *
 * The confirming dialog is generic over one `OrderTransition` at a time
 * rather than one dialog per action: whether the note is required is
 * exactly what that transition's guard says, per the table.
 */
export function OrderTransitions({
  orderId,
  kind,
  status,
  draftInvoice,
  draftShipment,
  edit,
}: {
  orderId: string;
  kind: OrderKind;
  status: OrderStatus;
  /** The DRAFT invoice, if any. Undefined below ADMIN (the select omits it); null when none. */
  draftInvoice?: OrderInvoiceRef | null;
  /** The DRAFT shipment, if any; null when none. */
  draftShipment: OrderShipmentRef | null;
  /** The "Edit order" link, slotted between the forward actions and Cancel. */
  edit?: ReactNode;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const t = useTranslations("orders");
  const { push } = useToast();
  const { user } = useCurrentUser();
  const [pending, setPending] = useState<OrderTransition | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.order.byId.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.order.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.salesInvoice.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.shipment.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.nav.counts.queryKey() }),
    ]);

  const transitionMutation = useMutation(
    trpc.order.transition.mutationOptions({
      onSuccess: async (_result, variables) => {
        setPending(null);
        setNote("");
        // A PRODUCTION user marking an order produced has just moved it out
        // of their scope: the detail page's refetch would 404. Go back to
        // the queue instead, which is where the next piece of work is.
        if (user && !canSeeOrderStatus(user.role, variables.to)) {
          router.replace("/orders");
          return;
        }
        await invalidate();
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const acceptQuoteMutation = useMutation(
    trpc.order.acceptQuote.mutationOptions({
      onSuccess: () => invalidate(),
      onError: (cause) => setError(cause.message),
    }),
  );
  const removeFromInvoiceMutation = useMutation(
    trpc.salesInvoice.removeOrder.mutationOptions({
      onSuccess: async (result) => {
        setPending(null);
        setNote("");
        push({
          title: result.deleted
            ? t("transitions.draftInvoiceDiscarded")
            : t("transitions.removedFromDraftInvoice"),
          tone: "success",
        });
        await Promise.all([
          invalidate(),
          queryClient.invalidateQueries({ queryKey: trpc.salesInvoice.byId.queryKey() }),
        ]);
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const createShipmentMutation = useMutation(
    trpc.shipment.createFromOrder.mutationOptions({
      onSuccess: async (created) => {
        push({ title: t("transitions.draftShipmentCreated"), tone: "success" });
        await invalidate();
        router.push(`/shipments/${created.id}`);
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const discardShipmentMutation = useMutation(
    trpc.shipment.discardDraft.mutationOptions({
      onSuccess: async () => {
        setPending(null);
        setNote("");
        push({ title: t("transitions.draftShipmentDiscarded"), tone: "success" });
        await invalidate();
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  if (!user) return null;

  const isCreateInvoice = (t: OrderTransition) =>
    t.from === "INVOICEABLE" && t.to === "INVOICED";
  const isRemoveFromInvoice = (t: OrderTransition) =>
    t.from === "INVOICED" && t.to === "INVOICEABLE";
  const isCreateShipment = (t: OrderTransition) =>
    t.from === "INVOICED" && t.to === "READY_FOR_EXPORT";
  const isDiscardShipment = (t: OrderTransition) =>
    t.from === "READY_FOR_EXPORT" && t.to === "INVOICED";
  const isMarkExported = (t: OrderTransition) =>
    t.from === "READY_FOR_EXPORT" && t.to === "COMPLETED";
  const isDestructive = (t: OrderTransition) =>
    t.to === "CANCELLED" || isRemoveFromInvoice(t) || isDiscardShipment(t);
  // The table's `description` is the English fallback; the label shown is the
  // message keyed by the row's endpoints (cancel applies from any status).
  const label = (transition: OrderTransition) =>
    transition.to === "CANCELLED"
      ? t("transitions.cancel")
      : t(`transitions.${transition.from}_${transition.to}`);

  // The discard rows only make sense while a DRAFT exists — the server
  // refuses them otherwise, so do not offer them. "Mark exported" is how a
  // shipped order closes only when it has no shipment at all; with a draft
  // in flight the way forward is that draft's Ship button.
  const actions = availableOrderTransitions(status, user.role).filter((action) => {
    // A quote is accepted before it goes anywhere; until then it can only be
    // declined. The server refuses the rest too.
    if (!kindAllowsTransition(kind, action.to)) return false;
    // Raised from the invoices page, with the client's other orders.
    if (isCreateInvoice(action)) return false;
    if (isRemoveFromInvoice(action)) return draftInvoice?.status === "DRAFT";
    if (isDiscardShipment(action)) return draftShipment !== null;
    if (isMarkExported(action)) return draftShipment === null;
    return true;
  });
  const canAccept = canAcceptQuote(kind, status, user.role);

  const openDialog = (transition: OrderTransition) => {
    setError(null);
    setNote("");
    setPending(transition);
  };

  const run = (transition: OrderTransition) => {
    if (isCreateShipment(transition)) {
      setError(null);
      createShipmentMutation.mutate({ orderId });
      return;
    }
    openDialog(transition);
  };

  const confirm = () => {
    if (!pending) return;
    if (isRemoveFromInvoice(pending) && draftInvoice) {
      removeFromInvoiceMutation.mutate({ id: draftInvoice.id, orderId, note });
      return;
    }
    if (isDiscardShipment(pending) && draftShipment) {
      discardShipmentMutation.mutate({ id: draftShipment.id, note });
      return;
    }
    transitionMutation.mutate({
      orderId,
      to: pending.to,
      note: note.trim() === "" ? undefined : note,
    });
  };

  const forward = actions.filter((action) => action.to !== "CANCELLED");
  const cancel = actions.find((action) => action.to === "CANCELLED");
  const busy =
    transitionMutation.isPending ||
    removeFromInvoiceMutation.isPending ||
    discardShipmentMutation.isPending;

  return (
    <div className={detail.railActions}>
      {error && (
        <p
          className={[styles.notice, styles.error].filter(Boolean).join(" ")}
          role="alert"
        >
          {error}
        </p>
      )}

      {/* The one step forward is the primary action; anything else is quiet. */}
      {canAccept && (
        <Button
          variant="primary"
          busy={acceptQuoteMutation.isPending}
          onClick={() => {
            setError(null);
            acceptQuoteMutation.mutate({ orderId });
          }}
        >
          {t("transitions.acceptQuote")}
        </Button>
      )}
      {forward.map((action, index) => (
        <Button
          key={action.to}
          variant={
            isDestructive(action)
              ? "danger"
              : // A reopen (every backward row needs a note) is never the
                // step forward, even when it is the only action left.
                index === 0 && !canAccept && !action.noteRequired
                ? "primary"
                : "secondary"
          }
          busy={isCreateShipment(action) && createShipmentMutation.isPending}
          onClick={() => run(action)}
        >
          {label(action)}
        </Button>
      ))}
      {edit}
      {cancel && (
        <Button variant="danger" onClick={() => openDialog(cancel)}>
          {label(cancel)}
        </Button>
      )}

      <Dialog
        open={pending !== null}
        title={pending ? label(pending) : ""}
        confirmLabel={pending ? label(pending) : t("transitions.confirm")}
        destructive={pending ? isDestructive(pending) : false}
        busy={busy}
        onConfirm={confirm}
        onClose={() => !busy && setPending(null)}
      >
        {pending && isRemoveFromInvoice(pending) && (
          <p className={styles.muted}>
            {t("transitions.discardInvoiceBody")}
          </p>
        )}
        {pending && isDiscardShipment(pending) && (
          <p className={styles.muted}>
            {t("transitions.discardShipmentBody")}
          </p>
        )}
        <TextField
          label={pending?.noteRequired ? t("transitions.noteRequired") : t("transitions.note")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
      </Dialog>
    </div>
  );
}
