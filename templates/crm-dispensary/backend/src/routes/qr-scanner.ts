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
      JOIN batches b ON b.id = p.batch_id
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

// Build the QR payload for any traceable entity. Shared by the GET (path params) and
// POST (JSON body) generate routes. Returns { qrData } or { error, status }.
async function buildQrData(companyId: string, entityType: string, entityId: string): Promise<{ qrData?: any; error?: string; status?: number }> {
  const validTypes = ['product', 'batch', 'plant', 'grow_input']
  if (!validTypes.includes(entityType)) {
    return { error: `Invalid entity type. Must be one of: ${validTypes.join(', ')}`, status: 400 }
  }

  const currentUser = { companyId }
  let qrData: any = null

  if (entityType === 'product') {
    const productResult = await db.execute(sql`
      SELECT p.* FROM products p
      WHERE p.id = ${entityId} AND p.company_id = ${currentUser.companyId}
    `)
    const product = ((productResult as any).rows || productResult)?.[0]
    if (!product) return { error: 'Product not found', status: 404 }

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
             OR ia.plant_id IN (SELECT p.id FROM plants p WHERE p.batch_id IN (SELECT id FROM batches WHERE product_id = ${entityId})))
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
    if (!batch) return { error: 'Batch not found', status: 404 }

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
    if (!input) return { error: 'Grow input not found', status: 404 }

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
    if (!plant) return { error: 'Plant not found', status: 404 }

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

  return { qrData }
}

// Generate QR code data for any entity (path params)
app.get('/generate/:entityType/:entityId', async (c) => {
  const currentUser = c.get('user') as any
  const res = await buildQrData(currentUser.companyId, c.req.param('entityType'), c.req.param('entityId'))
  if (res.error) return c.json({ error: res.error }, (res.status as any) || 400)
  return c.json(res.qrData)
})

// Generate QR code data from a JSON body — used by the QR Scanner "Generate" tab, which
// wraps the payload for preview/copy/print. { entityType, entityId } → { payload, ... }.
app.post('/generate', async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json().catch(() => ({}))
  const entityType = (body?.entityType || '').toString()
  const entityId = (body?.entityId || '').toString()
  if (!entityType || !entityId) return c.json({ error: 'entityType and entityId are required' }, 400)

  const res = await buildQrData(currentUser.companyId, entityType, entityId)
  if (res.error) return c.json({ error: res.error }, (res.status as any) || 400)
  return c.json({ entityType, entityId, payload: res.qrData })
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
      WHERE (id = ${text} OR barcode = ${text} OR sku = ${text} OR metrc_tag = ${text})
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
        WHERE (id = ${text} OR batch_number = ${text} OR metrc_tag = ${text})
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
        WHERE (id = ${text} OR metrc_tag = ${text})
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
        WHERE (id = ${text} OR name = ${text})
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
    // No matching entity found. qr_scan_events.entity_type / entity_id are NOT NULL,
    // so a failed scan cannot be logged as a row — just return 404.
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
             OR ia.plant_id IN (SELECT pl.id FROM plants pl WHERE pl.batch_id IN (SELECT id FROM batches WHERE product_id = ${entityId})))
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
    INSERT INTO qr_scan_events(id, company_id, entity_type, entity_id, scanner_type, context, scanned_by, result_action, created_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${entityType}, ${entityId}, ${body.scannerType}, ${body.context}, ${currentUser.userId}, ${body.context === 'pos_checkout' ? 'added_to_cart' : 'identified'}, NOW())
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

// ── Scan History ─────────────────────────────────────────────────────────

// Recent scans for the scanner panel. The page called GET /history but no such route
// existed → 404 → "No recent scans" forever. Return recent scan events with the entity
// name resolved for the label. (retest#11)
app.get('/history', async (c) => {
  const currentUser = c.get('user') as any
  const limit = Math.min(50, Math.max(1, +(c.req.query('limit') || '20')))
  const result = await db.execute(sql`
    SELECT qse.id, qse.entity_type, qse.entity_id, qse.context, qse.result_action, qse.created_at as scanned_at,
           COALESCE(p.name, b.batch_number, gi.name, pl.metrc_tag) as label
    FROM qr_scan_events qse
    LEFT JOIN products p ON p.id = qse.entity_id AND qse.entity_type = 'product'
    LEFT JOIN batches b ON b.id = qse.entity_id AND qse.entity_type = 'batch'
    LEFT JOIN grow_inputs gi ON gi.id = qse.entity_id AND qse.entity_type = 'grow_input'
    LEFT JOIN plants pl ON pl.id = qse.entity_id AND qse.entity_type = 'plant'
    WHERE qse.company_id = ${currentUser.companyId}
    ORDER BY qse.created_at DESC
    LIMIT ${limit}
  `)
  const rows = (result as any).rows || result
  const data = rows.map((r: any) => ({
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    data: r.entity_id,          // clicking re-scans by id (the /scan route resolves ids)
    label: r.label || r.entity_id,
    context: r.context,
    resultAction: r.result_action,
    scannedAt: r.scanned_at,
  }))
  return c.json(data)
})

