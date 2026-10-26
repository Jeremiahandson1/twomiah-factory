// Moved from templates/crm-store/frontend/src/pages/SettingsPage.tsx — the store's own part of it, as a Settings card
// at /crm/store-settings (its own address: a store manager may change shipping, and /crm/settings is the owner's): the business's name and support email (the company's, PUT /api/company), and the commerce
// settings at /api/admin/settings (server/crm/store/catalog/settings.ts): currency and tax, flat shipping and the free
// shipping line, shipping zones and regional tax rates, the abandoned-cart and review-request emails.
//
// Kept as the template had it: who sets what — shipping (flat rate, free line, zones) is shipping:configure, the
// manager's as well; everything else settings:update, the owner's — each section a disabled record for a seat that
// cannot change it; one Save that sends only the settings this person changed from what the page loaded (a manager's
// save carries shipping fields alone, and two people saving keep each other's work).
//
// Changes from the template:
//   · the store's name and support email are the company's (UNIFIED_STORE_PLAN decision 1): read from GET /api/company
//     (`name`, `email`) and saved with PUT /api/company, which is the owner's and an admin's (company:update — asked
//     here, as the shared Settings page asks it); the template sent them in the settings save as companyName /
//     supportEmail, which the server now refuses. The storefront's address is not here: the website is this app's own,
//     its address the Domain page (/crm/domain);
//   · the abandoned-cart reminder (on/off, how long after) and the review request (on/off, days after shipping) can be
//     set — the server took them and no screen could; they are the owner's (settings:update);
//   · the settings are the reply itself (the template read { settings }); a refusal's `fields` names the boxes;
//   · money and percents are read from the digits (a 7.25% rate is 725 basis points, never 724), and a box that is not
//     a number is refused on the form, naming it — the template sent parseFloat's NaN or 0;
//   · the zone and tax-rate rows stack at phone width (twelve-column grids that were 30px a box on a phone), each with a
//     labelled Remove button (was a bare ✕);
//   · the team, two-factor, password and email links are the shared screens (Team, My account, Settings) — not here;
//   · every ink has its dark partner;
//   · (2026-10-24, the store upgrade) Stripe Tax (the owner's: tax by the shopper's address, with what it costs and what
//     the business must do — the server refuses it until Stripe says its tax settings are active), local pickup (the
//     manager's too, as shipping is: the address and hours shown at checkout and in the ready-for-pickup email), and
//     the product feeds' private addresses with the steps for Google Merchant Center and Meta (the owner's).
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useAuth, useConfirm, useMayWrite, useToast } from '../../../../shared'
import { bpsToPercent, fromHundredths, refusalOf, toHundredths, toWhole, type StoreSettings } from './lib'

interface ZoneRow { name: string; countries: string; states: string; rate: string; free: string }
interface TaxRow { country: string; state: string; rate: string }
interface Form {
  name: string; email: string; currency: string; taxRatePct: string
  flatShipping: string; freeShippingThreshold: string; zones: ZoneRow[]; taxes: TaxRow[]
  abandonedCartEnabled: boolean; abandonedCartDelayMinutes: string; reviewsEnabled: boolean; reviewRequestDays: string
  stripeTaxEnabled: boolean; pickupEnabled: boolean; pickupAddress: string; pickupHours: string
}

const listText = (a: string[] | null | undefined) => (a || []).join(', ')
const listOfText = (s: string) => s.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)

