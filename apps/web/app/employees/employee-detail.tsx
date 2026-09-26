"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { canAccess } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { formatDay, numberFormat } from "../../i18n/formats";
import { useCurrentUser } from "../auth/use-auth";
import { useTRPC } from "../trpc/client";
import records from "../records/records.module.css";
import { Avatar, tintIndex } from "./avatar";
import { EmployeeDocuments, documentSlots } from "./employee-documents";
import { EmployeeDrawer, type StepKey } from "./employee-drawer";
import { employeeName } from "./employee-name";
import {
  contractEnd,
  invalidateEmployeeQueries,
  statusOf,
  tenureMonths,
  todayUtc,
  useGenderLabel,
  useTenureText,
  type EmployeeStatus,
} from "./employee-ui";
import styles from "./employee-detail.module.css";

/** Salaries are in dinars, which count in millimes: always three decimals. */
const MILLIMES = { minimumFractionDigits: 3, maximumFractionDigits: 3 } as const;

/** What the confidential panel shows until "show" is pressed. */
const MASK = "••••••";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The documents panel, which the "documents missing" issue scrolls to. */
const DOCUMENTS_ID = "employee-documents";

/** The header band washes in the avatar's own tint, so the page reads as this person's. */
const BANDS = [
  styles.band0,
  styles.band1,
  styles.band2,
  styles.band3,
  styles.band4,
  styles.band5,
];

const STATUS_TONE: Record<EmployeeStatus, string | undefined> = {
  onRoster: styles.toneSuccess,
  suspended: styles.toneDanger,
  archived: styles.toneNeutral,
};

/**
 * One labelled value in a side group. `null` reads "not given", in italics,
 * so an empty field is visibly a gap rather than a blank.
 */
