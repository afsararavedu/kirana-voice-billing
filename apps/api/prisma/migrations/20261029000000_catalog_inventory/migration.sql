-- CreateEnum
CREATE TYPE "UnitOfMeasure" AS ENUM ('KG', 'G', 'L', 'ML', 'PIECE', 'PACK', 'DOZEN');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('OPENING', 'RECEIVE', 'ADJUST', 'COUNT', 'DAMAGE', 'EXPIRY');

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "localNames" JSONB NOT NULL DEFAULT '{}',
    "sku" VARCHAR(64),
    "unit" "UnitOfMeasure" NOT NULL,
    "sellingPrice" DECIMAL(12,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "priceIncludesTax" BOOLEAN NOT NULL DEFAULT true,
    "stockQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "lowStockThreshold" DECIMAL(12,3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAlias" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "language" "UiLanguage",
    "text" VARCHAR(120) NOT NULL,
    "normalized" VARCHAR(120) NOT NULL,
    "position" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "storeId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantityDelta" DECIMAL(12,3) NOT NULL,
    "balanceAfter" DECIMAL(12,3) NOT NULL,
    "note" VARCHAR(255),
    "actorUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "scope" VARCHAR(64) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_storeId_isActive_name_idx" ON "Product"("storeId", "isActive", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_storeId_sku_key" ON "Product"("storeId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_storeId_id_key" ON "Product"("storeId", "id");

-- CreateIndex
CREATE INDEX "ProductAlias_storeId_normalized_idx" ON "ProductAlias"("storeId", "normalized");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAlias_productId_normalized_key" ON "ProductAlias"("productId", "normalized");

-- CreateIndex
CREATE INDEX "InventoryMovement_storeId_productId_seq_idx" ON "InventoryMovement"("storeId", "productId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_seq_key" ON "InventoryMovement"("seq");

-- CreateIndex
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_storeId_scope_key_key" ON "IdempotencyKey"("storeId", "scope", "key");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_storeId_productId_fkey" FOREIGN KEY ("storeId", "productId") REFERENCES "Product"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_storeId_productId_fkey" FOREIGN KEY ("storeId", "productId") REFERENCES "Product"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Hand-written: integrity guards (not expressible in Prisma schema) =====

-- Money and stock invariants enforced by the database, not only by the API.
ALTER TABLE "Product" ADD CONSTRAINT "Product_sellingPrice_nonneg" CHECK ("sellingPrice" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxRate_range" CHECK ("taxRate" >= 0 AND "taxRate" <= 100);
ALTER TABLE "Product" ADD CONSTRAINT "Product_stockQuantity_nonneg" CHECK ("stockQuantity" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_lowStockThreshold_nonneg" CHECK ("lowStockThreshold" IS NULL OR "lowStockThreshold" >= 0);
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_delta_nonzero" CHECK ("quantityDelta" <> 0);
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_balance_nonneg" CHECK ("balanceAfter" >= 0);

-- Append-only history: the ledger and audit log can be inserted into but never rewritten.
-- (TRUNCATE is not blocked; it requires table ownership, which the app role must not have in production.)
CREATE OR REPLACE FUNCTION forbid_history_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on "%" is not allowed: table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "InventoryMovement_append_only"
  BEFORE UPDATE OR DELETE ON "InventoryMovement"
  FOR EACH ROW EXECUTE FUNCTION forbid_history_rewrite();

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION forbid_history_rewrite();