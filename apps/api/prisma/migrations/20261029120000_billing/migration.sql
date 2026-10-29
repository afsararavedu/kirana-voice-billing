-- CreateEnum
CREATE TYPE "SaleSource" AS ENUM ('MANUAL', 'VOICE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'CARD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MovementType" ADD VALUE 'SALE';
ALTER TYPE "MovementType" ADD VALUE 'RETURN';

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "nextSaleNumber" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "saleId" UUID,
ADD COLUMN     "saleReturnId" UUID;

-- CreateTable
CREATE TABLE "Sale" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "source" "SaleSource" NOT NULL DEFAULT 'MANUAL',
    "taxableTotal" DECIMAL(12,2) NOT NULL,
    "taxTotal" DECIMAL(12,2) NOT NULL,
    "discountTotal" DECIMAL(12,2) NOT NULL,
    "grandTotal" DECIMAL(12,2) NOT NULL,
    "receiptLanguage" "UiLanguage" NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "lineNo" SMALLINT NOT NULL,
    "productName" VARCHAR(120) NOT NULL,
    "localNames" JSONB NOT NULL DEFAULT '{}',
    "unit" "UnitOfMeasure" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "priceIncludesTax" BOOLEAN NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL,
    "taxableValue" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalePayment" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "tendered" DECIMAL(12,2),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturn" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "restocked" BOOLEAN NOT NULL,
    "refundMethod" "PaymentMethod" NOT NULL,
    "refundTotal" DECIMAL(12,2) NOT NULL,
    "taxRefunded" DECIMAL(12,2) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturnItem" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "saleReturnId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "saleItemId" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "refundAmount" DECIMAL(12,2) NOT NULL,
    "taxRefunded" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "SaleReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sale_storeId_createdAt_idx" ON "Sale"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_storeId_number_key" ON "Sale"("storeId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_storeId_id_key" ON "Sale"("storeId", "id");

-- CreateIndex
CREATE INDEX "SaleItem_storeId_productId_idx" ON "SaleItem"("storeId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleItem_saleId_lineNo_key" ON "SaleItem"("saleId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "SaleItem_saleId_id_key" ON "SaleItem"("saleId", "id");

-- CreateIndex
CREATE INDEX "SalePayment_saleId_idx" ON "SalePayment"("saleId");

-- CreateIndex
CREATE INDEX "SaleReturn_saleId_idx" ON "SaleReturn"("saleId");

-- CreateIndex
CREATE INDEX "SaleReturnItem_saleItemId_idx" ON "SaleReturnItem"("saleItemId");

-- CreateIndex
CREATE INDEX "InventoryMovement_saleId_idx" ON "InventoryMovement"("saleId");

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_storeId_saleId_fkey" FOREIGN KEY ("storeId", "saleId") REFERENCES "Sale"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_storeId_productId_fkey" FOREIGN KEY ("storeId", "productId") REFERENCES "Product"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_storeId_saleId_fkey" FOREIGN KEY ("storeId", "saleId") REFERENCES "Sale"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_storeId_saleId_fkey" FOREIGN KEY ("storeId", "saleId") REFERENCES "Sale"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_saleId_saleItemId_fkey" FOREIGN KEY ("saleId", "saleItemId") REFERENCES "SaleItem"("saleId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Hand-written: integrity guards (not expressible in Prisma schema) =====

ALTER TABLE "Store" ADD CONSTRAINT "Store_nextSaleNumber_positive" CHECK ("nextSaleNumber" >= 1);

-- Bill totals are internally consistent at the database level.
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_number_positive" CHECK ("number" >= 1);
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_amounts_nonneg"
  CHECK ("taxableTotal" >= 0 AND "taxTotal" >= 0 AND "discountTotal" >= 0 AND "grandTotal" >= 0);
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_grand_total_sum" CHECK ("grandTotal" = "taxableTotal" + "taxTotal");

ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_amounts_nonneg"
  CHECK ("unitPrice" >= 0 AND "grossAmount" >= 0 AND "discountAmount" >= 0
     AND "taxableValue" >= 0 AND "taxAmount" >= 0 AND "lineTotal" >= 0);
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_discount_le_gross" CHECK ("discountAmount" <= "grossAmount");
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_total_sum" CHECK ("lineTotal" = "taxableValue" + "taxAmount");
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_taxRate_range" CHECK ("taxRate" >= 0 AND "taxRate" <= 100);

ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_tendered_cash_only"
  CHECK ("tendered" IS NULL OR ("method" = 'CASH' AND "tendered" >= "amount"));

ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_amounts_nonneg" CHECK ("refundTotal" >= 0 AND "taxRefunded" >= 0);
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_amounts_nonneg" CHECK ("refundAmount" >= 0 AND "taxRefunded" >= 0);

-- Finalised financial history is append-only (function defined in the catalog_inventory migration).
CREATE TRIGGER "Sale_append_only" BEFORE UPDATE OR DELETE ON "Sale"
  FOR EACH ROW EXECUTE FUNCTION forbid_history_rewrite();
CREATE TRIGGER "SaleItem_append_only" BEFORE UPDATE OR DELETE ON "SaleItem"
  FOR EACH ROW EXECUTE FUNCTION forbid_history_rewrite();
CREATE TRIGGER "SalePayment_append_only" BEFORE UPDATE OR DELETE ON "SalePayment"
  FOR EACH ROW EXECUTE FUNCTION forbid_history_rewrite();
CREATE TRIGGER "SaleReturn_append_only" BEFORE UPDATE OR DELETE ON "SaleReturn"
  FOR EACH ROW EXECUTE FUNCTION forbid_history_rewrite();
CREATE TRIGGER "SaleReturnItem_append_only" BEFORE UPDATE OR DELETE ON "SaleReturnItem"
  FOR EACH ROW EXECUTE FUNCTION forbid_history_rewrite();