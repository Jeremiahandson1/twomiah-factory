import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import crypto from 'crypto'

const app = new Hono()
app.use('*', authenticate)

// ============================================
// GENERATE WALLET PASS
// ============================================

// Generate a wallet pass for a customer
app.post('/generate', async (c) => {
  const currentUser = c.get('user') as any

  const generateSchema = z.object({
    contactId: z.string().min(1),
    platform: z.enum(['apple', 'google']),
  })
  const data = generateSchema.parse(await c.req.json())

  // Fetch loyalty member data
  const memberResult = await db.execute(sql`
    SELECT lm.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
    FROM loyalty_members lm
    JOIN contact c ON c.id = lm.contact_id
    WHERE lm.contact_id = ${data.contactId} AND lm.company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const member = ((memberResult as any).rows || memberResult)?.[0]
  if (!member) return c.json({ error: 'Customer is not a loyalty member' }, 404)

  // Get company info for branding
  const companyResult = await db.execute(sql`
    SELECT name, logo_url, primary_color FROM company
    WHERE id = ${currentUser.companyId}
    LIMIT 1
  `)
  const company = ((companyResult as any).rows || companyResult)?.[0]

  // Count active rewards
  const rewardsResult = await db.execute(sql`
    SELECT COUNT(*)::int as count FROM loyalty_rewards
    WHERE company_id = ${currentUser.companyId} AND active = true
  `)
  const rewardsCount = Number(((rewardsResult as any).rows || rewardsResult)?.[0]?.count || 0)

  const serialNumber = crypto.randomUUID()
  const authToken = crypto.randomBytes(32).toString('hex')

  let passData: any

  if (data.platform === 'apple') {
    // Build Apple Wallet pass.json structure
    passData = {
      formatVersion: 1,
      passTypeIdentifier: 'pass.com.dispensary.loyalty',
      serialNumber,
      teamIdentifier: 'TEAM_ID',
      organizationName: company?.name || 'Dispensary',
      description: `${company?.name || 'Dispensary'} Loyalty Card`,
      logoText: company?.name || 'Dispensary',
      foregroundColor: 'rgb(255, 255, 255)',
      backgroundColor: company?.primary_color || 'rgb(34, 139, 34)',
      loyaltyCard: {
        headerFields: [
          {
            key: 'tier',
            label: 'TIER',
            value: (member.tier || 'bronze').toUpperCase(),
          },
        ],
        primaryFields: [
          {
            key: 'points',
            label: 'POINTS',
            value: Number(member.points_balance) || 0,
          },
        ],
        secondaryFields: [
          {
            key: 'name',
            label: 'MEMBER',
            value: member.customer_name || '',
          },
          {
            key: 'rewards',
            label: 'AVAILABLE REWARDS',
            value: rewardsCount,
          },
        ],
        auxiliaryFields: [
          {
            key: 'visits',
            label: 'TOTAL VISITS',
            value: Number(member.total_visits) || 0,
          },
          {
            key: 'memberSince',
            label: 'MEMBER SINCE',
            value: new Date(member.created_at).toLocaleDateString(),
            dateStyle: 'PKDateStyleMedium',
          },
        ],
        backFields: [
          {
            key: 'memberId',
            label: 'Member ID',
            value: member.id,
          },
          {
            key: 'totalSpent',
            label: 'Total Spent',
            value: `$${Number(member.total_spent || 0).toFixed(2)}`,
          },
        ],
      },
      barcode: {
        format: 'PKBarcodeFormatQR',
        message: member.id,
        messageEncoding: 'iso-8859-1',
        altText: member.id,
      },
      barcodes: [
        {
          format: 'PKBarcodeFormatQR',
          message: member.id,
          messageEncoding: 'iso-8859-1',
          altText: member.id,
        },
      ],
    }
  } else {
    // Build Google Wallet Loyalty Object
    passData = {
      iss: 'dispensary-wallet@dispensary.iam.gserviceaccount.com',
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      payload: {
        loyaltyObjects: [
          {
            id: `dispensary.loyalty.${serialNumber}`,
            classId: `dispensary.loyalty_class_${currentUser.companyId}`,
            state: 'ACTIVE',
            accountId: member.id,
            accountName: member.customer_name || '',
            loyaltyPoints: {
              label: 'Points',
              balance: {
                int: Number(member.points_balance) || 0,
              },
            },
            barcode: {
              type: 'QR_CODE',
              value: member.id,
              alternateText: member.id,
            },
            textModulesData: [
              {
                header: 'Tier',
                body: (member.tier || 'bronze').toUpperCase(),
              },
              {
                header: 'Total Visits',
                body: String(Number(member.total_visits) || 0),
              },
              {
                header: 'Available Rewards',
                body: String(rewardsCount),
              },
            ],
          },
        ],
      },
    }
  }

  // Store wallet pass record
  const result = await db.execute(sql`
    INSERT INTO wallet_passes(id, contact_id, member_id, serial_number, auth_token, platform, pass_data, active, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.contactId}, ${member.id}, ${serialNumber}, ${authToken}, ${data.platform}, ${JSON.stringify(passData)}::jsonb, true, ${currentUser.companyId}, NOW(), NOW())
    RETURNING id, serial_number, platform, active, created_at
  `)

  const walletPass = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'wallet_pass',
    entityId: walletPass?.id,
    entityName: `${data.platform} pass for ${member.customer_name}`,
    metadata: { platform: data.platform, contactId: data.contactId, serialNumber },
    req: c.req,
  })

  if (data.platform === 'apple') {
    // Return base64-encoded pass data (in production, would be a signed .pkpass file)
    const encoded = Buffer.from(JSON.stringify(passData)).toString('base64')
    return c.json({ pass: encoded, serialNumber, format: 'base64', contentType: 'application/vnd.apple.pkpass' }, 201)
  } else {
    // Return Google Wallet save URL
    const jwtToken = Buffer.from(JSON.stringify(passData)).toString('base64url')
    const saveUrl = `https://pay.google.com/gp/v/save/${jwtToken}`
    return c.json({ saveUrl, serialNumber }, 201)
  }
})

