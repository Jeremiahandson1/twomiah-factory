// Phone notifications through Expo's push service, for every vertical (moved out of home care's visit notices, which
// keep using it): the phones a person signed in on (POST /api/push/expo-token), and one send that reaches all of them.
//
// Expo's public push service needs no key. Messages go in batches of 100; the reply carries one ticket per message, in
// order — a DeviceNotRegistered ticket means the app was removed, so that token is deleted. The transport is replaceable
// (setTransport): tests record instead of reaching Expo.
import { Hono } from 'hono'
import { fail, one } from '../http/reply.ts'
import { forgetPhoneToken, phoneTokensOf, removePhoneToken, savePhoneToken } from '../data/phonePush.ts'

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
export const isExpoToken = (t: unknown) => typeof t === 'string' && /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(t)

export type ExpoTicket = { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } }
export type ExpoTransport = (messages: any[]) => Promise<ExpoTicket[]>
export interface PhoneMessage { title: string; body: string; data?: Record<string, unknown> }

const expoOverHttps: ExpoTransport = async (messages) => {
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST', headers: { accept: 'application/json', 'accept-encoding': 'gzip, deflate', 'content-type': 'application/json' },
    body: JSON.stringify(messages),
  })
  const body: any = await res.json().catch(() => ({}))
  return Array.isArray(body?.data) ? body.data : []
}

export function createPhonePush(deps: { db: any; logger: { error: (m: string, x?: any) => void }; transport?: ExpoTransport }) {
  let transport = deps.transport ?? expoOverHttps

  /** Every phone of these people gets the message. Returns how many accepted it; never throws. */
  async function send(companyId: string | null, userIds: (string | null | undefined)[], msg: PhoneMessage): Promise<number> {
    const ids = [...new Set(userIds.filter((u): u is string => !!u))]
    let sent = 0
    try {
      const tokens = await phoneTokensOf(deps.db, companyId, ids)
      for (let i = 0; i < tokens.length; i += 100) {
        const batch = tokens.slice(i, i + 100)
        const tickets = await transport(batch.map((t) => ({ to: t.token, title: msg.title, body: msg.body, data: msg.data ?? {}, sound: 'default' })))
        for (let k = 0; k < batch.length; k++) {
          const tk = tickets[k]
          if (tk?.status === 'ok') sent++
          else if (tk?.details?.error === 'DeviceNotRegistered') await forgetPhoneToken(deps.db, batch[k].id).catch(() => {})
        }
      }
    } catch (e: any) {
      deps.logger.error('[push] phone notification failed', { error: e?.message })
    }
    return sent
  }

  /**
   * POST / { token, platform? } — this phone's Expo push token, for the signed-in person. A token belongs to one person:
   * signing in on a phone someone else used moves it to the caller. DELETE / { token } — signed out on this phone; only
   * the caller's own token goes. Mounted at /api/push/expo-token behind sign-in.
   */
  const tokenRoutes = new Hono()
    .post('/', async (c) => {
      const me = c.get('user' as never) as { userId: string; companyId: string }
      const { token, platform } = await c.req.json().catch(() => ({} as any))
      if (!isExpoToken(token)) return fail(c, 400, 'token must be an Expo push token (ExponentPushToken[…])')
      const plat = typeof platform === 'string' && ['ios', 'android', 'web'].includes(platform) ? platform : null
      const row = await savePhoneToken(deps.db, me.companyId, me.userId, token, plat)
      return one(c, { success: true, id: row.id }, 201)
    })
    .delete('/', async (c) => {
      const me = c.get('user' as never) as { userId: string; companyId: string }
      const { token } = await c.req.json().catch(() => ({} as any))
      if (!token) return fail(c, 400, 'token is required')
      return one(c, { success: true, removed: await removePhoneToken(deps.db, me.companyId, me.userId, String(token)) })
    })

  return { send, tokenRoutes, setTransport(fn: ExpoTransport) { transport = fn } }
}

export type PhonePush = ReturnType<typeof createPhonePush>
