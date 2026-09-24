-- Shift planning and daily tickets — docs/shift-planning-plan.md §2.
--
-- Six tables: a week of 18 fixed shifts, the people on each shift, the
-- changes made to a published week (an admin's moves and a worker's
-- requests, one row each), the tickets on a shift and who they are for.
--
-- Two things Prisma's DDL cannot say are worth reading here:
--
-- ShiftAssignment's foreign key is on (shiftId, date) TOGETHER, against a
-- redundant unique on Shift(id, date). The assignment carries a copy of its
-- shift's date so "one employee, one shift per date" is a plain unique, and
-- the compound key is what stops that copy from ever disagreeing with the
-- shift: a move must write both columns in one statement or Postgres refuses
-- it.
--
-- ShiftChange_one_pending (hand-written at the end) is a partial unique: at
-- most one PENDING request per assignment. A worker who already has a
-- request open on a shift gets a CONFLICT rather than a second row; an
-- accepted, rejected or withdrawn request frees the slot.
--
-- Every User link is SET NULL, the ProductionRun.recordedBy convention:
-- user.remove hard-deletes and maps every foreign-key refusal to the
-- stocktake message, so a required requestedById would block deleting any
-- worker who ever filed a request. The employee row is the durable identity.
--
-- Prisma's own DDL (`migrate diff`), followed by one hand-written index.

-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('NIGHT', 'MORNING', 'AFTERNOON');

-- CreateEnum
CREATE TYPE "ShiftWeekStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ShiftChangeKind" AS ENUM ('MOVE', 'SWAP', 'REPLACE', 'REMOVE', 'ADD');

-- CreateEnum
CREATE TYPE "ShiftChangeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ShiftTaskType" AS ENUM ('SETTING', 'PRODUCTION', 'PRINTING', 'CLEANING');

-- CreateEnum
CREATE TYPE "ShiftTaskStatus" AS ENUM ('OPEN', 'DONE');

-- CreateTable
CREATE TABLE "ShiftWeek" (
    "id" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "status" "ShiftWeekStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "ShiftType" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftChange" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "kind" "ShiftChangeKind" NOT NULL,
    "status" "ShiftChangeStatus" NOT NULL DEFAULT 'PENDING',
    "employeeId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "fromShiftId" TEXT,
    "toShiftId" TEXT,
    "counterpartEmployeeId" TEXT,
    "reason" TEXT,
    "decisionReason" TEXT,
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftTask" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "type" "ShiftTaskType" NOT NULL,
    "machineId" TEXT NOT NULL,
    "orderId" TEXT,
    "note" TEXT,
    "status" "ShiftTaskStatus" NOT NULL DEFAULT 'OPEN',
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftTaskAssignee" (
    "taskId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,

    CONSTRAINT "ShiftTaskAssignee_pkey" PRIMARY KEY ("taskId","employeeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftWeek_weekStart_key" ON "ShiftWeek"("weekStart");

-- CreateIndex
CREATE INDEX "ShiftWeek_status_weekStart_idx" ON "ShiftWeek"("status", "weekStart");

-- CreateIndex
CREATE INDEX "ShiftWeek_publishedById_idx" ON "ShiftWeek"("publishedById");

-- CreateIndex
CREATE INDEX "Shift_weekId_startsAt_idx" ON "Shift"("weekId", "startsAt");

-- CreateIndex
CREATE INDEX "Shift_startsAt_endsAt_idx" ON "Shift"("startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_date_type_key" ON "Shift"("date", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_id_date_key" ON "Shift"("id", "date");

-- CreateIndex
CREATE INDEX "ShiftAssignment_shiftId_employeeId_idx" ON "ShiftAssignment"("shiftId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftAssignment_employeeId_date_key" ON "ShiftAssignment"("employeeId", "date");

-- CreateIndex
CREATE INDEX "ShiftChange_status_createdAt_id_idx" ON "ShiftChange"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ShiftChange_weekId_createdAt_id_idx" ON "ShiftChange"("weekId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ShiftChange_decidedAt_id_idx" ON "ShiftChange"("decidedAt", "id");

-- CreateIndex
CREATE INDEX "ShiftChange_employeeId_idx" ON "ShiftChange"("employeeId");

-- CreateIndex
CREATE INDEX "ShiftChange_assignmentId_idx" ON "ShiftChange"("assignmentId");

-- CreateIndex
CREATE INDEX "ShiftChange_fromShiftId_idx" ON "ShiftChange"("fromShiftId");

-- CreateIndex
CREATE INDEX "ShiftChange_toShiftId_idx" ON "ShiftChange"("toShiftId");

-- CreateIndex
CREATE INDEX "ShiftChange_counterpartEmployeeId_idx" ON "ShiftChange"("counterpartEmployeeId");

-- CreateIndex
CREATE INDEX "ShiftChange_requestedById_idx" ON "ShiftChange"("requestedById");

-- CreateIndex
CREATE INDEX "ShiftChange_decidedById_idx" ON "ShiftChange"("decidedById");

-- CreateIndex
CREATE INDEX "ShiftTask_shiftId_status_id_idx" ON "ShiftTask"("shiftId", "status", "id");

-- CreateIndex
CREATE INDEX "ShiftTask_machineId_idx" ON "ShiftTask"("machineId");

-- CreateIndex
CREATE INDEX "ShiftTask_orderId_idx" ON "ShiftTask"("orderId");

-- CreateIndex
CREATE INDEX "ShiftTask_doneById_idx" ON "ShiftTask"("doneById");

-- CreateIndex
CREATE INDEX "ShiftTask_createdById_idx" ON "ShiftTask"("createdById");

-- CreateIndex
CREATE INDEX "ShiftTaskAssignee_employeeId_idx" ON "ShiftTaskAssignee"("employeeId");

-- AddForeignKey
ALTER TABLE "ShiftWeek" ADD CONSTRAINT "ShiftWeek_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "ShiftWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_shiftId_date_fkey" FOREIGN KEY ("shiftId", "date") REFERENCES "Shift"("id", "date") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChange" ADD CONSTRAINT "ShiftChange_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "ShiftWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChange" ADD CONSTRAINT "ShiftChange_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChange" ADD CONSTRAINT "ShiftChange_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ShiftAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChange" ADD CONSTRAINT "ShiftChange_fromShiftId_fkey" FOREIGN KEY ("fromShiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChange" ADD CONSTRAINT "ShiftChange_toShiftId_fkey" FOREIGN KEY ("toShiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChange" ADD CONSTRAINT "ShiftChange_counterpartEmployeeId_fkey" FOREIGN KEY ("counterpartEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChange" ADD CONSTRAINT "ShiftChange_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChange" ADD CONSTRAINT "ShiftChange_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTask" ADD CONSTRAINT "ShiftTask_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTask" ADD CONSTRAINT "ShiftTask_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTask" ADD CONSTRAINT "ShiftTask_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTask" ADD CONSTRAINT "ShiftTask_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTask" ADD CONSTRAINT "ShiftTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTaskAssignee" ADD CONSTRAINT "ShiftTaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ShiftTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTaskAssignee" ADD CONSTRAINT "ShiftTaskAssignee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One pending request per assignment. Prisma cannot express a partial
-- unique, so it is hand-written here — precedent StockCount_one_open.
CREATE UNIQUE INDEX "ShiftChange_one_pending" ON "ShiftChange" ("assignmentId")
  WHERE "status" = 'PENDING';
