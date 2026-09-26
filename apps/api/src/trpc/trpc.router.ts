import { Injectable } from "@nestjs/common";
import { z } from "zod";
import {
  canAccess,
  canAccessAny,
  acceptQuoteInput,
  createShipmentFromOrderInput,
  createUploadInput,
  discardShipmentDraftInput,
  addEmployeeDocumentInput,
  employeeDocumentUploadInput,
  employeePhotoUploadInput,
  removeEmployeeDocumentInput,
  exportShipmentIdInput,
  shipShipmentInput,
  updateShipmentCustomsInput,
  updateShipmentDraftInput,
  createPurchaseInvoiceInput,
  createSalesInvoiceFromOrderInput,
  createSalesInvoiceInput,
  discardSalesInvoiceDraftInput,
  purchaseInvoiceIdInput,
  updatePurchaseInvoiceInput,
  createPurchaseOrderInput,
  updatePurchaseOrderInput,
  purchaseOrderIdInput,
  createGoodsReceiptInput,
  updateGoodsReceiptInput,
  goodsReceiptIdInput,
  issueSalesInvoiceInput,
  salesInvoiceIdInput,
  updateSalesInvoiceDraftInput,
  createDocumentTemplateInput,
  documentTemplateIdInput,
  publishDocumentTemplateInput,
  renameDocumentTemplateInput,
  saveDocumentTemplateVersionInput,
  createClientInput,
  createEmployeeInput,
  createMachineInput,
  createOrderInput,
  createProductInput,
  createProductionRunInput,
  createRollInput,
  createShipmentInput,
  createSupplierFamilyInput,
  createSupplierInput,
  createUserInput,
  linkEmployeeUserInput,
  partnerIdInput,
  productionRunIdInput,
  setPartnerActiveInput,
  similarPartnerNameInput,
  setSupplierFamilyActiveInput,
  supplierFamilyIdInput,
  setUserBannedInput,
  setUserRoleInput,
  transitionOrderInput,
  updateClientInput,
  updateEmployeeInput,
  updateMachineInput,
  updateOrderInput,
  updateProductInput,
  updateProductionRunInput,
  updateRollInput,
  rollIdInput,
  setRollArchivedInput,
  receiveRollInput,
  resolveScanInput,
  rollLabelsInput,
  updateShipmentInput,
  setShipmentActiveInput,
  setShipmentRollsInput,
  shipmentIdInput,
  setOrderColoursInput,
  updateSupplierFamilyInput,
  updateSupplierInput,
  userIdInput,
  adjustInkStockInput,
  createInkColourInput,
  inkColourIdInput,
  inkUsageForOrderInput,
  inkUsageIdInput,
  recordInkUsageInput,
  restockInkInput,
  setInkColourActiveInput,
  updateInkColourInput,
  updateInkUsageInput,
  allocationForOrderInput,
  allocationIdInput,
  consumeAllocationInput,
  cutAndReserveInput,
  cutRollInput,
  reserveRollInput,
  slitRollInput,
  openStockCountInput,
  countScanInput,
  stockCountIdInput,
  listStockCountsInput,
  varianceInput,
  chatFeedInput,
  chatSinceInput,
  markChatReadInput,
  chatUploadInput,
  postChatMessageInput,
  setChatPinnedInput,
  weekStartInput,
  weekIdInput,
  assignmentIdInput,
  changeIdInput,
  taskIdInput,
  copyWeekInput,
  assignWeekInput,
  moveDraftInput,
  dayInput,
  adminChangeInput,
  requestChangeInput,
  rejectChangeInput,
  listShiftChangesInput,
  createShiftTaskInput,
  updateShiftTaskInput,
  setTaskDoneInput,
  myWeekInput,
  listNotificationsInput,
  markNotificationsReadInput,
} from "@repo/api-contract";
import { candidatesInput } from "../allocation/allocation.list";
import { AllocationService } from "../allocation/allocation.service";
import { auditIdInput, listAuditInput } from "../audit/audit.list";
import { AuditService } from "../audit/audit.service";
import { ChatService } from "../chat/chat.service";
import { TemplateService } from "../template/template.service";
import { listClientsInput } from "../client/client.list";
import { ClientService } from "../client/client.service";
import { DashboardService } from "../dashboard/dashboard.service";
import { listEmployeesInput } from "../employee/employee.list";
import { EmployeeService } from "../employee/employee.service";
import {
  listPurchaseInvoicesInput,
  listSalesInvoicesInput,
} from "../invoice/invoice.list";
import { InvoiceService } from "../invoice/invoice.service";
import { listMachinesInput } from "../machine/machine.list";
import { MachineService } from "../machine/machine.service";
import { NotificationService } from "../notification/notification.service";
import { listOrdersInput } from "../order/order.list";
import { OrderService } from "../order/order.service";
import {
  listProductsInput,
  ordersForProductInput,
  productsForClientInput,
} from "../product/product.list";
import { ProductService } from "../product/product.service";
import {
  listProductionInput,
  productionDailyInput,
  productionMonthlyInput,
  productionForOrderInput,
} from "../production/production.list";
import { ProductionService } from "../production/production.service";
import {
  listGoodsReceiptsInput,
  listPurchaseOrdersInput,
} from "../purchasing/purchasing.list";
import { PurchasingService } from "../purchasing/purchasing.service";
import { listExportShipmentsInput } from "../shipment/shipment.list";
import { ShipmentService } from "../shipment/shipment.service";
import { ShiftService } from "../shift/shift.service";
import { StorageService } from "../storage/storage.service";
import {
  exportRollsInput,
  listRollsInput,
  listShipmentsInput,
  rollsForShipmentInput,
} from "../stock/stock.list";
import { StockService } from "../stock/stock.service";
import { listInkColoursInput } from "../ink/ink.list";
import { InkService } from "../ink/ink.service";
import { InventoryService } from "../inventory/inventory.service";
import { SupplierFamilyService } from "../supplier-family/supplier-family.service";
import { listSuppliersInput } from "../supplier/supplier.list";
import { SupplierService } from "../supplier/supplier.service";
import { listUsersInput } from "../user/user.list";
import { UserService } from "../user/user.service";
import {
  adminProcedure,
  superAdminProcedure,
  protectedProcedure,
  orderModuleProcedure,
  publicProcedure,
  router,
  shopFloorProcedure,
  warehouseProcedure,
} from "./trpc";

@Injectable()
export class TrpcRouter {
  constructor(
    private readonly userService: UserService,
    private readonly clientService: ClientService,
    private readonly supplierService: SupplierService,
    private readonly supplierFamilyService: SupplierFamilyService,
    private readonly machineService: MachineService,
    private readonly employeeService: EmployeeService,
    private readonly orderService: OrderService,
    private readonly productService: ProductService,
    private readonly stockService: StockService,
    private readonly productionService: ProductionService,
    private readonly invoiceService: InvoiceService,
    private readonly purchasingService: PurchasingService,
    private readonly shipmentService: ShipmentService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    private readonly inkService: InkService,
    private readonly allocationService: AllocationService,
    private readonly inventoryService: InventoryService,
    private readonly chatService: ChatService,
    private readonly templateService: TemplateService,
    private readonly shiftService: ShiftService,
    private readonly dashboardService: DashboardService,
    private readonly notificationService: NotificationService,
  ) {}

