"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { canAccess } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { formatDay, numberFormat } from "../../i18n/formats";
import { useCurrentUser } from "../auth/use-auth";
import { KpiRow, KpiTile } from "../records/kpi";
import { useTRPC } from "../trpc/client";
import records from "../records/records.module.css";
import { Avatar } from "./avatar";
import { EmployeeDrawer, type StepKey } from "./employee-drawer";
import { employeeName } from "./employee-name";
import {
  contractEnd,
  ContractEndText,
  invalidateEmployeeQueries,
  statusOf,
  StatusPill,
  tenureMonths,
  todayUtc,
  useGenderLabel,
  useTenureText,
} from "./employee-ui";
import styles from "./employees.module.css";

/** Salaries are in dinars, which count in millimes: always three decimals. */
const MILLIMES = { minimumFractionDigits: 3, maximumFractionDigits: 3 } as const;

/** What the confidential panel shows until "show" is pressed. */
const MASK = "••••••";

type Tone = "warning" | "danger" | "success";

/**
 * One labelled value in a section. `null` is "never recorded" and draws the
 * muted dash; a `tone` colours a value that needs attention ("not given")
 * or states a standing.
 */
function Field({
  label,
  value,
  mono = false,
  tone,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  tone?: Tone;
}) {
  const toneClass =
    tone === "warning"
      ? styles.fieldWarning
      : tone === "danger"
        ? styles.fieldDanger
        : tone === "success"
          ? styles.fieldSuccess
          : null;
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span
        className={[styles.fieldValue, mono ? styles.fieldMono : null, toneClass]
          .filter(Boolean)
          .join(" ")}
      >
        {value === null || value === "" ? <span className={records.absent} /> : value}
      </span>
    </div>
  );
}

