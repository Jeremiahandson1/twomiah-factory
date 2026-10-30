// The Factory's one way to reach Anthropic. Every model call goes through this client, so an account problem is told
// wherever it first shows: the moment Anthropic answers "credit balance is too low" (or refuses the key), the owner is
// emailed (alerts.ts raiseIfAiAccountProblem → 'ai:credit' / 'ai:auth'), and the first call that works again clears it.
// Before this, only the signup builder and the preview raised it; the content writer, the staff generator and the stock-
// photo search failed quietly. A caller keeps its own error handling — the error is re-thrown unchanged.
import Anthropic from '@anthropic-ai/sdk'
import { clearAlert, raiseIfAiAccountProblem } from './alerts'

export function aiClient(opts: { timeout: number; maxRetries: number }): Anthropic {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, ...opts })
  // The SDK's own APIPromise is handed back, only watched: its stream() calls create(...).withResponse(), which a plain
  // async wrapper does not have (every signup site compose failed on it, 10/29).
  const create = client.messages.create.bind(client.messages) as (...a: any[]) => any
  ;(client.messages as any).create = (...args: any[]) => {
    const p = create(...args)
    p.then(() => { clearAlert('ai:credit'); clearAlert('ai:auth') }, (e: unknown) => raiseIfAiAccountProblem(e))
    return p
  }
  // The site composer streams (a 32K-token answer must): its outcome is finalMessage(), so that is what is watched.
  const stream = client.messages.stream.bind(client.messages) as (...a: any[]) => any
  ;(client.messages as any).stream = (...args: any[]) => {
    const s = stream(...args)
    const final = s.finalMessage.bind(s)
    s.finalMessage = async () => {
      try { const m = await final(); clearAlert('ai:credit'); clearAlert('ai:auth'); return m } catch (e) { raiseIfAiAccountProblem(e); throw e }
    }
    return s
  }
  return client
}
