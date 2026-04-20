import React, { useState, useEffect } from 'react'

// BYOD walkthrough + verification polling.
// Shows the DNS records that must exist at the tenant's DNS host (Cloudflare
// when we own the zone; their registrar otherwise) with copy-to-clipboard,
// a status badge, and a Verify button that forces SendGrid to re-check.

interface DnsRecord {
  type: 'cname' | 'txt' | 'mx' | string
  host: string
  data: string
  valid?: boolean
}

interface DomainStatus {
  status: 'unconfigured' | 'pending' | 'verified' | 'failed'
  domain?: string
  records?: DnsRecord[]
  detail?: string
}

function getToken(): string {
  try { return localStorage.getItem('token') || '' } catch { return '' }
}
function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() }
}

export function EmailDomainPage(): React.ReactElement {
  const [status, setStatus] = useState<DomainStatus>({ status: 'unconfigured' })
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [copiedKey, setCopiedKey] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/email-domain/status', { headers: authHeaders() })
      if (!res.ok) throw new Error('Status check failed: ' + res.status)
      const data = await res.json()
      setStatus(data)
    } catch (err: any) { setError(err.message) }
    setLoading(false)
  }

  async function verify() {
    setVerifying(true); setError('')
    try {
      const res = await fetch('/api/email-domain/verify', { method: 'POST', headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Verify failed') } else { setStatus(data) }
    } catch (err: any) { setError(err.message) }
    setVerifying(false)
  }

  function copy(key: string, value: string) {
    try { navigator.clipboard.writeText(value); setCopiedKey(key); setTimeout(() => setCopiedKey(''), 2000) } catch {}
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Email Domain</h1>
      <p className="text-sm text-gray-500 mb-6">Authenticate your domain with SendGrid so outbound email from your CRM sends as <code className="bg-gray-100 px-1 rounded">support@{status.domain || 'yourdomain.com'}</code> with proper SPF/DKIM.</p>

      {error && <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4 text-sm text-red-700">{error}</div>}

      {loading && <div className="text-sm text-gray-500">Loading…</div>}

      {!loading && status.status === 'unconfigured' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <div className="font-semibold text-yellow-900 mb-1">No domain connected yet</div>
          <div className="text-sm text-yellow-800">Your CRM is running on a temporary URL. Contact support to connect your domain, or re-deploy the tenant with a domain set.</div>
        </div>
      )}

      {!loading && status.status !== 'unconfigured' && (
        <>
          <div className={'rounded-md p-4 mb-6 border ' + (status.status === 'verified' ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200')}>
            <div className="flex items-center justify-between">
              <div>
                <div className={'font-semibold mb-1 ' + (status.status === 'verified' ? 'text-green-900' : 'text-yellow-900')}>
                  {status.status === 'verified' ? '✓ Verified' : '⏳ Pending verification'}
                </div>
                <div className={'text-sm ' + (status.status === 'verified' ? 'text-green-800' : 'text-yellow-800')}>
                  {status.status === 'verified'
                    ? 'All DNS records are valid. Outbound email sends as your domain.'
                    : 'Add the records below at your DNS host, then click Verify. DNS propagation usually takes 5–30 minutes.'}
                </div>
                {status.detail && <div className="text-xs text-gray-600 mt-2">{status.detail}</div>}
              </div>
              <button onClick={verify} disabled={verifying} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-400 text-white rounded-md text-sm font-semibold whitespace-nowrap">
                {verifying ? 'Verifying…' : 'Verify Now'}
              </button>
            </div>
          </div>

          {status.records && status.records.length > 0 && (
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Host</th>
                    <th className="px-3 py-2 text-left">Value</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {status.records.map((r, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-2 uppercase font-mono text-xs">{r.type}</td>
                      <td className="px-3 py-2 font-mono text-xs break-all">
                        <button onClick={() => copy('host-' + i, r.host)} className="text-left hover:text-orange-600" title="Copy">
                          {r.host}
                          {copiedKey === 'host-' + i && <span className="text-green-600 ml-1">✓</span>}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs break-all">
                        <button onClick={() => copy('data-' + i, r.data)} className="text-left hover:text-orange-600" title="Copy">
                          {r.data}
                          {copiedKey === 'data-' + i && <span className="text-green-600 ml-1">✓</span>}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        {r.valid === true ? <span className="text-green-600 font-semibold">✓</span>
                          : r.valid === false ? <span className="text-red-600 font-semibold">✗</span>
                          : <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-gray-500 mt-4">Click any host or value to copy it. After DNS records propagate, click Verify Now to re-check.</p>
        </>
      )}
    </div>
  )
}
