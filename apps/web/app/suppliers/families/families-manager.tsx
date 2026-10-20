"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { supplierFamilyCode } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { TextField } from "@repo/ui/field";
import { useToast } from "@repo/ui/toast";
import { numberFormat } from "../../../i18n/formats";
import { SegmentedFilter } from "../../records/segmented-filter";
import { useTRPC } from "../../trpc/client";
import records from "../../records/records.module.css";
import styles from "./families.module.css";

/**
 * One colour per family, from its place in the server's order (sortOrder,
 * then label), so a family keeps its colour while the list re-sorts by count,
 * is searched, or switches tab. Decorative only: the label always names it.
 * The handoff's ten swatches, snapped to toolkit tokens.
 */
const FAMILY_COLOURS = [
  "var(--bp-orange-500)",
  "var(--bp-orange-700)",
  "var(--bp-orange-300)",
  "var(--bp-neutral-400)",
  "var(--bp-neutral-600)",
  "var(--bp-neutral-800)",
  "var(--bp-neutral-300)",
  "var(--bp-warning)",
  "var(--bp-info)",
  "var(--bp-success)",
] as const;

/** Case- and accent-blind, for the search box and the look-alike warning. */
const fold = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const formatCount = (n: number) => numberFormat().format(n);

/**
 * Every family, archived ones included (they still need restoring). The
 * header figures and the manager both call this; React Query fetches once.
 */
function useFamilies() {
  const trpc = useTRPC();
  return useQuery(trpc.supplierFamily.list.queryOptions({ includeInactive: true }));
}

/**
 * The header's three figures. "Classified" sums the active families' rows;
 * "No family" is the supplier list's `unassigned` chip, which it opens.
 */
export function FamilyFigures() {
  const trpc = useTRPC();
  const t = useTranslations("suppliers.families");
  const familiesQuery = useFamilies();
  const statsQuery = useQuery(trpc.supplier.stats.queryOptions());

  const active = familiesQuery.data?.filter((family) => family.active);
  const classified = active?.reduce((sum, family) => sum + family.supplierCount, 0);
  const show = (n: number | undefined) => (n === undefined ? "—" : formatCount(n));

  return (
    <div className={styles.figures}>
      <div className={styles.figure}>
        <span className={styles.figureLabel}>{t("figures.families")}</span>
        <span className={styles.figureValue}>{show(active?.length)}</span>
      </div>
      <div className={styles.figure}>
        <span className={styles.figureLabel}>{t("figures.classified")}</span>
        <span className={styles.figureValue}>{show(classified)}</span>
      </div>
      <Link
        href="/suppliers?filter=unassigned"
        className={[styles.figure, styles.figureLink].filter(Boolean).join(" ")}
      >
        <span className={styles.figureLabel}>{t("figures.unassigned")}</span>
        <span className={styles.figureValue}>
          {show(statsQuery.data?.unassigned)}
          <span className={styles.arrow} aria-hidden>
            →
          </span>
        </span>
      </Link>
    </div>
  );
}

type Tab = "active" | "archived";

/**
 * Supplier families: find, rename in place, archive (keeping or moving the
 * suppliers), restore, delete an unused one, and create from a label whose
 * code is generated.
 *
 * Deliberately not a `DataTable`: a short lookup list, read whole, with every
 * row editable in place. Search and sort are client-side for that reason.
 */
