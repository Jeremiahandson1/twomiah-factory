import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()

// ── Traceability (PUBLIC — no auth, for consumer QR scans) ───────────────

// Full traceability chain for consumers
app.get('/trace/:productId', async (c) => {
  const productId = c.req.param('productId')

  // Get product
  const productResult = await db.execute(sql`
    SELECT p.id, p.name, p.strain, p.strain_type, p.category, p.thc_percent, p.cbd_percent,
           p.weight, p.weight_unit, p.description, p.image_url
    FROM products p
    WHERE p.id = ${productId} AND p.active = true
  `)
  const product = ((productResult as any).rows || productResult)?.[0]
  if (!product) return c.json({ error: 'Product not found' }, 404)

  // Get the company for this product
  const companyResult = await db.execute(sql`
    SELECT c.name, c.license_number
    FROM company c
    JOIN products p ON p.company_id = c.id
    WHERE p.id = ${productId}
  `)
  const company = ((companyResult as any).rows || companyResult)?.[0]

  // Get batch info (latest active batch for this product)
  const batchResult = await db.execute(sql`
    SELECT b.id, b.batch_number, b.received_date, b.supplier, b.supplier_license,
           b.manufacturing_date, b.metrc_tag
    FROM batches b
    WHERE b.product_id = ${productId}
      AND b.status = 'active'
    ORDER BY b.created_at DESC
    LIMIT 1
  `)
  const batch = ((batchResult as any).rows || batchResult)?.[0]

  // Get lab results
  let labResults = null
  if (batch) {
    const labResult = await db.execute(sql`
      SELECT lt.total_thc, lt.total_cbd, lt.terpenes, lt.tested_at, lt.lab_name,
             lt.passed, lt.pesticides_pass, lt.heavy_metals_pass, lt.microbial_pass,
             lt.mycotoxins_pass, lt.residual_solvents_pass, lt.moisture_pass,
             lt.coa_url
      FROM lab_tests lt
      WHERE lt.batch_id = ${batch.id}
      ORDER BY lt.tested_at DESC
      LIMIT 1
    `)
    labResults = ((labResult as any).rows || labResult)?.[0] || null
  }

  // Get grow inputs used (traceability chain: batch -> plant applications + batch applications)
  let growInputs: any[] = []
  if (batch) {
    // Direct batch applications
    const batchInputsResult = await db.execute(sql`
      SELECT DISTINCT gi.name, gi.brand, gi.type, gi.is_organic, gi.active_ingredients
      FROM input_applications ia
      JOIN grow_inputs gi ON gi.id = ia.grow_input_id
      WHERE ia.batch_id = ${batch.id}
    `)
    const batchInputs = (batchInputsResult as any).rows || batchInputsResult

    // Plant-level applications (via harvest)
    const plantInputsResult = await db.execute(sql`
      SELECT DISTINCT gi.name, gi.brand, gi.type, gi.is_organic, gi.active_ingredients
      FROM input_applications ia
      JOIN grow_inputs gi ON gi.id = ia.grow_input_id
      JOIN plants p ON p.id = ia.plant_id
      JOIN harvests h ON h.id = p.harvest_id
      JOIN batches b ON (b.id = h.batch_id OR b.harvest_id = h.id)
      WHERE b.product_id = ${productId}
    `)
    const plantInputs = (plantInputsResult as any).rows || plantInputsResult

    // Deduplicate by name
    const seen = new Set<string>()
    for (const input of [...batchInputs, ...plantInputs]) {
      if (!seen.has(input.name)) {
        seen.add(input.name)
        growInputs.push({
          name: input.name,
          brand: input.brand,
          type: input.type,
          organic: input.is_organic,
          activeIngredients: input.active_ingredients,
        })
      }
    }
  }

  // Get certifications from input policies (if all organic, show organic badge)
  const certifications: string[] = []
  if (growInputs.length > 0 && growInputs.every((gi) => gi.organic)) {
    certifications.push('All Organic Inputs')
  }

  return c.json({
    product: {
      name: product.name,
      strain: product.strain,
      strainType: product.strain_type,
      category: product.category,
      thc: product.thc_percent,
      cbd: product.cbd_percent,
      weight: product.weight,
      weightUnit: product.weight_unit,
      description: product.description,
      imageUrl: product.image_url,
    },
    batch: batch ? {
      batchNumber: batch.batch_number,
      receivedDate: batch.received_date,
      supplier: batch.supplier,
      manufacturingDate: batch.manufacturing_date,
      metrcTag: batch.metrc_tag,
    } : null,
    labResults: labResults ? {
      thc: labResults.total_thc,
      cbd: labResults.total_cbd,
      terpenes: labResults.terpenes,
      testedAt: labResults.tested_at,
      labName: labResults.lab_name,
      passed: labResults.passed,
      contaminantTests: {
        pesticides: labResults.pesticides_pass,
        heavyMetals: labResults.heavy_metals_pass,
        microbial: labResults.microbial_pass,
        mycotoxins: labResults.mycotoxins_pass,
        residualSolvents: labResults.residual_solvents_pass,
        moisture: labResults.moisture_pass,
      },
      coaUrl: labResults.coa_url,
    } : null,
    growInputs,
    certifications,
    company: company ? {
      name: company.name,
      licenseNumber: company.license_number,
    } : null,
  })
})