// ============================================
// PASS DATA (for wallet app updates)
// ============================================

// Get pass data by serial number
app.get('/:serialNumber', async (c) => {
  const currentUser = c.get('user') as any
  const serialNumber = c.req.param('serialNumber')

  const passResult = await db.execute(sql`
    SELECT wp.*, lm.points_balance, lm.tier, lm.total_visits, lm.total_spent,
           c.name as customer_name
    FROM wallet_passes wp
    JOIN loyalty_members lm ON lm.id = wp.member_id
    JOIN contact c ON c.id = wp.contact_id
    WHERE wp.serial_number = ${serialNumber}
      AND wp.company_id = ${currentUser.companyId}
      AND wp.active = true
    LIMIT 1
  `)

  const pass = ((passResult as any).rows || passResult)?.[0]
  if (!pass) return c.json({ error: 'Pass not found' }, 404)

  // Count available rewards
  const rewardsResult = await db.execute(sql`
    SELECT COUNT(*)::int as count FROM loyalty_rewards
    WHERE company_id = ${currentUser.companyId}
      AND active = true
      AND points_required <= ${Number(pass.points_balance)}
  `)
  const availableRewards = Number(((rewardsResult as any).rows || rewardsResult)?.[0]?.count || 0)

  return c.json({
    serialNumber: pass.serial_number,
    platform: pass.platform,
    customerName: pass.customer_name,
    points: Number(pass.points_balance) || 0,
    tier: pass.tier || 'bronze',
    totalVisits: Number(pass.total_visits) || 0,
    totalSpent: Number(pass.total_spent) || 0,
    availableRewards,
  })
})

// ============================================
// DEVICE REGISTRATION (push updates)
// ============================================

// Register device for push updates
app.post('/:serialNumber/register', async (c) => {
  const currentUser = c.get('user') as any
  const serialNumber = c.req.param('serialNumber')

  const registerSchema = z.object({
    pushToken: z.string().min(1),
    deviceId: z.string().min(1),
  })
  const data = registerSchema.parse(await c.req.json())

  // Verify pass exists
  const passResult = await db.execute(sql`
    SELECT id FROM wallet_passes
    WHERE serial_number = ${serialNumber}
      AND company_id = ${currentUser.companyId}
      AND active = true
    LIMIT 1
  `)
  const pass = ((passResult as any).rows || passResult)?.[0]
  if (!pass) return c.json({ error: 'Pass not found' }, 404)

  // Store push token and device ID directly on the wallet_passes row
  await db.execute(sql`
    UPDATE wallet_passes
    SET push_token = ${data.pushToken}, device_id = ${data.deviceId}, updated_at = NOW()
    WHERE id = ${pass.id}
  `)

  return c.json({ registered: true })
})

