-- The bell's "seen" stamp (docs/notifications-plan.md decision 18): the
-- badge counts unread rows newer than it, opening the bell advances it.
-- No backfill: an account without a row counts every unread row, as before.

-- CreateTable
CREATE TABLE "NotificationSeen" (
    "userId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSeen_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "NotificationSeen" ADD CONSTRAINT "NotificationSeen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
