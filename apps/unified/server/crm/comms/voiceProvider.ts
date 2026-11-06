// The voice provider adapter for live AI call answering: ONE interface between the dialogue (callDialogue.ts, the
// service) and whatever carries the call. The engine decides what to say, listen for, dial or end; the provider turns
// that into its own reply (Twilio: TwiML) and reads its own webhook into a plain CallEvent. Nothing else in the module
// knows a provider's field names.
//
//   · twilioVoiceProvider — Twilio Programmable Voice. The call arrives on the business's number as a signed voice
//     webhook (the same X-Twilio-Signature check every other Twilio door here makes); each caller line comes back as a
//     signed POST with Twilio's speech-to-text (<Gather input="speech">, SpeechResult); the assistant speaks with <Say>;
//     a transfer is <Dial>; the whole call is recorded by one REST call whose callback is the existing recording
//     webhook. The TwiML verbs and attributes used are Twilio's documented ones; the parts marked SPEC-PENDING (the
//     recording REST call's exact parameters, the ConversationRelay streaming variant) are not verified against a live
//     account — no live call is ever made from this repository.
//   · memoryVoiceProvider — the test implementation: the same actions kept as JSON, nothing leaves the process.
import type { Expecting } from './callDialogue.ts'

/** What the engine asks the line to do next, in order. */
export type VoiceAction =
  | { kind: 'say'; text: string }
  /** Speak the prompt, then listen for the caller's next line (what the engine expects it to be is for the provider's hints). */
  | { kind: 'listen'; prompt: string; expecting: Expecting }
  /** Announce, then ring `to`; the outcome comes back as a `transfer_result` event. */
  | { kind: 'transfer'; to: string; announce: string }
  | { kind: 'hangup'; text?: string }

/** A provider's webhook, read into one shape. */
export type CallEvent =
  | { kind: 'incoming'; callId: string; from: string; to: string; fromCity?: string; fromState?: string }
  | { kind: 'speech'; callId: string; text: string }
  | { kind: 'silence'; callId: string }
  | { kind: 'transfer_result'; callId: string; answered: boolean }

/** Where the provider should post the next turn and the transfer's outcome (relative paths on this same host). */
export interface ReplyPaths { turn: string; transferResult: string; recording: string }

export interface VoiceProvider {
  id: 'twilio' | 'memory'
  /** The incoming-call webhook's body → the event; null when it is not a call. */
  readIncoming(payload: Record<string, string>): Extract<CallEvent, { kind: 'incoming' }> | null
  /** A turn webhook's body (the caller's line, or nothing heard) → the event. */
  readTurn(payload: Record<string, string>): CallEvent | null
  readTransferResult(payload: Record<string, string>): CallEvent | null
  /** The reply body for the actions, in the provider's own language. */
  render(actions: VoiceAction[], paths: ReplyPaths): { contentType: string; body: string }
  /**
   * Start recording the live call, with the recording delivered to `paths.recording` (the existing recording webhook,
   * which files it on the call). A network call; a failure is logged by the caller and never stops the call.
   */
  startRecording(call: { callId: string; companyId: string }, cfg: { accountSid?: string; authToken?: string }, recordingCallbackUrl: string): Promise<{ ok: boolean; reason?: string }>
}

const xml = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Speech hints Twilio's recogniser is given for each kind of answer (documented Gather `hints`: comma-separated phrases). */
const HINTS: Record<Expecting, string> = {
  help: 'book, schedule, appointment, estimate, message, hours, price, cost, service area, person',
  service: '',
  name: '',
  address: 'street, avenue, road, drive, lane, court, apartment, unit',
  slot: 'first, second, third, morning, afternoon, monday, tuesday, wednesday, thursday, friday, saturday, earliest',
  yes_no: 'yes, no, book it, that works, cancel',
  message: '',
  anything_else: 'no, yes, that\'s all, goodbye, question',
}

