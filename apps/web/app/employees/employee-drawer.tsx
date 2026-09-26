"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import {
  canAccess,
  canAccessAny,
  createEmployeeInput,
  EMPLOYEE_PHOTO_CONTENT_TYPES,
  UPLOAD_MAX_BYTES,
  updateEmployeeInput,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/field";
import { useFileUpload } from "@repo/ui/file-upload";
import { useToast } from "@repo/ui/toast";
import { useCurrentUser } from "../auth/use-auth";
import { initials } from "../nav/initials";
import { useTRPC } from "../trpc/client";
import records from "../records/records.module.css";
import { Avatar } from "./avatar";
import { employeeName } from "./employee-name";
import { invalidateEmployeeQueries } from "./employee-ui";
import styles from "./employees.module.css";

export type EmployeeRecord = inferRouterOutputs<AppRouter>["employee"]["byId"];

/**
 * The form's six steps, from `Employees v3.dc.html`. Every step is reachable
 * at any time from the step bar, and Save works from any of them: the steps
 * group the fields, they are not a wizard's gate.
 */
export const STEP_KEYS = ["identity", "role", "contact", "roster", "confidential", "account"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

/** Which step holds each field, so a failed check opens the step that can fix it. */
const FIELD_STEP: Record<string, StepKey> = {
  matricule: "identity",
  firstName: "identity",
  lastName: "identity",
  gender: "identity",
  photo: "identity",
  jobTitle: "role",
  department: "role",
  employmentType: "role",
  categorie: "role",
  echelon: "role",
  hireDate: "role",
  contractEndDate: "role",
  email: "contact",
  phone: "contact",
  phone2: "contact",
  suspended: "roster",
  suspendedAt: "roster",
  suspensionReason: "roster",
  salary: "confidential",
  cin: "confidential",
  socialSecurityNumber: "confidential",
  birthDate: "confidential",
  address: "confidential",
};

/**
 * The contract kinds offered. Free text in the column (see the Employee
 * model), so a legacy value outside this list still shows, as its own card.
 * CIVP rather than the handoff's SIVP: it is what the migrated rows say.
 */
const CONTRACTS = ["CDI", "CDD", "CIVP", "Intérim"] as const;
const CONTRACT_META: Record<(typeof CONTRACTS)[number], string> = {
  CDI: "cdi",
  CDD: "cdd",
  CIVP: "civp",
  Intérim: "interim",
};

/** The stored values are the legacy's French words; the labels are translated. */
const GENDERS = [
  { value: "Homme", key: "male" },
  { value: "Femme", key: "female" },
] as const;

/**
 * The longest edge a photo is stored at. The largest avatar is 104px, so
 * 640px covers a 3× screen with room to spare, and a phone's 4000px shot
 * shrinks from megabytes to under a hundred kilobytes — which every list
 * row that draws it is grateful for.
 */
const PHOTO_MAX_EDGE = 640;

/**
 * Re-encodes an image at `PHOTO_MAX_EDGE` as JPEG before it is uploaded.
 * Anything the browser cannot decode (HEIC in Chrome) is passed through
 * untouched, and the type check that follows turns it away with a message.
 */
async function shrinkPhoto(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

const str = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

/** The `<input type="date">` value — the one place an ISO slice is right. */
function toDateInput(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) return "";
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * The employee form as a sheet from the inline end, over the list (new) or
 * the record page (edit). A native `<dialog>`, so the browser supplies the
 * focus trap, Escape and the inert page behind it.
 *
 * Not a `<form>`: with Save reachable from every step, Enter in the first
 * name would create a half-filled record. Save is a button, nothing else.
 */
export function EmployeeDrawer({
  employee,
  departments,
  startStep = "identity",
  onClose,
  onSaved,
}: {
  /** The record being edited; absent for a new one. */
  employee?: EmployeeRecord;
  /** The services already in use, most staffed first (`employee.summary`). */
  departments: readonly string[];
  startStep?: StepKey;
  onClose: () => void;
  /** After a successful save, with the record's id. */
  onSaved: (id: string) => void;
}) {
  const t = useTranslations("employees.form");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user: me } = useCurrentUser();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Every procedure here is ADMIN-gated, so this is true for anyone who can
  // open the form. It still decides whether the confidential and account
  // steps render: a lower rank is never sent those values, and must not
  // echo blanks back over them (see EmployeeService.writableUpdate).
  const canSeeSensitive = me ? canAccess(me.role, "ADMIN") : false;
  const steps: readonly StepKey[] = canSeeSensitive
    ? STEP_KEYS
    : STEP_KEYS.filter((key) => key !== "confidential" && key !== "account");

  const [step, setStep] = useState<StepKey>(startStep);
  const index = Math.max(0, steps.indexOf(step));

  const [matricule, setMatricule] = useState(employee?.matricule ?? "");
  const [firstName, setFirstName] = useState(employee?.firstName ?? "");
  const [lastName, setLastName] = useState(employee?.lastName ?? "");
  const [gender, setGender] = useState(employee?.gender ?? "");
  const [photo, setPhoto] = useState(employee?.photo ?? "");
  const [jobTitle, setJobTitle] = useState(employee?.jobTitle ?? "");
  const [department, setDepartment] = useState(employee?.department ?? "");
  // A service outside the known list is being typed rather than picked.
  const [typingDepartment, setTypingDepartment] = useState(false);
  const [employmentType, setEmploymentType] = useState(employee?.employmentType ?? "");
  const [categorie, setCategorie] = useState(employee?.categorie ?? "");
  const [echelon, setEchelon] = useState(employee?.echelon ?? "");
  const [hireDate, setHireDate] = useState(toDateInput(employee?.hireDate));
  const [contractEndDate, setContractEndDate] = useState(toDateInput(employee?.contractEndDate));
  const [phone, setPhone] = useState(employee?.phone ?? "");
  const [phone2, setPhone2] = useState(employee?.phone2 ?? "");
  const [email, setEmail] = useState(employee?.email ?? "");
  const [suspended, setSuspended] = useState(employee?.suspended ?? false);
  const [suspendedAt, setSuspendedAt] = useState(toDateInput(employee?.suspendedAt));
  const [suspensionReason, setSuspensionReason] = useState(employee?.suspensionReason ?? "");
  // The confidential columns come back for ADMIN and above only, so the
  // record is one of two shapes; these start blank when it is the narrow one.
  const sensitive = employee && "cin" in employee ? employee : undefined;
  const [salary, setSalary] = useState(str(sensitive?.salary));
  const [cin, setCin] = useState(sensitive?.cin ?? "");
  const [ssn, setSsn] = useState(sensitive?.socialSecurityNumber ?? "");
  const [birthDate, setBirthDate] = useState(toDateInput(sensitive?.birthDate));
  const [address, setAddress] = useState(sensitive?.address ?? "");
  const [userId, setUserId] = useState(employee?.userId ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  /**
   * The account step's options: accounts the shop-floor pages admit (ADMIN
   * and above, PRODUCTION) that belong to nobody yet, plus this person's
   * own. `user.list` is already scoped to accounts the caller outranks, so
   * the list and `linkUser` agree on who may be linked.
   */
  const usersQuery = useQuery({
    ...trpc.user.list.queryOptions({
      pageSize: 100,
      sortBy: "name",
      sortDir: "asc",
      filter: "active",
    }),
    enabled: canSeeSensitive,
  });
  const linkable = (usersQuery.data?.rows ?? []).filter(
    (user) =>
      canAccessAny(user.role, ["ADMIN", "PRODUCTION"]) &&
      (user.employee === null || user.employee.id === employee?.id),
  );

  const photoUpload = useMutation(trpc.employee.createPhotoUpload.mutationOptions());
  const upload = useFileUpload({
    onChange: (url) => setPhoto(url ?? ""),
    onRequestUpload: (file) =>
      photoUpload.mutateAsync({
        filename: file.name,
        // `useFileUpload` has already refused anything outside the list.
        contentType: file.type as (typeof EMPLOYEE_PHOTO_CONTENT_TYPES)[number],
        size: file.size,
      }),
    contentTypes: EMPLOYEE_PHOTO_CONTENT_TYPES,
    maxBytes: UPLOAD_MAX_BYTES,
    strings: {
      failed: t("photo.failed"),
      tooLarge: t("photo.tooLarge"),
      wrongType: t("photo.wrongType"),
    },
  });
  const pickPhoto = async (file: File | undefined) => {
    if (file) await upload.upload(await shrinkPhoto(file));
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    void pickPhoto(event.dataTransfer.files[0]);
  };

  const linkUser = useMutation(trpc.employee.linkUser.mutationOptions());

  /**
   * The link is its own procedure (it checks the account's role and the
   * caller's rank over it), so it follows the save. A failed link leaves
   * the saved record in place and the form open with the message.
   */
  const finish = async (id: string) => {
    const wanted = userId || null;
    if (canSeeSensitive && wanted !== (employee?.userId ?? null)) {
      try {
        await linkUser.mutateAsync({ id, userId: wanted });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : common("checkForm"));
        setStep("account");
        await invalidateEmployeeQueries(queryClient, trpc);
        return;
      }
    }
    await invalidateEmployeeQueries(queryClient, trpc);
    toast.push({ title: employee ? t("saved") : t("created"), tone: "success" });
    onSaved(id);
  };

  const create = useMutation(
    trpc.employee.create.mutationOptions({
      onSuccess: (row) => finish(row.id),
      onError: (cause) => setError(cause.message),
    }),
  );
  const update = useMutation(
    trpc.employee.update.mutationOptions({
      onSuccess: (row) => finish(row.id),
      onError: (cause) => setError(cause.message),
    }),
  );
  const busy = create.isPending || update.isPending || linkUser.isPending;

  /** Shows the first problem and opens the step that holds its field. */
  const fail = (message: string, field?: PropertyKey) => {
    setError(message);
    const target = typeof field === "string" ? FIELD_STEP[field] : undefined;
    if (target && steps.includes(target)) setStep(target);
  };

  function save() {
    setError(null);

    // A French figure ("719,500") and a pasted one with spaces both mean a number.
    const trimmedSalary = salary.replace(/\s/g, "").replace(",", ".");
    if (trimmedSalary !== "" && Number.isNaN(Number(trimmedSalary))) {
      fail(t("salaryMustBeNumber"), "salary");
      return;
    }

    // `null`, not `""`, for a field this form rendered and the user emptied.
    // The update path treats an absent key as "leave alone" so a non-admin's
    // save cannot blank the fields they were never shown — which makes `null`
    // the only way to say "clear this". See EmployeeService.writableUpdate.
    const cleared = (value: string) => (value.trim() === "" ? null : value);

    const raw = {
      matricule,
      firstName,
      lastName,
      department: cleared(department),
      jobTitle: cleared(jobTitle),
      employmentType: cleared(employmentType),
      categorie: cleared(categorie),
      echelon: cleared(echelon),
      gender: cleared(gender),
      email: cleared(email),
      phone: cleared(phone),
      phone2: cleared(phone2),
      hireDate: cleared(hireDate),
      contractEndDate: cleared(contractEndDate),
      suspended,
      // Sent as they stand even when the step hides them (back on the
      // roster): the old form kept them too, and a save should not wipe a
      // legacy date nobody asked to clear.
      suspendedAt: cleared(suspendedAt),
      suspensionReason: cleared(suspensionReason),
      photo: cleared(photo),
      // Only submitted when this caller was shown them; a non-admin's form has
      // no values here, and sending them would clear data they never saw.
      ...(canSeeSensitive
        ? {
            salary: trimmedSalary === "" ? null : Number(trimmedSalary),
            cin: cleared(cin),
            socialSecurityNumber: cleared(ssn),
            birthDate: cleared(birthDate),
            address: cleared(address),
          }
        : {}),
    };

    if (employee) {
      const parsed = updateEmployeeInput.safeParse({ ...raw, id: employee.id });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        fail(issue?.message ?? common("checkForm"), issue?.path[0]);
        return;
      }
      update.mutate(parsed.data);
      return;
    }
    const parsed = createEmployeeInput.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      fail(issue?.message ?? common("checkForm"), issue?.path[0]);
      return;
    }
    create.mutate(parsed.data);
  }

  const close = () => {
    if (!busy) dialogRef.current?.close();
  };

  // What the avatar previews: the photo as it stands, or the initials the
  // name typed so far gives — "+" on a blank new record, as the handoff draws.
  const preview = {
    id: employee?.id ?? "new",
    firstName,
    lastName,
    matricule: matricule || "+",
    photo: photo || null,
  };
  const knownDepartment = department === "" || departments.includes(department);
  const serviceChips = knownDepartment ? departments : [...departments, department];
  const contractCards: readonly string[] =
    employmentType === "" || (CONTRACTS as readonly string[]).includes(employmentType)
      ? CONTRACTS
      : [...CONTRACTS, employmentType];
  // A CDI has no end; the date shows for every other kind, and for a CDI
  // that already carries one (the legacy rows do), so it can be cleared.
  const showsEnd = employmentType !== "CDI" || contractEndDate !== "";

  const title = employee ? t("editTitle", { name: employeeName(employee) }) : t("newTitle");

  return (
    <dialog
      ref={dialogRef}
      className={styles.drawer}
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      aria-labelledby="employee-drawer-title"
    >
      <div className={styles.drawerHead}>
        <div className={styles.drawerHeading}>
          <span className={records.eyebrow}>{t("eyebrow")}</span>
          <h2 id="employee-drawer-title" className={styles.drawerTitle}>
            {title}
          </h2>
        </div>
        <button type="button" className={styles.drawerClose} onClick={close} aria-label={t("close")}>
          ×
        </button>
      </div>

      <nav className={styles.steps} aria-label={t("stepsLabel")}>
        {steps.map((key, i) => {
          const current = key === step;
          const done = i < index;
          return (
            <button
              key={key}
              type="button"
              className={[styles.stepChip, current ? styles.stepChipCurrent : null]
                .filter(Boolean)
                .join(" ")}
              aria-current={current ? "step" : undefined}
              onClick={() => setStep(key)}
            >
              <span
                className={[
                  styles.stepNo,
                  current ? styles.stepNoCurrent : done ? styles.stepNoDone : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {done ? "✓" : i + 1}
              </span>
              {t(`steps.${key}`)}
            </button>
          );
        })}
      </nav>

      <div className={styles.drawerBody}>
        {error && (
          <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
            {error}
          </p>
        )}

        {step === "identity" && (
          <div className={styles.stepStack}>
            <div
              className={styles.photoSlot}
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDrop}
            >
              <Avatar employee={preview} size="xxl" />
              <span className={styles.photoText}>
                <span className={styles.photoTitle}>{t("photo.title")}</span>
                <span className={styles.photoHint}>{t("photo.text")}</span>
                {upload.error && (
                  <span className={styles.photoError} role="alert">
                    {upload.error}
                  </span>
                )}
              </span>
              <span className={styles.photoActions}>
                <Button
                  variant="secondary"
                  onClick={() => fileRef.current?.click()}
                  busy={upload.busy}
                  disabled={busy}
                >
                  {upload.busy ? t("photo.uploading") : photo ? t("photo.replace") : t("photo.choose")}
                </Button>
                {photo !== "" && !upload.busy && (
                  <Button variant="ghost" onClick={() => setPhoto("")} disabled={busy}>
                    {t("photo.remove")}
                  </Button>
                )}
              </span>
              <input
                ref={fileRef}
                type="file"
                accept={EMPLOYEE_PHOTO_CONTENT_TYPES.join(",")}
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Cleared so picking the same file again still fires.
                  event.target.value = "";
                  void pickPhoto(file);
                }}
              />
            </div>

            <div className={styles.fieldGrid}>
              <TextField
                label={t("firstName")}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="off"
                disabled={busy}
              />
              <TextField
                label={t("lastName")}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="off"
                disabled={busy}
              />
              <div>
                <TextField
                  label={t("matricule")}
                  format="mono"
                  value={matricule}
                  onChange={(e) => setMatricule(e.target.value)}
                  autoComplete="off"
                  disabled={busy}
                />
                {!employee && <p className={records.hint}>{t("matriculeAuto")}</p>}
              </div>
              <div className={styles.choiceField}>
                <span className={styles.choiceLabel}>{t("gender")}</span>
                <div className={styles.toggle} role="group" aria-label={t("gender")}>
                  {GENDERS.map((option) => {
                    const active = gender === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={[styles.toggleOption, active ? styles.toggleOptionActive : null]
                          .filter(Boolean)
                          .join(" ")}
                        aria-pressed={active}
                        disabled={busy}
                        onClick={() => setGender(active ? "" : option.value)}
                      >
                        {t(`genders.${option.key}`)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {step === "role" && (
          <div className={styles.stepStack}>
            <div className={styles.fieldGrid}>
              <TextField
                label={t("jobTitle")}
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                autoComplete="off"
                disabled={busy}
              />
              <div className={styles.choiceField}>
                <span className={styles.choiceLabel}>{t("department")}</span>
                <div className={styles.optionRow} role="group" aria-label={t("department")}>
                  {serviceChips.map((name) => {
                    const active = !typingDepartment && department === name;
                    return (
                      <button
                        key={name}
                        type="button"
                        className={[styles.option, active ? styles.optionActive : null]
                          .filter(Boolean)
                          .join(" ")}
                        aria-pressed={active}
                        disabled={busy}
                        onClick={() => {
                          setTypingDepartment(false);
                          setDepartment(active ? "" : name);
                        }}
                      >
                        {name}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={[styles.option, typingDepartment ? styles.optionActive : null]
                      .filter(Boolean)
                      .join(" ")}
                    aria-pressed={typingDepartment}
                    disabled={busy}
                    onClick={() => {
                      setTypingDepartment(true);
                      setDepartment("");
                    }}
                  >
                    {t("otherDepartment")}
                  </button>
                </div>
              </div>
            </div>
            {typingDepartment && (
              <TextField
                label={t("newDepartment")}
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                autoComplete="off"
                autoFocus
                disabled={busy}
              />
            )}

            <div className={styles.choiceField}>
              <span className={styles.choiceLabel}>{t("contract")}</span>
              <div className={styles.cardGrid} role="group" aria-label={t("contract")}>
                {contractCards.map((kind) => {
                  const active = employmentType === kind;
                  const meta = CONTRACT_META[kind as (typeof CONTRACTS)[number]];
                  return (
                    <button
                      key={kind}
                      type="button"
                      className={[styles.card, active ? styles.cardActive : null]
                        .filter(Boolean)
                        .join(" ")}
                      aria-pressed={active}
                      disabled={busy}
                      onClick={() => setEmploymentType(active ? "" : kind)}
                    >
                      <span className={styles.cardTitle}>{kind}</span>
                      <span className={styles.cardMeta}>
                        {meta ? t(`contracts.${meta}`) : t("contracts.legacy")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={styles.fieldGridNarrow}>
              <TextField
                label={t("hired")}
                type="date"
                value={hireDate}
                onChange={(e) => setHireDate(e.target.value)}
                disabled={busy}
              />
              {showsEnd && (
                <TextField
                  label={t("contractEnds")}
                  type="date"
                  value={contractEndDate}
                  onChange={(e) => setContractEndDate(e.target.value)}
                  disabled={busy}
                />
              )}
              <TextField
                label={t("category")}
                unit={t("optional")}
                placeholder={t("categoryPlaceholder")}
                value={categorie}
                onChange={(e) => setCategorie(e.target.value)}
                autoComplete="off"
                disabled={busy}
              />
              <TextField
                label={t("echelon")}
                unit={t("optional")}
                placeholder={t("echelonPlaceholder")}
                value={echelon}
                onChange={(e) => setEchelon(e.target.value)}
                autoComplete="off"
                disabled={busy}
              />
            </div>
          </div>
        )}

        {step === "contact" && (
          <div className={styles.fieldGrid}>
            <TextField
              label={t("phone")}
              type="tel"
              format="mono"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
            <TextField
              label={t("phone2")}
              unit={t("optional")}
              type="tel"
              format="mono"
              placeholder="+216 …"
              value={phone2}
              onChange={(e) => setPhone2(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
            <div className={styles.fieldWide}>
              <TextField
                label={t("email")}
                unit={t("optional")}
                type="email"
                placeholder={t("emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                disabled={busy}
              />
            </div>
          </div>
        )}

        {step === "roster" && (
          <div className={styles.stepStack}>
            <div className={styles.statusCards} role="group" aria-label={t("steps.roster")}>
              {([false, true] as const).map((value) => {
                const active = suspended === value;
                const key = value ? "suspended" : "onRoster";
                return (
                  <button
                    key={key}
                    type="button"
                    className={[
                      styles.card,
                      styles.statusCard,
                      value ? styles.statusCardSuspended : styles.statusCardOnRoster,
                      active ? styles.cardActive : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-pressed={active}
                    disabled={busy}
                    onClick={() => setSuspended(value)}
                  >
                    <span className={styles.cardTitle}>
                      <i className={styles.statusDot} aria-hidden />
                      {t(`status.${key}`)}
                    </span>
                    <span className={styles.cardMeta}>{t(`status.${key}Meta`)}</span>
                  </button>
                );
              })}
            </div>
            {suspended && (
              <div className={styles.suspension}>
                <TextField
                  label={t("suspendedOn")}
                  type="date"
                  value={suspendedAt}
                  onChange={(e) => setSuspendedAt(e.target.value)}
                  disabled={busy}
                />
                <TextField
                  label={t("reason")}
                  placeholder={t("reasonPlaceholder")}
                  value={suspensionReason}
                  onChange={(e) => setSuspensionReason(e.target.value)}
                  autoComplete="off"
                  disabled={busy}
                />
              </div>
            )}
          </div>
        )}

        {step === "confidential" && canSeeSensitive && (
          <div className={styles.stepStack}>
            <p className={styles.confidentialBanner}>
              <strong>{t("confidentialTitle")}</strong>
              <span>{t("confidentialText")}</span>
            </p>
            <div className={styles.fieldGrid}>
              <TextField
                label={t("salary")}
                unit="TND"
                format="numeric"
                inputMode="decimal"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                autoComplete="off"
                disabled={busy}
              />
              <TextField
                label={t("birthDate")}
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                disabled={busy}
              />
              <TextField
                label={t("cin")}
                format="mono"
                value={cin}
                onChange={(e) => setCin(e.target.value)}
                autoComplete="off"
                disabled={busy}
              />
              <TextField
                label={t("ssn")}
                format="mono"
                value={ssn}
                onChange={(e) => setSsn(e.target.value)}
                autoComplete="off"
                disabled={busy}
              />
              <div className={styles.fieldWide}>
                <TextField
                  label={t("address")}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  autoComplete="off"
                  disabled={busy}
                />
              </div>
            </div>
          </div>
        )}

        {step === "account" && canSeeSensitive && (
          <div className={styles.accountList} role="group" aria-label={t("steps.account")}>
            <p className={styles.accountIntro}>{t("accountIntro")}</p>
            <button
              type="button"
              className={[styles.card, styles.account, userId === "" ? styles.cardActive : null]
                .filter(Boolean)
                .join(" ")}
              aria-pressed={userId === ""}
              disabled={busy}
              onClick={() => setUserId("")}
            >
              <span className={styles.accountBadge} aria-hidden>
                —
              </span>
              <span className={styles.accountText}>
                <span className={styles.cardTitle}>{t("noAccount")}</span>
                <span className={styles.cardMeta}>{t("noAccountMeta")}</span>
              </span>
            </button>
            {usersQuery.isPending ? (
              <p className={records.muted}>{t("loadingAccounts")}</p>
            ) : (
              linkable.map((user) => {
                const active = userId === user.id;
                return (
                  <button
                    key={user.id}
                    type="button"
                    className={[styles.card, styles.account, active ? styles.cardActive : null]
                      .filter(Boolean)
                      .join(" ")}
                    aria-pressed={active}
                    disabled={busy}
                    onClick={() => setUserId(user.id)}
                  >
                    <span className={styles.accountBadge} aria-hidden>
                      {initials(user.name)}
                    </span>
                    <span className={styles.accountText}>
                      <span className={styles.cardTitle}>{user.name}</span>
                      <span className={styles.cardMeta}>
                        <bdi>{user.email}</bdi>
                        {" · "}
                        {user.employee === null
                          ? t("accountFree", { role: enums(`role.${user.role}`) })
                          : t("accountThis", { role: enums(`role.${user.role}`) })}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      <div className={styles.drawerFoot}>
        <Button
          variant="secondary"
          onClick={() => setStep(steps[index - 1] ?? step)}
          disabled={index === 0 || busy}
        >
          {t("previous")}
        </Button>
        <span className={styles.stepCount}>
          {t("stepOf", { step: index + 1, total: steps.length })}
        </span>
        <Button
          variant="secondary"
          onClick={() => setStep(steps[index + 1] ?? steps[0] ?? step)}
          disabled={busy}
        >
          {index === steps.length - 1 ? t("review") : t("next")}
        </Button>
        <Button variant="primary" onClick={save} busy={busy} disabled={upload.busy}>
          {employee ? t("save") : t("create")}
        </Button>
      </div>
    </dialog>
  );
}
