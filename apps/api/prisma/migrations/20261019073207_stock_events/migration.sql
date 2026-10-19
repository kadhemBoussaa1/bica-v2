-- CreateEnum
CREATE TYPE "StockEventType" AS ENUM ('MOVEMENT', 'SNAPSHOT');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'SHIPMENT', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'PRODUCTION_IN', 'PRODUCTION_OUT', 'COUNT');

-- CreateTable
CREATE TABLE "StockEvent" (
    "sequence" BIGINT NOT NULL,
    "eventId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "StockEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "movementType" "StockMovementType",
    "sku" TEXT,
    "paperType" "PaperType",
    "grammage" INTEGER,
    "laizeMm" INTEGER,
    "lotId" TEXT,
    "lotNumber" TEXT,
    "quantity" DOUBLE PRECISION,
    "metres" DOUBLE PRECISION,
    "unitCost" DOUBLE PRECISION,
    "resultingQuantity" DOUBLE PRECISION,
    "resultingValue" DOUBLE PRECISION,
    "sourceType" TEXT,
    "sourceNumber" TEXT,
    "payload" JSONB,
    "deliveredAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "StockEvent_pkey" PRIMARY KEY ("sequence")
);

-- CreateTable
CREATE TABLE "StockEventCounter" (
    "id" INTEGER NOT NULL,
    "last" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "StockEventCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockEvent_eventId_key" ON "StockEvent"("eventId");

-- CreateIndex
CREATE INDEX "StockEvent_sku_sequence_idx" ON "StockEvent"("sku", "sequence");

-- CreateIndex
CREATE INDEX "StockEvent_deliveredAt_sequence_idx" ON "StockEvent"("deliveredAt", "sequence");

-- CreateIndex
CREATE INDEX "StockEvent_occurredAt_idx" ON "StockEvent"("occurredAt");

-- ---------------------------------------------------------------------------
-- The paper stock's event log for BICA Expert — docs/erp-stock-api.md.
--
-- A reel is ON HAND when it was received and is neither used up nor
-- archived; its on-hand weight is then `poidsRestant`, rounded to the gram.
-- Every change to a reel's on-hand weight, SKU or unit cost writes one
-- MOVEMENT row from the trigger below, in the transaction that made it.
-- ---------------------------------------------------------------------------

-- The SKU BICA Expert joins its catalogue on: type, grammage and width
-- (user, 2026-10-19). Width is rounded to the millimetre, here and in every
-- grouping, so the SKU and the level it names can never disagree.
CREATE FUNCTION paper_stock_sku(t "PaperType", g integer, l double precision)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE t WHEN 'PAPIER_KRAFT' THEN 'KRAFT' WHEN 'PAPIER_BLANC' THEN 'BLANC' ELSE 'PAPIER' END
      || '-' || COALESCE(g::text, 'X') || 'G'
      || '-' || COALESCE(round(l)::bigint::text, 'X') || 'MM'
$$;

-- One MOVEMENT row. `r` is the reel as it is after the change (before it,
-- for the leg leaving an old SKU or a deleted reel).
--
-- The counter UPDATE takes the counter's row lock and holds it until
-- commit, so sequences are gap-free (a rollback undoes the increment) and
-- commit-ordered (the next writer waits). The level is summed AFTER the
-- lock, so it includes every earlier movement: `resulting*` is the SKU as
-- it stands right after this one, which is what lets BICA heal a lost event
-- from the next one on the same SKU.
--
-- The movement type comes from the transaction's context
-- (`setStockContext` in src/stock-api/stock-context.ts): `in` for a gain,
-- `out` for a loss, ADJUSTMENT when nothing said why.
CREATE FUNCTION paper_stock_emit(
  r "PaperRoll", v_sku text, v_kg numeric, v_m numeric, v_cost double precision
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  ctx jsonb := COALESCE(NULLIF(current_setting('bica.stock_context', true), '')::jsonb, '{}'::jsonb);
  v_seq bigint;
  v_qty numeric;
  v_value numeric;
BEGIN
  UPDATE "StockEventCounter" SET "last" = "last" + 1 WHERE "id" = 1 RETURNING "last" INTO v_seq;

  SELECT COALESCE(sum(round("poidsRestant"::numeric, 3)), 0),
         COALESCE(sum(round(round("poidsRestant"::numeric, 3) * COALESCE("price", 0)::numeric, 3)), 0)
    INTO v_qty, v_value
    FROM "PaperRoll"
   WHERE "receivedAt" IS NOT NULL AND NOT "consomme" AND NOT "archived"
     AND paper_stock_sku("paperType", "grammage", "laize") = v_sku;

  INSERT INTO "StockEvent" (
    "sequence", "type", "occurredAt", "movementType", "sku", "paperType", "grammage", "laizeMm",
    "lotId", "lotNumber", "quantity", "metres", "unitCost", "resultingQuantity", "resultingValue",
    "sourceType", "sourceNumber"
  ) VALUES (
    v_seq, 'MOVEMENT', clock_timestamp() AT TIME ZONE 'UTC',
    (CASE WHEN v_kg > 0 THEN COALESCE(ctx->>'in', 'ADJUSTMENT')
          WHEN v_kg < 0 THEN COALESCE(ctx->>'out', 'ADJUSTMENT')
          ELSE 'ADJUSTMENT' END)::"StockMovementType",
    v_sku, r."paperType", r."grammage", round(r."laize")::integer,
    r."id", r."numero", v_kg, v_m, v_cost, v_qty, v_value,
    ctx->>'sourceType', ctx->>'sourceNumber'
  );
END $$;

-- Decides whether a reel write moved stock, and emits the movement(s):
--   same SKU, weight changed      -> one movement of the difference;
--   same SKU, only the price      -> a revaluation, quantity 0;
--   insert, delete or SKU change  -> out of the old SKU, into the new.
-- Reservations move no stock and `UPDATE OF` keeps them from firing it.
CREATE FUNCTION paper_stock_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_kg numeric := 0;
  new_kg numeric := 0;
  old_m numeric := 0;
  new_m numeric := 0;
  old_sku text;
  new_sku text;
  old_cost double precision;
  new_cost double precision;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_sku := paper_stock_sku(OLD."paperType", OLD."grammage", OLD."laize");
    old_cost := COALESCE(OLD."price", 0);
    IF OLD."receivedAt" IS NOT NULL AND NOT OLD."consomme" AND NOT OLD."archived" THEN
      old_kg := round(OLD."poidsRestant"::numeric, 3);
      old_m := round(OLD."metrageRestant"::numeric, 3);
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_sku := paper_stock_sku(NEW."paperType", NEW."grammage", NEW."laize");
    new_cost := COALESCE(NEW."price", 0);
    IF NEW."receivedAt" IS NOT NULL AND NOT NEW."consomme" AND NOT NEW."archived" THEN
      new_kg := round(NEW."poidsRestant"::numeric, 3);
      new_m := round(NEW."metrageRestant"::numeric, 3);
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND old_sku = new_sku THEN
    IF new_kg <> old_kg THEN
      PERFORM paper_stock_emit(NEW, new_sku, new_kg - old_kg, new_m - old_m, new_cost);
    ELSIF new_kg <> 0 AND new_cost <> old_cost THEN
      PERFORM paper_stock_emit(NEW, new_sku, 0, 0, new_cost);
    END IF;
  ELSE
    IF old_kg <> 0 THEN
      PERFORM paper_stock_emit(OLD, old_sku, -old_kg, -old_m, old_cost);
    END IF;
    IF new_kg <> 0 THEN
      PERFORM paper_stock_emit(NEW, new_sku, new_kg, new_m, new_cost);
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- The opening balance: one ADJUSTMENT per reel on hand, `sourceType`
-- OPENING, so the log sums to the stock from its first row. Taken under a
-- lock that stops reel writes, and before the trigger exists, so nothing
-- lands between the balance and the first live movement.
LOCK TABLE "PaperRoll" IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO "StockEventCounter" ("id", "last") VALUES (1, 0);

INSERT INTO "StockEvent" (
  "sequence", "type", "occurredAt", "movementType", "sku", "paperType", "grammage", "laizeMm",
  "lotId", "lotNumber", "quantity", "metres", "unitCost", "resultingQuantity", "resultingValue",
  "sourceType"
)
SELECT row_number() OVER (ORDER BY sku, id), 'MOVEMENT', clock_timestamp() AT TIME ZONE 'UTC',
       'ADJUSTMENT', sku, "paperType", "grammage", round("laize")::integer, id, "numero",
       kg, m, COALESCE("price", 0),
       sum(kg) OVER (PARTITION BY sku ORDER BY id),
       sum(value) OVER (PARTITION BY sku ORDER BY id),
       'OPENING'
  FROM (
    SELECT r.*,
           paper_stock_sku(r."paperType", r."grammage", r."laize") AS sku,
           round(r."poidsRestant"::numeric, 3) AS kg,
           round(r."metrageRestant"::numeric, 3) AS m,
           round(round(r."poidsRestant"::numeric, 3) * COALESCE(r."price", 0)::numeric, 3) AS value
      FROM "PaperRoll" r
     WHERE r."receivedAt" IS NOT NULL AND NOT r."consomme" AND NOT r."archived"
  ) live
 WHERE kg <> 0;

UPDATE "StockEventCounter"
   SET "last" = (SELECT COALESCE(max("sequence"), 0) FROM "StockEvent")
 WHERE "id" = 1;

CREATE TRIGGER paper_stock_event
  AFTER INSERT OR DELETE
     OR UPDATE OF "poidsRestant", "metrageRestant", "consomme", "archived", "receivedAt",
                  "price", "paperType", "grammage", "laize"
  ON "PaperRoll"
  FOR EACH ROW EXECUTE FUNCTION paper_stock_event();
