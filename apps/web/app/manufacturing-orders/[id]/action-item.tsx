"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type DragEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import {
  assetUrl,
  canCompleteAction,
  canEditActionDefinition,
  canFillAction,
  canSkipAction,
  canStartAction,
  firstOpenPosition,
  MANUFACTURING_ACTIONS_MAX,
  MANUFACTURING_ACTION_STATUSES,
  MANUFACTURING_COMMENT_MAX,
  type ManufacturingActionStatus,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Avatar } from "../../employees/avatar";
import { employeeName } from "../../employees/employee-name";
import { useTRPC } from "../../trpc/client";
import {
  ACTION_TONE,
  ActionStatusPill,
  FileGlyph,
  formatMoment,
  HandleGlyph,
  HandleIcons,
} from "../manufacturing-ui";
import styles from "../manufacturing.module.css";

export type ManufacturingOrderData = inferRouterOutputs<AppRouter>["manufacturing"]["byId"];
export type Action = ManufacturingOrderData["actions"][number];
type Person = Action["assignees"][number]["employee"];
type Comment = Action["comments"][number];

/** A comment the importer wrote from the old app's built-in fields: nobody's. */
export const isImportNote = (comment: Comment) =>
  comment.authorId === null && comment.authorName === null;

/** What an action card can ask of the page, which owns every mutation. */
export interface PipelineControls {
  /** A write is in flight: every control waits for it. */
  busy: boolean;
  start: (actionId: string) => void;
  complete: (actionId: string) => void;
  skip: (actionId: string) => void;
  /** Steps the whole pipeline back one action. */
  undo: () => void;
  move: (actionId: string, position: number) => void;
  setEmployees: (actionId: string, employeeIds: string[]) => void;
  setMachine: (actionId: string, machineId: string | null) => void;
  removeAttachment: (attachmentId: string) => void;
  comment: (actionId: string, body: string, onDone: () => void) => void;
  /** Opens the file picker for this action. */
  pickFile: (actionId: string) => void;
  /** Uploads a file dropped on this action. */
  dropFile: (actionId: string, file: File) => void;
  /** The action a file is being uploaded to, if any. */
  uploadingTo: string | null;
}

interface ActionItemProps {
  action: Action;
  index: number;
  /** The whole pipeline, in order: the rules read an action's neighbours. */
  actions: readonly Action[];
  /** What stepping the pipeline back would change — see `undoSteps`. */
  back: readonly { index: number; to: ManufacturingActionStatus }[];
  /** The OF is cancelled: only comments stay open. */
  frozen: boolean;
  open: boolean;
  onToggle: () => void;
  controls: PipelineControls;
  onEdit: () => void;
  onRemove: () => void;
  onInsertAfter: () => void;
}

/**
 * One action of the pipeline, on the timeline. Closed, the card says what
 * the action is, where it stands and what it holds; open, it is where the
 * action is worked — its status, its people, its machine, its files and its
 * comments.
 *
 * What each control does is decided by the pure rules the server re-checks
 * (`manufacturing.ts` in the contract), so a status is offered exactly when
 * the call behind it would be accepted.
 */
