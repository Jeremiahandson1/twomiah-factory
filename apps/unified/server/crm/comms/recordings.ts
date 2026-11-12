// CALL RECORDINGS at Twilio (CallRail's call recording, on the tracking numbers Twomiah sells — ./calltracking.ts). Twilio keeps
// the audio; this app never hands out its address. A signed-in person who may read calls hears it through
// GET /api/calltracking/calls/:id/recording, which fetches it with the credentials of the Twilio account that owns it: the
// business's own (Settings › Integrations), or the platform's (TWILIO_ACCOUNT_SID — the account the numbers Twomiah sells are on).
// Deleting one deletes it at Twilio. The Factory bills each recording at Twilio's price with its call (apps/api
// services/callTrackingNumbers.ts billCalls), so a recording is never deleted by the app before it is days old.
import { twilioConfigFor, twilioConfigFromEnv } from '@twomiah/tenant-backend'

export const DEFAULT_RECORDING_NOTICE = 'This call may be recorded for quality and training.'

/** A Twilio recording's address, as its callback sends it: the account and the recording. */
const RECORDING_URL = /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/(AC[0-9a-fA-F]{32})\/Recordings\/(RE[0-9a-fA-F]{32})$/
export const parseRecordingUrl = (url: unknown): { accountSid: string; recordingSid: string } | null => {
  const m = RECORDING_URL.exec(String(url ?? '').replace(/\.(mp3|wav|json)$/, ''))
  return m ? { accountSid: m[1], recordingSid: m[2] } : null
}

/** The credentials of the Twilio account that owns this recording: the company's own, or the platform's; null = neither. */
export function credentialsFor(companyRow: any, accountSid: string): { accountSid: string; authToken: string } | null {
  const own = twilioConfigFor(companyRow)
  if (own.accountSid === accountSid && own.authToken) return { accountSid, authToken: own.authToken }
  const env = twilioConfigFromEnv()
  if (env.accountSid === accountSid && env.authToken) return { accountSid, authToken: env.authToken }
  return null
}

const basic = (c: { accountSid: string; authToken: string }) => 'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64')
const base = (accountSid: string) => `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`

/** The recording's audio (mp3), as Twilio answers it; null when it cannot be reached. */
export async function fetchRecordingAudio(companyRow: any, url: string): Promise<Response | null> {
  const p = parseRecordingUrl(url)
  const cred = p && credentialsFor(companyRow, p.accountSid)
  if (!p || !cred) return null
  const r = await fetch(`${base(p.accountSid)}/Recordings/${p.recordingSid}.mp3`, { headers: { Authorization: basic(cred) } }).catch(() => null)
  return r && r.ok ? r : null
}

/** Delete the recording at Twilio. True when it is gone (deleted now, or already gone). */
export async function deleteRecordingAt(companyRow: any, url: string): Promise<boolean> {
  const p = parseRecordingUrl(url)
  const cred = p && credentialsFor(companyRow, p.accountSid)
  if (!p || !cred) return false
  const r = await fetch(`${base(p.accountSid)}/Recordings/${p.recordingSid}.json`, { method: 'DELETE', headers: { Authorization: basic(cred) } }).catch(() => null)
  return !!r && (r.ok || r.status === 404)
}

/** A call as Twilio has it (who called which number, its status and length), for a recording that came in before the call's own report. */
export async function fetchCall(companyRow: any, accountSid: string, callSid: string): Promise<{ from: string; to: string; status: string; duration: string; direction: string } | null> {
  const cred = credentialsFor(companyRow, accountSid)
  if (!cred || !/^CA[0-9a-fA-F]{32}$/.test(callSid)) return null
  const r = await fetch(`${base(accountSid)}/Calls/${callSid}.json`, { headers: { Authorization: basic(cred) } }).catch(() => null)
  if (!r || !r.ok) return null
  const j: any = await r.json().catch(() => null)
  return j ? { from: String(j.from || ''), to: String(j.to || ''), status: String(j.status || ''), duration: String(j.duration || '0'), direction: String(j.direction || 'inbound') } : null
}
