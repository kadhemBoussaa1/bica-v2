import { Module } from "@nestjs/common";
import { AllocationService } from "./allocation/allocation.service";
import { AuditService } from "./audit/audit.service";
import { ChatService } from "./chat/chat.service";
import { ClientService } from "./client/client.service";
import { DashboardService } from "./dashboard/dashboard.service";
import { PrismaService } from "./prisma.service";
import { EmployeeService } from "./employee/employee.service";
import { InkService } from "./ink/ink.service";
import { InventoryService } from "./inventory/inventory.service";
import { InvoiceService } from "./invoice/invoice.service";
import { MachineService } from "./machine/machine.service";
import { OrderService } from "./order/order.service";
import { PdfService } from "./pdf/pdf.service";
import { TemplateService } from "./template/template.service";
import { ProductService } from "./product/product.service";
import { ProductionService } from "./production/production.service";
import { PurchasingService } from "./purchasing/purchasing.service";
import { ShipmentService } from "./shipment/shipment.service";
import { ShiftService } from "./shift/shift.service";
import { StockService } from "./stock/stock.service";
import { StorageService } from "./storage/storage.service";
import { SupplierFamilyService } from "./supplier-family/supplier-family.service";
import { SupplierService } from "./supplier/supplier.service";
import { TrpcRouter } from "./trpc/trpc.router";
import { UserService } from "./user/user.service";

@Module({
  providers: [
    PrismaService,
    UserService,
    ClientService,
    SupplierService,
    SupplierFamilyService,
    MachineService,
    EmployeeService,
    ProductService,
    OrderService,
    StockService,
    ProductionService,
    InvoiceService,
    PurchasingService,
    PdfService,
    TemplateService,
    ShipmentService,
    StorageService,
    AuditService,
    InkService,
    AllocationService,
    InventoryService,
    ChatService,
    ShiftService,
    DashboardService,
    TrpcRouter,
  ],
})
export class AppModule {}
