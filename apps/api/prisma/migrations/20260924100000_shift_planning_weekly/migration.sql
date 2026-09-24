-- Shift planning v2: one shift per person per WEEK — docs/shift-planning-plan.md §2.
--
-- v1 placed people on each of the 18 day-shifts. The user re-cut the approach
-- on 2026-09-24: a person is on one shift type for the whole week, the days it
-- covers are derived from the type, tickets are one person one day, and the
-- machine on a ticket is optional.
--
-- ShiftAssignment becomes (week, employee, type); ShiftChange records
-- fromType/toType instead of two day-shifts; ShiftTask names its one person
-- and makes the machine nullable; ShiftTaskAssignee goes.
--
-- The three reshaped tables are emptied first: the new NOT NULL columns have
-- no meaning for the v1 rows, and everything in them was test data from the
-- v1 verification (docs/shift-planning-plan.md §11). Weeks and their 18
-- generated day-shifts are kept as they are.
--
-- Prisma's own DDL (`migrate diff`), after the three DELETEs.

DELETE FROM "ShiftTask";
DELETE FROM "ShiftChange";
DELETE FROM "ShiftAssignment";

-- DropForeignKey
ALTER TABLE "ShiftAssignment" DROP CONSTRAINT "ShiftAssignment_shiftId_date_fkey";

-- DropForeignKey
ALTER TABLE "ShiftChange" DROP CONSTRAINT "ShiftChange_fromShiftId_fkey";

-- DropForeignKey
ALTER TABLE "ShiftChange" DROP CONSTRAINT "ShiftChange_toShiftId_fkey";

-- DropForeignKey
ALTER TABLE "ShiftTask" DROP CONSTRAINT "ShiftTask_machineId_fkey";

-- DropForeignKey
ALTER TABLE "ShiftTaskAssignee" DROP CONSTRAINT "ShiftTaskAssignee_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "ShiftTaskAssignee" DROP CONSTRAINT "ShiftTaskAssignee_taskId_fkey";

-- DropIndex
DROP INDEX "Shift_id_date_key";

-- DropIndex
DROP INDEX "ShiftAssignment_employeeId_date_key";

-- DropIndex
DROP INDEX "ShiftAssignment_shiftId_employeeId_idx";

-- DropIndex
DROP INDEX "ShiftChange_fromShiftId_idx";

-- DropIndex
DROP INDEX "ShiftChange_toShiftId_idx";

-- DropIndex
DROP INDEX "ShiftTask_shiftId_status_id_idx";

-- AlterTable
ALTER TABLE "ShiftAssignment" DROP COLUMN "date",
DROP COLUMN "shiftId",
ADD COLUMN     "type" "ShiftType" NOT NULL,
ADD COLUMN     "weekId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ShiftChange" DROP COLUMN "fromShiftId",
DROP COLUMN "toShiftId",
ADD COLUMN     "fromType" "ShiftType",
ADD COLUMN     "toType" "ShiftType";

-- AlterTable
ALTER TABLE "ShiftTask" ADD COLUMN     "employeeId" TEXT NOT NULL,
ALTER COLUMN "machineId" DROP NOT NULL;

-- DropTable
DROP TABLE "ShiftTaskAssignee";

-- CreateIndex
CREATE INDEX "ShiftAssignment_weekId_type_idx" ON "ShiftAssignment"("weekId", "type");

-- CreateIndex
CREATE INDEX "ShiftAssignment_employeeId_idx" ON "ShiftAssignment"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftAssignment_weekId_employeeId_key" ON "ShiftAssignment"("weekId", "employeeId");

-- CreateIndex
CREATE INDEX "ShiftTask_shiftId_employeeId_id_idx" ON "ShiftTask"("shiftId", "employeeId", "id");

-- CreateIndex
CREATE INDEX "ShiftTask_employeeId_status_idx" ON "ShiftTask"("employeeId", "status");

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "ShiftWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTask" ADD CONSTRAINT "ShiftTask_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTask" ADD CONSTRAINT "ShiftTask_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