const formOf = (s: StoreSettings | null, company: { name?: string | null; email?: string | null } | null): Form => ({
  name: company?.name || '',
  email: company?.email || '',
  currency: s?.currency || 'usd',
  taxRatePct: bpsToPercent(s?.taxRateBps ?? 0),
  flatShipping: fromHundredths(s?.flatShippingCents ?? 0),
  freeShippingThreshold: fromHundredths(s?.freeShippingThresholdCents),
  zones: (s?.shippingZones || []).map((z) => ({ name: z.name, countries: listText(z.countries), states: listText(z.states), rate: fromHundredths(z.rateCents), free: fromHundredths(z.freeThresholdCents) })),
  taxes: (s?.taxRates || []).map((t) => ({ country: t.country, state: t.state, rate: bpsToPercent(t.rateBps) })),
  abandonedCartEnabled: s?.abandonedCartEnabled ?? true,
  abandonedCartDelayMinutes: String(s?.abandonedCartDelayMinutes ?? 60),
  reviewsEnabled: s?.reviewsEnabled ?? true,
  reviewRequestDays: String(s?.reviewRequestDays ?? 7),
  stripeTaxEnabled: !!s?.stripeTaxEnabled,
  pickupEnabled: !!s?.pickupEnabled,
  pickupAddress: s?.pickupAddress || '',
  pickupHours: s?.pickupHours || '',
})

/** The commerce settings as the server takes them, or the first box that is wrong. */
function settingsOf(f: Form): { body: Record<string, unknown> } | { error: string } {
  const flat = toHundredths(f.flatShipping || '0')
  if (flat === null) return { error: 'Flat shipping is an amount, like 5.00.' }
  const free = f.freeShippingThreshold.trim() ? toHundredths(f.freeShippingThreshold) : null
  if (f.freeShippingThreshold.trim() && free === null) return { error: 'Free shipping over is an amount, or blank for never.' }
  const tax = toHundredths(f.taxRatePct || '0')
  if (tax === null || tax > 10000) return { error: 'The tax rate is a percent from 0 to 100, like 7.25.' }
  if (!/^[a-zA-Z]{3}$/.test(f.currency.trim())) return { error: 'The currency is a three-letter code, like usd.' }
  const zones = []
  for (const [i, z] of f.zones.entries()) {
    if (!z.name.trim()) continue
    const rate = toHundredths(z.rate || '0')
    if (rate === null) return { error: `Zone ${i + 1} (${z.name.trim()}): the rate is an amount, like 7.00.` }
    const zf = z.free.trim() ? toHundredths(z.free) : null
    if (z.free.trim() && zf === null) return { error: `Zone ${i + 1} (${z.name.trim()}): free over is an amount, or blank.` }
    zones.push({ name: z.name.trim(), countries: listOfText(z.countries), states: listOfText(z.states), rateCents: rate, freeThresholdCents: zf })
  }
  const taxes = []
  for (const [i, t] of f.taxes.entries()) {
    if (!t.country.trim() && !t.state.trim()) continue
    const rate = toHundredths(t.rate || '0')
    if (rate === null || rate > 10000) return { error: `Tax rate ${i + 1}: the rate is a percent from 0 to 100.` }
    taxes.push({ country: t.country.trim().toUpperCase(), state: t.state.trim().toUpperCase(), rateBps: rate })
  }
  const delay = toWhole(f.abandonedCartDelayMinutes)
  if (delay === null || Number.isNaN(delay) || delay < 1 || delay > 10080) return { error: 'The abandoned-cart reminder goes out 1 to 10080 minutes (a week) after the cart is left.' }
  if (f.pickupEnabled && !f.pickupAddress.trim()) return { error: 'Pickup needs the address customers collect from.' }
  const days = toWhole(f.reviewRequestDays)
  if (days === null || Number.isNaN(days) || days > 365) return { error: 'The review request goes out 0 to 365 days after shipping.' }
  return {
    body: {
      currency: f.currency.trim().toLowerCase(),
      flatShippingCents: flat,
      freeShippingThresholdCents: free,
      taxRateBps: tax,
      shippingZones: zones,
      taxRates: taxes,
      abandonedCartEnabled: f.abandonedCartEnabled,
      abandonedCartDelayMinutes: delay,
      reviewsEnabled: f.reviewsEnabled,
      reviewRequestDays: days,
      stripeTaxEnabled: f.stripeTaxEnabled,
      pickupEnabled: f.pickupEnabled,
      pickupAddress: f.pickupAddress.trim() || null,
      pickupHours: f.pickupHours.trim() || null,
    },
  }
}