  readonly appRouter = router({
    health: publicProcedure.query(() => ({ status: "ok" as const })),

    /** The signed-in user, or null. Lets the client render by role. */
    me: publicProcedure.query(({ ctx }) => ctx.user),

    /**
     * The figures the sidebar shows beside a module's name. One request for
     * all of them, and each is null for a caller who cannot open that module
     * — the nav hides the row, so the count would be a leak with no reader.
     */
    nav: router({
      // Fires every minute per open tab and says nothing about intent: the
      // one protected procedure the activity trace skips.
      counts: protectedProcedure.meta({ audit: false }).query(async ({ ctx }) => {
        const commercial = canAccess(ctx.user.role, "ADMIN");
        const warehouse = canAccessAny(ctx.user.role, ["ADMIN", "MAGASINIER"]);
        // Rank-inclusive, like the nav row's `requires`: an ADMIN gets the
        // floor's figure too (0 unless linked to an employee). The warehouse
        // has its own "My shifts" row, so it gets the figure as well.
        const floor = canAccessAny(ctx.user.role, ["PRODUCTION", "MAGASINIER"]);
        const [clients, suppliers, orders, shipments, receiving, stocktake, shifts, myShifts] =
          await Promise.all([
            commercial ? this.clientService.count() : Promise.resolve(null),
            commercial ? this.supplierService.count() : Promise.resolve(null),
            this.orderService.count(ctx.user),
            // Drafts awaiting a truck, not a table size — the warehouse's to-do.
            warehouse ? this.shipmentService.count() : Promise.resolve(null),
            // Deliveries with reels still to scan in.
            warehouse ? this.stockService.receivingCount() : Promise.resolve(null),
            // 1 while a stocktake is open, 0 otherwise — at most one exists.
            warehouse ? this.inventoryService.openCount() : Promise.resolve(null),
            // Shift requests awaiting a decision — the planner's inbox.
            commercial ? this.shiftService.pendingChangeCount() : Promise.resolve(null),
            // My open tickets on the running or next shift.
            floor ? this.shiftService.openTaskCount(ctx.user) : Promise.resolve(null),
          ]);
        return {
          clients,
          suppliers,
          orders,
          shipments,
          receiving,
          stocktake,
          shifts,
          "my-shifts": myShifts,
        };
      }),
    }),

    /**
     * The settings rail's figures: accounts, trace errors, template drafts.
     * One call per settings page, refreshed on a timer like `nav.counts`,
     * and like it saying nothing about intent — so not audited; every page
     * inside the module still is. ADMIN and above, the module's own gate.
     */
    settings: router({
      summary: adminProcedure.meta({ audit: false }).query(async ({ ctx }) => {
        const [users, activity, templates] = await Promise.all([
          this.userService.summary(ctx.user),
          this.auditService.summary(),
          this.templateService.summary(),
        ]);
        return { users, activity, templates };
      }),
    }),

    /**
     * The super admin's home page — docs/dashboard-plan.md. One read for
     * every figure, polled every minute like `nav.counts` and
     * `settings.summary`, and like them saying nothing about intent — so
     * not audited. SUPER_ADMIN only: it is the plant's money and people on
     * one screen, and the gate still refuses ADMIN.
     */
    dashboard: router({
      summary: superAdminProcedure
        .meta({ audit: false })
        .query(({ ctx }) => this.dashboardService.summary(ctx.user)),
    }),

    /**
     * The shared plant-wide notice stream — docs/chat-plan.md §4.
     *
     * `protectedProcedure` throughout, with no rank gate anywhere except
     * pin/unpin: one room the whole plant reads and posts to, which is the
     * point. The shift that needs to hear a machine is down is the one locked
     * out of every other module.
     *
     * The four reads are the only block in this router where EVERY query
     * opts out of the activity trace, and that is not style. `auditMiddleware`
     * sits on `protectedProcedure` and writes one AuditLog row per call, so a
     * feed polled every 10s by ten open tabs is ~86k rows/day — enough to bury
     * the trace it would be written into. Same reasoning that exempts
     * `nav.counts` above, only louder. Both mutations stay audited: posting
     * and pinning are acts with intent.
     */
    chat: router({
      feed: protectedProcedure
        .meta({ audit: false })
        .input(chatFeedInput)
        .query(({ input }) => this.chatService.feed(input)),

      since: protectedProcedure
        .meta({ audit: false })
        .input(chatSinceInput)
        .query(({ input }) => this.chatService.since(input)),

      pinned: protectedProcedure
        .meta({ audit: false })
        .query(() => this.chatService.pinned()),

      unread: protectedProcedure
        .meta({ audit: false })
        .query(({ ctx }) => this.chatService.unreadCount(ctx.user)),

      /**
       * A read receipt, not an act with intent: unaudited like the reads,
       * or a feed left open would write a trace row on every poll.
       */
      markRead: protectedProcedure
        .meta({ audit: false })
        .input(markChatReadInput)
        .mutation(({ ctx, input }) => this.chatService.markRead(ctx.user, input)),

      post: protectedProcedure
        .input(postChatMessageInput)
        .mutation(({ ctx, input }) => this.chatService.post(ctx.user, input)),

      setPinned: adminProcedure
        .input(setChatPinnedInput)
        .mutation(({ ctx, input }) => this.chatService.setPinned(ctx.user, input)),

      /**
       * A presigned PUT for an attachment.
       *
       * The only upload procedure in this router with no record-level
       * assertion, because there is no record yet: the file is uploaded before
       * the notice exists. The session is the complete authorization question
       * — every signed-in role may post, so "may this caller attach a file?"
       * and "is this caller signed in?" have the same answer, and no narrower
       * right is being skipped. The real check is on the URL at `post`
       * (`ChatService.assertOwnAsset`).
       *
       * A mutation, not a query: it hands out a capability, and the audit row
       * belongs with the act of minting it.
       */
      createAttachmentUpload: protectedProcedure
        .input(chatUploadInput)
        .mutation(({ input }) => this.storageService.createUpload(input)),
    }),

    /**
     * The bell — docs/notifications-plan.md §4.3.
     *
     * `protectedProcedure` throughout: every role has a bell, and the
     * service scopes each call to the caller's own rows and to the kinds
     * their role may read now. All three are out of the activity trace, the
     * chat reasoning: the count is polled on every page, the list opens
     * with the bell, and marking read is a read receipt rather than an act
     * with intent — a mark-on-click would otherwise trace every click.
     *
     * The rows are written by the services that make the changes (orders,
     * shifts); the push is `GET /events` in main.ts, not a procedure.
     */
    notification: router({
      list: protectedProcedure
        .meta({ audit: false })
        .input(listNotificationsInput)
        .query(({ ctx, input }) => this.notificationService.list(ctx.user, input)),

      unreadCount: protectedProcedure
        .meta({ audit: false })
        .query(({ ctx }) => this.notificationService.unreadCount(ctx.user)),

      markRead: protectedProcedure
        .meta({ audit: false })
        .input(markNotificationsReadInput)
        .mutation(({ ctx, input }) => this.notificationService.markRead(ctx.user, input)),
    }),

    /**
     * Customers and suppliers are commercial reference data, ADMIN and above
     * throughout — reads included.
     *
     * These were `protectedProcedure` originally, on the reasoning that
     * production and warehouse staff read them daily. That policy is gone: a
     * PRODUCTION user now sees only the orders on the floor, the production
     * recorded against them and the product spec, and nothing commercial. The
     * client's name still reaches the shop floor where it belongs — inline on
     * the order row, through the order's own select — without opening the
     * customer list.
     */
    client: router({
      list: adminProcedure
        .input(listClientsInput)
        .query(({ input }) => this.clientService.list(input)),

      byId: adminProcedure
        .input(partnerIdInput)
        .query(({ input }) => this.clientService.byId(input.id)),

      /** The counters above the list; see `ClientService.stats`. */
      stats: adminProcedure.query(() => this.clientService.stats()),

      /** Live duplicate check for the name field on the client form. */
      similar: adminProcedure
        .input(similarPartnerNameInput)
        .query(({ input }) => this.clientService.similar(input)),

      create: adminProcedure
        .input(createClientInput)
        .mutation(({ input }) => this.clientService.create(input)),

      update: adminProcedure
        .input(updateClientInput)
        .mutation(({ input }) => this.clientService.update(input)),

      /** Archive / restore. There is no hard delete — see ClientService. */
      setActive: adminProcedure
        .input(setPartnerActiveInput)
        .mutation(({ input }) =>
          this.clientService.setActive(input.id, input.active),
        ),
    }),

    supplier: router({
      list: adminProcedure
        .input(listSuppliersInput)
        .query(({ input }) => this.supplierService.list(input)),

      byId: adminProcedure
        .input(partnerIdInput)
        .query(({ input }) => this.supplierService.byId(input.id)),

      /** The counters above the list; see `SupplierService.stats`. */
      stats: adminProcedure.query(() => this.supplierService.stats()),

      /** Live duplicate check for the name field on the supplier form. */
      similar: adminProcedure
        .input(similarPartnerNameInput)
        .query(({ input }) => this.supplierService.similar(input)),

      create: adminProcedure
        .input(createSupplierInput)
        .mutation(({ input }) => this.supplierService.create(input)),

      update: adminProcedure
        .input(updateSupplierInput)
        .mutation(({ input }) => this.supplierService.update(input)),

      setActive: adminProcedure
        .input(setPartnerActiveInput)
        .mutation(({ input }) =>
          this.supplierService.setActive(input.id, input.active),
        ),
    }),

    /**
     * Supplier families are a lookup table, not an enum, so a new purchasing
     * category is added here rather than by a schema migration and a deploy.
     *
     * `list` is a read like the supplier list itself: the form's picker and the
     * table's facet chips both need it. ADMIN and above throughout, with the
     * suppliers it categorises.
     */
    supplierFamily: router({
      list: adminProcedure
        .input(
          z.object({ includeInactive: z.boolean().default(false) }).optional(),
        )
        .query(({ input }) =>
          this.supplierFamilyService.list(input?.includeInactive ?? false),
        ),

      create: adminProcedure
        .input(createSupplierFamilyInput)
        .mutation(({ input }) => this.supplierFamilyService.create(input)),

      update: adminProcedure
        .input(updateSupplierFamilyInput)
        .mutation(({ input }) => this.supplierFamilyService.update(input)),

      setActive: adminProcedure
        .input(setSupplierFamilyActiveInput)
        .mutation(({ input }) =>
          this.supplierFamilyService.setActive(input.id, input.active),
        ),

      /** Refused while any supplier still references it — archive instead. */
      remove: adminProcedure
        .input(supplierFamilyIdInput)
        .mutation(({ input }) => this.supplierFamilyService.remove(input.id)),
    }),

    /**
     * Shop-floor equipment. Writes are ADMIN; `list` is `shopFloorProcedure`.
     *
     * `list` was locked to ADMIN in the RBAC pass, on the reasoning that
     * production runs no longer named a machine. They do again — PRINTING and
     * PRODUCER both record which machine ran the work — so the floor needs
     * this to populate its picker. That earlier note said to reopen it "if
     * machine selection ever returns"; it has.
     *
     * Below ADMIN the list returns `MACHINE_SELECT_FLOOR` (id, code, name,
     * type, active); price, invoice and supplier stay ADMIN-only. `byId`
     * stays ADMIN: the floor picks from a list, it does not open a machine's
     * full record.
     */
    machine: router({
      list: shopFloorProcedure
        .input(listMachinesInput)
        .query(({ ctx, input }) => this.machineService.list(ctx.user, input)),

      byId: adminProcedure
        .input(partnerIdInput)
        .query(({ input }) => this.machineService.byId(input.id)),

      create: adminProcedure
        .input(createMachineInput)
        .mutation(({ input }) => this.machineService.create(input)),

      update: adminProcedure
        .input(updateMachineInput)
        .mutation(({ input }) => this.machineService.update(input)),

      setActive: adminProcedure
        .input(setPartnerActiveInput)
        .mutation(({ input }) =>
          this.machineService.setActive(input.id, input.active),
        ),
    }),

    /**
     * Personnel, ADMIN and above throughout.
     *
     * These reads were open to any signed-in user, on the reasoning that work
     * is assigned to people and the floor needs the roster. Both halves of
     * that are now false: orders are no longer assigned to a worker, and a
     * production run is attributed to whoever records it through the session
     * rather than naming an employee — so the shop floor needs no roster and
     * no employee picker.
     *
     * `ctx.user` is still passed because the SERVICE decides which columns
     * come back: salary, CIN, social security number, date of birth and
     * address are selected only for ADMIN and above. That is now a
     * belt-and-braces check rather than the only one, since the procedure
     * gate already excludes everyone below ADMIN — leave it in place. Do not
     * "simplify" these to `({ input })`.
     */
    employee: router({
      list: adminProcedure
        .input(listEmployeesInput)
        .query(({ ctx, input }) => this.employeeService.list(ctx.user, input)),

      byId: adminProcedure
        .input(partnerIdInput)
        .query(({ ctx, input }) =>
          this.employeeService.byId(ctx.user, input.id),
        ),

      // The list header's figures and the service chips' values.
      summary: adminProcedure.query(() => this.employeeService.summary()),

      create: adminProcedure
        .input(createEmployeeInput)
        .mutation(({ input }) => this.employeeService.create(input)),

      update: adminProcedure
        .input(updateEmployeeInput)
        .mutation(({ input }) => this.employeeService.update(input)),

      setActive: adminProcedure
        .input(setPartnerActiveInput)
        .mutation(({ input }) =>
          this.employeeService.setActive(input.id, input.active),
        ),

      // The account this person signs in with, for shift planning. The
      // service checks the account's role and the caller's rank over it.
      linkUser: adminProcedure
        .input(linkEmployeeUserInput)
        .mutation(({ ctx, input }) =>
          this.employeeService.linkUser(ctx.user, input.id, input.userId),
        ),

      /**
       * A presigned PUT for a photo — docs/s3-assets-plan.md "Step 2". No
       * record-level check, like the chat's: the form uploads before a new
       * record exists, and the procedure gate is the whole question — anyone
       * who may save an employee may attach a photo to one. The URL only
       * reaches a row through `create`/`update`, which own the record rules.
       *
       * A mutation: it hands out a capability, and the audit row belongs
       * with the act of minting it.
       */
      createPhotoUpload: adminProcedure
        .input(employeePhotoUploadInput)
        .mutation(({ input }) => this.storageService.createUpload(input)),

      /**
       * The record's documents — Employees v3. Upload first (a presigned
       * PUT, refused for an unknown record), then file the returned URL,
       * which the service checks is on this app's bucket.
       */
      createDocumentUpload: adminProcedure
        .input(employeeDocumentUploadInput)
        .mutation(async ({ input }) => {
          await this.employeeService.assertDocumentUploadable(input.employeeId);
          return this.storageService.createUpload(input);
        }),

      addDocument: adminProcedure
        .input(addEmployeeDocumentInput)
        .mutation(({ input }) => this.employeeService.addDocument(input)),

      removeDocument: adminProcedure
        .input(removeEmployeeDocumentInput)
        .mutation(({ input }) => this.employeeService.removeDocument(input.id)),
    }),

    /**
     * Bag/sheet specifications ("products").
     *
     * `list`/`byId` are `shopFloorProcedure`: the spec — dimensions,
     * grammage, handle — is what the floor needs to actually run a job, and
     * the order detail page links straight to it. Unlike every other
     * reference module, this one stays readable below ADMIN.
     *
     * `forClient` does NOT: it is the order form's picker, and only ADMIN and
     * above create or edit orders. It is not paginated, like
     * `supplierFamily.list`, because it fills a `<select>` that needs the
     * whole list at once.
     */
    product: router({
      list: shopFloorProcedure
        .input(listProductsInput)
        .query(({ input }) => this.productService.list(input)),

      byId: shopFloorProcedure
        .input(partnerIdInput)
        .query(({ input }) => this.productService.byId(input.id)),

      /**
       * The orders placed for one product, narrowed to the caller's order
       * scope (PRODUCTION sees only IN_PRODUCTION) and priced for ADMIN+
       * only — see `ProductService.ordersForProduct`.
       */
      ordersForProduct: shopFloorProcedure
        .input(ordersForProductInput)
        .query(({ ctx, input }) => this.productService.ordersForProduct(ctx.user, input)),

      forClient: adminProcedure
        .input(productsForClientInput)
        .query(({ input }) => this.productService.forClient(input.clientId)),

      create: adminProcedure
        .input(createProductInput)
        .mutation(({ input }) => this.productService.create(input)),

      update: adminProcedure
        .input(updateProductInput)
        .mutation(({ input }) => this.productService.update(input)),

      setActive: adminProcedure
        .input(setPartnerActiveInput)
        .mutation(({ input }) =>
          this.productService.setActive(input.id, input.active),
        ),
    }),

    /**
     * Production orders — the hub of the system. Reads and the lifecycle
     * moves are `orderModuleProcedure` (ADMIN+; PRODUCTION row-scoped to the
     * orders on the floor by `orderScopeFor`; MAGASINIER sees every order but,
     * like PRODUCTION, without a money column, and moves only the export tail);
     * create, edit and the priced views are ADMIN.
     *
     * Pricing is computed live, server-side, on every create and update — see
     * `OrderService.priced`. There is no "recalculate" action because there is
     * nothing that goes stale between saves: the snapshot is always exactly
     * what the current product and inputs price to.
     */
    order: router({
      list: orderModuleProcedure
        .input(listOrdersInput)
        .query(({ ctx, input }) => this.orderService.list(ctx.user, input)),

      byId: orderModuleProcedure
        .input(partnerIdInput)
        .query(({ ctx, input }) => this.orderService.byId(ctx.user, input.id)),

      /** The orders open on the floor — the production page's picker. */
      onFloor: orderModuleProcedure.query(({ ctx }) =>
        this.orderService.onFloor(ctx.user),
      ),

      create: adminProcedure
        .input(createOrderInput)
        .mutation(({ ctx, input }) => this.orderService.create(ctx.user, input)),

      update: adminProcedure
        .input(updateOrderInput)
        .mutation(({ input }) => this.orderService.update(input)),

      setActive: adminProcedure
        .input(setPartnerActiveInput)
        .mutation(({ input }) =>
          this.orderService.setActive(input.id, input.active),
        ),

      /** Replaces the order's print colours wholesale. */
      setColours: adminProcedure
        .input(setOrderColoursInput)
        .mutation(({ input }) =>
          this.orderService.setColours(input.orderId, input.colours),
        ),

      /**
       * The two lifecycle mutations from docs/order-lifecycle-plan.md §3 and
       * §3.1. Deliberately NOT `adminProcedure`: the transition table's
       * "Who" column is not one fixed rank (two rows are "PRODUCTION" and
       * "MAGASINIER" specifically, siblings that must not reach each other's
       * transitions — see roles.ts), so the real per-transition check happens
       * once, in `OrderService.transition` against
       * `canTransition`/`findOrderTransition`, rather than being approximated
       * at the procedure boundary and re-derived in the service.
       *
       * `orderModuleProcedure` is therefore a coarse outer gate only — it
       * lets both rank-50 roles through to the table, which then allows each
       * exactly the one transition it owns. That is also why the order gate
       * is wider than `shopFloorProcedure`: excluding MAGASINIER here would
       * make its READY_FOR_EXPORT -> COMPLETED row unreachable, so the gate
       * would silently contradict the table it guards.
       */
      transition: orderModuleProcedure
        .input(transitionOrderInput)
        .mutation(({ ctx, input }) =>
          this.orderService.transition(ctx.user, input),
        ),

      acceptQuote: orderModuleProcedure
        .input(acceptQuoteInput)
        .mutation(({ ctx, input }) =>
          this.orderService.acceptQuote(ctx.user, input.orderId),
        ),
    }),

    /**
     * Paper stock: reels and the shipments they arrived in.
     *
     * Reel reads are the order-module gate — ADMIN+, PRODUCTION and
     * MAGASINIER — since reel picking landed (docs/roll-allocation-plan.md):
     * the floor follows a reservation to the reel it names, and the
     * warehouse picks from this list. Cutting and slitting are the
     * warehouse's own (`warehouseProcedure`), beside the reservations in
     * `allocation`.
     *
     * Shipment READS moved to `warehouseProcedure` when receiving landed
     * (docs/receiving-plan.md): a MAGASINIER scanning a delivery has to open
     * it. What it cost stays ADMIN+, structurally — `SHIPMENT_SELECT` has no
     * money in it and `SHIPMENT_SELECT_PRICED` adds it back, chosen by
     * `StockService.canReadPricing`, so the warehouse cannot read a price
     * that was never selected. Every shipment WRITE stays ADMIN+.
     */
    stock: router({
      // `ctx.user` decides whether the rows carry price: the shop floor picks
      // and cuts paper but does not read what it cost. See
      // `StockService.canReadPricing`.
      listRolls: orderModuleProcedure
        .input(listRollsInput)
        .query(({ ctx, input }) => this.stockService.listRolls(ctx.user, input)),

      rollById: orderModuleProcedure
        .input(partnerIdInput)
        .query(({ ctx, input }) => this.stockService.rollById(ctx.user, input.id)),

      /**
       * The stock list as a CSV string for the browser to save — every reel
       * the current facet and search match, not one page. A query, not a
       * mutation: it reads.
       */
      exportRolls: orderModuleProcedure
        .input(exportRollsInput)
        .query(({ ctx, input }) => this.stockService.exportRolls(ctx.user, input)),

      /**
       * Names for the advanced filter's supplier dropdown. Reference data the
       * warehouse needs to use its own list, so `orderModuleProcedure` rather
       * than the ADMIN-only `supplier.list`. Audited like any read: it is
       * fetched once per page, not polled.
       */
      supplierOptions: orderModuleProcedure
        .query(() => this.stockService.supplierOptions()),

      // `ctx.user` decides whether the rows carry price, as with reels above.
      listShipments: warehouseProcedure
        .input(listShipmentsInput)
        .query(({ ctx, input }) => this.stockService.listShipments(ctx.user, input)),

      shipmentById: warehouseProcedure
        .input(partnerIdInput)
        .query(({ ctx, input }) => this.stockService.shipmentById(ctx.user, input.id)),

      /** Reels on one shipment, searchable by reel number. No money on the row. */
      rollsForShipment: warehouseProcedure
        .input(rollsForShipmentInput)
        .query(({ input }) => this.stockService.rollsForShipment(input)),

      // Shipment writes are ADMIN, like every other module.
      createShipment: adminProcedure
        .input(createShipmentInput)
        .mutation(({ input }) => this.stockService.createShipment(input)),

      updateShipment: adminProcedure
        .input(updateShipmentInput)
        .mutation(({ input }) => this.stockService.updateShipment(input)),

      /** Archive / restore. The reels and their provenance are untouched. */
      setShipmentActive: adminProcedure
        .input(setShipmentActiveInput)
        .mutation(({ input }) =>
          this.stockService.setShipmentActive(input.id, input.active),
        ),

      /** Refused while any reel references it — archive instead. */
      removeShipment: adminProcedure
        .input(shipmentIdInput)
        .mutation(({ input }) => this.stockService.removeShipment(input.id)),

      /** Replaces which reels claim this shipment as their provenance. */
      setShipmentRolls: adminProcedure
        .input(setShipmentRollsInput)
        .mutation(({ input }) => this.stockService.setShipmentRolls(input)),

      // Reels. Every one belongs to a delivery, so these are created from a
      // shipment. `updateRoll` accepts weights but the SERVICE refuses them
      // once allocations, splits or consumption depend on the reel — see
      // StockService.assertRollWeightsEditable.
      createRoll: adminProcedure
        .input(createRollInput)
        .mutation(({ input }) => this.stockService.createRoll(input)),

      updateRoll: adminProcedure
        .input(updateRollInput)
        .mutation(({ input }) => this.stockService.updateRoll(input)),

      /** Archive / restore. Always allowed: it changes no quantity. */
      setRollArchived: adminProcedure
        .input(setRollArchivedInput)
        .mutation(({ input }) =>
          this.stockService.setRollArchived(input.id, input.archived),
        ),

      /** Refused while allocations, split children or consumption reference it. */
      removeRoll: adminProcedure
        .input(rollIdInput)
        .mutation(({ input }) => this.stockService.removeRoll(input.id)),

      /** Cut a length off a reel into a child reel. Warehouse and ADMIN+. */
      cut: warehouseProcedure
        .input(cutRollInput)
        .mutation(({ input }) => this.stockService.cut(input)),

      /** Slit a reel into narrower bands; the mother is retired. */
      slit: warehouseProcedure
        .input(slitRollInput)
        .mutation(({ input }) => this.stockService.slit(input)),

      /**
       * Receiving — docs/receiving-plan.md.
       *
       * Audited like any other mutation, including the refusals: a label
       * scanned under the wrong delivery is exactly the event someone will
       * want to look up later. The heuristic reads the reel off the result
       * and the shipment off the input.
       */
      receiveRoll: warehouseProcedure
        .input(receiveRollInput)
        .mutation(({ ctx, input }) => this.stockService.receiveRoll(ctx.user, input)),

      /** Deliveries with reels still to scan. */
      receivingInbox: warehouseProcedure.query(() => this.stockService.receivingInbox()),

      /**
       * A legacy `/scan/rouleau/<legacyId>` label to the reel it names, for
       * the redirect page. `orderModuleProcedure` because scanning a label to
       * look at a reel is a read anyone who can read reels may do.
       */
      resolveScan: orderModuleProcedure
        .input(resolveScanInput)
        .query(({ input }) => this.stockService.resolveScan(input.code)),

      /** Reels to print labels for. The office prints; ADMIN+. */
      rollLabels: adminProcedure
        .input(rollLabelsInput)
        .query(({ input }) => this.stockService.rollLabels(input)),
    }),

    /**
     * Paper reserved for orders (docs/roll-allocation-plan.md).
     *
     * Reads and `consume` are the order-module gate, scoped per role by the
     * service like ink usage — the floor consumes what it ran. Reserving,
     * cutting-and-reserving and cancelling are the warehouse's
     * (`warehouseProcedure`): MAGASINIER and ADMIN+.
     */
    allocation: router({
      forOrder: orderModuleProcedure
        .input(allocationForOrderInput)
        .query(({ ctx, input }) =>
          this.allocationService.forOrder(ctx.user, input.orderId),
        ),

      candidates: orderModuleProcedure
        .input(candidatesInput)
        .query(({ ctx, input }) =>
          this.allocationService.candidates(ctx.user, input),
        ),

      reserve: warehouseProcedure
        .input(reserveRollInput)
        .mutation(({ ctx, input }) =>
          this.allocationService.reserve(ctx.user, input),
        ),

      cutAndReserve: warehouseProcedure
        .input(cutAndReserveInput)
        .mutation(({ ctx, input }) =>
          this.allocationService.cutAndReserve(ctx.user, input),
        ),

      consume: orderModuleProcedure
        .input(consumeAllocationInput)
        .mutation(({ ctx, input }) =>
          this.allocationService.consume(ctx.user, input),
        ),

      cancel: warehouseProcedure
        .input(allocationIdInput)
        .mutation(({ ctx, input }) =>
          this.allocationService.cancel(ctx.user, input.id),
        ),
    }),

    /**
     * Ink stock — the colour catalogue and the ink drawn from it per order
     * (docs/legacy-migration.md "Step 7").
     *
     * Catalogue writes and the two balance corrections are ADMIN+. `list`
     * is `shopFloorProcedure` because the floor's usage form needs the
     * picker; the usage procedures follow the production runs exactly —
     * record and correct from the floor, delete from ADMIN — and the
     * service scopes them to the orders on the floor the same way.
     */
    ink: router({
      list: shopFloorProcedure
        .input(listInkColoursInput)
        .query(({ input }) => this.inkService.list(input)),

      byId: adminProcedure
        .input(inkColourIdInput)
        .query(({ input }) => this.inkService.byId(input.id)),

      create: adminProcedure
        .input(createInkColourInput)
        .mutation(({ input }) => this.inkService.create(input)),

      update: adminProcedure
        .input(updateInkColourInput)
        .mutation(({ input }) => this.inkService.update(input)),

      setActive: adminProcedure
        .input(setInkColourActiveInput)
        .mutation(({ input }) =>
          this.inkService.setActive(input.id, input.active),
        ),

      remove: adminProcedure
        .input(inkColourIdInput)
        .mutation(({ input }) => this.inkService.remove(input.id)),

      restock: adminProcedure
        .input(restockInkInput)
        .mutation(({ input }) => this.inkService.restock(input)),

      adjust: adminProcedure
        .input(adjustInkStockInput)
        .mutation(({ input }) => this.inkService.adjust(input)),

      usageForOrder: shopFloorProcedure
        .input(inkUsageForOrderInput)
        .query(({ ctx, input }) =>
          this.inkService.usageForOrder(ctx.user, input.orderId),
        ),

      recordUsage: shopFloorProcedure
        .input(recordInkUsageInput)
        .mutation(({ ctx, input }) =>
          this.inkService.recordUsage(ctx.user, input),
        ),

      updateUsage: shopFloorProcedure
        .input(updateInkUsageInput)
        .mutation(({ ctx, input }) =>
          this.inkService.updateUsage(ctx.user, input),
        ),

      removeUsage: adminProcedure
        .input(inkUsageIdInput)
        .mutation(({ ctx, input }) =>
          this.inkService.removeUsage(ctx.user, input.id),
        ),
    }),

    /**
     * Stocktakes — docs/inventory-plan.md §5.
     *
     * All `warehouseProcedure` (ADMIN + MAGASINIER): counting is the
     * warehouse's job, and a count carries no money, so there is no priced /
     * unpriced select split to make here.
     *
     * Every call is audited, refusals included. `scan` takes `countId` at the
     * top level and returns the REEL, so the audit heuristic reads the reel as
     * the entity and the session as `relatedId` — which needs `countId` in
     * `PARENT_KEYS` (audit.util.ts), not just at the top level of the input.
     */
    inventory: router({
      list: warehouseProcedure
        .input(listStockCountsInput)
        .query(({ input }) => this.inventoryService.list(input)),

      byId: warehouseProcedure
        .input(stockCountIdInput)
        .query(({ input }) => this.inventoryService.byId(input.id)),

      open: warehouseProcedure
        .input(openStockCountInput)
        .mutation(({ ctx, input }) => this.inventoryService.open(ctx.user, input)),

      scan: warehouseProcedure
        .input(countScanInput)
        .mutation(({ ctx, input }) => this.inventoryService.scan(ctx.user, input)),

      close: warehouseProcedure
        .input(stockCountIdInput)
        .mutation(({ input }) => this.inventoryService.close(input)),

      summary: warehouseProcedure
        .input(stockCountIdInput)
        .query(({ input }) => this.inventoryService.summary(input.id)),

      variance: warehouseProcedure
        .input(varianceInput)
        .query(({ input }) => this.inventoryService.variance(input)),
    }),

    /**
     * Recorded production runs — what was made against an order on one day.
     *
     * Recording a run is the shop floor's job, so `forOrder`, `create` and
     * `update` are `shopFloorProcedure` (PRODUCTION, plus ADMIN and above):
     * it is the one place in the app where that role writes anything besides
     * the IN_PRODUCTION -> PRODUCED transition, and it does so from the
     * order detail page.
     *
     * The `/production` module itself — `list`, `byId`, `daily` and
     * `monthly`, the cross-order roll-ups — is supervision rather than the
     * floor's tool and is ADMIN and above only. The sidebar hides it from
     * PRODUCTION to match (see `nav-items.ts`), but this gate is the real
     * boundary.
     *
     * The order behind a run is scope-checked in the service against the same
     * `PRODUCTION_VISIBLE_ORDER_STATUSES` the orders list uses, so a run
     * cannot be recorded against an order the caller cannot see.
     */
    production: router({
      list: adminProcedure
        .input(listProductionInput)
        .query(({ ctx, input }) =>
          this.productionService.list(ctx.user, input),
        ),

      byId: adminProcedure
        .input(partnerIdInput)
        .query(({ ctx, input }) =>
          this.productionService.byId(ctx.user, input.id),
        ),

      forOrder: shopFloorProcedure
        .input(productionForOrderInput)
        .query(({ ctx, input }) =>
          this.productionService.forOrder(ctx.user, input.orderId),
        ),

      /**
       * One day's production, grouped by station — the `/production`
       * dashboard. Its totals are computed server-side so the KPI tiles
       * cannot disagree with the sections under them.
       */
      daily: adminProcedure
        .input(productionDailyInput)
        .query(({ ctx, input }) =>
          this.productionService.daily(ctx.user, input),
        ),

      /**
       * A range of months, per machine and per operator — the month view of
       * the same dashboard. Aggregated in the database; see the service.
       */
      monthly: adminProcedure
        .input(productionMonthlyInput)
        .query(({ ctx, input }) =>
          this.productionService.monthly(ctx.user, input),
        ),

      create: shopFloorProcedure
        .input(createProductionRunInput)
        .mutation(({ ctx, input }) =>
          this.productionService.create(ctx.user, input),
        ),

      update: shopFloorProcedure
        .input(updateProductionRunInput)
        .mutation(({ ctx, input }) =>
          this.productionService.update(ctx.user, input),
        ),

      /**
       * A hard delete, unlike every archive elsewhere: a run is a dated
       * measurement, not a record other rows reference, and a mis-keyed one
       * is noise rather than history worth keeping. ADMIN and above only —
       * the floor corrects its own runs with `update`.
       */
      remove: adminProcedure
        .input(productionRunIdInput)
        .mutation(({ input }) => this.productionService.remove(input.id)),
    }),

    /**
     * Invoices — what suppliers bill us and what we bill customers. Commercial
     * data like clients and suppliers, so ADMIN and above throughout.
     *
     * Each router's own block below says what it writes.
     */
    purchaseInvoice: router({
      list: adminProcedure
        .input(listPurchaseInvoicesInput)
        .query(({ input }) => this.invoiceService.listPurchase(input)),

      byId: adminProcedure
        .input(purchaseInvoiceIdInput)
        .query(({ input }) => this.invoiceService.purchaseById(input.id)),

      /**
       * Plain CRUD: a supplier's invoice is recorded as received, with the
       * totals derived from its lines. No lifecycle — the number is the
       * supplier's — and `remove` is a hard delete (see the service).
       */
      create: adminProcedure
        .input(createPurchaseInvoiceInput)
        .mutation(({ input }) => this.invoiceService.createPurchase(input)),

      update: adminProcedure
        .input(updatePurchaseInvoiceInput)
        .mutation(({ input }) => this.invoiceService.updatePurchase(input)),

      remove: adminProcedure
        .input(purchaseInvoiceIdInput)
        .mutation(({ input }) => this.invoiceService.removePurchase(input.id)),
    }),

    /**
     * Sales invoices: the migrated history plus the write path from
     * docs/sales-invoice-plan.md — a draft raised from an INVOICEABLE order,
     * edited, issued (numbered) or discarded. ADMIN and above throughout:
     * every mutation moves money or an order's lifecycle.
     */
    salesInvoice: router({
      list: adminProcedure
        .input(listSalesInvoicesInput)
        .query(({ input }) => this.invoiceService.listSales(input)),

      byId: adminProcedure
        .input(salesInvoiceIdInput)
        .query(({ input }) => this.invoiceService.salesById(input.id)),

      /** Draft + order -> INVOICED, one transaction. Returns the draft's id. */
      createFromOrder: adminProcedure
        .input(createSalesInvoiceFromOrderInput)
        .mutation(({ ctx, input }) =>
          this.invoiceService.createFromOrder(ctx.user, input),
        ),

      /**
       * A draft billing something other than a job order — the ordinary case
       * in the migrated data, where 47 of 48 invoices name no order. No order
       * is touched, so this has none of `createFromOrder`'s lifecycle; the
       * draft then goes through the same `updateDraft` / `issue` / `discardDraft`.
       */
      create: adminProcedure
        .input(createSalesInvoiceInput)
        .mutation(({ ctx, input }) => this.invoiceService.createSales(ctx.user, input)),

      updateDraft: adminProcedure
        .input(updateSalesInvoiceDraftInput)
        .mutation(({ input }) => this.invoiceService.updateDraft(input)),

      refreshFromPackaging: adminProcedure
        .input(salesInvoiceIdInput)
        .mutation(({ input }) => this.invoiceService.refreshFromPackaging(input.id)),

      issue: adminProcedure
        .input(issueSalesInvoiceInput)
        .mutation(({ ctx, input }) => this.invoiceService.issue(ctx.user, input)),

      /** Deletes the draft and returns its order(s) to INVOICEABLE, note required. */
      discardDraft: adminProcedure
        .input(discardSalesInvoiceDraftInput)
        .mutation(({ ctx, input }) => this.invoiceService.discardDraft(ctx.user, input)),
    }),

    /**
     * Outbound shipments (exports) — docs/export-plan.md. The warehouse's
     * module: `warehouseProcedure` (ADMIN+ and MAGASINIER) for reads and
     * for raising, editing and shipping a draft; discarding one reopens the
     * order's lifecycle and is ADMIN+, matching its row in the transition
     * table. No procedure here returns a money column.
     */
    shipment: router({
      list: warehouseProcedure
        .input(listExportShipmentsInput)
        .query(({ input }) => this.shipmentService.list(input)),

      byId: warehouseProcedure
        .input(exportShipmentIdInput)
        .query(({ input }) => this.shipmentService.byId(input.id)),

      /** Draft + order -> READY_FOR_EXPORT, one transaction. Returns the draft's id. */
      createFromOrder: warehouseProcedure
        .input(createShipmentFromOrderInput)
        .mutation(({ ctx, input }) =>
          this.shipmentService.createFromOrder(ctx.user, input.orderId),
        ),

      updateDraft: warehouseProcedure
        .input(updateShipmentDraftInput)
        .mutation(({ input }) => this.shipmentService.updateDraft(input)),

      /** The one edit a SHIPPED shipment accepts. */
      updateCustoms: warehouseProcedure
        .input(updateShipmentCustomsInput)
        .mutation(({ input }) => this.shipmentService.updateCustoms(input)),

      /** Numbers the shipment and moves its order(s) on; `closeOrder` is admin-checked in the service. */
      ship: warehouseProcedure
        .input(shipShipmentInput)
        .mutation(({ ctx, input }) => this.shipmentService.ship(ctx.user, input)),

      /** Deletes the draft and returns its order(s) to INVOICED, note required. */
      discardDraft: adminProcedure
        .input(discardShipmentDraftInput)
        .mutation(({ ctx, input }) => this.shipmentService.discardDraft(ctx.user, input)),

      /**
       * A presigned PUT for a scan of this shipment's documents —
       * docs/s3-assets-plan.md "Step 2". The browser uploads straight to S3
       * and then saves the returned URL through `updateDraft` /
       * `updateCustoms`, so the row is only ever written by the mutations
       * that already own its rules.
       *
       * Mutations, not queries: each one hands out a capability, and the
       * audit row belongs with the act of minting it.
       *
       * The two fields gate differently because the record does — the packing
       * list freezes at ship, the customs declaration does not — and
       * `assertUploadable` holds both rules.
       */
      createPackingListUpload: warehouseProcedure
        .input(exportShipmentIdInput.extend(createUploadInput.shape))
        .mutation(async ({ input }) => {
          await this.shipmentService.assertUploadable(input.id, "packingList");
          return this.storageService.createUpload(input);
        }),

      createCustomsUpload: warehouseProcedure
        .input(exportShipmentIdInput.extend(createUploadInput.shape))
        .mutation(async ({ input }) => {
          await this.shipmentService.assertUploadable(input.id, "customs");
          return this.storageService.createUpload(input);
        }),
    }),

    /**
     * Document templates: the stored layouts generated PDFs print from —
     * docs/sales-invoice-pdf-plan.md. ADMIN reads (they issue the invoices
     * these style); SUPER_ADMIN writes, because publishing the default
     * restyles every invoice issued after it. A published version is never
     * updated — see `TemplateService`.
     */
    documentTemplate: router({
      list: adminProcedure.query(() => this.templateService.list()),

      byId: adminProcedure
        .input(documentTemplateIdInput)
        .query(({ input }) => this.templateService.byId(input.id)),

      create: superAdminProcedure
        .input(createDocumentTemplateInput)
        .mutation(({ ctx, input }) => this.templateService.create(ctx.user, input)),

      rename: superAdminProcedure
        .input(renameDocumentTemplateInput)
        .mutation(({ input }) => this.templateService.rename(input)),

      /** Writes the template's draft; a published version is never touched. */
      saveVersion: superAdminProcedure
        .input(saveDocumentTemplateVersionInput)
        .mutation(({ ctx, input }) => this.templateService.saveVersion(ctx.user, input)),

      publish: superAdminProcedure
        .input(publishDocumentTemplateInput)
        .mutation(({ input }) => this.templateService.publish(input)),

      setDefault: superAdminProcedure
        .input(documentTemplateIdInput)
        .mutation(({ input }) => this.templateService.setDefault(input.id)),
    }),

    /**
     * Purchasing: purchase orders and the goods receipts raised against
     * them. Commercial data — prices and supplier terms — so ADMIN and above
     * throughout, read and write alike. Notably that excludes MAGASINIER,
     * who physically receives the goods: recording the note is an office job
     * here, and the warehouse's own step is scanning reels in
     * (`stock.receiveRoll`).
     *
     * The service owns the numbering rule (the legacy numbers are prefixed
     * per category) and refuses a delivery past what was ordered. It does
     * NOT touch stock: a paper receipt is a paper trail, and reels enter
     * stock by being scanned — see the service docblock.
     */
    purchaseOrder: router({
      list: adminProcedure
        .input(listPurchaseOrdersInput)
        .query(({ input }) => this.purchasingService.listOrders(input)),

      byId: adminProcedure
        .input(purchaseOrderIdInput)
        .query(({ input }) => this.purchasingService.orderById(input.id)),

      create: adminProcedure
        .input(createPurchaseOrderInput)
        .mutation(({ input }) => this.purchasingService.createOrder(input)),

      /** Header always; category never; lines and supplier only while no receipt holds a delivery or an invoice (the empty receipt born with the order is rebuilt). */
      update: adminProcedure
        .input(updatePurchaseOrderInput)
        .mutation(({ input }) => this.purchasingService.updateOrder(input)),

      /** Refused while a goods receipt holds a delivery or an invoice; untouched receipts are deleted with it. */
      remove: adminProcedure
        .input(purchaseOrderIdInput)
        .mutation(({ input }) => this.purchasingService.removeOrder(input.id)),
    }),

    goodsReceipt: router({
      list: adminProcedure
        .input(listGoodsReceiptsInput)
        .query(({ input }) => this.purchasingService.listReceipts(input)),

      byId: adminProcedure
        .input(goodsReceiptIdInput)
        .query(({ input }) => this.purchasingService.receiptById(input.id)),

      create: adminProcedure
        .input(createGoodsReceiptInput)
        .mutation(({ input }) => this.purchasingService.createReceipt(input)),

      update: adminProcedure
        .input(updateGoodsReceiptInput)
        .mutation(({ input }) => this.purchasingService.updateReceipt(input)),

      /** Refused while a purchase invoice is raised on it. */
      remove: adminProcedure
        .input(goodsReceiptIdInput)
        .mutation(({ input }) => this.purchasingService.removeReceipt(input.id)),
    }),

    /**
     * Shift planning and daily tickets — docs/shift-planning-plan.md §4.3.
     *
     * Planning (open, copy, clear, publish, assign, unassign), recording a
     * change on a published week, deciding requests, the day view and
     * writing tickets are ADMIN and above. Reading a week and the running
     * shift are `shopFloorProcedure` — PRODUCTION alongside ADMIN.
     *
     * The four calls behind "My shifts" — one's own week, requesting or
     * withdrawing a change, marking a ticket done — are `protectedProcedure`
     * (docs/notifications-plan.md §4.7): the nav has offered that page to
     * the warehouse since 2026-09-24, and the week-published notification
     * links every role there. The gate was never what protected them: the
     * service scopes each to the caller's own employee record, so a worker
     * of either role sees published weeks only, their own tickets, and can
     * request or withdraw on their own weekly row only, and an account with
     * no employee row gets an empty screen.
     */
    shift: router({
      weekByStart: shopFloorProcedure
        .input(weekStartInput)
        .query(({ ctx, input }) => this.shiftService.weekByStart(ctx.user, input)),

      // The admin's ticket screen: one day, its shifts, their people and tickets.
      dayView: adminProcedure
        .input(dayInput)
        .query(({ input }) => this.shiftService.dayView(input)),

      myWeek: protectedProcedure
        .input(myWeekInput)
        .query(({ ctx, input }) => this.shiftService.myWeek(ctx.user, input)),

      // Polled every minute by the floor's Today tab, and says nothing
      // about intent — so, like `nav.counts`, not in the trace.
      current: shopFloorProcedure
        .meta({ audit: false })
        .query(({ ctx }) => this.shiftService.current(ctx.user)),

      openWeek: adminProcedure
        .input(weekStartInput)
        .mutation(({ input }) => this.shiftService.openWeek(input)),

      copyWeek: adminProcedure
        .input(copyWeekInput)
        .mutation(({ input }) => this.shiftService.copyWeek(input)),

      clearWeek: adminProcedure
        .input(weekIdInput)
        .mutation(({ input }) => this.shiftService.clearWeek(input.weekId)),

      publish: adminProcedure
        .input(weekIdInput)
        .mutation(({ ctx, input }) => this.shiftService.publish(ctx.user, input.weekId)),

      // The picker's bulk action: rows on a draft, rows plus recorded ADD
      // changes on a published week.
      assign: adminProcedure
        .input(assignWeekInput)
        .mutation(({ ctx, input }) => this.shiftService.assign(ctx.user, input)),

      unassign: adminProcedure
        .input(assignmentIdInput)
        .mutation(({ input }) => this.shiftService.unassign(input.assignmentId)),

      moveDraft: adminProcedure
        .input(moveDraftInput)
        .mutation(({ input }) => this.shiftService.moveDraft(input)),

      change: adminProcedure
        .input(adminChangeInput)
        .mutation(({ ctx, input }) => this.shiftService.change(ctx.user, input)),

      requestChange: protectedProcedure
        .input(requestChangeInput)
        .mutation(({ ctx, input }) => this.shiftService.requestChange(ctx.user, input)),

      withdraw: protectedProcedure
        .input(changeIdInput)
        .mutation(({ ctx, input }) => this.shiftService.withdraw(ctx.user, input)),

      accept: adminProcedure
        .input(changeIdInput)
        .mutation(({ ctx, input }) => this.shiftService.accept(ctx.user, input)),

      reject: adminProcedure
        .input(rejectChangeInput)
        .mutation(({ ctx, input }) => this.shiftService.reject(ctx.user, input)),

      listChanges: adminProcedure
        .input(listShiftChangesInput)
        .query(({ input }) => this.shiftService.listChanges(input)),

      createTask: adminProcedure
        .input(createShiftTaskInput)
        .mutation(({ ctx, input }) => this.shiftService.createTask(ctx.user, input)),

      updateTask: adminProcedure
        .input(updateShiftTaskInput)
        .mutation(({ ctx, input }) => this.shiftService.updateTask(ctx.user, input)),

      removeTask: adminProcedure
        .input(taskIdInput)
        .mutation(({ input }) => this.shiftService.removeTask(input.id)),

      setTaskDone: protectedProcedure
        .input(setTaskDoneInput)
        .mutation(({ ctx, input }) => this.shiftService.setTaskDone(ctx.user, input)),
    }),

    user: router({
      // ADMIN and above; the service further restricts by rank, in SQL.
      list: adminProcedure
        .input(listUsersInput)
        .query(({ ctx, input }) => this.userService.list(ctx.user, input)),

      assignableRoles: adminProcedure.query(({ ctx }) =>
        this.userService.assignableRoles(ctx.user),
      ),

      create: adminProcedure
        .input(createUserInput)
        .mutation(({ ctx, input }) => this.userService.create(ctx.user, input)),

      setRole: adminProcedure
        .input(setUserRoleInput)
        .mutation(({ ctx, input }) =>
          this.userService.setRole(ctx.user, input.id, input.role),
        ),

      setBanned: adminProcedure
        .input(setUserBannedInput)
        .mutation(({ ctx, input }) =>
          this.userService.setBanned(
            ctx.user,
            input.id,
            input.banned,
            input.reason,
          ),
        ),

      remove: adminProcedure
        .input(userIdInput)
        .mutation(({ ctx, input }) =>
          this.userService.remove(ctx.user, input.id),
        ),
    }),

    /**
     * The activity trace (docs/audit-log-plan.md). ADMIN and above read every
     * user's rows.
     *
     * `list` and `actors` are NOT audited, a measured exception to the
     * "everything" decision: the row a `list` call writes lands at the top
     * of the newest-first list it just read, so every page turn re-showed
     * the previous page's last row (verified in the plan's Step 8). `byId`
     * stays audited — "who inspected whose activity" is the one read here
     * with intent in it.
     */
    audit: router({
      list: adminProcedure
        .meta({ audit: false })
        .input(listAuditInput)
        .query(({ input }) => this.auditService.list(input)),

      byId: adminProcedure
        .input(auditIdInput)
        .query(({ input }) => this.auditService.byId(input.id)),

      actors: adminProcedure
        .meta({ audit: false })
        .query(() => this.auditService.actors()),
    }),
  });
}

export type AppRouter = TrpcRouter["appRouter"];