// ── Authenticated routes below ───────────────────────────────────────────
app.use('*', authenticate)

// ── QR Code Generation ───────────────────────────────────────────────────

// Generate QR code data for any entity
app.get('/generate/:entityType/:entityId', async (c) => {
  const currentUser = c.get('user') as any
  const entityType = c.req.param('entityType')
  const entityId = c.req.param('entityId')

  const validTypes = ['product', 'batch', 'plant', 'grow_input']
  if (!validTypes.includes(entityType)) {
    return c.json({ error: `Invalid entity type. Must be one of: ${validTypes.join(', ')}` }, 400)
  }

  let qrData: any = null

  if (entityType === 'product') {
    const productResult = await db.execute(sql`
      SELECT p.* FROM products p
      WHERE p.id = ${entityId} AND p.company_id = ${currentUser.companyId}
    `)
    const product = ((productResult as any).rows || productResult)?.[0]
    if (!product) return c.json({ error: 'Product not found' }, 404)

    // Get latest batch
    const batchResult = await db.execute(sql`
      SELECT b.batch_number, b.metrc_tag FROM batches b
      WHERE b.product_id = ${entityId} AND b.status = 'active'
      ORDER BY b.created_at DESC LIMIT 1
    `)
    const batch = ((batchResult as any).rows || batchResult)?.[0]

    // Get lab results from latest batch
    let labResults = null
    if (batch) {
      const labResult = await db.execute(sql`
        SELECT lt.total_thc, lt.total_cbd, lt.terpenes, lt.passed as pesticides_status
        FROM lab_tests lt
        JOIN batches b ON b.id = lt.batch_id
        WHERE b.product_id = ${entityId}
        ORDER BY lt.tested_at DESC LIMIT 1
      `)
      labResults = ((labResult as any).rows || labResult)?.[0]
    }

    // Get grow inputs chain
    const inputsResult = await db.execute(sql`
      SELECT DISTINCT gi.name, gi.brand, gi.type, gi.is_organic
      FROM input_applications ia
      JOIN grow_inputs gi ON gi.id = ia.grow_input_id
      WHERE (ia.batch_id IN (SELECT id FROM batches WHERE product_id = ${entityId})
             OR ia.plant_id IN (SELECT p.id FROM plants p JOIN harvests h ON h.id = p.harvest_id JOIN batches b ON (b.id = h.batch_id OR b.harvest_id = h.id) WHERE b.product_id = ${entityId}))
        AND ia.company_id = ${currentUser.companyId}
    `)
    const inputs = (inputsResult as any).rows || inputsResult

    qrData = {
      type: 'product',
      id: product.id,
      name: product.name,
      strain: product.strain,
      thc: product.thc_percent,
      cbd: product.cbd_percent,
      price: product.price,
      batchNumber: batch?.batch_number || null,
      metrcTag: batch?.metrc_tag || product.metrc_tag || null,
      labResults: labResults ? {
        thc: labResults.total_thc,
        cbd: labResults.total_cbd,
        terpenes: labResults.terpenes,
        pesticides: labResults.pesticides_status ? 'pass' : 'fail',
      } : null,
      growInputs: inputs.map((i: any) => ({
        name: i.name,
        brand: i.brand,
        type: i.type,
        organic: i.is_organic,
      })),
    }
  } else if (entityType === 'batch') {
    const batchResult = await db.execute(sql`
      SELECT b.*, p.name as product_name
      FROM batches b
      LEFT JOIN products p ON p.id = b.product_id
      WHERE b.id = ${entityId} AND b.company_id = ${currentUser.companyId}
    `)
    const batch = ((batchResult as any).rows || batchResult)?.[0]
    if (!batch) return c.json({ error: 'Batch not found' }, 404)

    // Lab tested?
    const labResult = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM lab_tests
      WHERE batch_id = ${entityId}
    `)
    const labTested = Number(((labResult as any).rows || labResult)?.[0]?.count || 0) > 0

    // Get inputs
    const inputsResult = await db.execute(sql`
      SELECT DISTINCT gi.name, gi.brand, gi.type, gi.is_organic
      FROM input_applications ia
      JOIN grow_inputs gi ON gi.id = ia.grow_input_id
      WHERE ia.batch_id = ${entityId}
        AND ia.company_id = ${currentUser.companyId}
    `)
    const inputs = (inputsResult as any).rows || inputsResult

    qrData = {
      type: 'batch',
      batchNumber: batch.batch_number,
      product: batch.product_name,
      status: batch.status,
      manufacturer: batch.supplier,
      receivedDate: batch.received_date,
      labTested,
      inputs: inputs.map((i: any) => ({
        name: i.name,
        brand: i.brand,
        type: i.type,
        organic: i.is_organic,
      })),
    }
  } else if (entityType === 'grow_input') {
    const inputResult = await db.execute(sql`
      SELECT * FROM grow_inputs
      WHERE id = ${entityId} AND company_id = ${currentUser.companyId}
    `)
    const input = ((inputResult as any).rows || inputResult)?.[0]
    if (!input) return c.json({ error: 'Grow input not found' }, 404)

    qrData = {
      type: 'input',
      name: input.name,
      brand: input.brand,
      type_detail: input.type,
      organic: input.is_organic,
      ingredients: input.active_ingredients,
      sds_url: input.sds_url,
    }
  } else if (entityType === 'plant') {
    const plantResult = await db.execute(sql`
      SELECT * FROM plants
      WHERE id = ${entityId} AND company_id = ${currentUser.companyId}
    `)
    const plant = ((plantResult as any).rows || plantResult)?.[0]
    if (!plant) return c.json({ error: 'Plant not found' }, 404)

    // Get inputs applied to this plant
    const inputsResult = await db.execute(sql`
      SELECT DISTINCT gi.name, gi.brand, gi.type, gi.is_organic
      FROM input_applications ia
      JOIN grow_inputs gi ON gi.id = ia.grow_input_id
      WHERE ia.plant_id = ${entityId}
        AND ia.company_id = ${currentUser.companyId}
    `)
    const inputs = (inputsResult as any).rows || inputsResult

    qrData = {
      type: 'plant',
      metrcTag: plant.metrc_tag,
      strain: plant.strain_name,
      phase: plant.phase,
      plantDate: plant.plant_date,
      inputs: inputs.map((i: any) => ({
        name: i.name,
        brand: i.brand,
        type: i.type,
        organic: i.is_organic,
      })),
    }
  }

  return c.json(qrData)
})

// ── QR Code Scanning ─────────────────────────────────────────────────────

// Process a QR scan
app.post('/scan', async (c) => {
  const currentUser = c.get('user') as any

  const scanSchema = z.object({
    data: z.string().min(1),
    context: z.enum(['pos_checkout', 'inventory_count', 'customer_info', 'input_application', 'receiving']),
    scannerType: z.enum(['camera', 'dedicated_reader', 'mobile_app']).default('camera'),
  })
  const body = scanSchema.parse(await c.req.json())

  // Parse QR data
  let parsed: any = null
  try {
    parsed = JSON.parse(body.data)
  } catch {
    // Fall back to plain text lookup — try as ID or metrc tag
    parsed = { rawText: body.data }
  }

  let entityType: string | null = null
  let entityId: string | null = null
  let responseData: any = null

  if (parsed.type && parsed.id) {
    // Structured QR data
    entityType = parsed.type
    entityId = parsed.id
  } else if (parsed.type === 'batch' && parsed.batchNumber) {
    entityType = 'batch'
    // Look up batch by number
    const batchResult = await db.execute(sql`
      SELECT id FROM batches
      WHERE batch_number = ${parsed.batchNumber}
        AND company_id = ${currentUser.companyId}
      LIMIT 1
    `)
    entityId = ((batchResult as any).rows || batchResult)?.[0]?.id || null
  } else if (parsed.type === 'input' && parsed.name) {
    entityType = 'grow_input'
    const inputResult = await db.execute(sql`
      SELECT id FROM grow_inputs
      WHERE name = ${parsed.name}
        AND company_id = ${currentUser.companyId}
      LIMIT 1
    `)
    entityId = ((inputResult as any).rows || inputResult)?.[0]?.id || null
  } else if (parsed.type === 'plant' && parsed.metrcTag) {
    entityType = 'plant'
    const plantResult = await db.execute(sql`
      SELECT id FROM plants
      WHERE metrc_tag = ${parsed.metrcTag}
        AND company_id = ${currentUser.companyId}
      LIMIT 1
    `)
    entityId = ((plantResult as any).rows || plantResult)?.[0]?.id || null
  } else if (parsed.rawText) {
    // Try to find by metrc tag, barcode, SKU, or batch number
    const text = parsed.rawText

    // Try product barcode/sku
    const productResult = await db.execute(sql`
      SELECT id FROM products
      WHERE (barcode = ${text} OR sku = ${text} OR metrc_tag = ${text})
        AND company_id = ${currentUser.companyId}
      LIMIT 1
    `)
    const foundProduct = ((productResult as any).rows || productResult)?.[0]
    if (foundProduct) {
      entityType = 'product'
      entityId = foundProduct.id
    }

    // Try batch number
    if (!entityId) {
      const batchResult = await db.execute(sql`
        SELECT id FROM batches
        WHERE (batch_number = ${text} OR metrc_tag = ${text})
          AND company_id = ${currentUser.companyId}
        LIMIT 1
      `)
      const foundBatch = ((batchResult as any).rows || batchResult)?.[0]
      if (foundBatch) {
        entityType = 'batch'
        entityId = foundBatch.id
      }
    }

    // Try plant metrc tag
    if (!entityId) {
      const plantResult = await db.execute(sql`
        SELECT id FROM plants
        WHERE metrc_tag = ${text}
          AND company_id = ${currentUser.companyId}
        LIMIT 1
      `)
      const foundPlant = ((plantResult as any).rows || plantResult)?.[0]
      if (foundPlant) {
        entityType = 'plant'
        entityId = foundPlant.id
      }
    }

    // Try grow input by name
    if (!entityId) {
      const inputResult = await db.execute(sql`
        SELECT id FROM grow_inputs
        WHERE name = ${text}
          AND company_id = ${currentUser.companyId}
        LIMIT 1
      `)
      const foundInput = ((inputResult as any).rows || inputResult)?.[0]
      if (foundInput) {
        entityType = 'grow_input'
        entityId = foundInput.id
      }
    }
  }

  if (!entityType || !entityId) {
    // Log failed scan
    await db.execute(sql`
      INSERT INTO qr_scan_events(id, company_id, raw_data, context, scanner_type, entity_type, entity_id, success, scanned_by, created_at)
      VALUES (gen_random_uuid(), ${currentUser.companyId}, ${body.data}, ${body.context}, ${body.scannerType}, NULL, NULL, false, ${currentUser.id}, NOW())
    `)
    return c.json({ error: 'Could not identify scanned entity', rawData: body.data }, 404)
  }

  // Fetch full entity data based on type
  if (entityType === 'product') {
    const productResult = await db.execute(sql`
      SELECT p.* FROM products p
      WHERE p.id = ${entityId} AND p.company_id = ${currentUser.companyId}
    `)
    const product = ((productResult as any).rows || productResult)?.[0]
    if (!product) return c.json({ error: 'Product not found' }, 404)

    // Get batch + lab
    const batchResult = await db.execute(sql`
      SELECT b.* FROM batches b
      WHERE b.product_id = ${entityId} AND b.status = 'active'
      ORDER BY b.created_at DESC LIMIT 1
    `)
    const batch = ((batchResult as any).rows || batchResult)?.[0]

    let labResults = null
    if (batch) {
      const labResult = await db.execute(sql`
        SELECT * FROM lab_tests
        WHERE batch_id = ${batch.id}
        ORDER BY tested_at DESC LIMIT 1
      `)
      labResults = ((labResult as any).rows || labResult)?.[0]
    }

    // Get grow inputs chain
    const inputsResult = await db.execute(sql`
      SELECT DISTINCT gi.name, gi.brand, gi.type, gi.is_organic
      FROM input_applications ia
      JOIN grow_inputs gi ON gi.id = ia.grow_input_id
      WHERE (ia.batch_id IN (SELECT id FROM batches WHERE product_id = ${entityId})
             OR ia.plant_id IN (SELECT pl.id FROM plants pl JOIN harvests h ON h.id = pl.harvest_id JOIN batches b2 ON (b2.id = h.batch_id OR b2.harvest_id = h.id) WHERE b2.product_id = ${entityId}))
        AND ia.company_id = ${currentUser.companyId}
    `)
    const inputs = (inputsResult as any).rows || inputsResult

    responseData = {
      entityType: 'product',
      product,
      batch: batch || null,
      labResults: labResults || null,
      growInputs: inputs,
      price: product.price,
    }

    if (body.context === 'pos_checkout') {
      responseData.addToCart = true
      responseData.productId = product.id
      responseData.price = product.price
    }
  } else if (entityType === 'batch') {
    const batchResult = await db.execute(sql`
      SELECT b.*, p.name as product_name, p.sku as product_sku
      FROM batches b
      LEFT JOIN products p ON p.id = b.product_id
      WHERE b.id = ${entityId} AND b.company_id = ${currentUser.companyId}
    `)
    const batch = ((batchResult as any).rows || batchResult)?.[0]
    if (!batch) return c.json({ error: 'Batch not found' }, 404)

    const labResult = await db.execute(sql`
      SELECT * FROM lab_tests
      WHERE batch_id = ${entityId}
      ORDER BY tested_at DESC LIMIT 1
    `)
    const labTest = ((labResult as any).rows || labResult)?.[0]

    const inputsResult = await db.execute(sql`
      SELECT DISTINCT gi.name, gi.brand, gi.type, gi.is_organic
      FROM input_applications ia
      JOIN grow_inputs gi ON gi.id = ia.grow_input_id
      WHERE ia.batch_id = ${entityId}
        AND ia.company_id = ${currentUser.companyId}
    `)
    const inputs = (inputsResult as any).rows || inputsResult

    responseData = {
      entityType: 'batch',
      batch,
      labTest: labTest || null,
      inputs,
    }
  } else if (entityType === 'grow_input') {
    const inputResult = await db.execute(sql`
      SELECT * FROM grow_inputs
      WHERE id = ${entityId} AND company_id = ${currentUser.companyId}
    `)
    const input = ((inputResult as any).rows || inputResult)?.[0]
    if (!input) return c.json({ error: 'Grow input not found' }, 404)

    const recentAppsResult = await db.execute(sql`
      SELECT ia.*, p.strain_name as plant_strain, b.batch_number
      FROM input_applications ia
      LEFT JOIN plants p ON p.id = ia.plant_id
      LEFT JOIN batches b ON b.id = ia.batch_id
      WHERE ia.grow_input_id = ${entityId}
        AND ia.company_id = ${currentUser.companyId}
      ORDER BY ia.created_at DESC LIMIT 10
    `)
    const recentApplications = (recentAppsResult as any).rows || recentAppsResult

    responseData = {
      entityType: 'grow_input',
      input,
      recentApplications,
    }

    // If context is input_application, add compliance check
    if (body.context === 'input_application') {
      const policiesResult = await db.execute(sql`
        SELECT * FROM input_policies
        WHERE company_id = ${currentUser.companyId}
      `)
      const policies = (policiesResult as any).rows || policiesResult
      const violations: string[] = []
      const ingredients: string[] = Array.isArray(input.active_ingredients) ? input.active_ingredients : []

      for (const policy of policies) {
        const banned = Array.isArray(policy.banned_ingredients) ? policy.banned_ingredients : []
        for (const ingredient of ingredients) {
          if (banned.map((b: string) => b.toLowerCase()).includes(ingredient.toLowerCase())) {
            violations.push(`"${ingredient}" is banned by policy "${policy.name}"`)
          }
        }
        const rules = Array.isArray(policy.rules) ? policy.rules : []
        for (const rule of rules) {
          if (rule.type === 'organic_only' && !input.is_organic) {
            violations.push(`Policy "${policy.name}" requires organic inputs only`)
          }
        }
      }

      responseData.complianceCheck = {
        compliant: violations.length === 0,
        violations,
      }
    }
  } else if (entityType === 'plant') {
    const plantResult = await db.execute(sql`
      SELECT p.*, gr.name as room_name
      FROM plants p
      LEFT JOIN grow_rooms gr ON gr.id = p.room_id
      WHERE p.id = ${entityId} AND p.company_id = ${currentUser.companyId}
    `)
    const plant = ((plantResult as any).rows || plantResult)?.[0]
    if (!plant) return c.json({ error: 'Plant not found' }, 404)

    const inputsResult = await db.execute(sql`
      SELECT ia.*, gi.name as input_name, gi.brand as input_brand, gi.type as input_type, gi.is_organic
      FROM input_applications ia
      JOIN grow_inputs gi ON gi.id = ia.grow_input_id
      WHERE ia.plant_id = ${entityId}
        AND ia.company_id = ${currentUser.companyId}
      ORDER BY ia.created_at DESC
    `)
    const inputs = (inputsResult as any).rows || inputsResult

    responseData = {
      entityType: 'plant',
      plant,
      inputApplications: inputs,
    }
  }

  // Log successful scan event
  await db.execute(sql`
    INSERT INTO qr_scan_events(id, company_id, raw_data, context, scanner_type, entity_type, entity_id, success, scanned_by, created_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${body.data}, ${body.context}, ${body.scannerType}, ${entityType}, ${entityId}, true, ${currentUser.id}, NOW())
  `)

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'qr_scan',
    entityId,
    entityName: `${entityType}:${entityId}`,
    metadata: { context: body.context, scannerType: body.scannerType, entityType },
    req: c.req,
  })

  return c.json(responseData)
})

// ── Scan Analytics ───────────────────────────────────────────────────────

// QR scan analytics (manager+)
app.get('/analytics', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  // Total scans by entity type
  const byTypeResult = await db.execute(sql`
    SELECT entity_type, COUNT(*)::int as count
    FROM qr_scan_events
    WHERE company_id = ${currentUser.companyId}
      AND success = true
    GROUP BY entity_type
    ORDER BY count DESC
  `)
  const scansByType = (byTypeResult as any).rows || byTypeResult

  // Total scans by context
  const byContextResult = await db.execute(sql`
    SELECT context, COUNT(*)::int as count
    FROM qr_scan_events
    WHERE company_id = ${currentUser.companyId}
      AND success = true
    GROUP BY context
    ORDER BY count DESC
  `)
  const scansByContext = (byContextResult as any).rows || byContextResult

  // Scans by day (last 30 days)
  const byDayResult = await db.execute(sql`
    SELECT DATE(created_at) as date, COUNT(*)::int as count
    FROM qr_scan_events
    WHERE company_id = ${currentUser.companyId}
      AND success = true
      AND created_at >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `)
  const scansByDay = (byDayResult as any).rows || byDayResult

  // Most scanned products
  const topProductsResult = await db.execute(sql`
    SELECT qse.entity_id, p.name as product_name, COUNT(*)::int as scan_count
    FROM qr_scan_events qse
    JOIN products p ON p.id = qse.entity_id
    WHERE qse.company_id = ${currentUser.companyId}
      AND qse.entity_type = 'product'
      AND qse.success = true
    GROUP BY qse.entity_id, p.name
    ORDER BY scan_count DESC
    LIMIT 20
  `)
  const topProducts = (topProductsResult as any).rows || topProductsResult

  // Scan heatmap by hour
  const heatmapResult = await db.execute(sql`
    SELECT EXTRACT(HOUR FROM created_at)::int as hour, COUNT(*)::int as count
    FROM qr_scan_events
    WHERE company_id = ${currentUser.companyId}
      AND success = true
      AND created_at >= NOW() - INTERVAL '30 days'
    GROUP BY EXTRACT(HOUR FROM created_at)
    ORDER BY hour ASC
  `)
  const scanHeatmap = (heatmapResult as any).rows || heatmapResult

  // Total + failed scans
  const totalsResult = await db.execute(sql`
    SELECT
      COUNT(*)::int as total_scans,
      COUNT(*) FILTER (WHERE success = true)::int as successful_scans,
      COUNT(*) FILTER (WHERE success = false)::int as failed_scans
    FROM qr_scan_events
    WHERE company_id = ${currentUser.companyId}
  `)
  const totals = ((totalsResult as any).rows || totalsResult)?.[0]

  return c.json({
    totals,
    scansByType,
    scansByContext,
    scansByDay,
    topProducts,
    scanHeatmap,
  })
})

export default app
