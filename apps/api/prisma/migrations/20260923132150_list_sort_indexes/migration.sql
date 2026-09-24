-- Index-only: (col, id) indexes matching every list sort key (leading with
-- active/archived where the sort does), plain indexes on unindexed foreign
-- keys, and User.role widened to (role, id). Drops PaperRoll
-- (disponible, paperGrade, id): the stock list leads with archived, not
-- disponible, so nothing used it. No column or constraint changes.

-- DropIndex
DROP INDEX "PaperRoll_disponible_paperGrade_id_idx";

-- DropIndex
DROP INDEX "User_role_idx";

-- CreateIndex
CREATE INDEX "AuditLog_action_id_idx" ON "AuditLog"("action", "id");

-- CreateIndex
CREATE INDEX "AuditLog_actorName_id_idx" ON "AuditLog"("actorName", "id");

-- CreateIndex
CREATE INDEX "AuditLog_durationMs_id_idx" ON "AuditLog"("durationMs", "id");

-- CreateIndex
CREATE INDEX "ChatMessage_authorId_idx" ON "ChatMessage"("authorId");

-- CreateIndex
CREATE INDEX "ChatMessage_pinnedById_idx" ON "ChatMessage"("pinnedById");

-- CreateIndex
CREATE INDEX "Client_active_registeredAt_id_idx" ON "Client"("active", "registeredAt", "id");

-- CreateIndex
CREATE INDEX "Client_active_createdAt_id_idx" ON "Client"("active", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Machine_supplierId_idx" ON "Machine"("supplierId");

-- CreateIndex
CREATE INDEX "Order_active_createdAt_id_idx" ON "Order"("active", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Order_active_quantite_id_idx" ON "Order"("active", "quantite", "id");

-- CreateIndex
CREATE INDEX "Order_active_orderTotal_id_idx" ON "Order"("active", "orderTotal", "id");

-- CreateIndex
CREATE INDEX "Order_acceptedById_idx" ON "Order"("acceptedById");

-- CreateIndex
CREATE INDEX "OrderStatusChange_byUserId_idx" ON "OrderStatusChange"("byUserId");

-- CreateIndex
CREATE INDEX "PaperRoll_archived_paperGrade_id_idx" ON "PaperRoll"("archived", "paperGrade", "id");

-- CreateIndex
CREATE INDEX "PaperRoll_archived_createdAt_id_idx" ON "PaperRoll"("archived", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PaperRoll_archived_poidsRestant_id_idx" ON "PaperRoll"("archived", "poidsRestant", "id");

-- CreateIndex
CREATE INDEX "PaperRoll_archived_metrageRestant_id_idx" ON "PaperRoll"("archived", "metrageRestant", "id");

-- CreateIndex
CREATE INDEX "PaperRoll_archived_grammage_id_idx" ON "PaperRoll"("archived", "grammage", "id");

-- CreateIndex
CREATE INDEX "PaperRoll_archived_laize_id_idx" ON "PaperRoll"("archived", "laize", "id");

-- CreateIndex
CREATE INDEX "ProductionRun_quantite_id_idx" ON "ProductionRun"("quantite", "id");

-- CreateIndex
CREATE INDEX "ProductionRun_stage_id_idx" ON "ProductionRun"("stage", "id");

-- CreateIndex
CREATE INDEX "Supplier_active_vatRate_id_idx" ON "Supplier"("active", "vatRate", "id");

-- CreateIndex
CREATE INDEX "Supplier_active_createdAt_id_idx" ON "Supplier"("active", "createdAt", "id");

-- CreateIndex
CREATE INDEX "User_role_id_idx" ON "User"("role", "id");

-- CreateIndex
CREATE INDEX "User_createdById_idx" ON "User"("createdById");
