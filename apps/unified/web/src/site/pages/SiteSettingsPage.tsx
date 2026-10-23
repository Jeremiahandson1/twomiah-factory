// The website's own settings (/api/site/settings): its look, navigation, words, search defaults and tracking. The
// business's facts — name, phone, email, address, logo, main colour — are the company's, edited once in Settings, and
// the site reads them from there.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Save, Plus, X, ChevronUp, ChevronDown } from 'lucide-react'
import { PageError, useMayWrite } from '../../shared'
import { api } from '../../api'
import { Label, TextField, TextAreaField, ImageUrlField } from '../components/Field'

interface NavItem { label: string; href: string }
interface Design { id: string; label: string; isDefault: boolean }

interface SiteRow {
  design: string | null
  tagline: string | null
  serviceAreas: string[]
  inventoryFeedUrl: string | null
  contactCtaLabel: string
  accentColor: string | null
  faviconUrl: string | null
  nav: NavItem[]
  seoTitle: string | null
  seoDescription: string | null
  googleTagManagerId: string | null
  googleAnalyticsId: string | null
  googleAdsId: string | null
  facebookPixelId: string | null
  microsoftClarityId: string | null
}

const FIELDS: Array<keyof SiteRow> = ['design', 'tagline', 'serviceAreas', 'inventoryFeedUrl', 'contactCtaLabel', 'accentColor', 'faviconUrl', 'nav', 'seoTitle', 'seoDescription', 'googleTagManagerId', 'googleAnalyticsId', 'googleAdsId', 'facebookPixelId', 'microsoftClarityId']
const pick = (row: any): SiteRow => Object.fromEntries(FIELDS.map((k) => [k, row?.[k] ?? null])) as SiteRow

const TRACKING = [
  ['googleTagManagerId', 'Google Tag Manager', 'GTM-XXXXXXX'],
  ['googleAnalyticsId', 'Google Analytics 4', 'G-XXXXXXXXXX'],
  ['googleAdsId', 'Google Ads', 'AW-XXXXXXXXX'],
  ['facebookPixelId', 'Facebook Pixel', '1234567890'],
  ['microsoftClarityId', 'Microsoft Clarity', 'abcdefghij'],
] as const

