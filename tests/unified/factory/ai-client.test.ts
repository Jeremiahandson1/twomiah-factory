// Every Factory model call goes through services/aiClient.ts, so an Anthropic account problem (out of credit, key refused)
// emails the owner wherever it first shows, and the first call that works clears it. Anthropic is a stand-in here (fetch is
// replaced): nothing leaves the machine.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
process.env.ANTHROPIC_API_KEY ||= 'test-key'
const { resetAlerts, setAlertHooks, activeAlertKeys } = await import('../../../apps/api/src/services/alerts.ts')
const { aiClient } = await import('../../../apps/api/src/services/aiClient.ts')

const realFetch = globalThis.fetch
let sent: string[] = []
let answer: () => Response
beforeEach(() => {
  resetAlerts(); sent = []
  setAlertHooks({ send: async (subject) => { sent.push(subject); return true } })
  globalThis.fetch = (async () => answer()) as any
})
afterEach(() => { globalThis.fetch = realFetch; setAlertHooks() })

const credit = () => Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }, { status: 400 })
const ok = () => Response.json({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-x', content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } })
// Awaited as the Factory's callers await it: the SDK's APIPromise parses in then(), which Bun's `rejects` does not go through.
const call = async (c: any) => await c.messages.create({ model: 'claude-x', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] })
const settle = () => new Promise((r) => setTimeout(r, 20))

describe('the shared AI client', () => {
  test('out of credit: the call still fails as before, and the owner is emailed', async () => {
    answer = credit
    await expect(call(aiClient({ timeout: 5_000, maxRetries: 0 }))).rejects.toThrow(/credit balance is too low/)
    await settle()
    expect(activeAlertKeys()).toContain('ai:credit')
    expect(sent.length).toBe(1)
  })
  test('the first call that works clears it, so the next failure is news again', async () => {
    answer = credit
    await call(aiClient({ timeout: 5_000, maxRetries: 0 })).catch(() => {})
    await settle()
    answer = ok
    expect((await call(aiClient({ timeout: 5_000, maxRetries: 0 }))).content[0].text).toBe('hi')
    expect(activeAlertKeys()).not.toContain('ai:credit')
  })
  // The site composer streams. The SDK's stream() calls create(...).withResponse(); a wrapper that hid the SDK's promise
  // failed every signup compose with "withResponse is not a function" (10/29). Streamed through the wrapper, end to end.
  test('a streamed call works through the client, and a credit failure on it still emails the owner', async () => {
    const ev = (e: string, d: unknown) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`
    answer = () => new Response(
      ev('message_start', { type: 'message_start', message: { id: 'msg_s', type: 'message', role: 'assistant', model: 'claude-x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }) +
      ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
      ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'streamed' } }) +
      ev('content_block_stop', { type: 'content_block_stop', index: 0 }) +
      ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }) +
      ev('message_stop', { type: 'message_stop' }),
      { headers: { 'content-type': 'text/event-stream' } })
    const c = aiClient({ timeout: 5_000, maxRetries: 0 })
    const m = await c.messages.stream({ model: 'claude-x', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }).finalMessage()
    expect((m.content[0] as any).text).toBe('streamed')
    answer = credit
    await expect(c.messages.stream({ model: 'claude-x', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }).finalMessage()).rejects.toThrow(/credit balance is too low/)
    await settle()
    expect(activeAlertKeys()).toContain('ai:credit')
  })
  test('nothing in the Factory makes its own Anthropic client', () => {
    const root = path.resolve(import.meta.dir, '../../../apps/api/src')
    const files: string[] = []
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.ts$/.test(e.name)) files.push(p) } }
    walk(root)
    const own = files.filter((f) => !f.endsWith('aiClient.ts') && /new Anthropic\(|from '@anthropic-ai\/sdk'|import\('@anthropic-ai\/sdk'\)/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f))
    expect(own).toEqual([])
  })
})
