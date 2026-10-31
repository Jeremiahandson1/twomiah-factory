// /api/admin/audiences — a segment as an audience on the ad platforms, and the purchase tags (access 'user', behind the hidden
// feature store_audiences; 2026-10-31, parity row 7). The Menu row asks the same feature and marketing:update.
//   GET  /                         the connections (no secrets), whether each platform can be pushed to, the recent log
//   PUT  /settings                 the tags, the Conversions API and the platforms' keys          (integrations:update)
//   GET  /segments/:id/export      ?format=meta|google → the hashed file, as a download          (marketing:update; audited)
//   POST /segments/:id/push        { platform: meta|google } → a new audience on that platform    (marketing:update; audited)
// Never in a file or a push: anyone who unsubscribed from the shop's email, and anyone with neither an email nor a phone number.
import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { companyRowTimeZone } from '@twomiah/tenant-backend'
import { company } from '../../../db/schema/index.ts'
import { storeSegment } from '../../../db/schema/store.ts'
import { audiencePeople } from '../../../data/storeAudiences.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { googleCredsOf, metaPushOf, recentLog, saveSettings, settingsRow, settingsView, writeLog } from './audiences.ts'
import { googleCsv, googleRow, metaCsv, metaRow, type GoogleRow, type MetaRow } from './hashing.ts'
import { PlatformError, pushToGoogle, pushToMeta } from './platforms.ts'

const text = (max: number) => z.string().trim().max(max).nullable().optional()
const settingsSchema = z.object({
  purchaseEventsOn: z.boolean().optional(), metaCapiOn: z.boolean().optional(),
  metaCapiToken: text(500), metaTestEventCode: text(40), metaAdAccountId: text(40), metaAccessToken: text(1000),
  googleCustomerId: text(20), googleLoginCustomerId: text(20), googleDeveloperToken: text(100), googleClientId: text(200), googleClientSecret: text(200), googleRefreshToken: text(500),
}).strict()

