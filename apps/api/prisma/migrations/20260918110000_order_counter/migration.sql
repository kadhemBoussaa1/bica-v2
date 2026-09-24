-- The `CMD-` sequence new orders allocate their `numero` from, replacing the
-- number typed by hand on the create form.
--
-- Seeded from the highest CONTIGUOUS legacy number rather than `max + 1`:
-- 396 orders match `^CMD-\d+$` and run up to CMD-645, plus a single CMD-6009
-- that is a typo (the next highest is 645). Seeding from 6010 would strand
-- ~5 400 numbers permanently, so the sequence continues at 646 and 6009 is
-- simply never re-issued -- it already exists, and `Order.numero` is UNIQUE,
-- so a collision would be refused rather than silently duplicated.
--
-- The seed is computed here, not hard-coded, so the migration is correct on
-- any database: the greatest CMD-<n> at or below the 1000 cutoff, plus one.
-- Falls back to 1 on an empty table (COALESCE).

CREATE TABLE "OrderCounter" (
    "id" TEXT NOT NULL,
    "next" INTEGER NOT NULL,
    CONSTRAINT "OrderCounter_pkey" PRIMARY KEY ("id")
);

INSERT INTO "OrderCounter" ("id", "next")
SELECT
  'CMD',
  COALESCE(
    MAX((regexp_replace("numero", '^CMD-', ''))::int) FILTER (
      WHERE (regexp_replace("numero", '^CMD-', ''))::int < 1000
    ),
    0
  ) + 1
FROM "Order"
WHERE "numero" ~ '^CMD-[0-9]+$';
