// Payer payments: a check (or EFT) from a payer, matched to the claims it pays — the AI check scanner, recording a
// payment with its claim matches, the payments list, one payment with its matches, and the reconciliation summary.
// Moved from templates/crm-homecare/backend/src/routes/payments.ts. Its SQL is in server/data/homecareBillingRoutes.ts.
// (A client's payment on a visit invoice is /api/billing/invoice-payments; this is the payer's side.)
//
// Who: the template's router was requireAdmin. Reading is care-billing:read; scanning a check (a paid AI call) and
// recording a payment are care-billing:create.
//
// Changes from the template: the company's rows only, and a match must name the company's own claim (a foreign or
// unknown claim id is refused before anything is written; it used to fail on the foreign key after the payment row was
// written); the payment and its matches are written in one transaction; replies are camelCase and the list is
// { data, pagination }; created_by is the signed-in person (the template read user.id, which its sign-in did not set);
// a failure is the app's error reply rather than a hand-built 500, and the scanner's refusals carry no `setup` /
// `details` field (the setup step is in the sentence).
import { Hono } from 'hono'
import { and, eq, inArray } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { reportAiUsage } from '@twomiah/tenant-backend'
import { payments, paymentClaimMatches, claims } from '../../../db/schema/index.ts'
import {
  payerNamed, openClaimsOfPayer, markClaimPaid, payerPaymentRows, payerPaymentDetail, payerPaymentMatches, reconciliationFigures,
} from '../../../data/homecareBillingRoutes.ts'
import { uploadedForm } from '../core/upload.ts'
import type { HomecareCore } from '../core/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one } from '../../../http/reply.ts'
import { addDays } from '../core/agencyTime.ts'
import { body, who, isDate } from './shared.ts'