export default function StoreSettingsPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const { updateCompany } = useAuth()
  const [form, setForm] = useState<Form>(() => formOf(null, null))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // What the page was filled from: the settings as the server would take them, and the company's two fields.
  const loaded = useRef<{ settings: Record<string, unknown>; name: string; email: string } | null>(null)
  // The product feeds' token (the owner's only) and Stripe's word on its tax settings.
  const [feedToken, setFeedToken] = useState<string | null>(null)
  const [taxState, setTaxState] = useState<{ provider: string | null; status: string } | null>(null)

  // Each section asks the permission its fields ask on the server.
  const maySaveSettings = useMayWrite('settings:update')
  const mayShipping = useMayWrite('shipping:configure')
  // PUT /api/company is requireAdmin — the shared Settings page asks company:update for it, and so does this.
  const mayCompany = useMayWrite('company:update')

  useEffect(() => {
    Promise.all([api.get('/api/admin/settings'), api.get('/api/company')])
      .then(([s, co]: [StoreSettings, { name?: string; email?: string }]) => {
        const f = formOf(s, co)
        setForm(f)
        setFeedToken(s.feedToken || null)
        const d = settingsOf(f)
        loaded.current = { settings: 'body' in d ? d.body : {}, name: f.name, email: f.email }
      })
      .catch((e: unknown) => setLoadError(errorText(e, 'Could not load the store settings')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!maySaveSettings) return
    api.get('/api/admin/settings/stripe-tax').then((t: { provider: string | null; status: string }) => setTaxState(t)).catch(() => setTaxState(null))
  }, [maySaveSettings])

  const newFeedAddress = async () => {
    if (!(await confirm('Make new feed addresses? The old ones stop working at once — paste the new ones into Google Merchant Center and Meta.', { title: 'New feed addresses', confirmText: 'Make new ones' }))) return
    try { const r = await api.post('/api/admin/settings/feed-token') as { feedToken: string }; setFeedToken(r.feedToken); toast.success('New feed addresses made') }
    catch (e) { toast.error(errorText(e, 'Could not make new addresses')) }
  }
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('Copied') } catch { toast.error('Copy did not work here — select the address and copy it') }
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))
  const addZone = () => set('zones', [...form.zones, { name: '', countries: '', states: '', rate: '', free: '' }])
  const setZone = (i: number, k: keyof ZoneRow, v: string) => set('zones', form.zones.map((z, j) => (j === i ? { ...z, [k]: v } : z)))
  const delZone = (i: number) => set('zones', form.zones.filter((_, j) => j !== i))
  const addTax = () => set('taxes', [...form.taxes, { country: 'US', state: '', rate: '' }])
  const setTax = (i: number, k: keyof TaxRow, v: string) => set('taxes', form.taxes.map((t, j) => (j === i ? { ...t, [k]: v } : t)))
  const delTax = (i: number) => set('taxes', form.taxes.filter((_, j) => j !== i))

  const save = async () => {
    setSaveError(null)
    const from = loaded.current
    if (!from) return
    const d = settingsOf(form)
    if ('error' in d) { setSaveError(d.error); return }
    const changed = Object.fromEntries(Object.entries(d.body).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(from.settings[k])))
    const companyPatch: Record<string, string> = {}
    if (mayCompany && form.name.trim() !== from.name) companyPatch.name = form.name.trim()
    if (mayCompany && form.email.trim().toLowerCase() !== from.email.toLowerCase()) companyPatch.email = form.email.trim()
    if (companyPatch.name !== undefined && companyPatch.name.length < 2) { setSaveError('The store name needs at least 2 characters.'); return }
    if (!Object.keys(changed).length && !Object.keys(companyPatch).length) { toast.success('Saved — nothing had changed'); return }
    setSaving(true)
    try {
      if (Object.keys(companyPatch).length) {
        const co: { name?: string; email?: string } = await api.put('/api/company', companyPatch)
        loaded.current = { ...from, name: co?.name ?? form.name.trim(), email: co?.email ?? form.email.trim() }
        // The shell's brand name follows at once (the header shows the company's name).
        updateCompany({ name: co?.name ?? form.name.trim(), email: co?.email ?? form.email.trim() })
      }
      if (Object.keys(changed).length) {
        await api.patch('/api/admin/settings', changed)
        loaded.current = { ...(loaded.current || from), settings: { ...from.settings, ...changed } }
      }
      toast.success('Settings saved')
    } catch (e) {
      const named = Object.entries(refusalOf(e).fields).map(([k, v]) => `${k}: ${v}`).join('; ')
      setSaveError(named ? `${errorText(e, 'Save failed')} (${named})` : errorText(e, 'Save failed'))
    } finally { setSaving(false) }
  }

  // Back to Settings only for whoever may open it (the owner and admins: settings:update); a manager reaches this page
  // from the menu, and /crm/settings would refuse them.
  const back = maySaveSettings ? <Link to="/crm/settings" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100"><ArrowLeft className="h-4 w-4" /> Settings</Link> : null
  if (loading) return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-brand-500" /></div>
  if (loadError) return <div className="max-w-2xl space-y-4">{back}<PageError message={loadError} /></div>

  const note = 'text-xs text-gray-600 dark:text-slate-400'
  const h2 = 'font-semibold text-gray-900 dark:text-slate-100'

  return (
    <div className="max-w-2xl space-y-6">
      {back}
      <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Store, shipping &amp; tax</h1>

      {/* Each control carries its section's rule as its own `disabled` too: a disabled fieldset stops the browser editing
          its children but leaves each one's `.disabled` false, which is what the store's T3 retest read as "still
          editable inputs" (tests/store/audit-and-shipping-rates; the template's fix, lost in the move). */}
      {/* The business: the company's name and email (owner and admin, PUT /api/company). */}
      <fieldset disabled={!mayCompany} className="card p-5 space-y-4 min-w-0">
        <h2 className={h2}>Store</h2>
        {!mayCompany && <p className={note}>The store's name and support email are set by the owner.</p>}
        <div><label className="label" htmlFor="st-name">Store name</label><input disabled={!mayCompany} id="st-name" className="input" value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div><label className="label" htmlFor="st-email">Support email</label><input disabled={!mayCompany} id="st-email" className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
        {maySaveSettings && <p className={note}>The storefront's address is on the <Link to="/crm/domain" className="underline">Domain</Link> page.</p>}
      </fieldset>

      <fieldset disabled={!maySaveSettings} className="card p-5 space-y-4 min-w-0">
        <h2 className={h2}>Currency &amp; tax</h2>
        {!maySaveSettings && <p className={note}>The currency and tax are set by the owner.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Shown as the code is written (USD), kept lowercase as the server stores it (store live test, 2026-10-26). */}
          <div><label className="label" htmlFor="st-cur">Currency</label><input disabled={!maySaveSettings} id="st-cur" className="input" value={form.currency.toUpperCase()} onChange={(e) => set('currency', e.target.value.toLowerCase())} maxLength={3} /></div>
          <div><label className="label" htmlFor="st-tax">Tax rate (%)</label><input disabled={!maySaveSettings} id="st-tax" className="input" inputMode="decimal" value={form.taxRatePct} onChange={(e) => set('taxRatePct', e.target.value)} /></div>
        </div>
      </fieldset>

      {/* Stripe Tax: the owner's (settings:update), as the tax rate is. */}
      <fieldset disabled={!maySaveSettings} className="card p-5 space-y-3 min-w-0">
        <h2 className={h2}>Sales tax by address (Stripe Tax)</h2>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
          <input disabled={!maySaveSettings} type="checkbox" checked={form.stripeTaxEnabled} onChange={(e) => set('stripeTaxEnabled', e.target.checked)} />
          Work out sales tax from each shopper's address at checkout
        </label>
        <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1 dark:text-slate-300">
          <li>Stripe works out the right rate for the address on the payment page and shows it there; the order and the receipt show what was charged.</li>
          <li>Stripe charges 0.5% of each transaction where it calculates tax, on top of its card fees. That fee is Stripe's, billed to your Stripe account.</li>
          <li>You must register to collect tax in each state (or country) where you owe it, and add those registrations in Stripe (Settings › Tax › Registrations). Stripe only collects where you are registered — it does not register or file for you.</li>
          <li>Works with Stripe payments only. Off — or with Square or PayPal — the tax rates below are used.</li>
        </ul>
        {taxState && (
          <p className={note}>{taxState.provider !== 'stripe'
            ? 'Stripe is not your connected payment provider, so Stripe Tax cannot be switched on.'
            : taxState.status === 'active' ? 'Your Stripe account’s tax settings are active.'
              : 'Your Stripe account’s tax settings are not finished: in Stripe, open Settings › Tax, add your business address and registrations, then switch this on.'}</p>
        )}
      </fieldset>

      <fieldset disabled={!mayShipping} className="card p-5 space-y-4 min-w-0">
        <h2 className={h2}>Shipping</h2>
        {!mayShipping && <p className={note}>Shipping rates are set by a manager or the owner.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="label" htmlFor="st-flat">Flat shipping ({form.currency.toUpperCase()})</label><input disabled={!mayShipping} id="st-flat" className="input" inputMode="decimal" value={form.flatShipping} onChange={(e) => set('flatShipping', e.target.value)} /></div>
          <div><label className="label" htmlFor="st-free">Free shipping over</label><input disabled={!mayShipping} id="st-free" className="input" inputMode="decimal" value={form.freeShippingThreshold} onChange={(e) => set('freeShippingThreshold', e.target.value)} placeholder="Blank = never" /></div>
        </div>
        <p className={note}>The flat rate and the tax rate apply where no zone or regional rate below matches.</p>
      </fieldset>

      <fieldset disabled={!mayShipping} className="card p-5 space-y-3 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={h2}>Shipping zones <span className="font-normal text-gray-600 dark:text-slate-400">(by region)</span></h2>
          {mayShipping && <button type="button" onClick={addZone} className="btn btn-secondary text-sm px-3 py-1.5"><Plus className="h-4 w-4" /> Add zone</button>}
        </div>
        {form.zones.length === 0 && <p className="text-sm text-gray-600 dark:text-slate-400">No zones — the flat rate applies everywhere.</p>}
        {form.zones.map((z, i) => (
          <div key={i} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end border-t border-gray-200 pt-3 dark:border-slate-800">
            <div className="col-span-2 sm:col-span-3"><label className="label text-xs" htmlFor={`z${i}-name`}>Name</label><input disabled={!mayShipping} id={`z${i}-name`} className="input" value={z.name} onChange={(e) => setZone(i, 'name', e.target.value)} placeholder="Domestic" /></div>
            <div className="sm:col-span-2"><label className="label text-xs" htmlFor={`z${i}-c`}>Countries</label><input disabled={!mayShipping} id={`z${i}-c`} className="input" value={z.countries} onChange={(e) => setZone(i, 'countries', e.target.value)} placeholder="US" /></div>
            <div className="sm:col-span-3"><label className="label text-xs" htmlFor={`z${i}-s`}>States (blank = all)</label><input disabled={!mayShipping} id={`z${i}-s`} className="input" value={z.states} onChange={(e) => setZone(i, 'states', e.target.value)} placeholder="CA, NY" /></div>
            <div className="sm:col-span-2"><label className="label text-xs" htmlFor={`z${i}-r`}>Rate</label><input disabled={!mayShipping} id={`z${i}-r`} className="input" inputMode="decimal" value={z.rate} onChange={(e) => setZone(i, 'rate', e.target.value)} placeholder="7.00" /></div>
            <div className="sm:col-span-1"><label className="label text-xs" htmlFor={`z${i}-f`}>Free over</label><input disabled={!mayShipping} id={`z${i}-f`} className="input px-2" inputMode="decimal" value={z.free} onChange={(e) => setZone(i, 'free', e.target.value)} placeholder="—" /></div>
            {mayShipping && <div className="sm:col-span-1"><button type="button" onClick={() => delZone(i)} aria-label={`Remove zone ${z.name || i + 1}`} className="p-2 text-red-700 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"><Trash2 className="h-4 w-4" /></button></div>}
          </div>
        ))}
      </fieldset>

      <fieldset disabled={!maySaveSettings} className="card p-5 space-y-3 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={h2}>Tax rates <span className="font-normal text-gray-600 dark:text-slate-400">(by region)</span></h2>
          {maySaveSettings && <button type="button" onClick={addTax} className="btn btn-secondary text-sm px-3 py-1.5"><Plus className="h-4 w-4" /> Add rate</button>}
        </div>
        {form.taxes.length === 0 && <p className="text-sm text-gray-600 dark:text-slate-400">No regional rates — the tax rate above applies.</p>}
        {form.taxes.map((t, i) => (
          <div key={i} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end border-t border-gray-200 pt-3 dark:border-slate-800">
            <div className="sm:col-span-4"><label className="label text-xs" htmlFor={`t${i}-c`}>Country</label><input disabled={!maySaveSettings} id={`t${i}-c`} className="input" value={t.country} onChange={(e) => setTax(i, 'country', e.target.value)} placeholder="US" /></div>
            <div className="sm:col-span-4"><label className="label text-xs" htmlFor={`t${i}-s`}>State (blank = all)</label><input disabled={!maySaveSettings} id={`t${i}-s`} className="input" value={t.state} onChange={(e) => setTax(i, 'state', e.target.value)} placeholder="CA" /></div>
            <div className="sm:col-span-3"><label className="label text-xs" htmlFor={`t${i}-r`}>Rate %</label><input disabled={!maySaveSettings} id={`t${i}-r`} className="input" inputMode="decimal" value={t.rate} onChange={(e) => setTax(i, 'rate', e.target.value)} placeholder="7.25" /></div>
            {maySaveSettings && <div className="sm:col-span-1"><button type="button" onClick={() => delTax(i)} aria-label={`Remove tax rate ${i + 1}`} className="p-2 text-red-700 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"><Trash2 className="h-4 w-4" /></button></div>}
          </div>
        ))}
      </fieldset>

      {/* Local pickup: the shop's day-to-day, as shipping is (shipping:configure). */}
      <fieldset disabled={!mayShipping} className="card p-5 space-y-3 min-w-0">
        <h2 className={h2}>Local pickup</h2>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
          <input disabled={!mayShipping} type="checkbox" checked={form.pickupEnabled} onChange={(e) => set('pickupEnabled', e.target.checked)} />
          Let shoppers pick up their order (no shipping charge)
        </label>
        <div><label className="label" htmlFor="st-pu-addr">Pickup address</label><textarea disabled={!mayShipping} id="st-pu-addr" className="input min-h-[64px]" value={form.pickupAddress} onChange={(e) => set('pickupAddress', e.target.value)} placeholder={'123 Main St\nMadison, WI 53703'} /></div>
        <div><label className="label" htmlFor="st-pu-hours">Pickup hours</label><textarea disabled={!mayShipping} id="st-pu-hours" className="input min-h-[64px]" value={form.pickupHours} onChange={(e) => set('pickupHours', e.target.value)} placeholder="Mon–Fri 9am–5pm" /></div>
        <p className={note}>Shown at checkout and on the receipt. Mark a pickup order “Ready for pickup” to email the customer; “Picked up” when they collect it.</p>
      </fieldset>

      {/* Product feeds: private addresses, the owner's. */}
      {maySaveSettings && feedToken && (
        <div className="card p-5 space-y-3 min-w-0">
          <h2 className={h2}>Product feeds</h2>
          <p className={note}>Private addresses that list every product on sale, kept up to date. Anyone with an address can read your catalogue, so share them only with Google and Meta.</p>
          {([
            ['Google Merchant Center (XML)', 'google.xml'], ['Google Merchant Center (tab-separated)', 'google.tsv'], ['Meta catalog (CSV)', 'meta.csv'],
          ] as const).map(([label, file]) => {
            const url = `${window.location.origin}/api/public/feeds/${feedToken}/${file}`
            return (
              <div key={file} className="space-y-1">
                <span className="text-sm font-medium text-gray-800 dark:text-slate-200">{label}</span>
                <div className="flex flex-wrap gap-2"><input readOnly className="input flex-1 min-w-0 font-mono text-xs" value={url} aria-label={`${label} address`} onFocus={(e) => e.currentTarget.select()} /><button type="button" className="btn btn-secondary text-xs px-3 py-1.5" onClick={() => copy(url)}>Copy</button></div>
              </div>
            )
          })}
          <details className="rounded-lg border border-gray-200 p-3 dark:border-slate-700">
            <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-slate-200">How to add them</summary>
            <div className="mt-2 space-y-3 text-sm text-gray-700 dark:text-slate-300">
              <div><strong>Google Merchant Center</strong>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>In Merchant Center, open Settings › Data sources › Add product source › Add products from a file.</li>
                  <li>Choose “Enter a link to your file” and paste the XML address above (or the tab-separated one).</li>
                  <li>Set it to fetch daily, then save. Google checks the products; fix anything it flags (a missing photo, a barcode) on the product's page here.</li>
                </ol>
              </div>
              <div><strong>Meta (Facebook and Instagram shops)</strong>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>In Commerce Manager, open your catalog, then Catalog › Data sources › Add items › Data feed.</li>
                  <li>Choose “Scheduled feed”, paste the Meta CSV address above, and set it to update daily.</li>
                  <li>Choose your currency, then upload. Meta lists any items it could not take.</li>
                </ol>
              </div>
              <p className={note}>Each product option is one item: its SKU is the id, with the title, description, link, photo, price (and sale price), stock, brand, condition, and the barcode and part number when you have added them.</p>
            </div>
          </details>
          <button type="button" className="btn btn-secondary text-sm" onClick={newFeedAddress}>Make new addresses</button>
        </div>
      )}

      <fieldset disabled={!maySaveSettings} className="card p-5 space-y-4 min-w-0">
        <h2 className={h2}>Emails to shoppers</h2>
        {!maySaveSettings && <p className={note}>These are set by the owner.</p>}
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
            <input disabled={!maySaveSettings} type="checkbox" checked={form.abandonedCartEnabled} onChange={(e) => set('abandonedCartEnabled', e.target.checked)} />
            Remind a shopper who left items in their cart
          </label>
          <div className="pl-6">
            <label className="label text-xs" htmlFor="st-ac">Send it after (minutes)</label>
            <input id="st-ac" className="input max-w-[10rem]" inputMode="numeric" value={form.abandonedCartDelayMinutes} disabled={!form.abandonedCartEnabled || !maySaveSettings} onChange={(e) => set('abandonedCartDelayMinutes', e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
            <input disabled={!maySaveSettings} type="checkbox" checked={form.reviewsEnabled} onChange={(e) => set('reviewsEnabled', e.target.checked)} />
            Ask for a product review after an order ships
          </label>
          <div className="pl-6">
            <label className="label text-xs" htmlFor="st-rv">Days after shipping</label>
            <input id="st-rv" className="input max-w-[10rem]" inputMode="numeric" value={form.reviewRequestDays} disabled={!form.reviewsEnabled || !maySaveSettings} onChange={(e) => set('reviewRequestDays', e.target.value)} />
          </div>
        </div>
      </fieldset>

      <PageError message={saveError} />
      {/* One Save for whatever this seat may change; it sends only the fields changed, so a manager's save carries
          shipping fields alone. A seat that can change none of it is shown no Save at all. */}
      {(maySaveSettings || mayShipping || mayCompany) && (
        <button type="button" onClick={save} className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : maySaveSettings || mayCompany ? 'Save settings' : 'Save shipping'}</button>
      )}
    </div>
  )
}
