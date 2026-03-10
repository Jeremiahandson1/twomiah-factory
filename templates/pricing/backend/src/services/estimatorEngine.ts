import { db } from '../../db/index'
import { estimatorProduct, estimatorMaterialTier, estimatorAddon, pitchMultiplier } from '../../db/schema-estimator'
import { eq, and } from 'drizzle-orm'

// Types
export interface MeasurementInput {
  productId: string
  measurement: number
  pitch?: string  // "6/12"
  selectedAddons: string[]
  wasteFactor?: number  // override default
}

export interface AddonLineItem {
  addonId: string
  name: string
  pricingType: string
  unitPrice: number
  quantity: number
  total: number
}

export interface EstimateLineItem {
  productId: string
  productName: string
  tier: 'good' | 'better' | 'best'
  rawMeasurement: number
  unit: string
  pitchMultiplier: number
  wasteFactor: number
  adjustedMeasurement: number
  materialName: string
  materialCostPerUnit: number
  totalMaterials: number
  laborRate: number
  totalLabor: number
  addons: AddonLineItem[]
  totalAddons: number
  setupFee: number
  parPrice: number  // materials + labor (cost floor)
  retailPrice: number
  yr1Price: number
  day30Price: number
  todayPrice: number
  lineTotal: number
}

export interface EstimateResult {
  lines: EstimateLineItem[]
  subtotal: number
  totalMaterials: number
  totalLabor: number
  totalAddons: number
}

export async function calculateEstimate(
  inputs: MeasurementInput[],
  tenantId: string,
  tier: 'good' | 'better' | 'best'
): Promise<EstimateResult> {
  const lines: EstimateLineItem[] = []
  let subtotal = 0, totalMaterials = 0, totalLabor = 0, totalAddons = 0

  for (const input of inputs) {
    // 1. Load product
    const [prod] = await db.select().from(estimatorProduct)
      .where(and(eq(estimatorProduct.id, input.productId), eq(estimatorProduct.tenantId, tenantId)))
      .limit(1)
    if (!prod) throw new Error(`Product ${input.productId} not found`)

    // 2. Load material tier
    const [mat] = await db.select().from(estimatorMaterialTier)
      .where(and(eq(estimatorMaterialTier.productId, input.productId), eq(estimatorMaterialTier.tier, tier)))
      .limit(1)
    if (!mat) throw new Error(`No ${tier} tier for product ${input.productId}`)

    // 3. Pitch multiplier
    let pitchMult = 1
    if (prod.pitchAdjustable && input.pitch) {
      const [pm] = await db.select().from(pitchMultiplier)
        .where(and(eq(pitchMultiplier.tenantId, tenantId), eq(pitchMultiplier.pitch, input.pitch)))
        .limit(1)
      if (pm) pitchMult = Number(pm.multiplier)
    }

    // 4. Waste factor
    const waste = input.wasteFactor ?? Number(prod.defaultWasteFactor)

    // 5. Adjusted measurement
    const adjusted = input.measurement * pitchMult * waste

    // 6. Materials
    const matCost = adjusted * Number(mat.materialCostPerUnit)

    // 7. Labor
    const labCost = adjusted * Number(prod.laborRate)

    // 8. Addons
    const addonLines: AddonLineItem[] = []
    let addonsSum = 0
    if (input.selectedAddons.length > 0) {
      const allAddons = await db.select().from(estimatorAddon)
        .where(eq(estimatorAddon.productId, input.productId))
      for (const sa of input.selectedAddons) {
        const a = allAddons.find(x => x.id === sa)
        if (!a) continue
        let qty = 1, total = Number(a.price)
        if (a.pricingType === 'per_unit' || a.pricingType === 'per_sq_ft') {
          qty = adjusted
          total = Number(a.price) * adjusted
        }
        addonLines.push({ addonId: a.id, name: a.name, pricingType: a.pricingType, unitPrice: Number(a.price), quantity: qty, total })
        addonsSum += total
      }
    }

    // 9. Setup fee + minimum
    const setup = Number(prod.setupFee) || 0
    const par = matCost + labCost + addonsSum + setup
    const minimum = Number(prod.minimumCharge) || 0
    const finalPar = Math.max(par, minimum)

    // 10. Markup tiers
    const markupPct = Number(prod.retailMarkupPct) || 100
    const retail = finalPar * (1 + markupPct / 100)
    const yr1 = retail * (1 + Number(prod.yr1MarkupPct) / 100)
    const day30 = retail * (1 + Number(prod.day30MarkupPct) / 100)
    const today = retail * (1 - Number(prod.todayDiscountPct) / 100)

    const line: EstimateLineItem = {
      productId: input.productId,
      productName: prod.name,
      tier,
      rawMeasurement: input.measurement,
      unit: prod.measurementUnit,
      pitchMultiplier: pitchMult,
      wasteFactor: waste,
      adjustedMeasurement: Math.round(adjusted * 100) / 100,
      materialName: mat.materialName,
      materialCostPerUnit: Number(mat.materialCostPerUnit),
      totalMaterials: Math.round(matCost * 100) / 100,
      laborRate: Number(prod.laborRate),
      totalLabor: Math.round(labCost * 100) / 100,
      addons: addonLines,
      totalAddons: Math.round(addonsSum * 100) / 100,
      setupFee: setup,
      parPrice: Math.round(finalPar * 100) / 100,
      retailPrice: Math.round(retail * 100) / 100,
      yr1Price: Math.round(yr1 * 100) / 100,
      day30Price: Math.round(day30 * 100) / 100,
      todayPrice: Math.round(today * 100) / 100,
      lineTotal: Math.round(today * 100) / 100,
    }

    lines.push(line)
    subtotal += line.todayPrice
    totalMaterials += line.totalMaterials
    totalLabor += line.totalLabor
    totalAddons += line.totalAddons
  }

  return {
    lines,
    subtotal: Math.round(subtotal * 100) / 100,
    totalMaterials: Math.round(totalMaterials * 100) / 100,
    totalLabor: Math.round(totalLabor * 100) / 100,
    totalAddons: Math.round(totalAddons * 100) / 100,
  }
}
