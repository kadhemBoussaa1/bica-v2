"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  assetUrl,
  canAccess,
  canAccessAny,
  createEmployeeInput,
  updateEmployeeInput,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { SelectField, TextField } from "@repo/ui/field";
import { Thumbnail } from "@repo/ui/thumbnail";
import { useCurrentUser } from "../auth/use-auth";
import { useTRPC } from "../trpc/client";
import styles from "../records/records.module.css";

/**
 * The sensitive half is optional in this type because a non-admin's `byId` never
 * returns those fields — the service selects a narrower shape. Anyone reaching
 * this form can write (it is ADMIN-gated), but typing them as optional keeps the
 * component honest about what may be missing.
 */
export interface EmployeeFormValues {
  id: string;
  matricule: string;
  firstName: string;
  lastName: string;
  department: string | null;
  jobTitle: string | null;
  employmentType: string | null;
  categorie: string | null;
  echelon: string | null;
  gender: string | null;
  email: string | null;
  phone: string | null;
  phone2: string | null;
  hireDate: string | Date | null;
  contractEndDate: string | Date | null;
  photo: string | null;
  suspended: boolean;
  suspendedAt: string | Date | null;
  suspensionReason: string | null;
  salary?: number | null;
  salaryGross?: number | null;
  cin?: string | null;
  socialSecurityNumber?: string | null;
  birthDate?: string | Date | null;
  address?: string | null;
  /** The account they sign in with (shift planning); null when unlinked. */
  userId?: string | null;
}

const str = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

