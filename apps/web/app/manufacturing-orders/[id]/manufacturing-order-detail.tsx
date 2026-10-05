"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  assetUrl,
  canCancelManufacturingOrder,
  canDeleteManufacturingOrder,
  firstOpenPosition,
  isActionFinished,
  MANUFACTURING_ACTIONS_MAX,
  MANUFACTURING_REASON_MAX,
  manufacturingOrderIsFrozen,
  undoSteps,
  UPLOAD_CONTENT_TYPES,
  UPLOAD_MAX_BYTES,
  type UploadContentType,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { EmptyState } from "@repo/ui/empty-state";
import { TextAreaField } from "@repo/ui/field";
import { useFileUpload } from "@repo/ui/file-upload";
import { TableSkeleton } from "@repo/ui/skeleton";
import { Thumbnail } from "@repo/ui/thumbnail";
import { useToast } from "@repo/ui/toast";
import { Avatar } from "../../employees/avatar";
import { employeeName } from "../../employees/employee-name";
import records from "../../records/records.module.css";
import { useTRPC } from "../../trpc/client";
import { invalidateManufacturingQueries } from "../manufacturing-queries";
import { formatDay, formatMoment, OrderStatusPill } from "../manufacturing-ui";
import styles from "../manufacturing.module.css";
import { ActionDialog, type PositionChoice } from "./action-dialog";
import { ActionItem, type Action, type PipelineControls } from "./action-item";

/** The one dialog open over the page, if any. Actions are held by id: the live row is read at render. */
type Open =
  | null
  | { kind: "add"; at?: number }
  | { kind: "edit"; actionId: string }
  | { kind: "remove"; actionId: string }
  | { kind: "cancel" }
  | { kind: "delete" };

/** How many of the templates' action names the "new action" dialog offers. */
const SUGGESTIONS = 6;

/**
 * One OF, from "Ordres de fabrication v3.dc.html": who it is for and how far
 * it has got, its pipeline as a timeline of cards — the open one is where
 * the action is worked — and, beside it, what is happening now, who is on
 * the job, and the machines and files it has gathered.
 *
 * The page owns every mutation and hands the cards a small set of controls,
 * so one write at a time is in flight and everything waits for it. What a
 * card offers comes from the contract's rules; the server re-checks the same
 * ones under a lock, and a refusal lands here as a toast.
 */
