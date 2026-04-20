import React, { useState, useEffect } from 'react'

// List + detail for inbound emails routed into the CRM via crm-mode
// aliases. V1 is a flat reverse-chrono inbox — no threading, no contact
// matching yet. Enough to prove the pipe is working + give support agents
// a place to find messages.

interface InboundMessage {
  id: string
  toLocalPart: string
  fromEmail: string
  fromName: string | null
  subject: string | null
  textBody: string | null
  htmlBody: string | null
  spfVerdict: string | null
  dkimVerdict: string | null
  rawHeaders: string | null
  receivedAt: string
}

function getToken(): string {
  try { return localStorage.getItem('token') || '' } catch { return '' }
}
function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() }
}

export function InboundMessagesPage(): React.ReactElement {
  const [messages, setMessages] = useState<InboundMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<InboundMessage | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/inbound-messages?limit=100', { headers: authHeaders() })
      if (!res.ok) throw new Error('Failed to load: ' + res.status)
      const data = await res.json()
      setMessages(data.messages || [])
    } catch (err: any) { setError(err.message) }
    setLoading(false)
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Inbound Messages</h1>
      <p className="text-sm text-gray-500 mb-6">Emails received on your "route into CRM" aliases. Newest first.</p>

      {error && <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4 text-sm text-red-700">{error}</div>}

      {loading && <div className="text-sm text-gray-500">Loading…</div>}

      {!loading && messages.length === 0 && !error && (
        <div className="text-sm text-gray-500 italic py-12 text-center border border-dashed border-gray-300 rounded-md">
          No inbound messages yet. Once an alias is set to "Route into CRM" and receives an email, it'll appear here.
        </div>
      )}

      {!loading && messages.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-[360px_1fr] gap-4">
          <div className="border border-gray-200 rounded-md overflow-hidden max-h-[70vh] overflow-y-auto">
            {messages.map(m => (
              <button
                key={m.id}
                onClick={() => setSelected(m)}
                className={'w-full text-left px-3 py-2 border-b border-gray-100 hover:bg-gray-50 ' + (selected?.id === m.id ? 'bg-orange-50' : '')}
              >
                <div className="flex items-center justify-between text-xs text-gray-500 mb-0.5">
                  <span className="font-mono truncate">{m.toLocalPart}@</span>
                  <span>{new Date(m.receivedAt).toLocaleDateString()}</span>
                </div>
                <div className="text-sm font-semibold truncate">{m.fromName || m.fromEmail}</div>
                <div className="text-xs text-gray-600 truncate">{m.subject || '(no subject)'}</div>
              </button>
            ))}
          </div>
          <div className="border border-gray-200 rounded-md p-4 max-h-[70vh] overflow-y-auto">
            {!selected && <div className="text-sm text-gray-500 italic">Select a message to view.</div>}
            {selected && (
              <div>
                <div className="border-b border-gray-100 pb-3 mb-3">
                  <div className="text-xs text-gray-500 mb-1">Received {new Date(selected.receivedAt).toLocaleString()}</div>
                  <div className="font-semibold mb-1">{selected.subject || '(no subject)'}</div>
                  <div className="text-xs text-gray-600">
                    From: <span className="font-mono">{selected.fromName ? selected.fromName + ' <' + selected.fromEmail + '>' : selected.fromEmail}</span>
                  </div>
                  <div className="text-xs text-gray-600">To: <span className="font-mono">{selected.toLocalPart}@</span></div>
                  <div className="text-xs text-gray-500 mt-1">
                    SPF: <span className={selected.spfVerdict?.toLowerCase().includes('pass') ? 'text-green-600' : 'text-gray-500'}>{selected.spfVerdict || 'unknown'}</span>
                    {' · '}
                    DKIM: <span className={selected.dkimVerdict?.toLowerCase().includes('pass') ? 'text-green-600' : 'text-gray-500'}>{selected.dkimVerdict || 'unknown'}</span>
                  </div>
                </div>
                {selected.htmlBody ? (
                  <iframe
                    title="Message body"
                    srcDoc={selected.htmlBody}
                    sandbox=""
                    className="w-full min-h-[400px] border-none"
                  />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800">{selected.textBody || '(no body)'}</pre>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
