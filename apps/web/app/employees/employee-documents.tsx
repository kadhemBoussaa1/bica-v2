"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  assetUrl,
  UPLOAD_CONTENT_TYPES,
  UPLOAD_MAX_BYTES,
  type EmployeeDocumentKind,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { TextField } from "@repo/ui/field";
import { useFileUpload } from "@repo/ui/file-upload";
import { formatDay } from "../../i18n/formats";
import { useTRPC } from "../trpc/client";
import records from "../records/records.module.css";
import type { EmployeeRecord } from "./employee-drawer";
import { invalidateEmployeeQueries } from "./employee-ui";
import styles from "./employee-detail.module.css";

type EmployeeDocument = EmployeeRecord["documents"][number];

/** The one-per-record papers every file is expected to hold, in the order the handoff lists them. */
const BASE_KINDS: readonly EmployeeDocumentKind[] = [
  "CONTRACT",
  "ID_CARD",
  "CNSS_CERTIFICATE",
  "FITNESS_CERTIFICATE",
];

/**
 * The slots a record is expected to fill: the four every file holds, and
 * the CIVP agreement when the contract is a CIVP (or one is already filed,
 * so a changed contract does not hide a file). Each carries the newest
 * document of its kind, if any — a fixed kind holds one, the server
 * replaces on upload.
 */
export function documentSlots(
  employmentType: string | null,
  documents: readonly EmployeeDocument[],
): { kind: EmployeeDocumentKind; document: EmployeeDocument | undefined }[] {
  const kinds = [...BASE_KINDS];
  if (employmentType === "CIVP" || documents.some((doc) => doc.kind === "CIVP_AGREEMENT")) {
    kinds.push("CIVP_AGREEMENT");
  }
  return kinds.map((kind) => ({ kind, document: documents.find((doc) => doc.kind === kind) }));
}

const FILE_ICON = "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h4";
const UPLOAD_ICON = "M12 16V4 M7 9l5-5 5 5 M5 20h14";

function DocIcon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

/** Where the next uploaded file goes: a slot, or a new named OTHER document. */
type Target = { kind: EmployeeDocumentKind; name?: string };

/**
 * The record's papers, from `Employees v3.dc.html`: one card per expected
 * document, filed or "missing", then any other file filed by name.
 *
 * The upload is the app's usual two steps — a presigned PUT straight to
 * S3, then `addDocument` files the returned URL, which the server checks
 * is on this app's bucket. Documents keep their full resolution: unlike the
 * photo, a scan has to stay legible.
 */