function Row({
  label,
  value,
  mono = false,
  tone,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  tone?: EmployeeStatus;
}) {
  const t = useTranslations("employees.detail.fields");
  const empty = value === null || value === "";
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span
        className={[
          styles.rowValue,
          mono && !empty ? styles.rowMono : null,
          empty ? styles.rowEmpty : null,
          tone ? STATUS_TONE[tone] : null,
          tone ? styles.rowToned : null,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {empty ? t("notGiven") : value}
      </span>
    </div>
  );
}

function Group({ title, dot, children }: { title: string; dot: string; children: ReactNode }) {
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <i className={styles.groupDot} style={{ background: dot }} aria-hidden />
        <h3 className={styles.groupTitle}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

interface Issue {
  key: string;
  severity: "danger" | "warning";
  title: string;
  meta: string;
  action: string;
  act: () => void;
}

/**
 * An employee's record page, from `Employees v3.dc.html`: the person on a
 * band in their own tint, what needs doing, then the contract on a
 * timeline and the papers on file beside who they are and how to reach
 * them. Editing opens the form as a sheet over the page, at the step that
 * fixes whatever issue was clicked.
 */
export function EmployeeDetail({ id }: { id: string }) {
  const t = useTranslations("employees");
  const common = useTranslations("common");
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
  const onRoster = status === "onRoster";
  const end = contractEnd(employee.contractEndDate, today);
  const months = tenureMonths(employee.hireDate, today);
  const gender = genderLabel(employee.gender);
  const account = employee.user;
  // The service selects the confidential columns for ADMIN and above only,
  // so the record is one of two shapes. The panel draws when the server sent
  // them — the data decides, not a second guess at the role.
  const confidential = "cin" in employee ? employee : null;
  // Linking an account is ADMIN-only; below that, a missing one is not this
  // reader's to fix.
  const canLink = me ? canAccess(me.role, "ADMIN") : false;
  const slots = documentSlots(employee.employmentType, employee.documents);
  const missingDocs = slots.filter((slot) => slot.document === undefined);

  // What needs doing, most urgent first. Only for a record still in use:
  // an archived one is out of the app, and its gaps are nobody's to chase.
  const issues: Issue[] = [];
  if (employee.active) {
    const toStep = (step: StepKey) => () => setEditing(step);
    if (onRoster && end.kind === "ends" && end.soon) {
      issues.push({
        key: "ending",
        severity: "danger",
        title: t("detail.issues.endingSoon", { count: end.days }),
        meta: t("detail.issues.endingSoonMeta", { date: formatDay(end.date) }),
        action: t("detail.issues.renew"),
        act: toStep("role"),
      });
    }
    if (onRoster && end.kind === "ended") {
      issues.push({
        key: "expired",
        severity: "danger",
        title: t("detail.issues.expired"),
        meta: t("detail.issues.expiredMeta", { date: formatDay(end.date) }),
        action: t("detail.issues.regularise"),
        act: toStep("role"),
      });
    }
    if (employee.phone === null) {
      issues.push({
        key: "phone",
        severity: "warning",
        title: t("detail.issues.noPhone"),
        meta: t("detail.issues.noPhoneMeta"),
        action: t("detail.issues.add"),
        act: toStep("contact"),
      });
    }
    if (employee.suspended && employee.suspensionReason === null) {
      issues.push({
        key: "reason",
        severity: "warning",
        title: t("detail.issues.noReason"),
        meta:
          employee.suspendedAt === null
            ? t("detail.issues.noReasonUndated")
            : t("detail.issues.noReasonMeta", { date: formatDay(employee.suspendedAt) }),
        action: t("detail.issues.fill"),
        act: toStep("roster"),
      });
    }
    if (onRoster && employee.userId === null && canLink) {
      issues.push({
        key: "account",
        severity: "warning",
        title: t("detail.issues.noAccount"),
        meta: t("detail.issues.noAccountMeta"),
        action: t("detail.issues.link"),
        act: toStep("account"),
      });
    }
    if (missingDocs.length > 0) {
      issues.push({
        key: "documents",
        severity: "warning",
        title: t("detail.issues.documents", { count: missingDocs.length }),
        meta: missingDocs
          .map((slot) =>
            slot.kind === "CONTRACT" && employee.employmentType !== null
              ? t("detail.documents.kinds.contractOf", { type: employee.employmentType })
              : t(`detail.documents.kinds.${slot.kind}`),
          )
          .join(", "),
        action: t("detail.issues.upload"),
        act: () => {
          const section = document.getElementById(DOCUMENTS_ID);
          section?.scrollIntoView({ behavior: "smooth", block: "start" });
          section?.focus({ preventScroll: true });
        },
      });
    }
  }

  // The contract on a line from hire to end, with today marked on it. An
  // open-ended CDI draws a hatched track with no end; any other contract
  // with no end date says the date is missing rather than inventing one.
  const hired = employee.hireDate === null ? null : new Date(employee.hireDate).getTime();
  let percent = 0;
  let fillClass: string | undefined;
  let stateText: string;
  let stateTone: string | undefined;
  let showToday = false;
  if (end.kind === "open") {
    if (employee.employmentType === "CDI") {
      stateText = t("detail.contract.openEnded");
      stateTone = styles.stateSuccess;
      fillClass = styles.fillOpen;
      percent = 70;
      showToday = true;
    } else {
      stateText = t("detail.contract.noEnd");
      stateTone = styles.stateWarning;
    }
  } else if (end.kind === "ended") {
    stateText = t("detail.contract.endedAgo", {
      count: Math.round((today - new Date(end.date).getTime()) / DAY_MS),
    });
    stateTone = styles.stateMuted;
    fillClass = styles.fillEnded;
    percent = 100;
  } else {
    stateText = t("detail.contract.remaining", { count: end.days });
    stateTone = end.soon ? styles.stateDanger : styles.stateLater;
    fillClass = end.soon ? styles.fillSoon : styles.fillLater;
    const span = new Date(end.date).getTime() - (hired ?? today);
    percent = hired === null || span <= 0 ? 0 : Math.min(100, ((today - hired) / span) * 100);
    showToday = hired !== null;
  }
  const trackClass =
    end.kind === "open"
      ? employee.employmentType === "CDI"
        ? styles.trackOpen
        : styles.trackUnknown
      : undefined;
  const position = { "--at": `${percent.toFixed(1)}%` } as CSSProperties;

  const masked = (value: string | null) => (reveal ? value : value === null ? null : MASK);
  const salary =
    confidential === null || confidential.salary === null
      ? null
      : `${numberFormat(MILLIMES).format(confidential.salary)} TND`;

  const band =
    status === "suspended"
      ? styles.bandSuspended
      : status === "archived"
        ? styles.bandArchived
        : BANDS[tintIndex(employee.id)];

  return (
    <>
      {error && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <header className={[styles.hero, band].filter(Boolean).join(" ")}>
        <div className={styles.heroGlow} aria-hidden />
        <div className={styles.heroMain}>
          <span className={styles.portrait}>
            <Avatar employee={employee} size="hero" />
            <span
              className={[styles.statusBadge, STATUS_TONE[status]].filter(Boolean).join(" ")}
              title={t(`status.${status}`)}
            >
              <i aria-hidden />
            </span>
          </span>

          <div className={styles.heroText}>
            <div className={styles.heroTop}>
              <span className={[styles.statusChip, STATUS_TONE[status]].filter(Boolean).join(" ")}>
                <i aria-hidden />
                {t(`status.${status}`)}
              </span>
              <bdi className={styles.heroMatricule}>
                {t("detail.matricule", { matricule: employee.matricule })}
              </bdi>
            </div>
            <h1 className={styles.heroName}>{name}</h1>
            {(employee.jobTitle !== null || employee.department !== null) && (
              <div className={styles.heroRole}>
                {employee.jobTitle !== null && <bdi>{employee.jobTitle}</bdi>}
                {employee.department !== null && (
                  <span className={styles.heroService}>
                    {employee.jobTitle !== null && " · "}
                    <bdi>{employee.department}</bdi>
                  </span>
                )}
              </div>
            )}
            <div className={styles.chips}>
              {months !== null && (
                <span className={styles.chip}>
                  <span className={styles.chipLabel}>{t("detail.chips.since")}</span>
                  <strong>{tenureText(months)}</strong>
                </span>
              )}
              {gender !== null && (
                <span className={styles.chip}>
                  <span className={styles.chipLabel}>{t("detail.chips.sex")}</span>
                  <strong>{gender}</strong>
                </span>
              )}
              <span className={styles.chip}>
                <span className={styles.chipLabel}>{t("detail.chips.planning")}</span>
                <strong>{account ? t("detail.chips.visible") : t("detail.chips.absent")}</strong>
              </span>
            </div>
          </div>

          <div className={styles.heroActions}>
            {employee.phone !== null && (
              // A `tel:` link, so a phone dials and a desktop hands it to
              // whatever it uses for calls.
              <a href={`tel:${employee.phone.replace(/\s/g, "")}`} className={styles.call}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={styles.callIcon}
                  aria-hidden
                >
                  <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
                </svg>
                <span className={styles.callText}>
                  <span className={styles.callLabel}>{t("detail.call")}</span>
                  <bdi className={styles.callNumber}>{employee.phone}</bdi>
                </span>
              </a>
            )}
            <Button variant="primary" onClick={() => setEditing("identity")}>
              {t("detail.edit")}
            </Button>
            <Button
              variant={employee.active ? "ghost" : "secondary"}
              className={employee.active ? styles.archive : undefined}
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
            >
              {employee.active ? common("archive") : common("restore")}
            </Button>
          </div>
        </div>
      </header>

      {!employee.active && <p className={styles.archivedNotice}>{t("detail.archivedNotice")}</p>}

      {issues.length > 0 && (
        <section className={[styles.panel, styles.issuesPanel].filter(Boolean).join(" ")}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>{t("detail.issues.title")}</h2>
            <span className={styles.panelMeta}>
              {t("detail.issues.count", { count: issues.length })}
            </span>
          </div>
          <div className={styles.issues}>
            {issues.map((issue) => (
              <div
                key={issue.key}
                className={[
                  styles.issue,
                  issue.severity === "danger" ? styles.issueDanger : styles.issueWarning,
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className={styles.issueMark} aria-hidden>
                  !
                </span>
                <span className={styles.issueText}>
                  <span className={styles.issueTitle}>{issue.title}</span>
                  <span className={styles.issueMeta}>{issue.meta}</span>
                  <button type="button" className={styles.issueAction} onClick={issue.act}>
                    {issue.action}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className={styles.layout}>
        <div className={styles.main}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>{t("detail.contract.title")}</h2>
              <span className={styles.typeBadge}>{employee.employmentType ?? "—"}</span>
              <span className={[styles.contractState, stateTone].filter(Boolean).join(" ")}>
                {stateText}
              </span>
            </div>
            <div className={styles.track} style={position}>
              <div className={[styles.trackBar, trackClass].filter(Boolean).join(" ")} />
              {fillClass !== undefined && (
                <div className={[styles.trackFill, fillClass].filter(Boolean).join(" ")} />
              )}
              {showToday && <div className={styles.trackToday} />}
            </div>
            <div className={styles.trackLabels}>
              <span>
                <span className={styles.trackLabel}>{t("detail.contract.hired")}</span>
                <span className={styles.trackValue}>
                  {employee.hireDate === null ? "—" : formatDay(employee.hireDate)}
                </span>
              </span>
              <span className={styles.trackMiddle}>
                <span className={styles.trackLabel}>{t("detail.contract.today")}</span>
                <span className={styles.trackValue}>
                  {months === null
                    ? t("detail.contract.noHireDate")
                    : t("detail.contract.presence", { tenure: tenureText(months) })}
                </span>
              </span>
              <span className={styles.trackEnd}>
                <span className={styles.trackLabel}>{t("detail.contract.end")}</span>
                <span
                  className={[
                    styles.trackValue,
                    end.kind === "ends" && end.soon ? styles.stateDanger : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {end.kind === "open"
                    ? employee.employmentType === "CDI"
                      ? t("contractEnd.open")
                      : "—"
                    : formatDay(end.date)}
                </span>
              </span>
            </div>
          </section>

          <EmployeeDocuments employee={employee} id={DOCUMENTS_ID} />
        </div>

        <div className={styles.side}>
          <section className={styles.panel}>
            <Group title={t("detail.groups.role")} dot="var(--bp-orange-500)">
              <Row label={t("detail.fields.jobTitle")} value={employee.jobTitle} />
              <Row label={t("detail.fields.department")} value={employee.department} />
              <Row
                label={t("detail.fields.grade")}
                value={
                  employee.categorie === null && employee.echelon === null
                    ? null
                    : [employee.categorie ?? "—", employee.echelon ?? "—"].join(" · ")
                }
                mono
              />
            </Group>
            <Group
              title={t("detail.groups.roster")}
              dot={
                status === "onRoster"
                  ? "var(--bp-success)"
                  : status === "suspended"
                    ? "var(--bp-danger)"
                    : "var(--bp-ink-faint)"
              }
            >
              <Row label={t("detail.fields.status")} value={t(`status.${status}`)} tone={status} />
              {employee.suspendedAt !== null && (
                <Row
                  label={t("detail.fields.suspendedOn")}
                  value={formatDay(employee.suspendedAt)}
                  mono
                />
              )}
              {employee.suspended && (
                <Row label={t("detail.fields.reason")} value={employee.suspensionReason} />
              )}
              <Row
                label={t("detail.fields.account")}
                value={account ? <bdi>{account.name}</bdi> : null}
              />
            </Group>
            <Group title={t("detail.groups.contact")} dot="var(--bp-info)">
              {/* `<bdi>`: in Arabic the leading "+" would otherwise land at the end. */}
              <Row
                label={t("detail.fields.phone")}
                value={employee.phone === null ? null : <bdi>{employee.phone}</bdi>}
                mono
              />
              {employee.phone2 !== null && (
                <Row label={t("detail.fields.phone2")} value={<bdi>{employee.phone2}</bdi>} mono />
              )}
              <Row
                label={t("detail.fields.email")}
                value={employee.email === null ? null : <bdi>{employee.email}</bdi>}
              />
            </Group>
          </section>

          {confidential !== null && (
            <section className={[styles.panel, styles.ink].filter(Boolean).join(" ")}>
              <div className={styles.inkHead}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={styles.lock}
                  aria-hidden
                >
                  <path d="M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                <h2 className={styles.inkTitle}>{t("detail.confidential.title")}</h2>
                <span className={styles.inkSub}>{t("detail.confidential.sub")}</span>
              </div>
              <Row label={t("detail.fields.salary")} value={masked(salary)} mono />
              <Row label={t("detail.fields.cin")} value={masked(confidential.cin)} mono />
              <Row
                label={t("detail.fields.ssn")}
                value={masked(confidential.socialSecurityNumber)}
                mono
              />
              <Row
                label={t("detail.fields.birthDate")}
                value={masked(
                  confidential.birthDate === null ? null : formatDay(confidential.birthDate),
                )}
                mono
              />
              <Row label={t("detail.fields.address")} value={masked(confidential.address)} mono />
              <button
                type="button"
                className={styles.reveal}
                aria-pressed={reveal}
                onClick={() => setReveal((shown) => !shown)}
              >
                {reveal ? t("detail.hide") : t("detail.reveal")}
              </button>
            </section>
          )}
        </div>
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
