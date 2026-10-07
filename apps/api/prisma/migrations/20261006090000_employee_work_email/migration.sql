-- Employees: the work mailbox (the old app's `email_professionnel`), which the
-- "action à réaliser" email goes to — docs/email-notifications-plan.md.
-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "workEmail" TEXT;