function Section({
  title,
  sub,
  ink = false,
  children,
}: {
  title: string;
  sub?: string;
  /** The confidential panel: ink, so it reads as apart from the rest. */
  ink?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={[styles.section, ink ? styles.sectionInk : null].filter(Boolean).join(" ")}
    >
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {sub && <span className={styles.sectionSub}>{sub}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * An employee's record page, from `Employees v3.dc.html`: who they are and
 * where they stand at the head, four figures, what is missing, then the
 * record in four sections. Editing opens the form as a sheet over the page,
 * at the step that holds whatever the "to complete" notice names.
 */
export function EmployeeDetail({ id }: { id: string }) {
  const t = useTranslations("employees");
  const common = useTranslations("common");
  const locale = useLocale();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { user: me } = useCurrentUser();
  const tenureText = useTenureText();
  const genderLabel = useGenderLabel();
  const [editing, setEditing] = useState<StepKey | null>(null);
  const [reveal, setReveal] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery(trpc.employee.byId.queryOptions({ id }));
  // The form's service picker; fetched once the form is wanted.
  const summaryQuery = useQuery({
    ...trpc.employee.summary.queryOptions(),
    enabled: editing !== null,
  });

  const setActive = useMutation(
    trpc.employee.setActive.mutationOptions({
      onSuccess: async () => {
        setConfirming(false);
        await invalidateEmployeeQueries(queryClient, trpc);
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  if (query.isPending) return <p className={records.muted}>{t("loadingEmployee")}</p>;

  if (query.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {query.error.message}
      </p>
    );
  }

  const employee = query.data;
  const name = employeeName(employee);
  const today = todayUtc();
  const status = statusOf(employee);
  const end = contractEnd(employee.contractEndDate, today);
  const endingSoon = end.kind === "ends" && end.soon;
  const months = tenureMonths(employee.hireDate, today);
  const gender = genderLabel(employee.gender);
  // The service selects the confidential columns for ADMIN and above only,
  // so the record is one of two shapes. The panel draws when the server sent
  // them — the data decides, not a second guess at the role.
  const confidential = "cin" in employee ? employee : null;
  // Linking an account is ADMIN-only too; below that, a missing one is not
  // this reader's to fix.
  const canLink = me ? canAccess(me.role, "ADMIN") : false;

  // What the record lacks, in the order the form's steps hold them, so
  // "Complete" opens the first one. Only for a record still in use.
  const missing: { key: "phone" | "reason" | "account"; step: StepKey }[] = [];
  if (employee.active) {
    if (employee.phone === null) missing.push({ key: "phone", step: "contact" });
    if (employee.suspended && employee.suspensionReason === null) {
      missing.push({ key: "reason", step: "roster" });
    }
    if (!employee.suspended && employee.userId === null && canLink) {
      missing.push({ key: "account", step: "account" });
    }
  }
  const missingList = new Intl.ListFormat(locale, { type: "conjunction" }).format(
    missing.map((item) => t(`detail.missing.${item.key}`)),
  );

  const masked = (value: string | null) => (reveal ? value : value === null ? null : MASK);
  const salary =
    confidential === null || confidential.salary === null
      ? null
      : `${numberFormat(MILLIMES).format(confidential.salary)} TND`;
  const account = employee.user;

  return (
    <>
      {error && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <header className={styles.hero}>
        <div className={styles.heroMain}>
          <Avatar employee={employee} size="hero" />
          <div className={styles.heroText}>
            <div className={styles.heroNameRow}>
              <h1 className={styles.heroName}>{name}</h1>
              <StatusPill status={status} />
            </div>
            {(employee.jobTitle !== null || employee.department !== null) && (
              <div className={styles.heroRole}>
                {[employee.jobTitle, employee.department]
                  .filter((part): part is string => part !== null)
                  .map((part, index) => (
                    <span key={part}>
                      {index > 0 && " · "}
                      <bdi>{part}</bdi>
                    </span>
                  ))}
              </div>
            )}
            <div className={styles.heroMeta}>
              <bdi>{t("detail.matricule", { matricule: employee.matricule })}</bdi>
              {gender !== null && (
                <>
                  {" · "}
                  <bdi>{gender}</bdi>
                </>
              )}
            </div>
          </div>
          <div className={styles.heroActions}>
            <Button variant="primary" onClick={() => setEditing("identity")}>
              {t("detail.edit")}
            </Button>
            {employee.phone !== null && (
              // A `tel:` link, so a phone dials and a desktop hands it to
              // whatever it uses for calls.
              <a href={`tel:${employee.phone.replace(/\s/g, "")}`} className={styles.callLink}>
                <Button variant="secondary" tabIndex={-1}>
                  {t("detail.call")}
                </Button>
              </a>
            )}
            <Button
              variant={employee.active ? "danger" : "secondary"}
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
            >
              {employee.active ? common("archive") : common("restore")}
            </Button>
          </div>
        </div>

        <KpiRow>
          <KpiTile
            label={t("detail.tiles.tenure")}
            value={months === null ? "—" : tenureText(months)}
            meta={
              employee.hireDate === null ? (
                t("detail.tiles.noHireDate")
              ) : (
                <bdi>{t("detail.tiles.hiredOn", { date: formatDay(employee.hireDate) })}</bdi>
              )
            }
          />
          <KpiTile
            label={t("detail.tiles.contract")}
            value={employee.employmentType ?? "—"}
            meta={
              employee.employmentType === null && end.kind === "open" ? undefined : (
                <ContractEndText end={end} employmentType={employee.employmentType} />
              )
            }
            tone={endingSoon ? "danger" : "neutral"}
          />
          <KpiTile
            label={t("detail.tiles.roster")}
            value={t(`status.${status}`)}
            meta={
              status === "suspended" && employee.suspendedAt !== null ? (
                <bdi>{t("detail.tiles.since", { date: formatDay(employee.suspendedAt) })}</bdi>
              ) : status === "onRoster" ? (
                t("detail.tiles.active")
              ) : undefined
            }
            tone={status === "onRoster" ? "success" : status === "suspended" ? "danger" : "neutral"}
          />
          <KpiTile
            label={t("detail.tiles.planning")}
            value={account ? t("detail.tiles.visible") : t("detail.tiles.absent")}
            meta={
              account ? (
                <bdi>{t("detail.tiles.account", { name: account.name })}</bdi>
              ) : (
                t("detail.tiles.noAccount")
              )
            }
            tone={account ? "success" : "warning"}
          />
        </KpiRow>
      </header>

      {!employee.active && <p className={styles.archivedNotice}>{t("detail.archivedNotice")}</p>}

      {missing.length > 0 && (
        <div className={styles.missing}>
          <strong>{t("detail.missing.title")}</strong>
          <span className={styles.missingText}>{t("detail.missing.text", { items: missingList })}</span>
          <Button variant="secondary" onClick={() => setEditing(missing[0]?.step ?? "identity")}>
            {t("detail.missing.action")}
          </Button>
        </div>
      )}

      <div className={styles.sections}>
        <Section title={t("detail.sections.role")}>
          <Field label={t("detail.fields.jobTitle")} value={employee.jobTitle} />
          <Field label={t("detail.fields.department")} value={employee.department} />
          <Field label={t("detail.fields.contract")} value={employee.employmentType} mono />
          <Field
            label={t("detail.fields.hired")}
            value={employee.hireDate === null ? null : formatDay(employee.hireDate)}
            mono
          />
          <Field
            label={t("detail.fields.contractEnds")}
            value={
              end.kind === "open"
                ? employee.employmentType === null
                  ? null
                  : employee.employmentType === "CDI"
                    ? t("contractEnd.open")
                    : t("contractEnd.notGiven")
                : formatDay(end.date)
            }
            mono={end.kind !== "open"}
            tone={
              endingSoon
                ? "danger"
                : end.kind === "open" &&
                    employee.employmentType !== null &&
                    employee.employmentType !== "CDI"
                  ? "warning"
                  : undefined
            }
          />
          <Field label={t("detail.fields.category")} value={employee.categorie} mono />
          <Field label={t("detail.fields.echelon")} value={employee.echelon} mono />
        </Section>

        <Section title={t("detail.sections.contact")}>
          <Field label={t("detail.fields.phone")} value={employee.phone} mono />
          <Field label={t("detail.fields.phone2")} value={employee.phone2} mono />
          <Field
            label={t("detail.fields.email")}
            value={employee.email === null ? null : <bdi>{employee.email}</bdi>}
          />
        </Section>

        <Section title={t("detail.sections.roster")}>
          <Field
            label={t("detail.fields.status")}
            value={t(`status.${status}`)}
            tone={status === "onRoster" ? "success" : status === "suspended" ? "danger" : undefined}
          />
          <Field
            label={t("detail.fields.suspendedOn")}
            value={employee.suspendedAt === null ? null : formatDay(employee.suspendedAt)}
            mono
          />
          <Field
            label={t("detail.fields.reason")}
            value={
              employee.suspended
                ? (employee.suspensionReason ?? t("detail.fields.notGiven"))
                : t("detail.fields.notApplicable")
            }
            tone={employee.suspended && employee.suspensionReason === null ? "warning" : undefined}
          />
          <Field
            label={t("detail.fields.account")}
            value={account ? <bdi>{account.name}</bdi> : t("detail.fields.none")}
            tone={account ? undefined : "warning"}
          />
        </Section>

        {confidential !== null && (
          <Section
            title={t("detail.sections.confidential")}
            sub={t("detail.sections.confidentialSub")}
            ink
          >
            <Field label={t("detail.fields.salary")} value={masked(salary)} mono />
            <Field label={t("detail.fields.cin")} value={masked(confidential.cin)} mono />
            <Field
              label={t("detail.fields.ssn")}
              value={masked(confidential.socialSecurityNumber)}
              mono
            />
            <Field
              label={t("detail.fields.birthDate")}
              value={masked(
                confidential.birthDate === null ? null : formatDay(confidential.birthDate),
              )}
              mono
            />
            <Field
              label={t("detail.fields.address")}
              value={masked(confidential.address)}
              mono={!reveal}
            />
            <button
              type="button"
              className={styles.reveal}
              aria-pressed={reveal}
              onClick={() => setReveal((shown) => !shown)}
            >
              {reveal ? t("detail.hide") : t("detail.reveal")}
            </button>
          </Section>
        )}
      </div>

      {editing !== null && (
        <EmployeeDrawer
          employee={employee}
          departments={summaryQuery.data?.departments ?? []}
          startStep={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}

      <Dialog
        open={confirming}
        title={employee.active ? t("archiveTitle") : t("restoreTitle")}
        confirmLabel={employee.active ? common("archive") : common("restore")}
        destructive={employee.active}
        busy={setActive.isPending}
        onConfirm={() => setActive.mutate({ id: employee.id, active: !employee.active })}
        onClose={() => !setActive.isPending && setConfirming(false)}
      >
        {t.rich(employee.active ? "archiveBody" : "restoreBody", {
          name,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      </Dialog>
    </>
  );
}
