// The AI receptionist's reads and writes on the call log (moved from templates/crm/backend/src/services/
// aiReceptionist.ts, which ran them as raw SQL). Each returns camelCase.
import { sql } from 'drizzle-orm'
import { rowsOf } from '@twomiah/tenant-backend'

/** A call by the provider's id (Twilio's CallSid). */
export async function findCallByProviderId(db: any, companyId: string, providerId: string): Promise<{ id: string; callerNumber: string | null; callerName: string | null; contactId: string | null; clientId: string | null; status: string } | null> {
  const r = rowsOf(await db.execute(sql`
    SELECT id, caller_number, caller_name, contact_id, client_id, status
    FROM call_log
    WHERE company_id = ${companyId} AND provider_id = ${providerId}
    LIMIT 1
  `))[0]
  return r ? { id: r.id, callerNumber: r.caller_number, callerName: r.caller_name, contactId: r.contact_id, clientId: r.client_id ?? null, status: r.status } : null
}

/** One of this company's calls' recording, for a manual transcription. */
export async function findCallRecording(db: any, callId: string, companyId: string): Promise<{ id: string; recordingUrl: string | null; callerName: string | null } | null> {
  const r = rowsOf(await db.execute(sql`
    SELECT id, recording_url, caller_name FROM call_log
    WHERE id = ${callId} AND company_id = ${companyId} LIMIT 1
  `))[0]
  return r ? { id: r.id, recordingUrl: r.recording_url, callerName: r.caller_name } : null
}

/** Store a call's transcription, and the recording it came from when given. */
export async function setCallTranscription(db: any, callId: string, transcription: string, recordingUrl?: string) {
  if (recordingUrl !== undefined) {
    await db.execute(sql`UPDATE call_log SET transcription = ${transcription}, recording_url = ${recordingUrl} WHERE id = ${callId}`)
  } else {
    await db.execute(sql`UPDATE call_log SET transcription = ${transcription} WHERE id = ${callId}`)
  }
}

/** Store the AI's summary of a call. */
export async function setCallSummary(db: any, callId: string, summary: string) {
  await db.execute(sql`UPDATE call_log SET ai_summary = ${summary} WHERE id = ${callId}`)
}

/** Mark a call as answered by the AI receptionist. */
export async function markCallAiResponded(db: any, callId: string) {
  await db.execute(sql`UPDATE call_log SET ai_response_sent = true WHERE id = ${callId}`)
}
