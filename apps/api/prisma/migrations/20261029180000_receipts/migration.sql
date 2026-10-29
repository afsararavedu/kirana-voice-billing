-- Phase 4: store profile for receipts, GST invoice series per financial year, seller snapshot.

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "address" VARCHAR(300),
ADD COLUMN     "gstin" CHAR(15),
ADD COLUMN     "invoicePrefix" VARCHAR(4),
ADD COLUMN     "phone" VARCHAR(20),
ADD COLUMN     "receiptFooter" VARCHAR(200);

-- AlterTable (nullable first; existing bills are backfilled below, then the columns become NOT NULL)
ALTER TABLE "Sale" ADD COLUMN     "fiscalYear" INTEGER,
ADD COLUMN     "invoiceNumber" VARCHAR(16),
ADD COLUMN     "invoiceSeq" INTEGER,
ADD COLUMN     "seller" JSONB;

-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "storeId" UUID NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "nextSeq" INTEGER NOT NULL,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("storeId","fiscalYear")
);

-- Backfill bills made before this migration: financial year from the IST bill time, serials in
-- bill-number order, no prefix (none existed), seller = the store's name. "Sale" is append-only,
-- so its guard trigger is disabled for this one statement only, inside the migration transaction.
ALTER TABLE "Sale" DISABLE TRIGGER "Sale_append_only";
UPDATE "Sale" s
SET "fiscalYear" = b.fy,
    "invoiceSeq" = b.seq,
    "invoiceNumber" = lpad((b.fy % 100)::text, 2, '0') || '-' || lpad(((b.fy + 1) % 100)::text, 2, '0') || '/' || b.seq,
    "seller" = jsonb_build_object('name', st."name", 'address', NULL, 'phone', NULL, 'gstin', NULL, 'footer', NULL)
FROM (
  SELECT x."id", x.fy, row_number() OVER (PARTITION BY x."storeId", x.fy ORDER BY x."number")::int AS seq
  FROM (
    SELECT "id", "storeId", "number",
           EXTRACT(YEAR FROM (("createdAt" AT TIME ZONE 'Asia/Kolkata') - INTERVAL '3 months'))::int AS fy
    FROM "Sale"
  ) x
) b, "Store" st
WHERE s."id" = b."id" AND st."id" = s."storeId";
ALTER TABLE "Sale" ENABLE TRIGGER "Sale_append_only";

INSERT INTO "InvoiceCounter" ("storeId", "fiscalYear", "nextSeq")
SELECT "storeId", "fiscalYear", max("invoiceSeq") + 1 FROM "Sale" GROUP BY "storeId", "fiscalYear";

ALTER TABLE "Sale" ALTER COLUMN "fiscalYear" SET NOT NULL,
ALTER COLUMN "invoiceNumber" SET NOT NULL,
ALTER COLUMN "invoiceSeq" SET NOT NULL,
ALTER COLUMN "seller" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Sale_storeId_fiscalYear_invoiceSeq_key" ON "Sale"("storeId", "fiscalYear", "invoiceSeq");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_storeId_invoiceNumber_key" ON "Sale"("storeId", "invoiceNumber");

-- AddForeignKey
ALTER TABLE "InvoiceCounter" ADD CONSTRAINT "InvoiceCounter_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Hand-written invariants =====
ALTER TABLE "Store" ADD CONSTRAINT "Store_gstin_format"
  CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
ALTER TABLE "Store" ADD CONSTRAINT "Store_invoicePrefix_format"
  CHECK ("invoicePrefix" IS NULL OR "invoicePrefix" ~ '^[A-Z0-9]{1,4}$');
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_invoice_positive"
  CHECK ("invoiceSeq" > 0 AND "fiscalYear" BETWEEN 2000 AND 2999);
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_invoiceNumber_format"
  CHECK ("invoiceNumber" ~ '^[A-Za-z0-9/-]{1,16}$');
ALTER TABLE "InvoiceCounter" ADD CONSTRAINT "InvoiceCounter_nextSeq_positive" CHECK ("nextSeq" > 1);