export function FamiliesManager() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const t = useTranslations("suppliers.families");
  const common = useTranslations("common");
  const familiesQuery = useFamilies();
  type Family = NonNullable<typeof familiesQuery.data>[number];

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("active");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [newLabel, setNewLabel] = useState("");
  /** Tagged "new" until the page is left, so the admin sees where it landed. */
  const [createdId, setCreatedId] = useState<string | null>(null);
  /** `moveToId` "" keeps the suppliers in the archived family. */
  const [archiving, setArchiving] = useState<{ family: Family; moveToId: string } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<Family | null>(null);

  /**
   * Every write refreshes the supplier list and its figures too: a rename,
   * an archive or a move changes the chips, labels and counts that page shows.
   */
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.supplierFamily.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.supplier.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.supplier.stats.queryKey() }),
    ]);
  const onError = (cause: { message: string }) =>
    push({ tone: "error", title: t("genericError"), text: cause.message });

  const create = useMutation(
    trpc.supplierFamily.create.mutationOptions({ onSuccess: invalidate, onError }),
  );
  const update = useMutation(
    trpc.supplierFamily.update.mutationOptions({ onSuccess: invalidate, onError }),
  );
  const setActive = useMutation(
    trpc.supplierFamily.setActive.mutationOptions({ onSuccess: invalidate, onError }),
  );
  const remove = useMutation(
    trpc.supplierFamily.remove.mutationOptions({ onSuccess: invalidate, onError }),
  );
  const busy = create.isPending || update.isPending || setActive.isPending || remove.isPending;

  if (familiesQuery.isPending) {
    return <p className={records.muted}>{t("loading")}</p>;
  }

  if (familiesQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {familiesQuery.error.message}
      </p>
    );
  }

  const families = familiesQuery.data;
  const colourOf = new Map(
    families.map((family, i) => [family.id, FAMILY_COLOURS[i % FAMILY_COLOURS.length]]),
  );
  const byCount = (a: Family, b: Family) =>
    b.supplierCount - a.supplierCount || a.label.localeCompare(b.label);
  const active = families.filter((family) => family.active);
  // Bars measure against the busiest active family; an archived row is capped.
  const busiest = Math.max(1, ...active.map((family) => family.supplierCount));
  const needle = fold(query.trim());
  const rows = families
    .filter((family) => family.active === (tab === "active"))
    .filter((family) => fold(family.label).includes(needle))
    .sort(byCount);

  // --- create: the code is previewed exactly as the server will derive it ---
  const name = newLabel.trim();
  const code = name ? supplierFamilyCode(name, families.map((family) => family.code)) : "";
  const sameLabel = name
    ? families.find((family) => family.label.toLocaleLowerCase() === name.toLocaleLowerCase())
    : undefined;
  const sameCode =
    !sameLabel && code ? families.find((family) => family.code === code) : undefined;
  // A hint, not a block: four letters in common is a reason to look twice.
  const lookAlike =
    !sameLabel && !sameCode && name.length >= 3
      ? families.find((family) => {
          const existing = fold(family.label);
          const typed = fold(name);
          return existing.startsWith(typed.slice(0, 4)) || typed.startsWith(existing.slice(0, 4));
        })
      : undefined;
  const blocked = !name || sameLabel !== undefined || sameCode !== undefined;
  const warning = sameLabel
    ? {
        danger: true,
        text: sameLabel.active
          ? t("create.dupLabel", { name: sameLabel.label })
          : t("create.dupArchived", { name: sameLabel.label }),
      }
    : sameCode
      ? { danger: true, text: t("create.dupCode", { code, name: sameCode.label }) }
      : lookAlike
        ? { danger: false, text: t("create.similar", { name: lookAlike.label }) }
        : null;

  function submitCreate() {
    if (blocked || busy) return;
    create.mutate(
      { label: name },
      {
        onSuccess: (created) => {
          setNewLabel("");
          setCreatedId(created.id);
          setTab("active");
          setQuery("");
          push({ tone: "success", title: t("toast.created", { name: created.label }) });
        },
      },
    );
  }

  function startRename(family: Family) {
    setMenuId(null);
    setEditingId(family.id);
    setEditLabel(family.label);
  }

  function saveRename(family: Family) {
    const label = editLabel.trim();
    if (!label || label === family.label) {
      setEditingId(null);
      return;
    }
    update.mutate(
      { id: family.id, label },
      {
        onSuccess: () => {
          setEditingId(null);
          push({ tone: "success", title: t("toast.renamed", { name: label }) });
        },
      },
    );
  }

  /** An empty family is archived at once; one in use asks where its suppliers go. */
  function archive(family: Family) {
    setMenuId(null);
    if (family.supplierCount > 0) {
      setArchiving({ family, moveToId: "" });
      return;
    }
    setActive.mutate(
      { id: family.id, active: false },
      {
        onSuccess: () =>
          push({ tone: "success", title: t("toast.archived", { name: family.label }) }),
      },
    );
  }

  function confirmArchive() {
    if (!archiving) return;
    const { family, moveToId } = archiving;
    const target = active.find((candidate) => candidate.id === moveToId);
    setActive.mutate(
      { id: family.id, active: false, moveToId: target?.id },
      {
        onSuccess: (result) => {
          setArchiving(null);
          push({
            tone: "success",
            title: target
              ? t("toast.archivedMoved", {
                  name: family.label,
                  count: result.moved,
                  target: target.label,
                })
              : t("toast.archivedKept", { name: family.label, count: family.supplierCount }),
          });
        },
      },
    );
  }

  function restore(family: Family) {
    setMenuId(null);
    setActive.mutate(
      { id: family.id, active: true },
      {
        onSuccess: () =>
          push({ tone: "success", title: t("toast.restored", { name: family.label }) }),
      },
    );
  }

  function confirmDelete() {
    if (!deleting) return;
    const family = deleting;
    remove.mutate(
      { id: family.id },
      {
        onSuccess: () => {
          setDeleting(null);
          push({ tone: "success", title: t("toast.deleted", { name: family.label }) });
        },
      },
    );
  }

  const moveTargets = archiving
    ? active.filter((family) => family.id !== archiving.family.id).sort(byCount)
    : [];

  return (
    <div className={styles.manager}>
      <div className={styles.layout}>
        <section className={styles.panel} aria-label={t("title")}>
          <div className={styles.toolbar}>
            <input
              type="search"
              className={styles.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              autoComplete="off"
            />
            <SegmentedFilter<Tab>
              label={t("tabs.label")}
              value={tab}
              onChange={(next) => {
                setTab(next);
                setMenuId(null);
                setEditingId(null);
              }}
              segments={[
                { key: "active", label: t("tabs.active"), count: active.length },
                {
                  key: "archived",
                  label: t("tabs.archived"),
                  count: families.length - active.length,
                },
              ]}
            />
          </div>

          <div className={styles.head} aria-hidden>
            <span>{t("columns.family")}</span>
            <span>{t("columns.code")}</span>
            <span>{t("columns.suppliers")}</span>
            <span />
          </div>

          <ul className={styles.rows}>
            {rows.map((family) => {
              const editing = editingId === family.id;
              const share = Math.min(100, Math.round((family.supplierCount / busiest) * 100));
              return (
                <li
                  key={family.id}
                  className={[styles.row, editing ? styles.rowEditing : null]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ "--family": colourOf.get(family.id) } as CSSProperties}
                >
                  <div className={styles.name}>
                    <span className={styles.swatch} aria-hidden />
                    {editing ? (
                      <form
                        className={styles.rename}
                        onSubmit={(e) => {
                          e.preventDefault();
                          saveRename(family);
                        }}
                      >
                        <input
                          className={styles.renameInput}
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          aria-label={t("renameLabel", { name: family.label })}
                          maxLength={60}
                          autoComplete="off"
                          autoFocus
                          disabled={update.isPending}
                        />
                        <Button type="submit" variant="dark" size="dense" busy={update.isPending}>
                          {t("ok")}
                        </Button>
                      </form>
                    ) : family.active ? (
                      <button
                        type="button"
                        className={styles.label}
                        title={t("rename")}
                        onClick={() => startRename(family)}
                      >
                        {family.label}
                      </button>
                    ) : (
                      <span
                        className={[styles.label, styles.labelArchived].filter(Boolean).join(" ")}
                      >
                        {family.label}
                      </span>
                    )}
                    {!editing && family.id === createdId && (
                      <span className={styles.newTag}>{t("newTag")}</span>
                    )}
                  </div>

                  <span className={styles.code} title={t("codeLocked")}>
                    <LockIcon />
                    <span className={styles.codeText}>{family.code}</span>
                  </span>

                  <div className={styles.count}>
                    <span className={styles.countValue}>{formatCount(family.supplierCount)}</span>
                    <span className={styles.bar} aria-hidden>
                      <span className={styles.barFill} style={{ inlineSize: `${share}%` }} />
                    </span>
                  </div>

                  <RowMenu
                    label={t("actions", { name: family.label })}
                    open={menuId === family.id}
                    onToggle={() => setMenuId(menuId === family.id ? null : family.id)}
                    onClose={() => setMenuId(null)}
                  >
                    {family.active ? (
                      <button
                        type="button"
                        className={styles.menuItem}
                        onClick={() => startRename(family)}
                      >
                        {t("rename")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.menuItem}
                        disabled={busy}
                        onClick={() => restore(family)}
                      >
                        {common("restore")}
                      </button>
                    )}
                    {family.supplierCount > 0 && (
                      <Link
                        className={styles.menuItem}
                        href={`/suppliers?filter=${encodeURIComponent(family.code)}`}
                      >
                        {t("viewSuppliers", { count: family.supplierCount })}
                      </Link>
                    )}
                    {(family.active || family.supplierCount === 0) && (
                      <hr className={styles.menuRule} />
                    )}
                    {family.active && (
                      <button
                        type="button"
                        className={[styles.menuItem, styles.menuDanger].filter(Boolean).join(" ")}
                        disabled={busy}
                        onClick={() => archive(family)}
                      >
                        {t("archive")}
                      </button>
                    )}
                    {/* Only while nothing uses it: the server refuses otherwise. */}
                    {family.supplierCount === 0 && (
                      <button
                        type="button"
                        className={[styles.menuItem, styles.menuDanger].filter(Boolean).join(" ")}
                        disabled={busy}
                        onClick={() => {
                          setMenuId(null);
                          setDeleting(family);
                        }}
                      >
                        {t("delete")}
                      </button>
                    )}
                  </RowMenu>
                </li>
              );
            })}
          </ul>

          {rows.length === 0 && (
            <p className={styles.empty}>
              {needle
                ? t("empty.search", { query: query.trim() })
                : tab === "archived"
                  ? t("empty.archived")
                  : t("empty.active")}
            </p>
          )}
          <p className={styles.footnote}>{t("footnote")}</p>
        </section>

        <aside className={styles.aside}>
          <form
            className={styles.createCard}
            onSubmit={(e) => {
              e.preventDefault();
              submitCreate();
            }}
          >
            <div className={styles.createIntro}>
              <span className={styles.createEyebrow}>{t("create.eyebrow")}</span>
              <p className={styles.createLead}>{t("create.lead")}</p>
            </div>
            <TextField
              label={t("create.label")}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t("create.placeholder")}
              maxLength={60}
              autoComplete="off"
              disabled={create.isPending}
            />
            <div className={styles.codeField}>
              <span className={styles.codeLabel}>
                {t("create.code")}
                <span className={styles.codeHint}>{t("create.codeHint")}</span>
              </span>
              <div
                className={[styles.codePreview, code ? null : styles.codeEmpty]
                  .filter(Boolean)
                  .join(" ")}
              >
                {code || "—"}
              </div>
            </div>
            {warning && (
              <p
                className={[styles.warning, warning.danger ? styles.warningDanger : null]
                  .filter(Boolean)
                  .join(" ")}
                role="status"
              >
                {warning.text}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              className={styles.submit}
              disabled={blocked}
              busy={create.isPending}
            >
              {t("create.submit")}
            </Button>
          </form>
          <p className={styles.asideNote}>{t("archiveNote")}</p>
        </aside>
      </div>

      <Dialog
        open={archiving !== null}
        title={archiving ? t("archiveDialog.title", { name: archiving.family.label }) : ""}
        confirmLabel={common("archive")}
        destructive
        busy={setActive.isPending}
        onConfirm={confirmArchive}
        onClose={() => !setActive.isPending && setArchiving(null)}
      >
        {archiving && (
          <>
            <p className={styles.dialogText}>
              {t("archiveDialog.body", { count: archiving.family.supplierCount })}
            </p>
            <div
              className={styles.options}
              role="radiogroup"
              aria-label={t("archiveDialog.optionsLabel")}
            >
              {[
                { id: "", label: t("archiveDialog.keep", { name: archiving.family.label }) },
                ...moveTargets.map((family) => ({
                  id: family.id,
                  label: t("archiveDialog.moveTo", { name: family.label }),
                })),
              ].map((option) => {
                const checked = archiving.moveToId === option.id;
                return (
                  <label
                    key={option.id || "keep"}
                    className={[styles.option, checked ? styles.optionOn : null]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <input
                      type="radio"
                      name="family-archive-target"
                      className={styles.radio}
                      checked={checked}
                      onChange={() => setArchiving({ ...archiving, moveToId: option.id })}
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </>
        )}
      </Dialog>

      <Dialog
        open={deleting !== null}
        title={t("deleteDialog.title")}
        confirmLabel={common("delete")}
        destructive
        busy={remove.isPending}
        onConfirm={confirmDelete}
        onClose={() => !remove.isPending && setDeleting(null)}
      >
        {deleting &&
          t.rich("deleteDialog.body", {
            name: deleting.label,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
      </Dialog>
    </div>
  );
}

/**
 * The ⋯ button and its popover. Closes on a click outside or Escape; the
 * parent owns which row's menu is open, so opening one closes the other.
 */
function RowMenu({
  label,
  open,
  onToggle,
  onClose,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className={styles.menuWrap}>
      <button
        type="button"
        className={styles.menuButton}
        aria-label={label}
        aria-expanded={open}
        onClick={onToggle}
      >
        ⋯
      </button>
      {open && <div className={styles.menu}>{children}</div>}
    </div>
  );
}

/** The code column's padlock: the code never changes once created. */
function LockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.25" y="7.25" width="9.5" height="6.5" rx="1.25" />
      <path d="M5.5 7.25V5a2.5 2.5 0 0 1 5 0v2.25" />
    </svg>
  );
}
