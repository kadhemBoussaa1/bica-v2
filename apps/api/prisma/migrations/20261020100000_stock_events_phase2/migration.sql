-- AlterTable
ALTER TABLE "StockEvent" ADD COLUMN "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "StockEvent_lotId_sequence_idx" ON "StockEvent"("lotId", "sequence");

-- CreateIndex
CREATE INDEX "StockEvent_sourceType_sourceNumber_idx" ON "StockEvent"("sourceType", "sourceNumber");

-- ---------------------------------------------------------------------------
-- Phase 2 of the stock API for BICA Expert — docs/erp-stock-api.md §9.
--
-- `occurredAt` becomes the moment the goods moved, which a writer may now
-- name in its stock context (sync-paper copies the old app's dates);
-- `recordedAt` is the moment the row was written, the order `sequence`
-- follows. Every row so far was written as it happened.
-- ---------------------------------------------------------------------------

UPDATE "StockEvent" SET "recordedAt" = "occurredAt";

-- As before, plus `occurredAt` from the context when it names one. It is
-- clamped: never after now; never before the log's first row, since the
-- opening balance already holds everything that happened earlier — a move
-- the old app made before go-live but that reaches here later lands at the
-- opening, where the balance it corrects begins; and never before the same
-- lot's last movement, so a lot's movements stay in order and no lot is
-- negative at any past instant — a piece the old app cut on no recorded
-- date and consumed on a known one is consumed no earlier than its cut.
CREATE OR REPLACE FUNCTION paper_stock_emit(
  r "PaperRoll", v_sku text, v_kg numeric, v_m numeric, v_cost double precision
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  ctx jsonb := COALESCE(NULLIF(current_setting('bica.stock_context', true), '')::jsonb, '{}'::jsonb);
  v_seq bigint;
  v_qty numeric;
  v_value numeric;
  v_now timestamp;
  v_at timestamp;
BEGIN
  UPDATE "StockEventCounter" SET "last" = "last" + 1 WHERE "id" = 1 RETURNING "last" INTO v_seq;

  v_now := clock_timestamp() AT TIME ZONE 'UTC';
  v_at := v_now;
  IF ctx->>'occurredAt' IS NOT NULL THEN
    v_at := LEAST(v_now, GREATEST(
      (ctx->>'occurredAt')::timestamptz AT TIME ZONE 'UTC',
      (SELECT min("occurredAt") FROM "StockEvent"),
      (SELECT max("occurredAt") FROM "StockEvent" WHERE "lotId" = r."id")
    ));
  END IF;

  SELECT COALESCE(sum(round("poidsRestant"::numeric, 3)), 0),
         COALESCE(sum(round(round("poidsRestant"::numeric, 3) * COALESCE("price", 0)::numeric, 3)), 0)
    INTO v_qty, v_value
    FROM "PaperRoll"
   WHERE "receivedAt" IS NOT NULL AND NOT "consomme" AND NOT "archived"
     AND paper_stock_sku("paperType", "grammage", "laize") = v_sku;

  INSERT INTO "StockEvent" (
    "sequence", "type", "occurredAt", "recordedAt", "movementType", "sku", "paperType", "grammage",
    "laizeMm", "lotId", "lotNumber", "quantity", "metres", "unitCost", "resultingQuantity",
    "resultingValue", "sourceType", "sourceNumber"
  ) VALUES (
    v_seq, 'MOVEMENT', v_at, v_now,
    (CASE WHEN v_kg > 0 THEN COALESCE(ctx->>'in', 'ADJUSTMENT')
          WHEN v_kg < 0 THEN COALESCE(ctx->>'out', 'ADJUSTMENT')
          ELSE 'ADJUSTMENT' END)::"StockMovementType",
    v_sku, r."paperType", r."grammage", round(r."laize")::integer,
    r."id", r."numero", v_kg, v_m, v_cost, v_qty, v_value,
    ctx->>'sourceType', ctx->>'sourceNumber'
  );
END $$;