export function ActionItem({
  action,
  index,
  actions,
  back,
  frozen,
  open,
  onToggle,
  controls,
  onEdit,
  onRemove,
  onInsertAfter,
}: ActionItemProps) {
  const t = useTranslations("manufacturing");
  const enums = useTranslations("enums");
  const trpc = useTRPC();
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState(false);

  const { busy } = controls;
  const waiting = !frozen && canEditActionDefinition(action.status);
  const fillable = !frozen && canFillAction(action.status);
  const people = action.assignees.map(({ employee }) => employee);
  const uploading = controls.uploadingTo === action.id;
  const notes = action.comments.filter(isImportNote);
  const said = action.comments.length - notes.length;

  // Asked for only by the open card, and only when there is a choice to make.
  const rosterQuery = useQuery(
    trpc.employee.list.queryOptions(
      { pageSize: 100, sortBy: "lastName", sortDir: "asc", filter: "onRoster" },
      { enabled: open && picking },
    ),
  );
  const machinesQuery = useQuery(
    trpc.machine.list.queryOptions(
      { pageSize: 100, sortBy: "name", sortDir: "asc", filter: "all" },
      { enabled: open && fillable && action.handlesMachine },
    ),
  );

  /**
   * What clicking a status does, or null when the pipeline's sequence does
   * not allow it. Forward moves are the action's own; a move back is the
   * pipeline stepping back one action, offered only on the action(s) that
   * step would change.
   */
  const reach = (to: ManufacturingActionStatus): (() => void) | null => {
    if (frozen || action.status === to) return null;
    if (to === "IN_PROGRESS" && canStartAction(actions, index)) return () => controls.start(action.id);
    if (to === "DONE" && canCompleteAction(actions, index)) return () => controls.complete(action.id);
    if (to === "SKIPPED" && canSkipAction(actions, index)) return () => controls.skip(action.id);
    if (back.some((step) => step.index === index && step.to === to)) return controls.undo;
    return null;
  };

  const hint = frozen
    ? t("action.hint.frozen")
    : action.status === "WAITING"
      ? canStartAction(actions, index)
        ? t("action.hint.waiting")
        : t("action.hint.blocked")
      : action.status === "IN_PROGRESS"
        ? actions[index + 1]?.status === "WAITING"
          ? t("action.hint.inProgress")
          : t("action.hint.last")
        : action.status === "DONE"
          ? t("action.hint.done", { date: formatMoment(action.completedAt) })
          : t("action.hint.skipped", { date: formatMoment(action.completedAt) });

  // Each moment in its own <bdi>: in Arabic the LTR runs would otherwise
  // reorder. A dash between two, not an arrow, which would point the wrong
  // way in right-to-left text.
  const when: ReactNode =
    action.status === "WAITING" ? (
      t("action.notStarted")
    ) : action.status === "IN_PROGRESS" ? (
      <bdi>{t("action.startedOn", { date: formatMoment(action.startedAt) })}</bdi>
    ) : action.status === "SKIPPED" ? (
      <bdi>{t("action.skippedOn", { date: formatMoment(action.completedAt) })}</bdi>
    ) : (
      <>
        <bdi>{formatMoment(action.startedAt)}</bdi> – <bdi>{formatMoment(action.completedAt)}</bdi>
      </>
    );

  const assigned = new Set(people.map((person) => person.id));
  const term = search.trim().toLowerCase();
  const choices: Person[] = (rosterQuery.data?.rows ?? []).filter(
    (person) =>
      !assigned.has(person.id) &&
      (term === "" || `${employeeName(person)} ${person.matricule}`.toLowerCase().includes(term)),
  );
  // The picker lists active machines; one archived since stays selectable here.
  const machines = (machinesQuery.data?.rows ?? []).filter(
    (machine) => machine.active || machine.id === action.machine?.id,
  );

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) controls.dropFile(action.id, file);
  };

  const mark = action.status === "DONE" ? "✓" : action.status === "SKIPPED" ? "–" : String(index + 1);
  const canInsert =
    !frozen && actions.length < MANUFACTURING_ACTIONS_MAX && index + 1 >= firstOpenPosition(actions);

  return (
    <li
      id={`action-${action.id}`}
      className={[styles.step, styles[`step_${action.status}`], open ? styles.stepOpen : null]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.stepRail} aria-hidden>
        <span className={styles.stepMark}>{mark}</span>
        <span className={styles.stepLine} />
      </div>

      <div className={styles.stepBody}>
        <div className={[styles.card, ACTION_TONE[action.status]].filter(Boolean).join(" ")}>
          <button
            type="button"
            className={styles.cardHead}
            aria-expanded={open}
            aria-label={t("action.open", { n: index + 1, name: action.label })}
            onClick={onToggle}
          >
            <span className={styles.cardTitleRow}>
              <span className={styles.cardName}>{action.label}</span>
              <HandleIcons value={action} />
              <ActionStatusPill status={action.status} />
            </span>
            <span className={styles.cardWhen}>{when}</span>
          </button>

          {!open && (
            <>
              {(people.length > 0 || action.machine || action.attachments.length > 0) && (
                <div className={styles.held}>
                  {people.map((person) => (
                    <span key={person.id} className={styles.personChip}>
                      <Avatar employee={person} size="sm" />
                      {employeeName(person)}
                    </span>
                  ))}
                  {action.machine && (
                    <span className={styles.machineChip}>
                      <HandleGlyph name="machine" />
                      <bdi>{action.machine.code}</bdi> · {action.machine.name}
                    </span>
                  )}
                  {action.attachments.map((file) => (
                    <a
                      key={file.id}
                      className={styles.fileChip}
                      href={assetUrl(file.url) ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <HandleGlyph name="attachments" />
                      {file.filename}
                    </a>
                  ))}
                </div>
              )}
              {notes.map((note) => (
                <div key={note.id} className={styles.legacy}>
                  <div className={styles.legacyHead}>
                    {t("action.oldApp")} · <bdi>{formatMoment(note.createdAt)}</bdi>
                  </div>
                  <div className={styles.legacyBody}>{note.body}</div>
                </div>
              ))}
              {said > 0 && <div className={styles.fine}>{t("action.comments", { count: said })}</div>}
            </>
          )}

          {open && (
            <div className={styles.work}>
              <div className={styles.group}>
                <span className={styles.groupLabel}>{t("action.status")}</span>
                <div className={styles.statusOptions}>
                  {MANUFACTURING_ACTION_STATUSES.map((status) => {
                    const go = reach(status);
                    const on = action.status === status;
                    return (
                      <button
                        key={status}
                        type="button"
                        className={[styles.statusOption, ACTION_TONE[status], on ? styles.statusOptionOn : null]
                          .filter(Boolean)
                          .join(" ")}
                        aria-pressed={on}
                        disabled={busy || (!on && go === null)}
                        onClick={() => go?.()}
                      >
                        {enums(`manufacturingActionStatus.${status}`)}
                      </button>
                    );
                  })}
                </div>
                <span className={styles.fine}>{hint}</span>
              </div>

              {action.handlesEmployees && (
                <div className={styles.group}>
                  <span className={styles.groupLabel}>{t("action.people")}</span>
                  <div className={styles.held}>
                    {people.length === 0 && !fillable && (
                      <span className={styles.none}>{t("action.noEmployees")}</span>
                    )}
                    {people.map((person) => (
                      <span key={person.id} className={[styles.personChip, styles.personChipLarge].filter(Boolean).join(" ")}>
                        <Avatar employee={person} size="sm" />
                        {employeeName(person)}
                        {fillable && (
                          <button
                            type="button"
                            className={styles.chipRemove}
                            aria-label={t("action.unassign", { name: employeeName(person) })}
                            title={t("action.unassign", { name: employeeName(person) })}
                            disabled={busy}
                            onClick={() =>
                              controls.setEmployees(
                                action.id,
                                people.filter((other) => other.id !== person.id).map((other) => other.id),
                              )
                            }
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                    {fillable && (
                      <button
                        type="button"
                        className={styles.dashedChip}
                        aria-expanded={picking}
                        onClick={() => setPicking((current) => !current)}
                      >
                        {t("action.assign")}
                      </button>
                    )}
                  </div>
                  {fillable && picking && (
                    <div className={styles.picker}>
                      <input
                        type="search"
                        className={styles.input}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t("action.pickerSearch")}
                        aria-label={t("action.pickerSearch")}
                      />
                      <div className={styles.held}>
                        {!rosterQuery.isPending && choices.length === 0 && (
                          <span className={styles.none}>{t("action.pickerNone")}</span>
                        )}
                        {choices.map((person) => (
                          <button
                            key={person.id}
                            type="button"
                            className={styles.choice}
                            disabled={busy}
                            onClick={() =>
                              controls.setEmployees(action.id, [...assigned, person.id])
                            }
                          >
                            <Avatar employee={person} size="sm" />
                            {employeeName(person)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {action.handlesMachine && (
                <div className={styles.group}>
                  <span className={styles.groupLabel}>{t("action.machine")}</span>
                  {fillable ? (
                    <div className={styles.machineOptions}>
                      {machines.map((machine) => {
                        const on = machine.id === action.machine?.id;
                        return (
                          <button
                            key={machine.id}
                            type="button"
                            className={[styles.machineOption, on ? styles.machineOptionOn : null]
                              .filter(Boolean)
                              .join(" ")}
                            aria-pressed={on}
                            disabled={busy}
                            // A second click on the chosen machine takes it off.
                            onClick={() => controls.setMachine(action.id, on ? null : machine.id)}
                          >
                            <span className={styles.machineCode}>{machine.code}</span>
                            <span className={styles.machineName}>{machine.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : action.machine ? (
                    <div className={styles.held}>
                      <span className={styles.machineChip}>
                        <HandleGlyph name="machine" />
                        <bdi>{action.machine.code}</bdi> · {action.machine.name}
                      </span>
                    </div>
                  ) : (
                    <span className={styles.none}>{t("action.noMachine")}</span>
                  )}
                </div>
              )}

              {action.handlesAttachments && (
                <div className={styles.group}>
                  <span className={styles.groupLabel}>{t("action.files")}</span>
                  {action.attachments.length === 0 && !fillable && (
                    <span className={styles.none}>{t("action.noFiles")}</span>
                  )}
                  {action.attachments.map((file) => (
                    <div key={file.id} className={styles.fileRow}>
                      <FileGlyph />
                      <a
                        className={styles.fileName}
                        href={assetUrl(file.url) ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {file.filename}
                      </a>
                      {fillable && (
                        <button
                          type="button"
                          className={styles.rowRemove}
                          aria-label={t("action.removeFile", { name: file.filename })}
                          title={t("action.removeFile", { name: file.filename })}
                          disabled={busy}
                          onClick={() => controls.removeAttachment(file.id)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  {fillable && (
                    <button
                      type="button"
                      className={[styles.dropzone, dragging ? styles.dropzoneOver : null]
                        .filter(Boolean)
                        .join(" ")}
                      disabled={busy || controls.uploadingTo !== null}
                      onClick={() => controls.pickFile(action.id)}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragging(true);
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={onDrop}
                    >
                      {uploading ? (
                        t("action.uploading")
                      ) : (
                        <>
                          <strong>{t("action.attach")}</strong>{" "}
                          <span className={styles.dropzoneHint}>· {t("action.attachHint")}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}

              <div className={styles.group}>
                <span className={styles.groupLabel}>{t("action.commentsTitle")}</span>
                {action.comments.map((comment) => (
                  <div key={comment.id} className={styles.note}>
                    <span className={styles.noteBy}>
                      <bdi>{comment.authorName ?? t("action.oldApp")}</bdi> ·{" "}
                      <bdi>{formatMoment(comment.createdAt)}</bdi>
                    </span>
                    <span className={styles.noteBody}>{comment.body}</span>
                  </div>
                ))}
                <form
                  className={styles.noteForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const body = draft.trim();
                    if (body !== "") controls.comment(action.id, body, () => setDraft(""));
                  }}
                >
                  <input
                    className={styles.input}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={t("action.commentPlaceholder")}
                    aria-label={t("action.commentPlaceholder")}
                    maxLength={MANUFACTURING_COMMENT_MAX}
                    disabled={busy}
                  />
                  <Button type="submit" variant="dark" disabled={busy || draft.trim() === ""}>
                    {t("action.publish")}
                  </Button>
                </form>
              </div>

              {waiting && (
                <div className={styles.structure}>
                  <span className={styles.structureLabel}>{t("action.structure")}</span>
                  <Button
                    size="dense"
                    // Never above a started action: the sequence depends on it.
                    disabled={busy || index - 1 < firstOpenPosition(actions)}
                    onClick={() => controls.move(action.id, index - 1)}
                  >
                    <span aria-hidden>↑</span> {t("action.moveUp")}
                  </Button>
                  <Button
                    size="dense"
                    disabled={busy || index === actions.length - 1}
                    onClick={() => controls.move(action.id, index + 1)}
                  >
                    <span aria-hidden>↓</span> {t("action.moveDown")}
                  </Button>
                  <Button size="dense" disabled={busy} onClick={onEdit}>
                    {t("action.edit")}
                  </Button>
                  <span className={styles.spacer} />
                  <button
                    type="button"
                    className={[styles.quietBtn, styles.quietDanger].filter(Boolean).join(" ")}
                    disabled={busy}
                    onClick={onRemove}
                  >
                    {t("action.remove")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {canInsert && (
          <button type="button" className={styles.insert} disabled={busy} onClick={onInsertAfter}>
            {t("detail.insertHere")}
          </button>
        )}
      </div>
    </li>
  );
}
