import { createId } from '@paralleldrive/cuid2';
import { commissionRecord } from '../../db/schema';
import { logger } from './logger';

interface QuoteForCommission {
  id: string;
  companyId: string;
  repId: string;
  totalPrice: number;
  subtotal: number;
}

interface RepProfileForCommission {
  id: string;
  userId: string;
  commissionBasePct: number;
  commissionBonusPct: number;
  parPrice?: number | null;
}

interface CommissionResult {
  baseCommission: number;
  bonusCommission: number;
  totalCommission: number;
}

export function calculateCommission(
  quote: QuoteForCommission,
  repProfile: RepProfileForCommission,
  parPrice?: number
): CommissionResult {
  const effectiveParPrice = parPrice ?? repProfile.parPrice ?? quote.subtotal;
  const sellingPrice = quote.subtotal;

  const baseCommission = (effectiveParPrice * repProfile.commissionBasePct) / 100;

  let bonusCommission = 0;
  if (sellingPrice > effectiveParPrice) {
    bonusCommission =
      ((sellingPrice - effectiveParPrice) * repProfile.commissionBonusPct) / 100;
  }

  const totalCommission = baseCommission + bonusCommission;

  return {
    baseCommission: Math.round(baseCommission * 100) / 100,
    bonusCommission: Math.round(bonusCommission * 100) / 100,
    totalCommission: Math.round(totalCommission * 100) / 100,
  };
}

interface CommissionRecordData {
  companyId: string;
  repProfileId: string;
  quoteId: string;
  baseAmount: number;
  bonusAmount: number;
  totalAmount: number;
  parPriceSnapshot: number;
  sellingPriceSnapshot: number;
}

export async function createCommissionRecord(
  db: any,
  data: CommissionRecordData
): Promise<string> {
  const id = createId();
  try {
    await db.insert(commissionRecord).values({
      id,
      companyId: data.companyId,
      repProfileId: data.repProfileId,
      quoteId: data.quoteId,
      baseAmount: String(data.baseAmount),
      bonusAmount: String(data.bonusAmount),
      totalAmount: String(data.totalAmount),
      parPriceSnapshot: String(data.parPriceSnapshot),
      sellingPriceSnapshot: String(data.sellingPriceSnapshot),
      basePaidAt: null,
      bonusPaidAt: null,
      createdAt: new Date(),
    });
    logger.info('Commission record created', { id, quoteId: data.quoteId });
    return id;
  } catch (err) {
    logger.error('Failed to create commission record', {
      error: (err as Error).message,
      quoteId: data.quoteId,
    });
    throw err;
  }
}
