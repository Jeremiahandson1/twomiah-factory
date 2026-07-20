import { Hono } from 'hono'
import { reportAiUsage } from '../services/aiUsage'
import { authenticate } from '../middleware/auth.ts'

// AI Trade Appraisal — instant trade-in estimate for a unit (the GM's "trade
// values" ask). This is an AI MARKET ESTIMATE; authoritative book/auction values
// (J.D. Power, Price Digests, NPA) connect via their data APIs/subscriptions —
// the response carries that disclaimer so we never over-promise.
const app = new Hono()
app.use('*', authenticate)

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'
const DISCLAIMER = 'AI market estimate based on typical 2026 US values — directional, not a book quote. Authoritative book + wholesale-auction values connect via J.D. Power / Price Digests (book) and NPA Value Guide Pro (auction).'

app.post('/appraise', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const make = String(body.make || '').trim()
  const model = String(body.model || '').trim()
  if (!make || !model) return c.json({ error: 'Enter at least a make and model.' }, 400)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return c.json({ error: 'AI isn’t configured yet (missing ANTHROPIC_API_KEY).' }, 503)

  const unit = {
    year: body.year || undefined, make, model, category: body.category || undefined,
    mileageHours: body.mileageHours || undefined, condition: body.condition || 'good',
  }

  const system = `You are a powersports / RV / marine trade-in appraiser estimating CURRENT US market values (2026). Be realistic and CONSERVATIVE on trade-in (wholesale) and fair on retail. Account for the unit's age, mileage/hours, and condition. Return ONLY raw JSON (no markdown/code fences):
{"tradeIn":{"low":N,"avg":N,"high":N},"retail":{"low":N,"high":N},"conditionNote":"one line on how condition/mileage moved it","reasoning":"2-3 sentences a sales manager would trust","comps":["short comp/context line","..."]}
All values are whole-dollar integers, no symbols. Trade-in (wholesale) must be below retail.`

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 800, system, messages: [{ role: 'user', content: 'Appraise this trade-in:\n' + JSON.stringify(unit, null, 2) + '\n\nJSON only.' }] }),
    })
  } catch (e: any) { return c.json({ error: 'AI request failed: ' + (e?.message || e) }, 502) }
  if (!res.ok) { const t = await res.text().catch(() => ''); return c.json({ error: 'AI error (' + res.status + '): ' + t.slice(0, 200) }, 502) }

  const data: any = await res.json().catch(() => ({}))
  reportAiUsage(data?.usage?.input_tokens, data?.usage?.output_tokens, data?.model)
  const txt = data?.content?.[0]?.text || ''
  let parsed: any = null
  try { parsed = JSON.parse(txt) } catch { const m = txt.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]) } catch {} } }
  if (!parsed?.tradeIn) return c.json({ error: 'AI returned an unreadable estimate. Try again.', raw: txt.slice(0, 300) }, 502)

  return c.json({ appraisal: parsed, unit, disclaimer: DISCLAIMER, generatedAt: new Date().toISOString() })
})

export default app