export const twilioVoiceProvider: VoiceProvider = {
  id: 'twilio',
  readIncoming(p) {
    if (!p.CallSid || !p.From) return null
    return { kind: 'incoming', callId: p.CallSid, from: p.From, to: p.To || '', fromCity: p.FromCity, fromState: p.FromState }
  },
  readTurn(p) {
    if (!p.CallSid) return null
    const text = String(p.SpeechResult || '').trim()
    return text ? { kind: 'speech', callId: p.CallSid, text } : { kind: 'silence', callId: p.CallSid }
  },
  readTransferResult(p) {
    if (!p.CallSid) return null
    return { kind: 'transfer_result', callId: p.CallSid, answered: p.DialCallStatus === 'completed' || p.DialCallStatus === 'answered' }
  },
  render(actions, paths) {
    let body = ''
    for (const a of actions) {
      switch (a.kind) {
        case 'say': body += `<Say voice="alice">${xml(a.text)}</Say>`; break
        // actionOnEmptyResult: the action URL is posted even when nothing was heard, so silence is a turn the engine sees.
        case 'listen': body += `<Gather input="speech" action="${xml(paths.turn)}" method="POST" language="en-US" speechTimeout="auto" timeout="6" actionOnEmptyResult="true"${HINTS[a.expecting] ? ` hints="${xml(HINTS[a.expecting])}"` : ''}><Say voice="alice">${xml(a.prompt)}</Say></Gather>`; break
        case 'transfer': body += `<Say voice="alice">${xml(a.announce)}</Say><Dial timeout="25" action="${xml(paths.transferResult)}" method="POST">${xml(a.to)}</Dial>`; break
        case 'hangup': body += `${a.text ? `<Say voice="alice">${xml(a.text)}</Say>` : ''}<Hangup/>`; break
      }
    }
    return { contentType: 'text/xml', body: `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>` }
  },
  async startRecording(call, cfg, recordingCallbackUrl) {
    // SPEC-PENDING: Twilio's "record an in-progress call" REST resource (POST /2010-04-01/Accounts/{AccountSid}/Calls/
    // {CallSid}/Recordings.json with RecordingStatusCallback / RecordingStatusCallbackEvent) as documented; the exact
    // parameter set and the two-channel option are to be confirmed against the owner's account before this goes live.
    if (!cfg.accountSid || !cfg.authToken) return { ok: false, reason: 'Twilio is not configured for this business' }
    if (process.env.NODE_ENV === 'test' || process.env.AI_CALL_ANSWERING_NO_NETWORK === '1') return { ok: false, reason: 'no network from a test' }
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Calls/${encodeURIComponent(call.callId)}/Recordings.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ RecordingStatusCallback: recordingCallbackUrl, RecordingStatusCallbackEvent: 'completed', RecordingStatusCallbackMethod: 'POST' }).toString(),
      })
      return res.ok ? { ok: true } : { ok: false, reason: `Twilio answered ${res.status}` }
    } catch (err: any) {
      return { ok: false, reason: err?.message || 'network error' }
    }
  },
}

/**
 * SPEC-PENDING — the streaming variant. Twilio ConversationRelay carries the same conversation over a WebSocket
 * (<Connect><ConversationRelay url="wss://…" welcomeGreeting="…"/></Connect>; the socket then delivers
 * { type: 'prompt', voicePrompt } for each caller line and takes { type: 'text', token, last: true } to speak and
 * { type: 'end' } to hang up). The same engine answers it turn for turn; what is not verified is the socket's exact
 * message set and the transfer/handoff message, so this renders the TwiML only and the socket is not mounted.
 */
export function conversationRelayTwiml(socketUrl: string, welcome: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><ConversationRelay url="${xml(socketUrl)}" welcomeGreeting="${xml(welcome)}"/></Connect></Response>`
}

/** The test provider: the same events in, the actions out as JSON, no network. */
export function memoryVoiceProvider(): VoiceProvider & { recordings: Array<{ callId: string; callbackUrl: string }> } {
  const recordings: Array<{ callId: string; callbackUrl: string }> = []
  return {
    id: 'memory',
    recordings,
    readIncoming: twilioVoiceProvider.readIncoming,
    readTurn: twilioVoiceProvider.readTurn,
    readTransferResult: twilioVoiceProvider.readTransferResult,
    render(actions) { return { contentType: 'application/json', body: JSON.stringify({ actions }) } },
    async startRecording(call, _cfg, recordingCallbackUrl) { recordings.push({ callId: call.callId, callbackUrl: recordingCallbackUrl }); return { ok: true } },
  }
}
