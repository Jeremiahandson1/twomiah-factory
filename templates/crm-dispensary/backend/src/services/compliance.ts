// Michigan cannabis compliance service
const MICHIGAN_PURCHASE_LIMIT_OZ = 2.5

export function validatePurchaseLimit(items: Array<{ weightGrams: string; quantity: number; isMerch: boolean }>, companyLimitOz?: string): { valid: boolean; totalOz: number; limitOz: number; error?: string } {
  const limitOz = parseFloat(companyLimitOz || String(MICHIGAN_PURCHASE_LIMIT_OZ))

  let totalGrams = 0
  for (const item of items) {
    if (item.isMerch) continue // merch doesn't count
    totalGrams += parseFloat(item.weightGrams || '0') * item.quantity
  }

  const totalOz = totalGrams / 28.3495

  if (totalOz > limitOz) {
    return { valid: false, totalOz, limitOz, error: `Order exceeds purchase limit: ${totalOz.toFixed(2)}oz / ${limitOz}oz max` }
  }

  return { valid: true, totalOz, limitOz }
}
