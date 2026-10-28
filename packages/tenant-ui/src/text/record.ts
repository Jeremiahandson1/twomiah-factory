// The record of a Text button press: "Text opened on your phone — not confirmed sent".
//
// The shared button is handed no api by its page (this package is vendored into every CRM template). The unified app registers
// its api client once at startup (apps/unified/web/src/main.tsx); a template registers none, so its button simply does not
// record. A press is recorded when a message is chosen — the texting app opened on a phone, or the QR code shown on a
// computer — through POST /api/text-activity/<contact|lead>/<id> (apps/unified server/crm/textActivity.ts, which asks the
// permission to read that record), and never blocks the text from opening.
import type { TextMessage } from './textMessages'

export type TextEntity = 'contact' | 'lead'
export interface TextApi { post: (endpoint: string, data?: unknown) => Promise<unknown> }

/** The words the activity card shows for a recorded press — exactly (owner, 2026-10-28): it was opened, not confirmed sent. */
export const TEXT_STARTED_LABEL = 'Text opened on your phone — not confirmed sent'
export const TEXT_RECORDED_EVENT = 'twomiah:text-recorded'

let textApi: TextApi | null = null
export const registerTextApi = (api: TextApi | null) => { textApi = api }
export const hasTextRecorder = () => textApi !== null

/** Record it, then tell any open Activity card to reload. A failure is swallowed: the text itself is not held up by it. */
export function recordTextOpened(entity: TextEntity, id: string, message: Pick<TextMessage, 'id' | 'label'>): void {
  if (!textApi) return
  textApi.post(`/api/text-activity/${entity}/${encodeURIComponent(id)}`, { message: message.id, label: message.label }).then(() => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(TEXT_RECORDED_EVENT)) }).catch(() => { /* not recorded; the text still opens */ })
}
