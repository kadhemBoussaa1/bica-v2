"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { setRawMaterialPriceInput } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/field";
import { FormDialog } from "@repo/ui/form-dialog";
import { formatDay } from "../../../i18n/formats";
import { decimal } from "../../records/decimal";
import records from "../../records/records.module.css";
import { useTRPC } from "../../trpc/client";
import { errorCode, formatPrice, usePriceUnit, type MaterialDetail } from "./material-ui";
import styles from "./materials.module.css";

/**
 * A new price for a material. It names the price it was opened on: if
 * another admin changed it meanwhile, the server refuses (CONFLICT), and
 * the dialog reloads the material so the price it shows is the real one —
 * the user then decides again, rather than replacing a price they never saw.
 */
export function MaterialPriceDialog({
  material,
  onClose,
  onDone,
}: {
  material: MaterialDetail;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const t = useTranslations("materials");
  const common = useTranslations("common");
  const unit = usePriceUnit();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [price, setPrice] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const current = material.currentPrice;

  const setPriceMutation = useMutation(
    trpc.material.setPrice.mutationOptions({
      onSuccess: () => onDone(),
      onError: async (cause) => {
        if (errorCode(cause) !== "CONFLICT") {
          setError(cause.message);
          return;
        }
        const fresh = await queryClient.fetchQuery(
          trpc.material.byId.queryOptions({ id: material.id }, { staleTime: 0 }),
        );
        setError(
          t("price.conflict", {
            price: fresh.currentPrice ? formatPrice(fresh.currentPrice.price) : "—",
          }),
        );
      },
    }),
  );
  const busy = setPriceMutation.isPending;

  const box = material.type === "BOX";
  const fieldLabel = box ? t("price.newPriceBox") : t("price.newPrice");

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!current) return;
    if (price.trim() === "") {
      setError(box ? t("form.priceRequiredBox") : t("form.priceRequired"));
      return;
    }
    const amount = decimal(price);
    if (Number.isNaN(amount)) {
      setError(t("form.mustBeNumber", { label: fieldLabel }));
      return;
    }
    if (amount === current.price) {
      setError(t("price.unchanged"));
      return;
    }
    const parsed = setRawMaterialPriceInput.safeParse({
      materialId: material.id,
      currentPriceId: current.id,
      price: amount,
      comment,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    setPriceMutation.mutate(parsed.data);
  }

  return (
    <FormDialog eyebrow={material.label} title={t("price.title")} onClose={() => !busy && onClose()}>
      <form className={styles.dialogBody} onSubmit={submit} noValidate>
        {error && (
          <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
            {error}
          </p>
        )}

        {current && (
          <div className={styles.current}>
            <span className={styles.currentText}>
              <span className={styles.factLabel}>{t("price.current")}</span>
              <span className={styles.currentFigure}>
                {formatPrice(current.price)}
                <span className={styles.priceUnit}>{unit(material.type)}</span>
              </span>
              <span className={styles.since}>
                {t("price.since", { date: formatDay(current.validFrom) })}
              </span>
            </span>
          </div>
        )}

        <div className={styles.twoUp}>
          <TextField
            label={fieldLabel}
            unit={unit(material.type)}
            format="numeric"
            inputMode="decimal"
            placeholder={current ? formatPrice(current.price) : "0,00"}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            autoComplete="off"
            autoFocus
            disabled={busy}
          />
          <TextField
            label={t("form.comment")}
            placeholder={t("form.commentPlaceholder")}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </div>

        <p className={styles.note}>{t("price.note")}</p>

        <div className={records.formActions}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {common("cancel")}
          </Button>
          <Button variant="primary" type="submit" busy={busy} disabled={!current}>
            {t("price.save")}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
