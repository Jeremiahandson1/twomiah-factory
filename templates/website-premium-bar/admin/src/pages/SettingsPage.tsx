import { useEffect, useMemo, useState } from 'react'
import { Save, Plus, X } from 'lucide-react'
import { api } from '../api/client'
import { Label, TextField, TextAreaField, ImageUrlField } from '../components/Field'

interface NavItem { label: string; href: string }

interface Settings {
  googleTagManagerId?: string | null
  googleAnalyticsId?: string | null
  googleAdsId?: string | null
  facebookPixelId?: string | null
  microsoftClarityId?: string | null
  id?: string
  companyName: string
  tagline?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  contactCtaLabel?: string
  primaryColor?: string | null
  secondaryColor?: string | null
  accentColor?: string | null
  logoUrl?: string | null
  faviconUrl?: string | null
  nav?: NavItem[]
}

const DEFAULT_SETTINGS: Settings = {
  companyName: '',
  tagline: '',
  phone: '',
  email: '',
  address: '',
  seoTitle: '',
  seoDescription: '',
  contactCtaLabel: 'Get in touch',
  primaryColor: '#1a2e22',
  secondaryColor: '#0f1f17',
  accentColor: '#c89a4e',
  logoUrl: '',
  faviconUrl: '',
  nav: [
    { label: 'Services', href: 'services' },
    { label: 'About', href: 'about' },
    { label: 'Contact', href: 'contact' },
  ],
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [originalJson, setOriginalJson] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<{ settings: Settings | null }>('/api/admin/settings')
      .then(({ settings }) => {
        const initial = settings || DEFAULT_SETTINGS
        setSettings(initial)
        setOriginalJson(JSON.stringify(initial))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const isDirty = useMemo(() => settings ? JSON.stringify(settings) !== originalJson : false, [settings, originalJson])

  const update = (patch: Partial<Settings>) => setSettings((s) => s ? { ...s, ...patch } : s)

  const updateNav = (i: number, patch: Partial<NavItem>) => {
    if (!settings) return
    const nav = [...(settings.nav || [])]
    nav[i] = { ...nav[i], ...patch }
    update({ nav })
  }
  const removeNav = (i: number) => {
    if (!settings) return
    update({ nav: (settings.nav || []).filter((_, j) => j !== i) })
  }
  const addNav = () => {
    if (!settings) return
    update({ nav: [...(settings.nav || []), { label: '', href: '' }] })
  }
  const moveNav = (i: number, dir: -1 | 1) => {
    if (!settings) return
    const nav = [...(settings.nav || [])]
    const j = i + dir
    if (j < 0 || j >= nav.length) return
    ;[nav[i], nav[j]] = [nav[j], nav[i]]
    update({ nav })
  }

  const save = async () => {
    if (!settings) return
    setSaving(true)
    setError(null)
    try {
      const { settings: updated } = await api.patch<{ settings: Settings }>('/api/admin/settings', settings)
      setSettings(updated)
      setOriginalJson(JSON.stringify(updated))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-muted text-sm">Loading…</div>
  if (!settings) return null

  return (
    <div className="p-8 max-w-3xl mx-auto pb-32">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl text-ink">Settings</h1>
          <p className="text-muted text-sm mt-1">Company info, brand colors, navigation, SEO defaults.</p>
        </div>
        <button onClick={save} disabled={saving || !isDirty} className="btn-primary btn-lg inline-flex items-center gap-1.5 disabled:opacity-40">
          <Save className="w-4 h-4" />
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-6">{error}</div>}

      {/* Company */}
      <section className="card card-padding mb-6">
        <h2 className="text-lg text-ink mb-4">Company</h2>
        <div className="space-y-4">
          <TextField label="Company name" value={settings.companyName} onChange={(e) => update({ companyName: e.target.value })} />
          <TextField label="Tagline" value={settings.tagline || ''} onChange={(e) => update({ tagline: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Phone" value={settings.phone || ''} onChange={(e) => update({ phone: e.target.value })} />
            <TextField label="Email" value={settings.email || ''} onChange={(e) => update({ email: e.target.value })} />
          </div>
          <TextAreaField label="Address" rows={2} value={settings.address || ''} onChange={(e) => update({ address: e.target.value })} />
          <TextField label="Contact CTA button label" value={settings.contactCtaLabel || ''} onChange={(e) => update({ contactCtaLabel: e.target.value })} />
        </div>
      </section>

      {/* Tracking & Analytics */}
      <section className="card card-padding mb-6">
        <h2 className="text-lg text-ink mb-1">Tracking &amp; Analytics</h2>
        <p className="text-sm text-slate-500 mb-4">Paste IDs from Google or your marketing pro. Standard snippets are used, so Google&apos;s verification tools detect them. Leave blank to disable.</p>
        <div className="grid grid-cols-2 gap-4">
          {([
            ['googleTagManagerId', 'Google Tag Manager', 'GTM-XXXXXXX'],
            ['googleAnalyticsId', 'Google Analytics 4', 'G-XXXXXXXXXX'],
            ['googleAdsId', 'Google Ads', 'AW-XXXXXXXXX'],
            ['facebookPixelId', 'Facebook Pixel', '1234567890'],
            ['microsoftClarityId', 'Microsoft Clarity', 'abcdefghij'],
          ] as const).map(([key, label, ph]) => (
            <div key={key}>
              <Label>{label}</Label>
              <input type="text" placeholder={ph} value={(settings as any)[key] || ''}
                onChange={(e) => update({ [key]: e.target.value } as Partial<Settings>)} className="input" />
            </div>
          ))}
        </div>
      </section>

      {/* Brand */}
      <section className="card card-padding mb-6">
        <h2 className="text-lg text-ink mb-4">Brand</h2>
        <div className="grid grid-cols-3 gap-4 mb-4">
          {(['primaryColor', 'secondaryColor', 'accentColor'] as const).map((key) => (
            <div key={key}>
              <Label>{key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())}</Label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={settings[key] || '#000000'}
                  onChange={(e) => update({ [key]: e.target.value } as Partial<Settings>)}
                  className="w-12 h-10 rounded border border-line cursor-pointer"
                />
                <input
                  type="text"
                  value={settings[key] || ''}
                  onChange={(e) => update({ [key]: e.target.value } as Partial<Settings>)}
                  className="input"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ImageUrlField label="Logo" value={settings.logoUrl || ''} onChange={(v) => update({ logoUrl: v })} uploadTag="misc" />
          <ImageUrlField label="Favicon" value={settings.faviconUrl || ''} onChange={(v) => update({ faviconUrl: v })} uploadTag="misc" hint="Square. Ideally an SVG." />
        </div>
      </section>

      {/* Navigation */}
      <section className="card card-padding mb-6">
        <h2 className="text-lg text-ink mb-1">Navigation</h2>
        <p className="text-xs text-muted mb-4">Items appear in the header in this order.</p>
        <div className="space-y-2">
          {(settings.nav || []).map((item, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-center">
              <input
                type="text"
                placeholder="Label"
                value={item.label}
                onChange={(e) => updateNav(i, { label: e.target.value })}
                className="input"
              />
              <input
                type="text"
                placeholder="Link (slug or URL)"
                value={item.href}
                onChange={(e) => updateNav(i, { href: e.target.value })}
                className="input"
              />
              <button type="button" onClick={() => moveNav(i, -1)} disabled={i === 0} className="btn-secondary btn-sm disabled:opacity-30" aria-label="Move up">↑</button>
              <button type="button" onClick={() => moveNav(i, 1)} disabled={i === (settings.nav?.length || 0) - 1} className="btn-secondary btn-sm disabled:opacity-30" aria-label="Move down">↓</button>
              <button type="button" onClick={() => removeNav(i)} className="btn-secondary btn-sm" aria-label="Remove">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button type="button" onClick={addNav} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Add nav item
          </button>
        </div>
      </section>

      {/* SEO */}
      <section className="card card-padding mb-6">
        <h2 className="text-lg text-ink mb-1">SEO defaults</h2>
        <p className="text-xs text-muted mb-4">Used for pages that don't set their own meta title / description.</p>
        <div className="space-y-4">
          <TextField label="Default meta title" value={settings.seoTitle || ''} onChange={(e) => update({ seoTitle: e.target.value })} />
          <TextAreaField label="Default meta description" rows={3} value={settings.seoDescription || ''} onChange={(e) => update({ seoDescription: e.target.value })} />
        </div>
      </section>
    </div>
  )
}