export function ManufacturingOrderDetail({ id }: { id: string }) {
  const t = useTranslations("manufacturing");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { push } = useToast();

  const [open, setOpen] = useState<Open>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // The card that is open. `undefined` follows the action in progress, so
  // finishing one opens the next; a click pins a card (or `null`: none).
  const [focus, setFocus] = useState<string | null | undefined>(undefined);
  const show = (next: Open) => {
    setDialogError(null);
    setReason("");
    setOpen(next);
  };

  const orderQuery = useQuery(trpc.manufacturing.byId.queryOptions({ id }));
  const actions: readonly Action[] = orderQuery.data?.actions ?? [];
  // Their action names feed the "new action" dialog's suggestions.
  const templatesQuery = useQuery(
    trpc.manufacturingTemplate.list.queryOptions(undefined, { enabled: open?.kind === "add" }),
  );

  const refresh = () => invalidateManufacturingQueries(queryClient, trpc);
  // A card's control: the page refreshes, a refusal is a toast.
  const inline = {
    onSuccess: refresh,
    onError: (cause: { message: string }) => push({ title: cause.message, tone: "error" as const }),
  };
  // A move along the pipeline: the open card follows the action in progress.
  const advance = {
    ...inline,
    onSuccess: async () => {
      await refresh();
      setFocus(undefined);
    },
  };
  // A dialog's save: it closes on success and shows a refusal in place.
  const modal = {
    onSuccess: async () => {
      await refresh();
      setOpen(null);
    },
    onError: (cause: { message: string }) => setDialogError(cause.message),
  };

  const start = useMutation(trpc.manufacturing.start.mutationOptions(advance));
  const complete = useMutation(trpc.manufacturing.complete.mutationOptions(advance));
  const skip = useMutation(trpc.manufacturing.skip.mutationOptions(advance));
  const undo = useMutation(trpc.manufacturing.undo.mutationOptions(advance));
  const move = useMutation(trpc.manufacturing.moveAction.mutationOptions(inline));
  const setEmployees = useMutation(trpc.manufacturing.setEmployees.mutationOptions(inline));
  const setMachine = useMutation(trpc.manufacturing.setMachine.mutationOptions(inline));
  const removeAttachment = useMutation(trpc.manufacturing.removeAttachment.mutationOptions(inline));
  const addComment = useMutation(trpc.manufacturing.addComment.mutationOptions(inline));
  const reopen = useMutation(trpc.manufacturing.reopen.mutationOptions(inline));
  const addAction = useMutation(trpc.manufacturing.addAction.mutationOptions(modal));
  const updateAction = useMutation(trpc.manufacturing.updateAction.mutationOptions(modal));
  const removeAction = useMutation(trpc.manufacturing.removeAction.mutationOptions(modal));
  const cancel = useMutation(trpc.manufacturing.cancel.mutationOptions(modal));
  const remove = useMutation(
    trpc.manufacturing.remove.mutationOptions({
      // The OF is gone: leave before anything refetches it.
      onSuccess: async () => {
        router.replace("/manufacturing-orders");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.manufacturing.list.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.manufacturing.summary.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.order.byId.queryKey() }),
        ]);
      },
      onError: modal.onError,
    }),
  );

  // ---- files: a presigned PUT straight to S3, then the URL is filed ----------
  const fileRef = useRef<HTMLInputElement>(null);
  // Read inside the upload callbacks, which outlive the render that set them.
  const fileTarget = useRef<string | null>(null);
  const pendingFile = useRef<{ filename: string; contentType: UploadContentType; size: number } | null>(
    null,
  );
  const [uploadTarget, setUploadTarget] = useState<string | null>(null);
  const createUpload = useMutation(trpc.manufacturing.createAttachmentUpload.mutationOptions());
  const addAttachment = useMutation(trpc.manufacturing.addAttachment.mutationOptions(inline));
  const upload = useFileUpload({
    onChange: (url) => {
      const actionId = fileTarget.current;
      const file = pendingFile.current;
      if (url === null || actionId === null || file === null) return;
      addAttachment.mutate({ actionId, url, ...file });
    },
    onRequestUpload: (file) => {
      const actionId = fileTarget.current;
      if (actionId === null) return Promise.reject(new Error(t("action.failed")));
      // `useFileUpload` has already refused anything outside the list.
      const contentType = file.type as UploadContentType;
      pendingFile.current = { filename: file.name, contentType, size: file.size };
      return createUpload.mutateAsync({ actionId, filename: file.name, contentType, size: file.size });
    },
    contentTypes: UPLOAD_CONTENT_TYPES,
    maxBytes: UPLOAD_MAX_BYTES,
    strings: {
      failed: t("action.failed"),
      tooLarge: t("action.tooLarge"),
      wrongType: t("action.wrongType"),
    },
  });
  const uploadingTo = upload.busy || addAttachment.isPending ? uploadTarget : null;
  const aim = (actionId: string) => {
    upload.reset();
    fileTarget.current = actionId;
    setUploadTarget(actionId);
  };

  if (orderQuery.isPending) return <TableSkeleton />;
  if (orderQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {orderQuery.error.message}
      </p>
    );
  }

  const of = orderQuery.data;
  const frozen = manufacturingOrderIsFrozen(of.status);
  const photo = assetUrl(of.order.product.images[0] ?? null);
  const finished = actions.filter((action) => isActionFinished(action.status)).length;
  const actionOf = (actionId: string) => actions.find((action) => action.id === actionId);
  const currentIndex = actions.findIndex((action) => action.status === "IN_PROGRESS");
  const current = actions[currentIndex];
  // What comes after: the first waiting action, wherever the pipeline stands.
  const next = actions.find((action) => action.status === "WAITING");
  const last = actions[actions.length - 1];
  const back = frozen ? [] : undoSteps(actions);
  const openId = focus === undefined ? (current?.id ?? null) : focus;
  const busy = [
    start,
    complete,
    skip,
    undo,
    move,
    setEmployees,
    setMachine,
    removeAttachment,
    addComment,
    reopen,
    addAttachment,
  ].some((mutation) => mutation.isPending);

  const controls: PipelineControls = {
    busy,
    start: (actionId) => start.mutate({ actionId }),
    complete: (actionId) => complete.mutate({ actionId }),
    skip: (actionId) => skip.mutate({ actionId }),
    undo: () => undo.mutate({ id: of.id }),
    move: (actionId, position) => move.mutate({ actionId, position }),
    setEmployees: (actionId, employeeIds) => setEmployees.mutate({ actionId, employeeIds }),
    setMachine: (actionId, machineId) => setMachine.mutate({ actionId, machineId }),
    removeAttachment: (attachmentId) => removeAttachment.mutate({ attachmentId }),
    comment: (actionId, body, onDone) => addComment.mutate({ actionId, body }, { onSuccess: onDone }),
    pickFile: (actionId) => {
      aim(actionId);
      fileRef.current?.click();
    },
    dropFile: (actionId, file) => {
      aim(actionId);
      void upload.upload(file);
    },
    uploadingTo,
  };

  // ---- the rail: who is on the job, and what it has gathered -----------------
  const team = new Map<string, { person: Action["assignees"][number]["employee"]; count: number }>();
  const machines = new Map<string, { code: string; where: string[] }>();
  const files: { id: string; url: string; filename: string; where: string }[] = [];
  for (const action of actions) {
    for (const { employee } of action.assignees) {
      const entry = team.get(employee.id) ?? { person: employee, count: 0 };
      entry.count += 1;
      team.set(employee.id, entry);
    }
    if (action.machine) {
      const entry = machines.get(action.machine.id) ?? { code: action.machine.code, where: [] };
      entry.where.push(action.label);
      machines.set(action.machine.id, entry);
    }
    for (const file of action.attachments) {
      files.push({ id: file.id, url: file.url, filename: file.filename, where: action.label });
    }
  }

  const bold = (chunks: ReactNode) => <strong>{chunks}</strong>;
  const nowTitle = frozen
    ? t("detail.now.cancelled")
    : current
      ? current.label
      : of.status === "DONE"
        ? t("detail.now.allDone")
        : t("detail.now.nothing");
  // `<bdi>` per part: in Arabic a Latin name or a date would otherwise land
  // on the far side of its separator.
  const nowMeta: ReactNode = frozen ? (
    <>
      {of.cancelledAt && <bdi>{t("detail.cancelledOn", { date: formatDay(of.cancelledAt) })}</bdi>}
      {of.cancelledBy && (
        <>
          {" · "}
          <bdi>{of.cancelledBy.name}</bdi>
        </>
      )}
      {of.cancelReason && (
        <>
          {" · "}
          <bdi>{of.cancelReason}</bdi>
        </>
      )}
    </>
  ) : current ? (
    <>
      <bdi>{t("detail.now.position", { n: currentIndex + 1, total: actions.length })}</bdi>
      {" · "}
      <bdi>
        {current.assignees.length > 0
          ? current.assignees.map(({ employee }) => employeeName(employee)).join(", ")
          : t("detail.now.nobody")}
      </bdi>
      {current.startedAt && (
        <>
          {" · "}
          <bdi>{t("detail.now.since", { date: formatMoment(current.startedAt) })}</bdi>
        </>
      )}
    </>
  ) : of.status === "DONE" ? (
    last?.completedAt ? (
      t("detail.now.lastClosed", { date: formatMoment(last.completedAt) })
    ) : null
  ) : actions.length === 0 ? null : finished === 0 ? (
    t("detail.now.startHint")
  ) : (
    t("detail.now.resumeHint")
  );

  // ---- the "new action" dialog's places and suggestions ----------------------
  const floor = firstOpenPosition(actions);
  const positions: PositionChoice[] = [];
  if (open?.kind === "add") {
    if (open.at !== undefined) positions.push({ key: "here", position: open.at });
    positions.push({ key: "end", position: actions.length });
    if (currentIndex !== -1) positions.push({ key: "afterCurrent", position: currentIndex + 1 });
  }
  const labels = actions.map((action) => action.label);
  const have = new Set(labels.map((label) => label.toLowerCase()));
  const suggestions = [
    ...new Set(
      (templatesQuery.data ?? [])
        .filter((template) => template.active)
        .flatMap((template) => template.actions.map((action) => action.label)),
    ),
  ]
    .filter((label) => !have.has(label.toLowerCase()))
    .slice(0, SUGGESTIONS);

  const editing = open?.kind === "edit" ? actionOf(open.actionId) : undefined;
  const removing = open?.kind === "remove" ? actionOf(open.actionId) : undefined;
  const canAdd = !frozen && actions.length < MANUFACTURING_ACTIONS_MAX;

  return (
    <>
      <header className={styles.head}>
        <div className={styles.headTop}>
          {/* The order's photo (its product's first image); opens full size. */}
          <span className={styles.headThumb}>
            <Thumbnail size="md" src={photo} href={photo} />
          </span>
          <div className={styles.headMain}>
            <span className={records.eyebrow}>{t("detail.eyebrow")}</span>
            <div className={styles.headTitleRow}>
              <h1 className={styles.headNumero}>{of.numero}</h1>
              <OrderStatusPill status={of.status} />
            </div>
            <div className={styles.headWho}>
              <bdi>{of.order.client?.name ?? t("detail.noClient")}</bdi> · <bdi>{of.order.product.name}</bdi>
            </div>
            <div className={styles.headMeta}>
              <Link className={styles.headOrder} href={`/orders/${of.order.id}`}>
                {of.order.numero}
              </Link>
              <span>
                {of.createdByName
                  ? t("detail.openedBy", { date: formatDay(of.createdAt), name: of.createdByName })
                  : t("detail.opened", { date: formatDay(of.createdAt) })}
              </span>
              <span>
                {of.template
                  ? t(of.adapted ? "detail.fromTemplateAdapted" : "detail.fromTemplate", {
                      name: of.template.name,
                    })
                  : t("detail.custom")}
              </span>
              {of.legacyNumero && (
                <span className={styles.headLegacy}>{t("formerly", { numero: of.legacyNumero })}</span>
              )}
            </div>
          </div>

          <div className={styles.headProgress}>
            <div className={styles.headCount}>
              <span className={styles.headDone}>{finished}</span>
              <span className={styles.headTotal}>{t("detail.progress", { total: actions.length })}</span>
            </div>
            <div
              className={styles.bar}
              role="meter"
              aria-valuemin={0}
              aria-valuemax={actions.length}
              aria-valuenow={finished}
              aria-label={t("detail.pipeline")}
            >
              <span
                className={styles.barFill}
                style={{ width: `${actions.length ? (100 * finished) / actions.length : 0}%` }}
              />
            </div>
            <div className={styles.headActions}>
              <Button size="dense" disabled={busy || back.length === 0} onClick={controls.undo}>
                <span aria-hidden>↶</span> {t("detail.undo")}
              </Button>
              <Link
                className={records.inlineLink}
                href={`/settings/activity?entity=${encodeURIComponent(of.id)}`}
              >
                {t("detail.activity")}
              </Link>
            </div>
          </div>
        </div>

        {actions.length > 0 && (
          <div className={styles.jump}>
            {actions.map((action, index) => (
              <button
                key={action.id}
                type="button"
                className={[
                  styles.jumpChip,
                  styles[`jump_${action.status}`],
                  action.id === openId ? styles.jumpOn : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                title={action.label}
                aria-pressed={action.id === openId}
                onClick={() => {
                  setFocus(action.id);
                  document
                    .getElementById(`action-${action.id}`)
                    ?.scrollIntoView({ block: "center", behavior: "smooth" });
                }}
              >
                <span className={styles.jumpMark} aria-hidden>
                  {action.status === "DONE" ? "✓" : index + 1}
                </span>
                <span className={styles.jumpName}>{action.label}</span>
              </button>
            ))}
          </div>
        )}

        {(frozen || canCancelManufacturingOrder(of.status) || canDeleteManufacturingOrder(actions)) && (
          <div className={styles.headFoot}>
            {frozen && (
              <Button size="dense" variant="primary" busy={reopen.isPending} onClick={() => reopen.mutate({ id: of.id })}>
                {t("detail.reopen")}
              </Button>
            )}
            {canCancelManufacturingOrder(of.status) && (
              <button
                type="button"
                className={[styles.quietBtn, styles.quietDanger].filter(Boolean).join(" ")}
                disabled={busy}
                onClick={() => show({ kind: "cancel" })}
              >
                {t("detail.cancel")}
              </button>
            )}
            {canDeleteManufacturingOrder(actions) && (
              <button
                type="button"
                className={[styles.quietBtn, styles.quietDanger].filter(Boolean).join(" ")}
                disabled={busy}
                onClick={() => show({ kind: "delete" })}
              >
                {t("detail.delete")}
              </button>
            )}
          </div>
        )}
      </header>

      {frozen && <p className={[records.notice, styles.frozen].filter(Boolean).join(" ")}>{t("detail.frozen")}</p>}

      <div className={styles.layout}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>{t("detail.pipeline")}</h2>
            {canAdd && actions.length > 0 && (
              <Button size="dense" disabled={busy} onClick={() => show({ kind: "add" })}>
                {t("detail.addAction")}
              </Button>
            )}
          </div>

          {upload.error && (
            <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
              {upload.error}
            </p>
          )}

          {actions.length === 0 ? (
            <EmptyState
              title={t("detail.noActions")}
              text={frozen ? undefined : t("detail.noActionsText")}
              actions={
                frozen ? undefined : (
                  <Button variant="primary" onClick={() => show({ kind: "add" })}>
                    {t("detail.addAction")}
                  </Button>
                )
              }
            />
          ) : (
            <ol className={styles.steps}>
              {actions.map((action, index) => (
                <ActionItem
                  key={action.id}
                  action={action}
                  index={index}
                  actions={actions}
                  back={back}
                  frozen={frozen}
                  open={action.id === openId}
                  onToggle={() => setFocus(action.id === openId ? null : action.id)}
                  controls={controls}
                  onEdit={() => show({ kind: "edit", actionId: action.id })}
                  onRemove={() => show({ kind: "remove", actionId: action.id })}
                  onInsertAfter={() => show({ kind: "add", at: index + 1 })}
                />
              ))}
            </ol>
          )}
        </section>

        <aside className={styles.rail}>
          <div className={styles.now} data-surface="floor">
            <div className={styles.nowKicker}>{t("detail.now.kicker")}</div>
            <div className={styles.nowHeading}>{nowTitle}</div>
            {nowMeta && <div className={styles.nowLine}>{nowMeta}</div>}
            {!frozen && current && next && (
              <div className={styles.nowNext}>{t.rich("detail.now.next", { name: next.label, b: bold })}</div>
            )}
          </div>

          <div className={styles.railCard}>
            <h2 className={styles.railTitle}>{t("detail.team.title")}</h2>
            {team.size === 0 ? (
              <p className={styles.fine}>{t("detail.team.none")}</p>
            ) : (
              [...team.values()].map(({ person, count }) => (
                <div key={person.id} className={styles.railRow}>
                  <Avatar employee={person} size="sm" />
                  <span className={styles.railGrow}>{employeeName(person)}</span>
                  <span className={styles.railMeta}>{t("detail.team.count", { count })}</span>
                </div>
              ))
            )}
          </div>

          <div className={styles.railCard}>
            <h2 className={styles.railTitle}>{t("detail.assets.title")}</h2>
            {machines.size === 0 && files.length === 0 && (
              <p className={styles.fine}>{t("detail.assets.none")}</p>
            )}
            {[...machines.entries()].map(([machineId, machine]) => (
              <div key={machineId} className={styles.railRow}>
                <span className={styles.railCode}>{machine.code}</span>
                <span className={[styles.railGrow, styles.railWhere].filter(Boolean).join(" ")}>
                  {machine.where.join(", ")}
                </span>
              </div>
            ))}
            {files.map((file) => (
              <div key={file.id} className={styles.railRow}>
                <a
                  className={[styles.railGrow, styles.railFile].filter(Boolean).join(" ")}
                  href={assetUrl(file.url) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  {file.filename}
                </a>
                <span className={styles.railMeta}>{file.where}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={UPLOAD_CONTENT_TYPES.join(",")}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so picking the same file again still fires.
          event.target.value = "";
          if (file) void upload.upload(file);
        }}
      />

      {open?.kind === "add" && (
        <ActionDialog
          eyebrow={of.numero}
          // Never above a started action: only the places the rules allow.
          positions={positions.filter(
            (option, index, all) =>
              option.position >= floor &&
              all.findIndex((other) => other.position === option.position) === index,
          )}
          labels={labels}
          suggestions={suggestions}
          busy={addAction.isPending}
          error={dialogError}
          onSave={(definition, position) => addAction.mutate({ id: of.id, position, ...definition })}
          onClose={() => setOpen(null)}
        />
      )}
      {editing && (
        <ActionDialog
          key={editing.id}
          eyebrow={of.numero}
          initial={editing}
          labels={labels}
          busy={updateAction.isPending}
          error={dialogError}
          onSave={({ label, handlesEmployees, handlesMachine, handlesAttachments }) =>
            updateAction.mutate({
              actionId: editing.id,
              label,
              handlesEmployees,
              handlesMachine,
              handlesAttachments,
            })
          }
          onClose={() => setOpen(null)}
        />
      )}

      <Dialog
        open={removing !== undefined}
        title={t("dialogs.removeTitle")}
        confirmLabel={t("dialogs.removeConfirm")}
        destructive
        busy={removeAction.isPending}
        onConfirm={() => removing && removeAction.mutate({ actionId: removing.id })}
        onClose={() => setOpen(null)}
      >
        {dialogError && <span role="alert">{dialogError} </span>}
        {removing &&
          t.rich("dialogs.removeBody", {
            name: removing.label,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
      </Dialog>

      <Dialog
        open={open?.kind === "cancel"}
        title={t("dialogs.cancelTitle", { numero: of.numero })}
        confirmLabel={t("dialogs.cancelConfirm")}
        destructive
        busy={cancel.isPending}
        onConfirm={() => {
          if (reason.trim() !== "") cancel.mutate({ id: of.id, reason: reason.trim() });
        }}
        onClose={() => setOpen(null)}
      >
        <div className={styles.dialogForm}>
          <p>{t("dialogs.cancelBody")}</p>
          <TextAreaField
            label={t("dialogs.reason")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={MANUFACTURING_REASON_MAX}
            error={dialogError ?? undefined}
            disabled={cancel.isPending}
          />
        </div>
      </Dialog>

      <Dialog
        open={open?.kind === "delete"}
        title={t("dialogs.deleteTitle", { numero: of.numero })}
        confirmLabel={t("dialogs.deleteConfirm")}
        destructive
        busy={remove.isPending}
        onConfirm={() => remove.mutate({ id: of.id })}
        onClose={() => setOpen(null)}
      >
        {dialogError && <span role="alert">{dialogError} </span>}
        {t("dialogs.deleteBody")}
      </Dialog>
    </>
  );
}
