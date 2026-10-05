"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MANUFACTURING_LABEL_MAX, type ManufacturingActionDefinition } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { FormDialog } from "@repo/ui/form-dialog";
import records from "../../records/records.module.css";
import { HANDLE_KEYS, HandleGlyph } from "../manufacturing-ui";
import styles from "../manufacturing.module.css";

/** Where a new action can go. `position` is its 0-based place in the pipeline. */
export interface PositionChoice {
  key: "here" | "end" | "afterCurrent";
  position: number;
}

interface ActionDialogProps {
  /** The OF's number, above the title. */
  eyebrow: string;
  /** The action being edited; absent for a new one. */
  initial?: ManufacturingActionDefinition;
  /** A new action's possible places, the default first. Absent when editing. */
  positions?: readonly PositionChoice[];
  /** The pipeline's action names in order, for "right after …". */
  labels: readonly string[];
  /** Names to offer as one-tap starts: the templates' own, not yet in this OF. */
  suggestions?: readonly string[];
  busy: boolean;
  error: string | null;
  onSave: (definition: ManufacturingActionDefinition, position?: number) => void;
  onClose: () => void;
}

/** A new action offers its people by default: nearly every step names who does it. */
const FRESH: ManufacturingActionDefinition = {
  label: "",
  handlesEmployees: true,
  handlesMachine: false,
  handlesAttachments: false,
};

/**
 * An action's definition — its name and the three fields it may offer —
 * and, for a new one, its place in the pipeline. Mounted per use, so its
 * state starts from `initial` every time.
 */
export function ActionDialog({
  eyebrow,
  initial,
  positions = [],
  labels,
  suggestions = [],
  busy,
  error,
  onSave,
  onClose,
}: ActionDialogProps) {
  const t = useTranslations("manufacturing");
  const common = useTranslations("common");
  const [draft, setDraft] = useState<ManufacturingActionDefinition>(initial ?? FRESH);
  const [choice, setChoice] = useState<PositionChoice["key"] | undefined>(positions[0]?.key);

  const label = draft.label.trim();
  const chosen = positions.find((option) => option.key === choice) ?? positions[0];
  const before = chosen ? labels[chosen.position - 1] : undefined;
  const save = () => {
    if (label !== "") onSave({ ...draft, label }, chosen?.position);
  };

  return (
    <FormDialog
      eyebrow={eyebrow}
      title={initial ? t("dialogs.editTitle") : t("dialogs.addTitle")}
      onClose={onClose}
    >
      <form
        className={styles.sheet}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        {error && (
          <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
            {error}
          </p>
        )}

        <label className={styles.labelled}>
          <span className={styles.labelText}>{t("dialogs.label")}</span>
          <input
            className={[styles.input, styles.inputAccent].filter(Boolean).join(" ")}
            value={draft.label}
            onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
            placeholder={t("dialogs.labelPlaceholder")}
            maxLength={MANUFACTURING_LABEL_MAX}
            disabled={busy}
            autoFocus
          />
        </label>
        {suggestions.length > 0 && (
          <div className={styles.suggestions}>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className={styles.suggestion}
                disabled={busy}
                onClick={() => setDraft((current) => ({ ...current, label: suggestion }))}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <fieldset className={styles.group}>
          <legend className={styles.labelText}>{t("dialogs.handlesLegend")}</legend>
          <div className={styles.capCards}>
            {HANDLE_KEYS.map(([key, name]) => {
              const on = draft[key];
              return (
                <button
                  key={key}
                  type="button"
                  className={[styles.capCard, on ? styles.capCardOn : null].filter(Boolean).join(" ")}
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => setDraft((current) => ({ ...current, [key]: !current[key] }))}
                >
                  <span className={styles.capCardTop}>
                    <span className={styles.capCardIcon}>
                      <HandleGlyph name={name} />
                    </span>
                    <span className={styles.capCardBox} aria-hidden>
                      {on ? "✓" : ""}
                    </span>
                  </span>
                  <span className={styles.capCardLabel}>{t(`handles.${name}`)}</span>
                  <span className={styles.capCardMeta}>{t(`handlesMeta.${name}`)}</span>
                </button>
              );
            })}
          </div>
          <p className={styles.fine}>{t("dialogs.handlesHint")}</p>
        </fieldset>

        {chosen && (
          <fieldset className={styles.group}>
            <legend className={styles.labelText}>{t("dialogs.position")}</legend>
            <div className={styles.positions}>
              {positions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={[styles.position, option.key === chosen.key ? styles.positionOn : null]
                    .filter(Boolean)
                    .join(" ")}
                  aria-pressed={option.key === chosen.key}
                  disabled={busy}
                  onClick={() => setChoice(option.key)}
                >
                  {option.key === "here"
                    ? t("dialogs.posHere", { n: option.position + 1 })
                    : option.key === "end"
                      ? t("dialogs.posEnd")
                      : t("dialogs.posAfterCurrent")}
                </button>
              ))}
            </div>
            <p className={styles.fine}>
              {before === undefined
                ? t("dialogs.posNote", { n: chosen.position + 1, total: labels.length + 1 })
                : t("dialogs.posNoteAfter", {
                    n: chosen.position + 1,
                    total: labels.length + 1,
                    name: before,
                  })}
            </p>
          </fieldset>
        )}

        <div className={records.formActions}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {common("cancel")}
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={label === ""}>
            {initial ? t("dialogs.save") : t("dialogs.add")}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