function toDateInput(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export function EmployeeForm({
  initial,
  onDone,
  onCancel,
}: {
  onDone?: (target: string) => void | Promise<void>;
  onCancel?: (target: string) => void;
  initial?: EmployeeFormValues;
}) {
  const t = useTranslations("employees");
  const common = useTranslations("common");
  const router = useRouter();
  // The route modal passes both; the full page falls through to navigation.
  const go = (target: string) => (onDone ? onDone(target) : router.push(target));
  const cancel = (target: string) => (onCancel ? onCancel(target) : router.push(target));
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { user: me } = useCurrentUser();

  // Writes are ADMIN-gated server-side, so this only decides whether to render
  // inputs whose current values a lower rank would not have been sent.
  const canSeeSensitive = me ? canAccess(me.role, "ADMIN") : false;

  const [matricule, setMatricule] = useState(initial?.matricule ?? "");
  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [lastName, setLastName] = useState(initial?.lastName ?? "");
  const [department, setDepartment] = useState(initial?.department ?? "");
  const [jobTitle, setJobTitle] = useState(initial?.jobTitle ?? "");
  const [employmentType, setEmploymentType] = useState(initial?.employmentType ?? "");
  const [categorie, setCategorie] = useState(initial?.categorie ?? "");
  const [echelon, setEchelon] = useState(initial?.echelon ?? "");
  const [gender, setGender] = useState(initial?.gender ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [phone2, setPhone2] = useState(initial?.phone2 ?? "");
  const [hireDate, setHireDate] = useState(toDateInput(initial?.hireDate));
  const [contractEndDate, setContractEndDate] = useState(toDateInput(initial?.contractEndDate));
  const [suspended, setSuspended] = useState(initial?.suspended ?? false);
  const [suspendedAt, setSuspendedAt] = useState(toDateInput(initial?.suspendedAt));
  const [suspensionReason, setSuspensionReason] = useState(initial?.suspensionReason ?? "");
  const [photo, setPhoto] = useState(initial?.photo ?? "");

  const [salary, setSalary] = useState(str(initial?.salary));
  const [cin, setCin] = useState(initial?.cin ?? "");
  const [ssn, setSsn] = useState(initial?.socialSecurityNumber ?? "");
  const [birthDate, setBirthDate] = useState(toDateInput(initial?.birthDate));
  const [address, setAddress] = useState(initial?.address ?? "");
  const [userId, setUserId] = useState(initial?.userId ?? "");

  const [error, setError] = useState<string | null>(null);

  /**
   * The "Linked account" picker's options: accounts the shop-floor pages
   * admit (ADMIN and above, PRODUCTION) that belong to nobody yet, plus this
   * person's own. `user.list` is already scoped to accounts the caller
   * outranks, so the list and `linkUser` agree on who may be linked.
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
    (u) =>
      canAccessAny(u.role, ["ADMIN", "PRODUCTION"]) &&
      (u.employee === null || u.employee.id === initial?.id),
  );

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: trpc.employee.list.queryKey() });
    await go("/employees");
  };

  const linkUser = useMutation(trpc.employee.linkUser.mutationOptions());

  /**
   * The link is its own procedure (it checks the account's role and the
   * caller's rank over it), so it follows the save. A failed link leaves
   * the saved record in place and the form open with the message.
   */
  const finish = async (id: string) => {
    const wanted = userId || null;
    if (canSeeSensitive && wanted !== (initial?.userId ?? null)) {
      try {
        await linkUser.mutateAsync({ id, userId: wanted });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : common("checkForm"));
        await queryClient.invalidateQueries({ queryKey: trpc.employee.list.queryKey() });
        return;
      }
    }
    await done();
  };

  const create = useMutation(
    trpc.employee.create.mutationOptions({
      onSuccess: (row) => finish(row.id),
      onError: (c) => setError(c.message),
    }),
  );
  const update = useMutation(
    trpc.employee.update.mutationOptions({
      onSuccess: (row) => finish(row.id),
      onError: (c) => setError(c.message),
    }),
  );
  const busy = create.isPending || update.isPending || linkUser.isPending;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedSalary = salary.trim();
    if (trimmedSalary !== "" && Number.isNaN(Number(trimmedSalary))) {
      setError(t("form.salaryMustBeNumber"));
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
      email,
      phone: cleared(phone),
      phone2: cleared(phone2),
      hireDate: cleared(hireDate),
      contractEndDate: cleared(contractEndDate),
      suspended,
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

    if (initial) {
      const parsed = updateEmployeeInput.safeParse({ ...raw, id: initial.id });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? common("checkForm"));
        return;
      }
      update.mutate(parsed.data);
      return;
    }
    const parsed = createEmployeeInput.safeParse(raw);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    create.mutate(parsed.data);
  }

  return (
    <form className={styles.formPanel} onSubmit={handleSubmit} noValidate>
      {error && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <div className={styles.formGrid}>
        <TextField
          label={t("form.matricule")}
          value={matricule}
          onChange={(e) => setMatricule(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <SelectField
          label={t("form.gender")}
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          disabled={busy}
          allowEmpty
          placeholder={t("form.notStated")}
          options={[
            { value: "Femme", label: t("form.genderFemale") },
            { value: "Homme", label: t("form.genderMale") },
          ]}
        />
        <TextField
          label={t("form.firstName")}
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("form.lastName")}
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />

        <span className={styles.formSection}>{t("form.roleSection")}</span>
        <TextField
          label={t("form.jobTitle")}
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("form.department")}
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <SelectField
          label={t("form.contract")}
          value={employmentType}
          onChange={(e) => setEmploymentType(e.target.value)}
          disabled={busy}
          allowEmpty
          placeholder={t("form.notStated")}
          options={["CDI", "CIVP"]}
        />
        <TextField
          label={t("form.category")}
          value={categorie}
          onChange={(e) => setCategorie(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("form.echelon")}
          value={echelon}
          onChange={(e) => setEchelon(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("form.hired")}
          type="date"
          value={hireDate}
          onChange={(e) => setHireDate(e.target.value)}
          disabled={busy}
        />
        <TextField
          label={t("form.contractEnds")}
          type="date"
          value={contractEndDate}
          onChange={(e) => setContractEndDate(e.target.value)}
          disabled={busy}
        />

        <div className={styles.formWide}>
          {/*
            Migrated from the legacy roster, where 84 employees have a photo.
            The form has to send it back or the server would blank it; the
            preview is also the only place this app shows the photo at all.
          */}
          <div className={styles.imageRow}>
            <Thumbnail size="sm" src={assetUrl(photo)} />
            <TextField
              label={t("form.photoUrl")}
              value={photo}
              onChange={(e) => setPhoto(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </div>
        </div>

        <span className={styles.formSection}>{t("form.contactSection")}</span>
        <TextField
          label={t("form.email")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("form.phone")}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <TextField
          label={t("form.secondPhone")}
          value={phone2}
          onChange={(e) => setPhone2(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />

        <span className={styles.formSection}>{t("form.rosterSection")}</span>
        <SelectField
          label={t("form.status")}
          value={suspended ? "suspended" : "active"}
          onChange={(e) => setSuspended(e.target.value === "suspended")}
          disabled={busy}
          options={[
            { value: "active", label: t("onRoster") },
            { value: "suspended", label: t("suspended") },
          ]}
        />
        <TextField
          label={t("form.suspendedOn")}
          type="date"
          value={suspendedAt}
          onChange={(e) => setSuspendedAt(e.target.value)}
          disabled={busy || !suspended}
        />
        <div className={styles.formWide}>
          <TextField
            label={t("form.suspensionReason")}
            value={suspensionReason}
            onChange={(e) => setSuspensionReason(e.target.value)}
            autoComplete="off"
            disabled={busy || !suspended}
          />
        </div>

        {canSeeSensitive && (
          <>
            <span className={styles.formSection}>{t("form.confidentialSection")}</span>
            <TextField
              label={t("form.salary")}
              unit="TND"
              format="numeric"
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
            <TextField
              label={t("form.cin")}
              value={cin}
              onChange={(e) => setCin(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
            <TextField
              label={t("form.socialSecurityNumber")}
              value={ssn}
              onChange={(e) => setSsn(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
            <TextField
              label={t("form.dateOfBirth")}
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              disabled={busy}
            />
            <div className={styles.formWide}>
              <TextField
                label={t("form.address")}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                autoComplete="off"
                disabled={busy}
              />
            </div>

            <span className={styles.formSection}>{t("form.accountSection")}</span>
            <div className={styles.formWide}>
              <SelectField
                label={t("form.linkedAccount")}
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                disabled={busy || usersQuery.isPending}
                allowEmpty
                placeholder={usersQuery.isPending ? common("loading") : t("form.noAccount")}
                options={linkable.map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` }))}
              />
              <p className={styles.hint}>{t("form.linkedAccountHint")}</p>
            </div>
          </>
        )}
      </div>

      <div className={styles.formActions}>
        <Button variant="secondary" onClick={() => cancel("/employees")} disabled={busy}>
          {common("cancel")}
        </Button>
        <Button variant="primary" type="submit" busy={busy}>
          {busy ? common("saving") : initial ? common("saveChanges") : t("form.createEmployee")}
        </Button>
      </div>
    </form>
  );
}