// ── Scan Analytics ───────────────────────────────────────────────────────

// Analytics summary tiles for the QR Scanner "Analytics" tab.
app.get('/analytics/stats', async (c) => {
  const currentUser = c.get('user') as any
  const cid = currentUser.companyId

  const totalsResult = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int as today,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('week', now()))::int as this_week,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int as this_month,
      COUNT(*)::int as all_time
    FROM qr_scan_events
    WHERE company_id = ${cid}
  `)
  const t = ((totalsResult as any).rows || totalsResult)?.[0] || {}

  const byTypeResult = await db.execute(sql`
    SELECT entity_type as type, COUNT(*)::int as count
    FROM qr_scan_events WHERE company_id = ${cid}
    GROUP BY entity_type ORDER BY count DESC
  `)
  const byContextResult = await db.execute(sql`
    SELECT context, COUNT(*)::int as count
    FROM qr_scan_events WHERE company_id = ${cid}
    GROUP BY context ORDER BY count DESC
  `)

  return c.json({
    today: Number(t.today || 0),
    thisWeek: Number(t.this_week || 0),
    thisMonth: Number(t.this_month || 0),
    allTime: Number(t.all_time || 0),
    byEntityType: ((byTypeResult as any).rows || byTypeResult).map((r: any) => ({ type: r.type, count: Number(r.count || 0) })),
    byContext: ((byContextResult as any).rows || byContextResult).map((r: any) => ({ context: r.context, count: Number(r.count || 0) })),
  })
})

// Most-scanned products and grow inputs for the Analytics tab tables.
app.get('/analytics/top-scanned', async (c) => {
  const currentUser = c.get('user') as any
  const cid = currentUser.companyId

  const productsResult = await db.execute(sql`
    SELECT qse.entity_id as id, p.name, COUNT(*)::int as scan_count
    FROM qr_scan_events qse
    JOIN products p ON p.id = qse.entity_id
    WHERE qse.company_id = ${cid} AND qse.entity_type = 'product'
    GROUP BY qse.entity_id, p.name
    ORDER BY scan_count DESC LIMIT 10
  `)
  const inputsResult = await db.execute(sql`
    SELECT qse.entity_id as id, gi.name, COUNT(*)::int as scan_count
    FROM qr_scan_events qse
    JOIN grow_inputs gi ON gi.id = qse.entity_id
    WHERE qse.company_id = ${cid} AND qse.entity_type = 'grow_input'
    GROUP BY qse.entity_id, gi.name
    ORDER BY scan_count DESC LIMIT 10
  `)

  const shape = (rows: any[]) => rows.map((r: any) => ({ id: r.id, name: r.name, scanCount: Number(r.scan_count || 0) }))
  return c.json({
    products: shape((productsResult as any).rows || productsResult),
    inputs: shape((inputsResult as any).rows || inputsResult),
  })
})

// QR scan analytics (manager+)
app.get('/analytics', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  // Total scans by entity type
  const byTypeResult = await db.execute(sql`
    SELECT entity_type, COUNT(*)::int as count
    FROM qr_scan_events
    WHERE company_id = ${currentUser.companyId}
    GROUP BY entity_type
    ORDER BY count DESC
  `)
  const scansByType = (byTypeResult as any).rows || byTypeResult

  // Total scans by context
  const byContextResult = await db.execute(sql`
    SELECT context, COUNT(*)::int as count
    FROM qr_scan_events
    WHERE company_id = ${currentUser.companyId}
    GROUP BY context
    ORDER BY count DESC
  `)
  const scansByContext = (byContextResult as any).rows || byContextResult

  // Scans by day (last 30 days)
  const byDayResult = await db.execute(sql`
    SELECT DATE(created_at) as date, COUNT(*)::int as count
    FROM qr_scan_events
    WHERE company_id = ${currentUser.companyId}
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
      AND created_at >= NOW() - INTERVAL '30 days'
    GROUP BY EXTRACT(HOUR FROM created_at)
    ORDER BY hour ASC
  `)
  const scanHeatmap = (heatmapResult as any).rows || heatmapResult

  // Total + failed scans
  const totalsResult = await db.execute(sql`
    SELECT
      COUNT(*)::int as total_scans,
      COUNT(*)::int as successful_scans,
      0 as failed_scans
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