export function createAudienceRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const own = (c: Context) => (c as any).get('user').companyId as string
  const zoneOf = async (companyId: string) => companyRowTimeZone((await db.select().from(company).where(eq(company.id, companyId)).limit(1))[0])

  app.get('/', requirePermission('marketing:update'), async (c) => one(c, { ...(await settingsView(db, own(c))), log: await recentLog(db, own(c)) }))

  app.put('/settings', requirePermission('integrations:update'), async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return fail(c, 400, 'Check what you entered.', 'validation_failed')
    const p = parsed.data
    if (p.metaCapiOn) {
      const cur = await settingsRow(db, own(c))
      const hasToken = !!(p.metaCapiToken && p.metaCapiToken.trim()) || !!cur?.metaCapiTokenEnc
      if (!hasToken) return fail(c, 400, 'Add the Conversions API access token before switching it on.', 'validation_failed', { metaCapiToken: 'Required' })
      const v = await settingsView(db, own(c))
      if (!v.meta.pixelId) return fail(c, 400, 'Add your Meta pixel id in Website settings first: the server event and the browser pixel share it.', 'validation_failed', { metaCapiOn: 'No pixel yet' })
    }
    await saveSettings(db, own(c), p)
    await d.audit.log({ action: 'update', entity: 'store_audience_settings', entityName: 'Audiences and purchase tags', companyId: own(c), req: c })
    return one(c, await settingsView(db, own(c)))
  })

  /** The segment's people as hashed rows for a platform, and who was left out. */
  async function rowsFor(c: Context, platform: 'meta' | 'google') {
    const [seg] = await db.select().from(storeSegment).where(and(eq(storeSegment.id, c.req.param('id')), eq(storeSegment.companyId, own(c)))).limit(1)
    if (!seg) return { reply: fail(c, 404, 'Not found') }
    const found = await audiencePeople(db, own(c), seg.definition, await zoneOf(own(c)))
    const rows = platform === 'meta' ? found.people.map(metaRow).filter((r): r is MetaRow => !!r) : found.people.map(googleRow).filter((r): r is GoogleRow => !!r)
    return { seg, rows, leftOut: { ...found.leftOut, unmatchable: found.leftOut.unmatchable + (found.people.length - rows.length) } }
  }

  app.get('/segments/:id/export', requirePermission('marketing:update'), async (c) => {
    const platform = c.req.query('format') === 'google' ? 'google' : c.req.query('format') === 'meta' ? 'meta' : null
    if (!platform) return fail(c, 400, 'Choose Meta or Google.', 'validation_failed')
    const r = await rowsFor(c, platform); if ('reply' in r) return r.reply
    const body = platform === 'meta' ? metaCsv(r.rows as MetaRow[]) : googleCsv(r.rows as GoogleRow[])
    await writeLog(db, { companyId: own(c), segmentId: r.seg.id, platform, kind: 'download', people: r.rows.length, status: 'ok' })
    await d.audit.log({ action: d.audit.ACTIONS.EXPORT, entity: 'store_audience', entityId: r.seg.id, entityName: `${r.seg.name} — ${platform === 'meta' ? 'Meta' : 'Google'} audience file`, companyId: own(c), req: c, metadata: { people: r.rows.length } })
    const file = `${r.seg.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'segment'}-${platform}-audience.csv`
    return c.body(body, 200, {
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file}"`, 'Cache-Control': 'no-store',
      'X-Audience-People': String(r.rows.length), 'X-Audience-Left-Out': JSON.stringify(r.leftOut),
    })
  })

  app.post('/segments/:id/push', requirePermission('marketing:update'), async (c) => {
    const parsed = z.object({ platform: z.enum(['meta', 'google']) }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return fail(c, 400, 'Choose Meta or Google.', 'validation_failed')
    const platform = parsed.data.platform
    const s = await settingsRow(db, own(c))
    const meta = metaPushOf(s), google = googleCredsOf(s)
    if (platform === 'meta' ? !meta : !google) return fail(c, 409, platform === 'meta' ? 'Connect your Meta ad account first (ad account id and access token).' : 'Connect Google Ads first (customer id, developer token, OAuth client and refresh token).', 'not_connected')
    const r = await rowsFor(c, platform); if ('reply' in r) return r.reply
    if (!r.rows.length) return fail(c, 409, 'Nobody in this segment can be sent: they have no email or phone, or have unsubscribed.', 'empty_audience')
    const stamp = new Date().toISOString().slice(0, 10)
    const name = `${r.seg.name} — ${stamp}`
    try {
      const out = platform === 'meta'
        ? await pushToMeta({ ...meta!, name, rows: r.rows as MetaRow[] })
        : await pushToGoogle({ creds: google!, name, rows: r.rows as GoogleRow[] })
      const id = 'audienceId' in out ? out.audienceId : out.userList
      await writeLog(db, { companyId: own(c), segmentId: r.seg.id, platform, kind: 'push', people: out.sent, status: 'ok', detail: `${name} (${id})` })
      await d.audit.log({ action: d.audit.ACTIONS.EXPORT, entity: 'store_audience', entityId: r.seg.id, entityName: `${r.seg.name} — sent to ${platform === 'meta' ? 'Meta' : 'Google Ads'}`, companyId: own(c), req: c, metadata: { people: out.sent } })
      return one(c, { platform, name, sent: out.sent, leftOut: r.leftOut, remoteId: id })
    } catch (e: any) {
      const why = e instanceof PlatformError ? e.message : 'The platform could not be reached.'
      d.logger.warn('[store] audience push failed', { platform, error: e?.message })
      await writeLog(db, { companyId: own(c), segmentId: r.seg.id, platform, kind: 'push', people: 0, status: 'failed', detail: why })
      return fail(c, 502, `${platform === 'meta' ? 'Meta' : 'Google'} did not take the audience: ${why}`, 'platform_refused')
    }
  })

  return app
}
