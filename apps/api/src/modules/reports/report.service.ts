import { Prisma, type PrismaClient } from '@prisma/client';
import {
  businessDate,
  businessDayRange,
  PAYMENT_METHODS,
  type DailySummaryDto,
  type LowStockItemDto,
} from '@kirana/shared';
import { dec, moneyStr, qtyStr } from '../../lib/decimal.js';
import { toProductDto, withAliases } from '../products/product.mapper.js';
import { taxByRate } from '../sales/pricing.js';
import { toTaxRateDto } from '../sales/sale.mapper.js';

const ZERO = dec('0');
const orZero = (d: Prisma.Decimal | null | undefined) => d ?? ZERO;

export const LOW_STOCK_LIMIT = 500;

/** Read-only aggregates. `storeId` always comes from `req.tenant`. */
export class ReportService {
  constructor(private readonly db: PrismaClient) {}

  async daily(storeId: string, date = businessDate(new Date())): Promise<DailySummaryDto> {
    const { start, end } = businessDayRange(date);
    const billedThatDay = { storeId, createdAt: { gte: start, lt: end } };
    const ofBillsThatDay = { storeId, sale: billedThatDay };

    // One snapshot, so a bill committed mid-report cannot appear in some figures and not others.
    const [sales, payments, returns, refundsByMethod, rates] = await this.db.$transaction(
      [
        this.db.sale.aggregate({
          where: billedThatDay,
          _count: { _all: true },
          _sum: { taxableTotal: true, taxTotal: true, discountTotal: true, grandTotal: true },
        }),
        this.db.salePayment.groupBy({
          by: ['method'],
          where: ofBillsThatDay,
          orderBy: { method: 'asc' },
          _sum: { amount: true },
        }),
        this.db.saleReturn.aggregate({
          where: billedThatDay,
          _count: { _all: true },
          _sum: { refundTotal: true, taxRefunded: true },
        }),
        this.db.saleReturn.groupBy({
          by: ['refundMethod'],
          where: billedThatDay,
          orderBy: { refundMethod: 'asc' },
          _sum: { refundTotal: true },
        }),
        this.db.saleItem.groupBy({
          by: ['taxRate'],
          where: ofBillsThatDay,
          orderBy: { taxRate: 'asc' },
          _sum: { taxableValue: true, taxAmount: true },
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const grand = orZero(sales._sum.grandTotal);
    const refundTotal = orZero(returns._sum.refundTotal);
    return {
      date,
      billCount: sales._count._all,
      returnCount: returns._count._all,
      sales: {
        taxableTotal: moneyStr(orZero(sales._sum.taxableTotal)),
        taxTotal: moneyStr(orZero(sales._sum.taxTotal)),
        discountTotal: moneyStr(orZero(sales._sum.discountTotal)),
        grandTotal: moneyStr(grand),
      },
      refunds: { total: moneyStr(refundTotal), tax: moneyStr(orZero(returns._sum.taxRefunded)) },
      netSales: moneyStr(grand.minus(refundTotal)),
      payments: PAYMENT_METHODS.map((method) => {
        const collected = orZero(payments.find((p) => p.method === method)?._sum?.amount);
        const refunded = orZero(refundsByMethod.find((r) => r.refundMethod === method)?._sum?.refundTotal);
        return {
          method,
          collected: moneyStr(collected),
          refunded: moneyStr(refunded),
          net: moneyStr(collected.minus(refunded)),
        };
      }),
      taxByRate: taxByRate(
        rates.map((r) => ({
          taxRate: r.taxRate,
          taxableValue: orZero(r._sum?.taxableValue),
          taxAmount: orZero(r._sum?.taxAmount),
        })),
      ).map(toTaxRateDto),
    };
  }

  /** Active products that are out of stock or at/below their alert level; out of stock first. */
  async lowStock(storeId: string): Promise<LowStockItemDto[]> {
    const ids = await this.db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Product"
      WHERE "storeId" = ${storeId}::uuid AND "isActive"
        AND ("stockQuantity" <= 0
             OR ("lowStockThreshold" IS NOT NULL AND "stockQuantity" <= "lowStockThreshold"))
      ORDER BY ("stockQuantity" <= 0) DESC, "name", "id"
      LIMIT ${LOW_STOCK_LIMIT}`;
    const rows = await this.db.product.findMany({
      where: { storeId, id: { in: ids.map((r) => r.id) } },
      include: withAliases,
    });
    const byId = new Map(rows.map((p) => [p.id, p]));
    return ids.flatMap(({ id }) => {
      const p = byId.get(id);
      if (!p) return [];
      return [
        {
          product: toProductDto(p),
          shortfall: p.lowStockThreshold ? qtyStr(p.lowStockThreshold.minus(p.stockQuantity)) : null,
          outOfStock: p.stockQuantity.lte(0),
        },
      ];
    });
  }
}
