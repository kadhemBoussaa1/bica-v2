"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  createProductionRunInput,
  machineTypesForStage,
  WORKSHOP_STAGES,
  type WorkshopStage,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { SelectField, TextField } from "@repo/ui/field";
import { useTRPC } from "../trpc/client";
import styles from "../records/records.module.css";

/** Today as YYYY-MM-DD in local time — `toISOString` would shift the date near midnight. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Which numeric fields each station fills, and how they are labelled.
 * `labelKey` is a key in the `production` messages.
 *
 * Mirrors the discriminated union in `createProductionRunInput` — that schema
 * is the authority and validates whatever this sends, but the two must name
 * the same fields per stage or the form would submit something the server
 * rejects. `required` is what the union demands; the rest are optional there
 * too.
 */
const STAGE_FIELDS: Record<
  WorkshopStage,
  { key: string; labelKey: string; unit?: string; required: boolean }[]
> = {
  PRINTING: [
    {
      key: "metersPrinted",
      labelKey: "metersPrinted",
      unit: "m",
      required: true,
    },
  ],
  PRODUCER: [
    {
      key: "piecesProduced",
      labelKey: "piecesProduced",
      unit: "pcs",
      required: true,
    },
    { key: "goodPieces", labelKey: "goodPieces", unit: "pcs", required: false },
    { key: "wastePieces", labelKey: "waste", unit: "pcs", required: false },
    { key: "piecesToFix", labelKey: "toFix", unit: "pcs", required: false },
  ],
  QUALITY_CONTROL: [
    {
      key: "piecesControlled",
      labelKey: "piecesControlled",
      unit: "pcs",
      required: true,
    },
  ],
  PACKAGING: [
    { key: "parcelsClosed", labelKey: "parcelsClosed", required: true },
  ],
};

