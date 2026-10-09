-- Sort orders by the number in CMD-<n>, not by the text: as text CMD-99
-- sorts after CMD-746. Kept by a trigger rather than a generated column,
-- which Prisma reads as a default it cannot express (the CI schema check
-- fails) — the same choice as InkColour.stockLevel. Recomputed on every
-- insert and on every update touching numero or numeroSeq itself, so the
-- app never has to know it exists and a direct write to it is overwritten.
-- Null outside CMD-<n>; at most 9 digits, so the cast cannot overflow.
ALTER TABLE "Order" ADD COLUMN "numeroSeq" INTEGER;

CREATE FUNCTION order_numero_seq() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."numeroSeq" := CASE
    WHEN NEW."numero" ~ '^CMD-[0-9]{1,9}$' THEN substring(NEW."numero" FROM 5)::integer
  END;
  RETURN NEW;
END
$$;

CREATE TRIGGER order_numero_seq
  BEFORE INSERT OR UPDATE OF "numero", "numeroSeq" ON "Order"
  FOR EACH ROW EXECUTE FUNCTION order_numero_seq();

-- Existing rows: fire the trigger once.
UPDATE "Order" SET "numero" = "numero";

-- The sort key is (active, numeroSeq, id); the text one is no longer sorted on.
DROP INDEX "Order_active_numero_id_idx";
CREATE INDEX "Order_active_numeroSeq_id_idx" ON "Order"("active", "numeroSeq", "id");
