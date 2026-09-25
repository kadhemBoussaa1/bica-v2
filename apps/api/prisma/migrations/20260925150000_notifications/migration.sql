-- In-app notifications — docs/notifications-plan.md §2.
--
-- One row per recipient, written in the same transaction as the order,
-- week or ticket change it reports ("store first, push second"); the SSE
-- stream only says a row exists. Additive: a new enum and a new table, no
-- change to any existing column, so the previous API image runs against it.
-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('ORDER_CREATED', 'QUOTE_CREATED', 'ORDER_IN_PRODUCTION', 'SHIFT_WEEK_PUBLISHED', 'TASK_ASSIGNED', 'TASK_REASSIGNED_AWAY', 'TASK_REOPENED', 'TASK_DONE');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "entityId" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "actorId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_id_idx" ON "Notification"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_id_idx" ON "Notification"("userId", "readAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_actorId_idx" ON "Notification"("actorId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

