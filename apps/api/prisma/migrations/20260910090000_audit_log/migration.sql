-- Activity trace (audit log) — docs/audit-log-plan.md Step 1.
--
-- Prisma's own DDL (`migrate diff`), purely additive: two enums, the AuditLog
-- table (the schema's first JSONB column), its filter/sort indexes and the
-- SetNull foreign key back to User. Nothing is backfilled: history before this
-- migration was never recorded.

-- CreateEnum
CREATE TYPE "AuditKind" AS ENUM ('QUERY', 'MUTATION', 'AUTH');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('OK', 'ERROR');

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "actorName" TEXT,
    "actorRole" "Role",
    "impersonatedById" TEXT,
    "kind" "AuditKind" NOT NULL,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entityId" TEXT,
    "entityLabel" TEXT,
    "relatedId" TEXT,
    "input" JSONB,
    "outcome" "AuditOutcome" NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "durationMs" INTEGER NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_at_id_idx" ON "AuditLog"("at" DESC, "id");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_at_id_idx" ON "AuditLog"("actorId", "at", "id");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_at_id_idx" ON "AuditLog"("entityId", "at", "id");

-- CreateIndex
CREATE INDEX "AuditLog_relatedId_at_id_idx" ON "AuditLog"("relatedId", "at", "id");

-- CreateIndex
CREATE INDEX "AuditLog_module_at_id_idx" ON "AuditLog"("module", "at", "id");

-- CreateIndex
CREATE INDEX "AuditLog_kind_at_id_idx" ON "AuditLog"("kind", "at", "id");

-- CreateIndex
CREATE INDEX "AuditLog_outcome_at_id_idx" ON "AuditLog"("outcome", "at", "id");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

