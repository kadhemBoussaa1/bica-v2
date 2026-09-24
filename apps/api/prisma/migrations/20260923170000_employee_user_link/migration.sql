-- Employee ↔ User link — docs/shift-planning-plan.md Phase 0.
--
-- The account an employee signs in with. Nullable (suspended people and
-- office staff have none), unique (one account is one person), and SET NULL
-- on delete so removing an account keeps the person on rosters and tickets.

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