interface RunFormProps {
  /**
   * The order to record against. When absent the form offers a picker of
   * the orders currently in production — the production page's case, where
   * the operator starts from the day rather than from an order.
   */
  orderId?: string;
  initialStage?: WorkshopStage;
  /** YYYY-MM-DD; defaults to today. The day view passes the day being looked at. */
  initialDate?: string;
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Records one run against an order. Shared by the order page (order known)
 * and the production day view (order picked here).
 *
 * The station lives on the RUN, not the user: someone covering two stations
 * picks the stage each time rather than needing two accounts. Each stage
 * shows only its own fields, and the contract's discriminated union has the
 * final word before anything is sent.
 */
export function RunForm({
  orderId: fixedOrderId,
  initialStage = "PRODUCER",
  initialDate,
  onDone,
  onCancel,
}: RunFormProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const t = useTranslations("production");
  const enums = useTranslations("enums");
  const common = useTranslations("common");

  const [orderId, setOrderId] = useState(fixedOrderId ?? "");
  const [stage, setStage] = useState<WorkshopStage>(initialStage);
  const [machineId, setMachineId] = useState("");
  const [dateProduction, setDateProduction] = useState(initialDate ?? today());
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  /**
   * The order picker's options: only orders open on the floor, since a run
   * can only be recorded against one of those (the service rejects the rest).
   */
  const ordersQuery = useQuery({
    ...trpc.order.onFloor.queryOptions(),
    enabled: fixedOrderId === undefined,
  });
  const orders = ordersQuery.data ?? [];

  /**
   * The machine picker's options. Page size 100 covers all 22 machines.
   * Filtered by the SAME rule the server enforces (`machineTypesForStage`),
   * so the dropdown can never offer something `assertMachineFitsStage` would
   * then reject. Archived machines are dropped: they cannot be used.
   */
  const stageMachineTypes = machineTypesForStage(stage);
  const machinesQuery = useQuery({
    ...trpc.machine.list.queryOptions({
      pageSize: 100,
      sortBy: "name",
      sortDir: "asc",
    }),
    enabled: stageMachineTypes !== null,
  });
  const machines = (machinesQuery.data?.rows ?? []).filter(
    (m) => m.active && stageMachineTypes?.some((t) => t === m.type),
  );

  const create = useMutation(
    trpc.production.create.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.production.forOrder.queryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.production.daily.queryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.production.monthly.queryKey(),
          }),
        ]);
        onDone();
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!orderId) {
      setError(t("chooseOrderError"));
      return;
    }

    // Build only this stage's fields, then let the discriminated union in the
    // contract have the final word — the same schema the server runs, so a
    // bad value is named here rather than round-tripping to a generic 400.
    const payload: Record<string, unknown> = {
      orderId,
      stage,
      dateProduction,
      note: note.trim() === "" ? undefined : note,
    };
    // Only the two machine stations carry it — the union rejects the key
    // outright on the other two, so it must not be sent at all.
    if (stageMachineTypes) payload.machineId = machineId;
    for (const field of STAGE_FIELDS[stage]) {
      const raw = (values[field.key] ?? "").trim();
      if (raw === "") continue;
      if (Number.isNaN(Number(raw))) {
        setError(t("mustBeNumber", { field: t(field.labelKey) }));
        return;
      }
      payload[field.key] = Number(raw);
    }

    const parsed = createProductionRunInput.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(
        issue
          ? `${issue.path.join(".")}: ${issue.message}`
          : common("checkForm"),
      );
      return;
    }
    create.mutate(parsed.data);
  }

  const busy = create.isPending;

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && (
        <p
          className={[styles.notice, styles.error].filter(Boolean).join(" ")}
          role="alert"
        >
          {error}
        </p>
      )}

      <div className={styles.formGrid}>
        {fixedOrderId === undefined && (
          <div className={styles.formWide}>
            <SelectField
              label={t("order")}
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              disabled={busy || ordersQuery.isPending}
              placeholder={
                ordersQuery.isPending
                  ? common("loading")
                  : orders.length === 0
                    ? t("noOrderInProduction")
                    : t("chooseOrder")
              }
              options={orders.map((o) => ({
                value: o.id,
                label: `${o.numero} · ${o.product.name}${o.client ? ` · ${o.client.name}` : ""}`,
              }))}
            />
          </div>
        )}

        <SelectField
          label={t("station")}
          value={stage}
          onChange={(e) => {
            // Clear the figures: the previous station's fields do not exist
            // on the new stage, and carrying them over would submit values
            // the union rejects. The previous machine is not valid either.
            setValues({});
            setError(null);
            setMachineId("");
            setStage(e.target.value as WorkshopStage);
          }}
          disabled={busy}
          options={WORKSHOP_STAGES.map((v) => ({
            value: v,
            label: enums(`workshopStage.${v}`),
          }))}
        />
        <TextField
          label={t("date")}
          type="date"
          format="mono"
          value={dateProduction}
          onChange={(e) => setDateProduction(e.target.value)}
          disabled={busy}
        />
        {stageMachineTypes && (
          <SelectField
            label={t("machine")}
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            disabled={busy || machinesQuery.isPending}
            allowEmpty
            placeholder={
              machinesQuery.isPending
                ? common("loading")
                : machines.length === 0
                  ? t("noMachineForStation")
                  : t("chooseMachine")
            }
            options={machines.map((m) => ({
              value: m.id,
              label: `${m.name} (${m.code})`,
            }))}
          />
        )}
        {STAGE_FIELDS[stage].map((field) => (
          <TextField
            key={field.key}
            label={
              field.required
                ? t(field.labelKey)
                : t("optional", { label: t(field.labelKey) })
            }
            unit={field.unit}
            format="numeric"
            value={values[field.key] ?? ""}
            onChange={(e) =>
              setValues((current) => ({
                ...current,
                [field.key]: e.target.value,
              }))
            }
            autoComplete="off"
            disabled={busy}
          />
        ))}
        <div className={styles.formWide}>
          <TextField
            label={t("note")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </div>
      </div>

      <div className={styles.formActions}>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {common("cancel")}
        </Button>
        <Button variant="primary" type="submit" busy={busy}>
          {busy ? common("saving") : t("recordRun")}
        </Button>
      </div>
    </form>
  );
}
