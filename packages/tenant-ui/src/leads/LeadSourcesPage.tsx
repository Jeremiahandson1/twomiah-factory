// Lead Sources — ONE page for every CRM (vendored into each template as ../shared). Talks to the shared /api/leads/sources
// routes. Before: three copies (crm-family raw fetch + localStorage token; fieldservice raw fetch + context token; salon
// with its own platform list). Now: api client (refresh + retry), the vertical's platform list from config, errors shown,
// and the webhook URL is offered WITH its secret so Zapier / Make users paste one URL.
import React, { useState, useEffect, useCallback } from 'react'
import { Settings, Plus, Trash2, ToggleLeft, ToggleRight, Copy, Check, Mail, Webhook, Info, AlertCircle, KeyRound } from 'lucide-react'
import type { LeadsApi, LeadsConfig, LeadsToast, LeadSourceRow, LeadPlatform } from './types'
import { TRADES_LEAD_PLATFORMS } from './types'

const errMsg = (e: unknown, fallback: string) => (e as Error)?.message || fallback

export function LeadSourcesPage({ api, toast, config }: { api: LeadsApi; toast?: LeadsToast; config?: LeadsConfig }) {
  const platforms: LeadPlatform[] = config?.platforms || TRADES_LEAD_PLATFORMS
  const subtitle = config?.sourcesSubtitle || 'Connect your lead platforms to receive leads automatically'
  const [sources, setSources] = useState<LeadSourceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState('')

  const fetchSources = useCallback(async () => {
    setLoading(true)
    try { const json = await api.get('/api/leads/sources'); setSources(json?.data || []); setError('') }
    catch (e) { setError(errMsg(e, 'Failed to load lead sources')) }
    finally { setLoading(false) }
  }, [api])
  useEffect(() => { fetchSources() }, [fetchSources])

  const act = async (key: string, fn: () => Promise<void>, fallback: string) => {
    setBusy(key)
    try { await fn(); await fetchSources() }
    catch (e) { const msg = errMsg(e, fallback); toast ? toast.error(msg) : setError(msg) }
    finally { setBusy(null) }
  }
  const addSource = (platform: string) => act(`add:${platform}`, async () => {
    const info = platforms.find((p) => p.value === platform)
    await api.post('/api/leads/sources', { platform, label: info?.label || platform })
    setShowAdd(false)
    toast?.success(`${info?.label || platform} connected`)
  }, 'Failed to add lead source')
  const toggleSource = (source: LeadSourceRow) => act(`toggle:${source.id}`, () => api.put(`/api/leads/sources/${source.id}`, { enabled: !source.enabled }), 'Failed to update lead source')
  const deleteSource = (source: LeadSourceRow) => {
    if (!window.confirm(`Remove ${source.label}? Leads already received are kept.`)) return
    return act(`delete:${source.id}`, () => api.delete('/api/leads/sources', source.id), 'Failed to remove lead source')
  }
  const copyToClipboard = async (text: string, field: string) => {
    try { await navigator.clipboard.writeText(text); setCopiedField(field); setTimeout(() => setCopiedField(''), 2000) }
    catch { toast ? toast.error('Copy failed — select the text and copy it manually') : setError('Copy failed — select the text and copy it manually') }
  }
  const webhookWithSecret = (s: LeadSourceRow) => s.webhookUrl ? `${s.webhookUrl}${s.webhookUrl.includes('?') ? '&' : '?'}secret=${s.webhookSecret || ''}` : ''

  const connected = new Set(sources.map((s) => s.platform))
  const available = platforms.filter((p) => !connected.has(p.value))
  const CopyField = ({ label, icon, value, field, mono = true, breakAll = false }: { label: string; icon: React.ReactNode; value: string; field: string; mono?: boolean; breakAll?: boolean }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#666', marginBottom: 6 }}>{icon} {label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <code style={{ flex: 1, padding: '8px 12px', background: '#f5f5f5', borderRadius: 6, fontSize: 13, fontFamily: mono ? 'monospace' : undefined, wordBreak: breakAll ? 'break-all' : undefined }}>{value}</code>
        <button type="button" aria-label={`Copy ${label}`} onClick={() => copyToClipboard(value, field)} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          {copiedField === field ? <Check size={14} color="#2e7d32" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }} data-testid="lead-sources-shared">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><Settings size={24} /> Lead Sources</h1>
          <p style={{ color: '#666', marginTop: 4, fontSize: 14 }}>{subtitle}</p>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> Add Source
        </button>
      </div>

      {error && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16, borderRadius: 8, background: '#fdecea', color: '#b71c1c', fontSize: 13 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setShowAdd(false)}>
          <div role="dialog" aria-label="Add Lead Source" style={{ background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 500, maxHeight: '80vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Add Lead Source</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {available.map((p) => (
                <button key={p.value} disabled={busy === `add:${p.value}`} onClick={() => addSource(p.value)}
                  style={{ padding: '14px 16px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}
                  onMouseOver={(e) => (e.currentTarget.style.borderColor = p.color)} onMouseOut={(e) => (e.currentTarget.style.borderColor = '#e5e7eb')}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{p.label}</span>
                </button>
              ))}
              {available.length === 0 && <p style={{ textAlign: 'center', color: '#999', padding: 16, fontSize: 14 }}>All platforms connected!</p>}
            </div>
            <button onClick={() => setShowAdd(false)} style={{ marginTop: 16, padding: '8px 20px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', width: '100%', fontSize: 13 }}>Cancel</button>
          </div>
        </div>
      )}

      {loading && sources.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading sources...</div>
      ) : sources.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 40, textAlign: 'center' }}>
          <Settings size={48} style={{ marginBottom: 12, opacity: 0.3, color: '#999' }} />
          <div style={{ fontSize: 16, fontWeight: 600 }}>{error ? 'Lead sources could not be loaded' : 'No lead sources configured'}</div>
          {!error && <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>Click "Add Source" to connect your first platform</div>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {sources.map((source) => {
            const info = platforms.find((p) => p.value === source.platform)
            const color = info?.color || '#666'
            return (
              <div key={source.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
                    <span style={{ fontWeight: 700, fontSize: 16 }}>{source.label}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: source.enabled ? '#e8f5e9' : '#f5f5f5', color: source.enabled ? '#2e7d32' : '#999' }}>{source.enabled ? 'Active' : 'Paused'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button type="button" aria-label={source.enabled ? 'Pause source' : 'Resume source'} disabled={busy === `toggle:${source.id}`} onClick={() => toggleSource(source)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: source.enabled ? '#2e7d32' : '#999' }}>
                      {source.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                    </button>
                    <button type="button" aria-label="Remove source" disabled={busy === `delete:${source.id}`} onClick={() => deleteSource(source)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
                <div style={{ padding: '16px 20px' }}>
                  {source.inboundEmail && <CopyField label="Inbound Email Address" icon={<Mail size={14} />} value={source.inboundEmail} field={`email-${source.id}`} />}
                  {source.webhookUrl && <CopyField label="Webhook URL (secret included — paste into Zapier / Make / your form builder)" icon={<Webhook size={14} />} value={webhookWithSecret(source)} field={`webhook-${source.id}`} breakAll />}
                  {source.webhookSecret && <CopyField label="Webhook Secret (or send it as the x-webhook-secret header)" icon={<KeyRound size={14} />} value={source.webhookSecret} field={`secret-${source.id}`} />}
                  {info?.instructions && (
                    <div style={{ background: '#f8f9ff', borderRadius: 8, padding: 14, border: '1px solid #e8ecff' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 8 }}><Info size={14} /> Setup Instructions</div>
                      <ol style={{ paddingLeft: 20, margin: 0, fontSize: 13, color: '#555', lineHeight: 1.8 }}>
                        {info.instructions.map((step, i) => <li key={i}>{step}</li>)}
                      </ol>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
