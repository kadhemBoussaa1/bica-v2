-- CreateTable
CREATE TABLE "ChatRead" (
    "userId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatRead_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "ChatRead" ADD CONSTRAINT "ChatRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
