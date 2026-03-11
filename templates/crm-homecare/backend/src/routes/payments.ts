// routes/payments.ts
// Payment reconciliation: AI check scanner, auto-matching, reconciliation log
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { createId } from '@paralleldrive/cuid2'
import fs from 'fs'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// ─── AI CHECK SCANNER ────────────────────────────────────────────────────────
// Uses Claude AI vision to extract check/remittance data from an image
app.post('/scan-check', async (c) => {
  try {
    const formData = await c.req.formData()
    const file = formData.get('check') as File | null
    if (!file) return c.json({ error: 'No image uploaded' }, 400)

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return c.json({
        error: 'ANTHROPIC_API_KEY not configured',
        setup: 'Add ANTHROPIC_API_KEY to your environment variables'
      }, 400)
    }

    // Read image as base64
    const arrayBuffer = await file.arrayBuffer()
    const base64Image = Buffer.from(arrayBuffer).toString('base64')
    const mediaType = file.type

    // Call Claude Vision API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Image }
            },
            {
              type: 'text',
              text: `Analyze this check/remittance image. Extract the following information and return ONLY valid JSON (no markdown, no explanation):
{
  "payerName": "name of the paying organization",
  "amount": 0.00,
  "checkNumber": "check number",
  "checkDate": "YYYY-MM-DD",
  "remittanceInfo": "any EOB details, claim references, member IDs, or service dates visible",
  "confidence": "high/medium/low"
}
If a field is not visible, use null.`
            }
          ]
        }]
      })
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      return c.json({ error: 'AI analysis failed', details: errData }, 500)
    }

    const aiResult: any = await response.json()
    const textContent = aiResult.content?.[0]?.text || '{}'

    let extracted: any
    try {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/)
      extracted = JSON.parse(jsonMatch ? jsonMatch[0] : textContent)
    } catch {
      extracted = {
        payerName: null, amount: null, checkNumber: null,
        checkDate: null, remittanceInfo: textContent, confidence: 'low'
      }
    }

    // Try to match payer
    let suggestedPayer: any = null
    if (extracted.payerName) {
      const words = extracted.payerName.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2)
      for (const word of words) {
        const match = await db.execute(sql`
          SELECT id, name, payer_type FROM referral_sources
          WHERE LOWER(name) LIKE ${'%' + word + '%'} AND is_active_payer = true
          LIMIT 1
        `)
        if (match.rows.length) {
          suggestedPayer = match.rows[0]
          break
        }
      }
    }

    // Try to auto-match claims
    let suggestedMatches: any[] = []
    if (suggestedPayer && extracted.amount) {
      const openClaims = await db.execute(sql`
        SELECT c.id, c.claim_number, c.billed_amount as charge_amount, c.service_date,
          cl.first_name as client_first, cl.last_name as client_last
        FROM claims c
        JOIN clients cl ON c.client_id = cl.id
        WHERE c.payer_id = ${suggestedPayer.id}
          AND c.status IN ('submitted', 'accepted')
        ORDER BY c.service_date DESC
        LIMIT 20
      `)

      const totalAmount = parseFloat(extracted.amount)
      let remaining = totalAmount
      for (const claim of openClaims.rows as any[]) {
        const amt = parseFloat(claim.charge_amount)
        if (amt <= remaining + 0.01) {
          suggestedMatches.push({
            claimId: claim.id,
            claimNumber: claim.claim_number,
            chargeAmount: amt,
            clientName: `${claim.client_first} ${claim.client_last}`,
            serviceDate: claim.service_date,
          })
          remaining -= amt
          if (remaining < 0.01) break
        }
      }
    }

    return c.json({
      extracted,
      suggestedPayer,
      suggestedMatches,
      unmatchedAmount: extracted.amount
        ? Math.max(0, parseFloat(extracted.amount) - suggestedMatches.reduce((s, m) => s + m.chargeAmount, 0))
        : null,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ─── RECORD PAYMENT ──────────────────────────────────────────────────────────
app.post('/', async (c) => {
  try {
    const user = (c as any).get('user') || {}
    const {
      payerId, payerName, checkNumber, checkDate, checkAmount,
      paymentDate, paymentMethod, notes, claimMatches
    } = await c.req.json()

    if (!checkAmount) return c.json({ error: 'Payment amount is required' }, 400)

    const paymentId = createId()
    let totalMatched = 0
    let underpayment = 0

    // Create payment record
    const payment = await db.execute(sql`
      INSERT INTO payments (
        id, payer_id, payer_name, check_number, check_date,
        check_amount, payment_date, payment_method, reconciliation_notes,
        created_by
      ) VALUES (
        ${paymentId}, ${payerId || null}, ${payerName || 'Unknown'},
        ${checkNumber || null}, ${checkDate || null},
        ${checkAmount}, ${paymentDate || new Date().toISOString().split('T')[0]},
        ${paymentMethod || 'check'}, ${notes || null}, ${user.id || null}
      )
      RETURNING *
    `)

    // Match to claims
    if (claimMatches && claimMatches.length > 0) {
      for (const match of claimMatches) {
        const matchedAmount = parseFloat(match.amount || match.chargeAmount || 0)
        totalMatched += matchedAmount

        await db.execute(sql`
          INSERT INTO payment_claim_matches (id, payment_id, claim_id, matched_amount, match_type)
          VALUES (${createId()}, ${paymentId}, ${match.claimId}, ${matchedAmount}, ${match.matchType || 'manual'})
        `)

        // Update claim status
        const claim = await db.execute(sql`SELECT billed_amount FROM claims WHERE id = ${match.claimId}`)
        const chargeAmt = parseFloat((claim.rows[0] as any)?.billed_amount || 0)

        if (matchedAmount < chargeAmt - 0.01) {
          await db.execute(sql`
            UPDATE claims SET
              status = 'paid', paid_amount = ${matchedAmount}, paid_date = ${paymentDate || new Date().toISOString().split('T')[0]},
              notes = COALESCE(notes, '') || ${`\nUnderpayment: billed $${chargeAmt.toFixed(2)}, paid $${matchedAmount.toFixed(2)}`},
              updated_at = NOW()
            WHERE id = ${match.claimId}
          `)
          underpayment += (chargeAmt - matchedAmount)
        } else {
          await db.execute(sql`
            UPDATE claims SET
              status = 'paid', paid_amount = ${matchedAmount}, paid_date = ${paymentDate || new Date().toISOString().split('T')[0]},
              updated_at = NOW()
            WHERE id = ${match.claimId}
          `)
        }
      }
    }

    // Update payment totals
    const checkAmt = parseFloat(checkAmount)
    await db.execute(sql`
      UPDATE payments SET
        total_matched = ${totalMatched},
        underpayment_amount = ${underpayment},
        overpayment_amount = ${Math.max(0, checkAmt - totalMatched)},
        reconciliation_status = ${totalMatched >= checkAmt - 0.01 ? 'reconciled' : 'partial'},
        updated_at = NOW()
      WHERE id = ${paymentId}
    `)

    return c.json({
      payment: payment.rows[0],
      totalMatched,
      underpayment,
      unmatched: Math.max(0, checkAmt - totalMatched),
      claimsUpdated: claimMatches?.length || 0,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ─── GET ALL PAYMENTS ────────────────────────────────────────────────────────
app.get('/', async (c) => {
  try {
    const { status, payerId, startDate, endDate } = c.req.query()

    let conditions = sql`WHERE 1=1`
    if (status) conditions = sql`${conditions} AND p.reconciliation_status = ${status}`
    if (payerId) conditions = sql`${conditions} AND p.payer_id = ${payerId}`
    if (startDate) conditions = sql`${conditions} AND p.payment_date >= ${startDate}`
    if (endDate) conditions = sql`${conditions} AND p.payment_date <= ${endDate}`

    const result = await db.execute(sql`
      SELECT p.*,
        rs.name as payer_display_name,
        (SELECT COUNT(*) FROM payment_claim_matches WHERE payment_id = p.id) as match_count
      FROM payments p
      LEFT JOIN referral_sources rs ON p.payer_id = rs.id
      ${conditions}
      ORDER BY p.payment_date DESC LIMIT 100
    `)

    return c.json(result.rows)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ─── GET PAYMENT DETAIL WITH MATCHES ─────────────────────────────────────────
app.get('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const payment = await db.execute(sql`
      SELECT p.*, rs.name as payer_display_name
      FROM payments p
      LEFT JOIN referral_sources rs ON p.payer_id = rs.id
      WHERE p.id = ${id}
    `)
    if (!payment.rows.length) return c.json({ error: 'Payment not found' }, 404)

    const matches = await db.execute(sql`
      SELECT pcm.*, c.claim_number, c.billed_amount as charge_amount, c.service_date,
        cl.first_name as client_first, cl.last_name as client_last
      FROM payment_claim_matches pcm
      JOIN claims c ON pcm.claim_id = c.id
      JOIN clients cl ON c.client_id = cl.id
      WHERE pcm.payment_id = ${id}
      ORDER BY c.service_date
    `)

    return c.json({ ...(payment.rows[0] as any), matches: matches.rows })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ─── RECONCILIATION SUMMARY ─────────────────────────────────────────────────
app.get('/reports/reconciliation', async (c) => {
  try {
    const { startDate, endDate } = c.req.query()
    const start = startDate || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
    const end = endDate || new Date().toISOString().split('T')[0]

    const summary = await db.execute(sql`
      SELECT
        COUNT(*) as total_payments,
        COALESCE(SUM(check_amount), 0) as total_received,
        COALESCE(SUM(total_matched), 0) as total_matched,
        COALESCE(SUM(underpayment_amount), 0) as total_underpayments,
        COUNT(CASE WHEN reconciliation_status = 'reconciled' THEN 1 END) as reconciled_count,
        COUNT(CASE WHEN reconciliation_status = 'partial' THEN 1 END) as partial_count,
        COUNT(CASE WHEN reconciliation_status = 'unreconciled' THEN 1 END) as unreconciled_count
      FROM payments
      WHERE payment_date BETWEEN ${start} AND ${end}
    `)

    const byPayer = await db.execute(sql`
      SELECT
        COALESCE(rs.name, p.payer_name) as payer_name,
        COUNT(*) as payment_count,
        COALESCE(SUM(p.check_amount), 0) as total_received,
        COALESCE(SUM(p.total_matched), 0) as total_matched
      FROM payments p
      LEFT JOIN referral_sources rs ON p.payer_id = rs.id
      WHERE p.payment_date BETWEEN ${start} AND ${end}
      GROUP BY COALESCE(rs.name, p.payer_name)
      ORDER BY total_received DESC
    `)

    return c.json({
      period: { start, end },
      summary: summary.rows[0],
      byPayer: byPayer.rows,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

export default app