export function EmployeeDocuments({
  employee,
  id,
}: {
  employee: Pick<EmployeeRecord, "id" | "employmentType" | "documents">;
  /** The "documents missing" issue scrolls here. */
  id?: string;
}) {
  const t = useTranslations("employees.detail.documents");
  const common = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  // Read inside the upload callbacks, which outlive the render that set them.
  const target = useRef<Target | null>(null);
  const pendingType = useRef<(typeof UPLOAD_CONTENT_TYPES)[number]>("application/pdf");
  const [busyKind, setBusyKind] = useState<EmployeeDocumentKind | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [removing, setRemoving] = useState<EmployeeDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createUpload = useMutation(trpc.employee.createDocumentUpload.mutationOptions());
  const addDocument = useMutation(
    trpc.employee.addDocument.mutationOptions({
      onSuccess: async () => {
        setAdding(false);
        setNewName("");
        await invalidateEmployeeQueries(queryClient, trpc);
      },
      onError: (cause) => setError(cause.message),
      onSettled: () => setBusyKind(null),
    }),
  );
  const removeDocument = useMutation(
    trpc.employee.removeDocument.mutationOptions({
      onSuccess: async () => {
        setRemoving(null);
        await invalidateEmployeeQueries(queryClient, trpc);
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  const upload = useFileUpload({
    onChange: (url) => {
      const into = target.current;
      if (url === null || into === null) return;
      addDocument.mutate({
        employeeId: employee.id,
        kind: into.kind,
        name: into.name,
        url,
        contentType: pendingType.current,
      });
    },
    onRequestUpload: (file) => {
      // `useFileUpload` has already refused anything outside the list.
      const contentType = file.type as (typeof UPLOAD_CONTENT_TYPES)[number];
      pendingType.current = contentType;
      return createUpload.mutateAsync({
        employeeId: employee.id,
        filename: file.name,
        contentType,
        size: file.size,
      });
    },
    contentTypes: UPLOAD_CONTENT_TYPES,
    maxBytes: UPLOAD_MAX_BYTES,
    strings: { failed: t("failed"), tooLarge: t("tooLarge"), wrongType: t("wrongType") },
  });

  const pick = (into: Target) => {
    setError(null);
    upload.reset();
    target.current = into;
    fileRef.current?.click();
  };

  const slots = documentSlots(employee.employmentType, employee.documents);
  const others = employee.documents.filter((doc) => doc.kind === "OTHER");
  const filed = slots.filter((slot) => slot.document !== undefined).length;
  const working = upload.busy || addDocument.isPending;

  const label = (kind: EmployeeDocumentKind, doc?: EmployeeDocument) => {
    if (kind === "OTHER") return doc?.name ?? t("kinds.OTHER");
    if (kind === "CONTRACT" && employee.employmentType !== null) {
      return t("kinds.contractOf", { type: employee.employmentType });
    }
    return t(`kinds.${kind}`);
  };

  const filedMeta = (doc: EmployeeDocument) =>
    t("filedMeta", {
      type: doc.contentType === "application/pdf" ? t("pdf") : t("image"),
      date: formatDay(doc.createdAt),
    });

  const card = (kind: EmployeeDocumentKind, doc: EmployeeDocument | undefined) => {
    const uploading = working && busyKind === kind && (kind !== "OTHER" || doc === undefined);
    const name = label(kind, doc);
    if (doc === undefined) {
      return (
        <div key={kind} className={[styles.doc, styles.docMissing].filter(Boolean).join(" ")}>
          <span className={styles.docIcon}>
            <DocIcon path={UPLOAD_ICON} />
          </span>
          <span className={styles.docText}>
            <span className={styles.docName}>{name}</span>
            <span className={styles.docMeta}>{uploading ? t("uploading") : t("missing")}</span>
          </span>
          <span className={styles.docActions}>
            <button
              type="button"
              className={styles.docLink}
              disabled={working}
              onClick={() => {
                setBusyKind(kind);
                pick({ kind });
              }}
            >
              {t("upload")}
            </button>
          </span>
        </div>
      );
    }
    return (
      <div key={doc.id} className={styles.doc}>
        <span className={styles.docIcon}>
          <DocIcon path={FILE_ICON} />
        </span>
        <span className={styles.docText}>
          <span className={styles.docName}>
            <bdi>{name}</bdi>
          </span>
          <span className={styles.docMeta}>{uploading ? t("uploading") : filedMeta(doc)}</span>
        </span>
        <span className={styles.docActions}>
          <a
            className={styles.docLink}
            href={assetUrl(doc.url) ?? undefined}
            target="_blank"
            rel="noreferrer"
          >
            {t("open")}
          </a>
          {kind !== "OTHER" && (
            <button
              type="button"
              className={styles.docLink}
              disabled={working}
              onClick={() => {
                setBusyKind(kind);
                pick({ kind });
              }}
            >
              {t("replace")}
            </button>
          )}
          <button
            type="button"
            className={[styles.docLink, styles.docLinkQuiet].filter(Boolean).join(" ")}
            disabled={working}
            onClick={() => {
              setError(null);
              setRemoving(doc);
            }}
          >
            {t("remove")}
          </button>
        </span>
      </div>
    );
  };

  return (
    <section id={id} className={styles.panel} tabIndex={-1}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{t("title")}</h2>
        <span className={styles.panelMeta}>{t("count", { filed, total: slots.length })}</span>
        <Button
          size="dense"
          onClick={() => {
            setError(null);
            setAdding(true);
          }}
          disabled={adding || working}
        >
          {t("add")}
        </Button>
      </div>

      {(error ?? upload.error) && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {error ?? upload.error}
        </p>
      )}

      <div className={styles.docGrid}>
        {slots.map((slot) => card(slot.kind, slot.document))}
        {others.map((doc) => card("OTHER", doc))}

        {adding && (
          <div className={[styles.doc, styles.docNew].filter(Boolean).join(" ")}>
            <TextField
              label={t("newName")}
              placeholder={t("newPlaceholder")}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              size="dense"
              autoFocus
              disabled={working}
            />
            <span className={styles.docNewActions}>
              <Button
                size="dense"
                variant="primary"
                disabled={newName.trim() === ""}
                busy={working && busyKind === "OTHER"}
                onClick={() => {
                  setBusyKind("OTHER");
                  pick({ kind: "OTHER", name: newName.trim() });
                }}
              >
                {t("chooseFile")}
              </Button>
              <Button size="dense" variant="ghost" disabled={working} onClick={() => setAdding(false)}>
                {common("cancel")}
              </Button>
            </span>
          </div>
        )}
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
          else setBusyKind(null);
        }}
      />

      <Dialog
        open={removing !== null}
        title={t("removeTitle")}
        confirmLabel={t("remove")}
        destructive
        busy={removeDocument.isPending}
        onConfirm={() => removing && removeDocument.mutate({ id: removing.id })}
        onClose={() => !removeDocument.isPending && setRemoving(null)}
      >
        {removing &&
          t.rich("removeBody", {
            name: label(removing.kind, removing),
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
      </Dialog>
    </section>
  );
}