// ============================================
// PUSH UPDATES
// ============================================

// Push update to customer's wallet pass
app.post('/update/:contactId', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const contactId = c.req.param('contactId')

  // Get latest loyalty data
  const memberResult = await db.execute(sql`
    SELECT lm.points_balance, lm.tier, lm.total_visits, lm.total_spent,
           c.name as customer_name
    FROM loyalty_members lm
    JOIN contact c ON c.id = lm.contact_id
    WHERE lm.contact_id = ${contactId} AND lm.company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const member = ((memberResult as any).rows || memberResult)?.[0]
  if (!member) return c.json({ error: 'Loyalty member not found' }, 404)

  // Get all active passes for this customer
  const passesResult = await db.execute(sql`
    SELECT wp.id, wp.serial_number, wp.platform
    FROM wallet_passes wp
    WHERE wp.contact_id = ${contactId}
      AND wp.company_id = ${currentUser.companyId}
      AND wp.active = true
  `)
  const passes = (passesResult as any).rows || passesResult

  if (!passes.length) return c.json({ error: 'No active passes found for this customer' }, 404)

  // Get registered devices from wallet_passes push_token field
  const devicesResult = await db.execute(sql`
    SELECT wp.push_token, wp.device_id, wp.platform
    FROM wallet_passes wp
    WHERE wp.contact_id = ${contactId}
      AND wp.company_id = ${currentUser.companyId}
      AND wp.active = true
      AND wp.push_token IS NOT NULL
  `)
  const devices = (devicesResult as any).rows || devicesResult

  // Update pass data in DB (mark as needing refresh)
  await db.execute(sql`
    UPDATE wallet_passes
    SET updated_at = NOW()
    WHERE contact_id = ${contactId}
      AND company_id = ${currentUser.companyId}
      AND active = true
  `)

  // In production, this would send APNs push for Apple passes
  // and call Google Wallet API for Google passes
  const pushResults = devices.map((device: any) => ({
    deviceId: device.device_id,
    platform: device.platform,
    status: 'queued',
  }))

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'wallet_pass',
    entityId: contactId,
    entityName: `Pass update for ${member.customer_name}`,
    metadata: { passCount: passes.length, deviceCount: devices.length },
    req: c.req,
  })

  return c.json({
    updated: true,
    passesUpdated: passes.length,
    pushNotifications: pushResults,
    currentData: {
      points: Number(member.points_balance) || 0,
      tier: member.tier,
      totalVisits: Number(member.total_visits) || 0,
    },
  })
})

// ============================================
// PASS MANAGEMENT
// ============================================

// List all generated passes (manager+)
app.get('/passes', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  const dataResult = await db.execute(sql`
    SELECT wp.id, wp.serial_number, wp.platform, wp.active, wp.created_at, wp.updated_at,
           c.name as customer_name, c.email as customer_email,
           lm.points_balance, lm.tier
    FROM wallet_passes wp
    JOIN contact c ON c.id = wp.contact_id
    LEFT JOIN loyalty_members lm ON lm.id = wp.member_id
    WHERE wp.company_id = ${currentUser.companyId}
    ORDER BY wp.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM wallet_passes
    WHERE company_id = ${currentUser.companyId}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Deactivate a pass
app.delete('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE wallet_passes
    SET active = false, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING id, serial_number, contact_id
  `)

  const pass = ((result as any).rows || result)?.[0]
  if (!pass) return c.json({ error: 'Pass not found' }, 404)

  // Clear push token on the pass
  await db.execute(sql`
    UPDATE wallet_passes SET push_token = NULL, device_id = NULL WHERE id = ${id}
  `)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'wallet_pass',
    entityId: id,
    entityName: `Pass ${pass.serial_number}`,
    req: c.req,
  })

  return c.json({ success: true })
})

export default app
