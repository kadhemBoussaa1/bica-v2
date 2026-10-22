"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@repo/ui/toast";
import records from "../../records/records.module.css";
import { useTRPC } from "../../trpc/client";
import { MaterialDetailDialog } from "./material-detail-dialog";
import { MaterialFormDialog } from "./material-form-dialog";
import { MaterialPriceDialog } from "./material-price-dialog";

/** Which dialog is up. One at a time: each hands over to the next. */
type Open =
  | { kind: "detail"; id: string }
  | { kind: "edit"; id: string }
  | { kind: "price"; id: string }
  | { kind: "create" }
  | null;

interface MaterialsContextValue {
  /** The material whose dialog is up, for the table's selected row. */
  openId: string | null;
  open: (id: string) => void;
  create: () => void;
}

const MaterialsContext = createContext<MaterialsContextValue | null>(null);

export function useMaterials(): MaterialsContextValue {
  const value = useContext(MaterialsContext);
  if (!value) throw new Error("useMaterials outside MaterialsProvider");
  return value;
}

/**
 * The catalogue page's dialogs, and the one piece of state the header's
 * "New material" button and the table share. A provider rather than state
 * in the table because the button sits in the server-rendered header.
 *
 * `initialId` is `?material=` — how an activity row links to a material,
 * which has no page of its own. Read once, like `?search=` elsewhere.
 */
export function MaterialsProvider({
  initialId,
  children,
}: {
  initialId: string | null;
  children: ReactNode;
}) {
  const t = useTranslations("materials");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [dialog, setDialog] = useState<Open>(initialId ? { kind: "detail", id: initialId } : null);

  const id = dialog && dialog.kind !== "create" ? dialog.id : null;
  // The detail, the edit form and the price dialog all read the same
  // material, so handing over between them never refetches.
  const materialQuery = useQuery({
    ...trpc.material.byId.queryOptions({ id: id ?? "" }),
    enabled: id !== null,
  });

  // Un-narrowed list key: every page, sort and filter of the list. The
  // order form's prefill goes too, so a price set here shows there at once.
  const invalidate = (materialId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.material.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.material.forOrderForm.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.settings.summary.queryKey() }),
      ...(materialId
        ? [queryClient.invalidateQueries({ queryKey: trpc.material.byId.queryKey({ id: materialId }) })]
        : []),
    ]);

  const value: MaterialsContextValue = {
    openId: id,
    open: (materialId) => setDialog({ kind: "detail", id: materialId }),
    create: () => setDialog({ kind: "create" }),
  };

  const material = materialQuery.data;
  const close = () => setDialog(null);
  const backToDetail = () => id && setDialog({ kind: "detail", id });

  return (
    <MaterialsContext.Provider value={value}>
      {children}

      {dialog?.kind === "create" && (
        <MaterialFormDialog
          onClose={close}
          onDone={async (createdId) => {
            await invalidate();
            push({ title: t("toast.created"), tone: "success" });
            setDialog({ kind: "detail", id: createdId });
          }}
        />
      )}

      {/* A stale `?material=` (a mistyped id) opens no dialog; the
          server's refusal shows under the list instead. */}
      {id && materialQuery.isError && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {materialQuery.error.message}
        </p>
      )}

      {dialog?.kind === "detail" && material && (
        <MaterialDetailDialog
          material={material}
          onClose={close}
          onEdit={() => setDialog({ kind: "edit", id: material.id })}
          onNewPrice={() => setDialog({ kind: "price", id: material.id })}
          onChanged={async (active) => {
            await invalidate(material.id);
            push({ title: active ? t("toast.restored") : t("toast.archived"), tone: "success" });
          }}
        />
      )}

      {dialog?.kind === "edit" && material && (
        <MaterialFormDialog
          material={material}
          onClose={backToDetail}
          onDone={async () => {
            await invalidate(material.id);
            push({ title: t("toast.updated"), tone: "success" });
            backToDetail();
          }}
        />
      )}

      {dialog?.kind === "price" && material && (
        <MaterialPriceDialog
          material={material}
          onClose={backToDetail}
          onDone={async () => {
            await invalidate(material.id);
            push({ title: t("toast.priced"), tone: "success" });
            backToDetail();
          }}
        />
      )}
    </MaterialsContext.Provider>
  );
}