export function SiteSettingsPage() {
  const mayEdit = useMayWrite('site:settings')
  const mayOpenCompany = useMayWrite('company:update')
  const [settings, setSettings] = useState<SiteRow | null>(null)
  const [designs, setDesigns] = useState<Design[]>([])
  const [originalJson, setOriginalJson] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    Promise.all([api.get('/api/site/settings'), api.get('/api/site/designs')])
      .then(([row, d]: [any, { data: Design[] }]) => {
        const initial = pick(row)
        setSettings(initial)
        setOriginalJson(JSON.stringify(initial))
        setDesigns(d.data)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const isDirty = useMemo(() => settings ? JSON.stringify(settings) !== originalJson : false, [settings, originalJson])
  const update = (patch: Partial<SiteRow>) => { setSaved(false); setSettings((s) => s ? { ...s, ...patch } : s) }

  const nav = settings?.nav || []
  const updateNav = (i: number, patch: Partial<NavItem>) => update({ nav: nav.map((n, j) => (j === i ? { ...n, ...patch } : n)) })
  const moveNav = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= nav.length) return
    const next = [...nav]
    ;[next[i], next[j]] = [next[j], next[i]]
    update({ nav: next })
  }

  const save = async () => {
    if (!settings) return
    setSaving(true)
    setError(null)
    try {
      // Blank lines in the town list are where the owner pressed Enter, not towns.
      const body = { ...settings, serviceAreas: (settings.serviceAreas || []).map((s) => s.trim()).filter(Boolean) }
      const updated = pick(await api.patch('/api/site/settings', body))
      setSettings(updated)
      setOriginalJson(JSON.stringify(updated))
      setSaved(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-muted text-sm">Loading…</div>
  if (!settings) return <PageError message={error || "Couldn't load the website's settings."} />

  const defaultDesign = designs.find((d) => d.isDefault)

  return (
    <div className="max-w-3xl mx-auto pb-16">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Website settings</h1>
          <p className="text-muted text-sm mt-1">The site's look, navigation, search defaults and tracking.</p>
        </div>
        {mayEdit && (
          <div className="flex items-center gap-3">
            {isDirty && <span className="text-amber-700 dark:text-amber-300 text-xs font-semibold">Unsaved changes</span>}
            {saved && !isDirty && <span className="text-green-700 dark:text-green-300 text-xs font-semibold" role="status">Saved</span>}
            <button type="button" onClick={save} disabled={saving || !isDirty} className="btn-primary btn-lg disabled:opacity-40">
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      <PageError message={error} className="mb-6" />

      <div className="card card-padding mb-6 text-sm text-ink-soft">
        Your business name, phone, email, address, logo and main colour are your company's, and the site uses them as they are.{' '}
        {mayOpenCompany
          ? <>Change them in <Link to="/crm/settings" className="underline text-ink">Settings</Link>.</>
          : <>An owner or admin changes them in Settings.</>}
      </div>

      <fieldset disabled={!mayEdit} className="min-w-0">
        {/* Look */}
        <section className="card card-padding mb-6">
          <h2 className="text-lg font-semibold text-ink mb-4">Look</h2>
          <div className="space-y-4">
            <div>
              <Label htmlFor="site-design">Design</Label>
              <select id="site-design" className="input" value={settings.design || ''} onChange={(e) => update({ design: e.target.value || null })}>
                <option value="">{defaultDesign ? `${defaultDesign.label} (your business type's)` : 'Your business type\'s'}</option>
                {designs.filter((d) => !d.isDefault).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="site-accent">Accent colour</Label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  aria-label="Pick the accent colour"
                  value={/^#[0-9a-fA-F]{6}$/.test(settings.accentColor || '') ? settings.accentColor! : '#000000'}
                  onChange={(e) => update({ accentColor: e.target.value })}
                  className="w-12 h-10 rounded border border-line cursor-pointer"
                />
                <input id="site-accent" type="text" placeholder="Blank: the design's own" value={settings.accentColor || ''} onChange={(e) => update({ accentColor: e.target.value || null })} className="input" />
              </div>
            </div>
            <ImageUrlField label="Favicon" value={settings.faviconUrl || ''} onChange={(v) => update({ faviconUrl: v || null })} uploadTag="misc" hint="The little icon in the browser tab. Square." />
          </div>
        </section>

        {/* Words and places */}
        <section className="card card-padding mb-6">
          <h2 className="text-lg font-semibold text-ink mb-4">Words and places</h2>
          <div className="space-y-4">
            <TextField label="Tagline" value={settings.tagline || ''} onChange={(e) => update({ tagline: e.target.value || null })} />
            <TextField label="Contact button" value={settings.contactCtaLabel || ''} placeholder="Get in touch" onChange={(e) => update({ contactCtaLabel: e.target.value })} />
            <TextAreaField label="Service areas" hint="One town per line. Each gets its own page at /service-areas." rows={4} value={(settings.serviceAreas || []).join('\n')} onChange={(e) => update({ serviceAreas: e.target.value.split('\n') })} />
            <TextField label="Inventory feed (dealers, optional)" hint="An https:// link to your units as JSON. They then show at /inventory." value={settings.inventoryFeedUrl || ''} onChange={(e) => update({ inventoryFeedUrl: e.target.value || null })} />
          </div>
        </section>

        {/* Navigation */}
        <section className="card card-padding mb-6">
          <h2 className="text-lg font-semibold text-ink mb-1">Navigation</h2>
          <p className="text-xs text-muted mb-4">Items appear in the header in this order. A page you publish is added here; a link to a hidden page isn't shown. Blog, Projects and Service areas are shown on their own once they have something in them.</p>
          <div className="space-y-2">
            {nav.map((item, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] sm:grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-center">
                <input type="text" placeholder="Label" aria-label={`Item ${i + 1} label`} value={item.label} onChange={(e) => updateNav(i, { label: e.target.value })} className="input" />
                <input type="text" placeholder="Link (page or URL)" aria-label={`Item ${i + 1} link`} value={item.href} onChange={(e) => updateNav(i, { href: e.target.value })} className="input" />
                <div className="hidden sm:contents">
                  <button type="button" onClick={() => moveNav(i, -1)} disabled={i === 0} className="btn-secondary btn-sm disabled:opacity-30" aria-label={`Move ${item.label || 'item'} up`}><ChevronUp className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => moveNav(i, 1)} disabled={i === nav.length - 1} className="btn-secondary btn-sm disabled:opacity-30" aria-label={`Move ${item.label || 'item'} down`}><ChevronDown className="w-3.5 h-3.5" /></button>
                </div>
                <button type="button" onClick={() => update({ nav: nav.filter((_, j) => j !== i) })} className="btn-secondary btn-sm" aria-label={`Remove ${item.label || 'item'}`}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => update({ nav: [...nav, { label: '', href: '' }] })} className="btn-secondary btn-sm">
              <Plus className="w-3.5 h-3.5" />
              Add nav item
            </button>
          </div>
        </section>

        {/* SEO */}
        <section className="card card-padding mb-6">
          <h2 className="text-lg font-semibold text-ink mb-1">Search defaults</h2>
          <p className="text-xs text-muted mb-4">The title is your home page's in search results and the browser tab (left empty: your business name and town). Other pages show their own name first, like “About — your business, your town”, unless they set their own. The description is used for pages that don't set their own.</p>
          <div className="space-y-4">
            <TextField label="Home page title" value={settings.seoTitle || ''} onChange={(e) => update({ seoTitle: e.target.value || null })} />
            <TextAreaField label="Default description" rows={3} value={settings.seoDescription || ''} onChange={(e) => update({ seoDescription: e.target.value || null })} />
          </div>
        </section>

        {/* Tracking */}
        <section className="card card-padding mb-6">
          <h2 className="text-lg font-semibold text-ink mb-1">Tracking &amp; analytics</h2>
          <p className="text-sm text-muted mb-4">Paste IDs from Google or your marketing pro. The standard snippets are used, so Google&apos;s tools detect them. Leave blank to turn one off.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {TRACKING.map(([key, label, ph]) => (
              <TextField key={key} label={label} placeholder={ph} value={settings[key] || ''} onChange={(e) => update({ [key]: e.target.value || null } as Partial<SiteRow>)} />
            ))}
          </div>
        </section>
      </fieldset>
    </div>
  )
}