export function createPayerPaymentRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const read = requirePermission('care-billing:read')
  const create = requirePermission('care-billing:create')

  // ─── AI CHECK SCANNER ────────────────────────────────────────────────────────
  // Claude reads a check / remittance image; the payer and the open claims it likely pays are suggested.
  app.post('/scan-check', create, async (c) => {
    const { companyId } = who(c)
    const formData = await uploadedForm(c)
    const file = formData.get('check') as File | null
    if (!file) return fail(c, 400, 'No image uploaded')
    const apiKey = process.env.ANTHROPIC_API_KEY
    // Said to an owner on Integrations › Remittance: no server setting names (live test, 2026-10-22).
    if (!apiKey) return fail(c, 503, 'Reading checks from a photo is not available on your account yet — enter the remittance by hand, or contact Twomiah to switch it on.', 'check_reader_unavailable')

    const base64Image = Buffer.from(await file.arrayBuffer()).toString('base64')
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: file.type, data: base64Image } },
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
If a field is not visible, use null.`,
            },
          ],
        }],
      }),
    })
    if (!response.ok) return fail(c, 500, 'AI analysis failed')

    const aiResult: any = await response.json()
    reportAiUsage(aiResult?.usage?.input_tokens, aiResult?.usage?.output_tokens, aiResult?.model)
    const textContent = aiResult.content?.[0]?.text || '{}'
    let extracted: any
    try {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/)
      extracted = JSON.parse(jsonMatch ? jsonMatch[0] : textContent)
    } catch {
      extracted = { payerName: null, amount: null, checkNumber: null, checkDate: null, remittanceInfo: textContent, confidence: 'low' }
    }

    // The payer: the first active payer whose name contains one of the words read.
    let suggestedPayer: any = null
    if (extracted.payerName) {
      const words = String(extracted.payerName).toLowerCase().split(/\s+/).filter((w: string) => w.length > 2)
      for (const word of words) {
        suggestedPayer = await payerNamed(db, companyId, word)
        if (suggestedPayer) break
      }
    }

    // The claims it likely pays: the payer's open claims, newest first, while the amount lasts.
    const suggestedMatches: any[] = []
    if (suggestedPayer && extracted.amount) {
      let remaining = parseFloat(extracted.amount)
      for (const claim of await openClaimsOfPayer(db, companyId, suggestedPayer.id)) {
        const amt = parseFloat(claim.chargeAmount)
        if (amt <= remaining + 0.01) {
          suggestedMatches.push({
            claimId: claim.id, claimNumber: claim.claimNumber, chargeAmount: amt,
            clientName: `${claim.clientFirst} ${claim.clientLast}`, serviceDate: claim.serviceDate,
          })
          remaining -= amt
          if (remaining < 0.01) break
        }
      }
    }

    return one(c, {
      extracted,
      suggestedPayer,
      suggestedMatches,
      unmatchedAmount: extracted.amount
        ? Math.max(0, parseFloat(extracted.amount) - suggestedMatches.reduce((s, m) => s + m.chargeAmount, 0))
        : null,
    })
  })

  // ─── RECORD PAYMENT ──────────────────────────────────────────────────────────
  app.post('/', create, async (c) => {
    const { companyId, userId } = who(c)
    const { payerId, payerName, checkNumber, checkDate, checkAmount, paymentDate, paymentMethod, notes, claimMatches } = await body(c)
    if (!checkAmount) return fail(c, 400, 'Payment amount is required')
    const matches: any[] = Array.isArray(claimMatches) ? claimMatches : []
    // Undated: today on the agency's clock (the template took UTC's date, tomorrow every evening in the US).
    const paidOn = isDate(paymentDate) ? paymentDate : await core.time.today(companyId)

    // Every matched claim must be the company's own.
    const claimIds = [...new Set(matches.map((m) => String(m.claimId || '')))].filter(Boolean)
    const owned = claimIds.length
      ? await db.select({ id: claims.id, billedAmount: claims.billedAmount }).from(claims)
        .where(and(eq(claims.companyId, companyId), inArray(claims.id, claimIds)))
      : []
    if (owned.length !== claimIds.length || matches.some((m) => !m.claimId)) return fail(c, 404, 'Claim not found')
    const billedOf = new Map<string, number>(owned.map((r: any) => [r.id, parseFloat(r.billedAmount || '0')]))

    const out = await db.transaction(async (tx: any) => {
      const paymentId = createId()
      let totalMatched = 0
      let underpayment = 0
      const [payment] = await tx.insert(payments).values({
        id: paymentId, companyId, payerId: payerId || null, payerName: payerName || 'Unknown',
        checkNumber: checkNumber || null, checkDate: checkDate || null, checkAmount: String(checkAmount),
        paymentDate: paidOn, paymentMethod: paymentMethod || 'check', reconciliationNotes: notes || null, createdBy: userId,
      }).returning()

      for (const match of matches) {
        const matchedAmount = parseFloat(match.amount || match.chargeAmount || 0)
        totalMatched += matchedAmount
        await tx.insert(paymentClaimMatches).values({
          companyId, paymentId, claimId: match.claimId, matchedAmount: String(matchedAmount), matchType: match.matchType || 'manual',
        })
        const chargeAmt = billedOf.get(match.claimId) ?? 0
        if (matchedAmount < chargeAmt - 0.01) {
          await markClaimPaid(tx, companyId, match.claimId, matchedAmount, paidOn, `\nUnderpayment: billed $${chargeAmt.toFixed(2)}, paid $${matchedAmount.toFixed(2)}`)
          underpayment += (chargeAmt - matchedAmount)
        } else {
          await markClaimPaid(tx, companyId, match.claimId, matchedAmount, paidOn, null)
        }
      }

      const checkAmt = parseFloat(checkAmount)
      const [updated] = await tx.update(payments).set({
        totalMatched: String(totalMatched),
        underpaymentAmount: String(underpayment),
        overpaymentAmount: String(Math.max(0, checkAmt - totalMatched)),
        reconciliationStatus: totalMatched >= checkAmt - 0.01 ? 'reconciled' : 'partial',
        updatedAt: new Date(),
      }).where(and(eq(payments.id, paymentId), eq(payments.companyId, companyId))).returning()
      return { payment: updated ?? payment, totalMatched, underpayment, unmatched: Math.max(0, checkAmt - totalMatched), claimsUpdated: matches.length }
    })
    return one(c, out)
  })

  // ─── GET ALL PAYMENTS ────────────────────────────────────────────────────────
  // A list reply.
  app.get('/', read, async (c) => {
    const { status, payerId, startDate, endDate } = c.req.query()
    const rows = await payerPaymentRows(db, who(c).companyId, { status, payerId, startDate, endDate })
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  // ─── RECONCILIATION SUMMARY ─────────────────────────────────────────────────
  // Default: the last 30 days on the agency's clock (the template took them on UTC's, a day ahead every evening).
  app.get('/reports/reconciliation', read, async (c) => {
    const { companyId } = who(c)
    const { startDate, endDate } = c.req.query()
    const today = await core.time.today(companyId)
    const start = isDate(startDate) ? startDate : addDays(today, -30)
    const end = isDate(endDate) ? endDate : today
    const { summary, byPayer } = await reconciliationFigures(db, companyId, start, end)
    return one(c, { period: { start, end }, summary, byPayer })
  })

  // ─── GET PAYMENT DETAIL WITH MATCHES ─────────────────────────────────────────
  app.get('/:id', read, async (c) => {
    const { companyId } = who(c)
    const id = c.req.param('id')
    const payment = await payerPaymentDetail(db, companyId, id)
    if (!payment) return fail(c, 404, 'Payment not found')
    return one(c, { ...payment, matches: await payerPaymentMatches(db, companyId, id) })
  })

  return app
}
