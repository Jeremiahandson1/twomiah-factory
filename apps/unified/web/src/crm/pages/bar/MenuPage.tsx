// Moved from templates/crm-bar/frontend/src/pages/bar/MenuPage.tsx.
import { useState, useEffect, useCallback } from 'react'
import { Plus, Loader2, X, Utensils, Edit2, Trash2, ImagePlus } from 'lucide-react'
import { api } from '../../../api'
import { useMayWrite, useAuth } from '../../../shared'
import FormError, { errorText } from '../../ui/FormError'
import { money } from '@twomiah/tenant-ui/src/money'

/**
 * MENU — the bar's menu, as its website shows it: real prices, sizes, signature items with their own page,
 * and the 86. One place to change a price; the website reads it live (GET /api/public/bar/menu).
 *
 * Editing the menu is a manager's (bar:update); 86 is anyone's who works the console (bar:console). An item's photo is
 * part of editing it (POST /api/bar/menu/items/:id/photo, bar:update): it goes into the website's photo library and
 * shows on the website's menu, the /order page and the kiosk.
 */

interface Item {
  id: string; sectionId: string | null; name: string; slug: string; description: string | null; priceCents: number | null;
  priceLabel: string | null; isSignature: boolean; is86ed: boolean; eightySixUntilOpen?: boolean; isActive: boolean; dietary: string[]; story: string | null;
  variations: Array<{ name: string; priceCents: number }>;
  imageUrl: string | null;
  toKitchen: boolean | null; prepSeconds: number | null;
  modifiers?: Array<{ id: string; name: string; priceCents: number }>;
}
/** An add-on as the form edits it: the price typed in dollars. */
type ModRow = { id?: string; name: string; price: string };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
interface Section { id: string; name: string; slug: string; description: string | null; kind: 'food' | 'drink'; isActive: boolean; availableFrom?: string | null; availableTo?: string | null; availableDays?: number[]; availableWindows?: Array<{ from: string; to: string; days: number[] }>; items: Item[] }

const INPUT = 'w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100';
const LBL = 'block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1';

const price = (cents: number | null) => cents === null || cents === undefined ? '' : `${money((cents / 100))}`;

export default function MenuPage() {
  const mayEdit = useMayWrite('bar:update');
  const may86 = useMayWrite('bar:console');
  const { hasFeature } = useAuth();
  const byTime = hasFeature('menu_dayparts');
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [sectionForm, setSectionForm] = useState<Partial<Section> | null>(null);
  const [itemForm, setItemForm] = useState<(Partial<Item> & { price?: string; prepMin?: string; mods?: ModRow[] }) | null>(null);
  const [formErr, setFormErr] = useState('');
  // The photo picked in the item form, uploaded once the item itself has saved (a new item has no id before then).
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string>('');

  const load = useCallback(async () => {
    try { const m = await api.get('/api/bar/menu'); setSections(m.sections || []); setErr('') }
    catch (e) { setErr(errorText(e, 'Could not load the menu. Try again.')) }
    finally { setLoading(false) }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveSection = async () => {
    if (!sectionForm) return;
    setSaving(true); setFormErr('');
    try {
      const body = { name: sectionForm.name, description: sectionForm.description ?? null, kind: sectionForm.kind || 'food', isActive: sectionForm.isActive !== false,
        ...(byTime ? { availableFrom: sectionForm.availableFrom || null, availableTo: sectionForm.availableTo || null, availableDays: sectionForm.availableFrom ? sectionForm.availableDays || [] : [], availableWindows: (sectionForm.availableWindows || []).filter((w) => w.from && w.to) } : {}) };
      if (sectionForm.id) await api.put(`/api/bar/menu/sections/${sectionForm.id}`, body);
      else await api.post('/api/bar/menu/sections', body);
      setSectionForm(null); await load();
    } catch (e) { setFormErr(errorText(e, 'The section did not save.')) } finally { setSaving(false) }
  };

  const saveItem = async () => {
    if (!itemForm) return;
    setSaving(true); setFormErr('');
    try {
      const body: Record<string, unknown> = {
        name: itemForm.name, sectionId: itemForm.sectionId || null, description: itemForm.description ?? null,
        priceLabel: itemForm.priceLabel ?? null, isSignature: !!itemForm.isSignature, isActive: itemForm.isActive !== false,
        story: itemForm.story ?? null,
        toKitchen: itemForm.toKitchen ?? null, prepMinutes: itemForm.prepMin ?? '',
      };
      // The price box is dollars ("9.50"); blank means no single price (the label says it).
      if (itemForm.price !== undefined) body.price = itemForm.price.trim() === '' ? null : itemForm.price;
      // Add-ons and changes the register, the kiosk and the website offer: a name and a price ($0 for "No onions").
      // "Remove photo" clears it; a new photo is uploaded below.
      if (itemForm.id && itemForm.imageUrl === null) body.imageUrl = null;
      if (itemForm.mods) body.modifiers = itemForm.mods.filter((m) => m.name.trim()).map((m) => ({ ...(m.id ? { id: m.id } : {}), name: m.name.trim(), priceCents: Math.round((Number(m.price.replace(/[$,\s]/g, '')) || 0) * 100) }));
      const saved = itemForm.id ? await api.put(`/api/bar/menu/items/${itemForm.id}`, body) : await api.post('/api/bar/menu/items', body);
      const id = itemForm.id || saved?.id;
      if (photo && id) {
        const fd = new FormData(); fd.append('file', photo);
        try { await api.upload(`/api/bar/menu/items/${id}/photo`, fd) }
        catch (e) {
          // The item saved; keep the form open on it so the photo can be tried again.
          setItemForm({ ...itemForm, id }); await load();
          setFormErr(errorText(e, 'The item saved, but the photo did not upload.')); return;
        }
      }
      setItemForm(null); setPhoto(null); await load();
    } catch (e) { setFormErr(errorText(e, 'The item did not save.')) } finally { setSaving(false) }
  };

  const remove = async (kind: 'sections' | 'items', id: string) => {
    setErr('');
    try { await api.delete(`/api/bar/menu/${kind}`, id); setConfirmDelete(''); await load() }
    catch (e) { setErr(errorText(e, 'That was not deleted.')); setConfirmDelete('') }
  };

  const toggle86 = async (i: Item, untilOpen = false) => {
    setErr('');
    try { await api.put(`/api/bar/menu/items/${i.id}/86`, { is86ed: !i.is86ed, ...(untilOpen && !i.is86ed ? { untilOpen: true } : {}) }); await load() }
    catch (e) { setErr(errorText(e, 'The 86 did not save.')) }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-slate-100"><Utensils className="w-6 h-6 text-orange-600 dark:text-orange-200" /> Menu</h1>
          <p className="text-gray-500 dark:text-slate-400">Real prices, on your website the moment you save</p>
        </div>
        {mayEdit && (
          <div className="flex gap-2">
            <button onClick={() => { setFormErr(''); setSectionForm({ kind: 'food', isActive: true }) }} className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-800 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"><Plus className="w-4 h-4" /> Section</button>
            <button onClick={() => { setFormErr(''); setPhoto(null); setItemForm({ isActive: true, sectionId: sections[0]?.id || null, price: '' }) }} disabled={!sections.length} className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"><Plus className="w-4 h-4" /> Item</button>
          </div>
        )}
      </div>

      <FormError message={err} onDismiss={() => setErr('')} />

      {loading ? <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        : sections.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-white rounded-xl border dark:text-slate-400 dark:bg-slate-900 dark:border-slate-800">
            No menu yet. {mayEdit ? 'Start with a section — Burgers, Fryer, Drinks.' : ''}
          </div>
        ) : sections.map((s) => (
          <section key={s.id} className={`bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 ${s.isActive ? '' : 'opacity-60'}`}>
            <div className="flex items-start justify-between gap-2 p-4 border-b border-gray-100 dark:border-slate-800">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{s.name} <span className="text-xs font-normal text-gray-500 dark:text-slate-400">{s.kind === 'drink' ? 'Drinks' : 'Food'}{s.isActive ? '' : ' · hidden'}</span></h2>
                {byTime && (s.availableFrom && s.availableTo || s.availableWindows?.length) && <p className="text-sm text-gray-600 dark:text-slate-300">Served {[...(s.availableFrom && s.availableTo ? [{ from: s.availableFrom, to: s.availableTo, days: s.availableDays || [] }] : []), ...(s.availableWindows || [])].map((w) => `${w.from} to ${w.to}${w.days.length && w.days.length < 7 ? ' ' + w.days.map((d) => DAYS[d]).join(', ') : ''}`).join('; ')}</p>}
                {s.description && <p className="text-sm text-gray-500 dark:text-slate-400">{s.description}</p>}
              </div>
              {mayEdit && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => { setFormErr(''); setSectionForm(s) }} className="p-2 text-gray-500 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-100" aria-label={`Edit ${s.name}`}><Edit2 className="w-4 h-4" /></button>
                  {confirmDelete === s.id
                    ? <><button onClick={() => remove('sections', s.id)} className="px-2 py-1 text-sm font-semibold text-red-700 dark:text-red-300">Delete section</button><button onClick={() => setConfirmDelete('')} className="px-2 py-1 text-sm text-gray-600 dark:text-slate-300">Keep</button></>
                    : <button onClick={() => setConfirmDelete(s.id)} className="p-2 text-gray-500 hover:text-red-700 dark:text-slate-400 dark:hover:text-red-300" aria-label={`Delete ${s.name}`}><Trash2 className="w-4 h-4" /></button>}
                </div>
              )}
            </div>
            {s.items.length === 0 ? <p className="p-4 text-sm text-gray-500 dark:text-slate-400">No items in this section.</p> : (
              <ul className="divide-y divide-gray-100 dark:divide-slate-800">
                {s.items.map((i) => (
                  <li key={i.id} className={`flex items-start justify-between gap-3 p-4 ${i.isActive ? '' : 'opacity-60'}`}>
                    {i.imageUrl && <img src={i.imageUrl} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className={`font-medium ${i.is86ed ? 'line-through text-gray-500 dark:text-slate-400' : 'text-gray-900 dark:text-slate-100'}`}>
                        {i.name}
                        {i.isSignature && <span className="ml-2 text-xs font-semibold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full dark:text-orange-200 dark:bg-orange-950/40">Signature</span>}
                        {i.is86ed && <span className="ml-2 text-xs font-semibold text-red-800 bg-red-50 px-2 py-0.5 rounded-full dark:text-red-200 dark:bg-red-950/40">{i.eightySixUntilOpen ? '86 until open' : '86'}</span>}
                        {!i.isActive && <span className="ml-2 text-xs text-gray-600 dark:text-slate-300">hidden</span>}
                      </p>
                      {i.description && <p className="text-sm text-gray-500 dark:text-slate-400">{i.description}</p>}
                      <p className="text-sm text-gray-700 dark:text-slate-200">{i.priceLabel || price(i.priceCents)}{i.variations?.length > 1 ? ` · ${i.variations.map((v) => `${v.name} ${price(v.priceCents)}`).join(' · ')}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {may86 && <button onClick={() => toggle86(i)} aria-pressed={i.is86ed} className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${i.is86ed ? 'bg-orange-600 text-white border-orange-600 dark:bg-orange-600 dark:text-white dark:border-orange-500' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-800'}`}>{i.is86ed ? 'Back on' : '86'}</button>}
                      {may86 && byTime && !i.is86ed && <button onClick={() => toggle86(i, true)} className="px-3 py-1.5 rounded-lg text-sm font-semibold border bg-white text-gray-800 border-gray-300 hover:bg-gray-50 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">86 until we open</button>}
                      {mayEdit && <button onClick={() => { setFormErr(''); setPhoto(null); setItemForm({ ...i, price: i.priceCents === null ? '' : (i.priceCents / 100).toFixed(2), prepMin: i.prepSeconds ? String(Math.round(i.prepSeconds / 6) / 10) : '', mods: (i.modifiers || []).map((m) => ({ id: m.id, name: m.name, price: (m.priceCents / 100).toFixed(2) })) }) }} className="p-2 text-gray-500 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-100" aria-label={`Edit ${i.name}`}><Edit2 className="w-4 h-4" /></button>}
                      {mayEdit && (confirmDelete === i.id
                        ? <><button onClick={() => remove('items', i.id)} className="px-2 py-1 text-sm font-semibold text-red-700 dark:text-red-300">Delete</button><button onClick={() => setConfirmDelete('')} className="px-2 py-1 text-sm text-gray-600 dark:text-slate-300">Keep</button></>
                        : <button onClick={() => setConfirmDelete(i.id)} className="p-2 text-gray-500 hover:text-red-700 dark:text-slate-400 dark:hover:text-red-300" aria-label={`Delete ${i.name}`}><Trash2 className="w-4 h-4" /></button>)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

      {sectionForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label={sectionForm.id ? 'Edit section' : 'New section'}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md p-5 space-y-3">
            <div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{sectionForm.id ? 'Edit section' : 'New section'}</h2><button onClick={() => setSectionForm(null)} aria-label="Close" className="p-1 text-gray-500 dark:text-slate-400"><X className="w-5 h-5" /></button></div>
            <FormError message={formErr} />
            <div><label htmlFor="sec-name" className={LBL}>Name</label><input id="sec-name" className={INPUT} value={sectionForm.name || ''} onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })} /></div>
            <div><label htmlFor="sec-desc" className={LBL}>Description (shown above the items)</label><textarea id="sec-desc" className={INPUT} rows={2} value={sectionForm.description || ''} onChange={(e) => setSectionForm({ ...sectionForm, description: e.target.value })} /></div>
            <div><label htmlFor="sec-kind" className={LBL}>Kind</label><select id="sec-kind" className={INPUT} value={sectionForm.kind || 'food'} onChange={(e) => setSectionForm({ ...sectionForm, kind: e.target.value as 'food' | 'drink' })}><option value="food">Food</option><option value="drink">Drinks</option></select></div>
            {byTime && (
              <fieldset className="space-y-2">
                <legend className={LBL}>Serve only at certain times (leave empty for all day)</legend>
                <div className="flex gap-2 items-center">
                  <input aria-label="Served from" type="time" className={INPUT} value={sectionForm.availableFrom || ''} onChange={(e) => setSectionForm({ ...sectionForm, availableFrom: e.target.value || null })} />
                  <span className="text-sm text-gray-600 dark:text-slate-300">to</span>
                  <input aria-label="Served until" type="time" className={INPUT} value={sectionForm.availableTo || ''} onChange={(e) => setSectionForm({ ...sectionForm, availableTo: e.target.value || null })} />
                </div>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Days served">
                  {DAYS.map((d, n) => { const on = (sectionForm.availableDays || []).includes(n); return (
                    <button type="button" key={d} aria-pressed={on} onClick={() => setSectionForm({ ...sectionForm, availableDays: on ? (sectionForm.availableDays || []).filter((x) => x !== n) : [...(sectionForm.availableDays || []), n].sort() })} className={`px-2.5 py-1 rounded-lg text-sm border ${on ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-gray-800 border-gray-300 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700'}`}>{d}</button>) })}
                </div>
                {/* More windows (parity row 12): happy hour, late night, each with its own days. */}
                {(sectionForm.availableWindows || []).map((w, i) => (
                  <div key={i} className="space-y-1 border-t border-gray-100 dark:border-slate-800 pt-2">
                    <div className="flex gap-2 items-center">
                      <input aria-label={`Window ${i + 2} from`} type="time" className={INPUT} value={w.from} onChange={(e) => setSectionForm({ ...sectionForm, availableWindows: (sectionForm.availableWindows || []).map((x, n) => (n === i ? { ...x, from: e.target.value } : x)) })} />
                      <span className="text-sm text-gray-600 dark:text-slate-300">to</span>
                      <input aria-label={`Window ${i + 2} until`} type="time" className={INPUT} value={w.to} onChange={(e) => setSectionForm({ ...sectionForm, availableWindows: (sectionForm.availableWindows || []).map((x, n) => (n === i ? { ...x, to: e.target.value } : x)) })} />
                      <button type="button" aria-label={`Remove window ${i + 2}`} className="px-2 py-1 text-sm text-gray-600 dark:text-slate-300" onClick={() => setSectionForm({ ...sectionForm, availableWindows: (sectionForm.availableWindows || []).filter((_, n) => n !== i) })}>Remove</button>
                    </div>
                    <div className="flex flex-wrap gap-1" role="group" aria-label={`Window ${i + 2} days`}>
                      {DAYS.map((d, n) => { const on = (w.days || []).includes(n); return (
                        <button type="button" key={d} aria-pressed={on} onClick={() => setSectionForm({ ...sectionForm, availableWindows: (sectionForm.availableWindows || []).map((x, k) => (k === i ? { ...x, days: on ? (x.days || []).filter((y) => y !== n) : [...(x.days || []), n].sort() } : x)) })} className={`px-2.5 py-1 rounded-lg text-sm border ${on ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-gray-800 border-gray-300 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700'}`}>{d}</button>) })}
                    </div>
                  </div>
                ))}
                {(sectionForm.availableWindows || []).length < 7 && <button type="button" className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-800 dark:border-slate-700 dark:text-slate-100" onClick={() => setSectionForm({ ...sectionForm, availableWindows: [...(sectionForm.availableWindows || []), { from: '16:00', to: '18:00', days: [] }] })}>Add another window</button>}
                <p className="text-xs text-gray-500 dark:text-slate-400">No days picked means every day. A window that runs past midnight counts as the day it started. The section is served in any of its windows.</p>
              </fieldset>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200"><input type="checkbox" checked={sectionForm.isActive !== false} onChange={(e) => setSectionForm({ ...sectionForm, isActive: e.target.checked })} /> Show on the website</label>
            <div className="flex justify-end gap-2 pt-2"><button onClick={() => setSectionForm(null)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 dark:border-slate-700 dark:text-slate-100">Cancel</button><button onClick={saveSection} disabled={saving} className="px-4 py-2 rounded-lg bg-orange-600 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button></div>
          </div>
        </div>
      )}

      {itemForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label={itemForm.id ? 'Edit item' : 'New item'}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{itemForm.id ? 'Edit item' : 'New item'}</h2><button onClick={() => setItemForm(null)} aria-label="Close" className="p-1 text-gray-500 dark:text-slate-400"><X className="w-5 h-5" /></button></div>
            <FormError message={formErr} />
            <div><label htmlFor="item-name" className={LBL}>Name</label><input id="item-name" className={INPUT} value={itemForm.name || ''} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} /></div>
            <div><label htmlFor="item-section" className={LBL}>Section</label><select id="item-section" className={INPUT} value={itemForm.sectionId || ''} onChange={(e) => setItemForm({ ...itemForm, sectionId: e.target.value || null })}>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label htmlFor="item-price" className={LBL}>Price</label><input id="item-price" className={INPUT} inputMode="decimal" placeholder="9.50" value={itemForm.price || ''} onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })} /></div>
              <div><label htmlFor="item-label" className={LBL}>Price as printed (optional)</label><input id="item-label" className={INPUT} placeholder="$6.49 / $7.99" value={itemForm.priceLabel || ''} onChange={(e) => setItemForm({ ...itemForm, priceLabel: e.target.value })} /></div>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400">Two prices in "as printed" (sandwich / platter) become two sizes on the website.</p>
            <div>
              <p className={LBL}>Add-ons and changes</p>
              {(itemForm.mods || []).map((m, n) => (
                <div key={n} className="flex gap-2 mb-2">
                  <label className="sr-only" htmlFor={`mod-name-${n}`}>Add-on {n + 1}</label>
                  <input id={`mod-name-${n}`} className={INPUT} placeholder="Add bacon" value={m.name} onChange={(e) => setItemForm({ ...itemForm, mods: (itemForm.mods || []).map((x, k) => k === n ? { ...x, name: e.target.value } : x) })} />
                  <label className="sr-only" htmlFor={`mod-price-${n}`}>Its price</label>
                  <input id={`mod-price-${n}`} className={`${INPUT} w-28`} inputMode="decimal" placeholder="2.00" value={m.price} onChange={(e) => setItemForm({ ...itemForm, mods: (itemForm.mods || []).map((x, k) => k === n ? { ...x, price: e.target.value } : x) })} />
                  <button type="button" className="px-3 rounded-lg border border-gray-300 text-gray-800 dark:border-slate-700 dark:text-slate-100" aria-label={`Take off ${m.name || 'this add-on'}`} onClick={() => setItemForm({ ...itemForm, mods: (itemForm.mods || []).filter((_, k) => k !== n) })}><X className="w-4 h-4" /></button>
                </div>
              ))}
              <button type="button" className="text-sm underline text-gray-800 dark:text-slate-200" onClick={() => setItemForm({ ...itemForm, mods: [...(itemForm.mods || []), { name: '', price: '' }] })}>Add an add-on</button>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">The register, the kiosk and online orders offer these; $0 for a change like "No onions". The grill ticket says them.</p>
            </div>
            <div>
              <p className={LBL}>Photo</p>
              <div className="flex items-center gap-3 flex-wrap">
                {photo ? <span className="text-sm text-gray-700 dark:text-slate-200 truncate max-w-[12rem]">{photo.name}</span>
                  : itemForm.imageUrl ? <img src={itemForm.imageUrl} alt="" className="w-20 h-20 rounded-lg object-cover" />
                  : <span className="text-sm text-gray-500 dark:text-slate-400">No photo</span>}
                <label htmlFor="item-photo" className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-800 cursor-pointer hover:bg-gray-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"><ImagePlus className="w-4 h-4" />{itemForm.imageUrl || photo ? 'Change photo' : 'Add a photo'}</label>
                <input id="item-photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
                {(photo || itemForm.imageUrl) && <button type="button" className="text-sm underline text-gray-800 dark:text-slate-200" onClick={() => { setPhoto(null); setItemForm({ ...itemForm, imageUrl: null }) }}>Remove photo</button>}
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Shown on your website's menu, online ordering and the kiosk. JPG, PNG, WebP or GIF, up to 8 MB.</p>
            </div>
            <div><label htmlFor="item-desc" className={LBL}>Description</label><textarea id="item-desc" className={INPUT} rows={2} value={itemForm.description || ''} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200"><input type="checkbox" checked={!!itemForm.isSignature} onChange={(e) => setItemForm({ ...itemForm, isSignature: e.target.checked })} /> Signature item — gets its own page on the website</label>
            {itemForm.isSignature && <div><label htmlFor="item-story" className={LBL}>Its story (for its own page)</label><textarea id="item-story" className={INPUT} rows={4} value={itemForm.story || ''} onChange={(e) => setItemForm({ ...itemForm, story: e.target.value })} /></div>}
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200"><input type="checkbox" checked={itemForm.isActive !== false} onChange={(e) => setItemForm({ ...itemForm, isActive: e.target.checked })} /> Show on the website</label>
            <div className="grid grid-cols-2 gap-3">
              <div><label htmlFor="item-grill" className={LBL}>Goes to the grill</label><select id="item-grill" className={INPUT} value={itemForm.toKitchen === true ? 'yes' : itemForm.toKitchen === false ? 'no' : ''} onChange={(e) => setItemForm({ ...itemForm, toKitchen: e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null })}><option value="">By its section (food yes, drinks no)</option><option value="yes">Yes</option><option value="no">No</option></select></div>
              <div><label htmlFor="item-prep" className={LBL}>Minutes on the grill</label><input id="item-prep" className={INPUT} inputMode="decimal" placeholder="8" value={itemForm.prepMin || ''} onChange={(e) => setItemForm({ ...itemForm, prepMin: e.target.value })} /></div>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400">The grill screen starts the longest item first so a ticket comes up together. Blank uses the house default; the screen learns real times as tickets are bumped.</p>
            <div className="flex justify-end gap-2 pt-2"><button onClick={() => setItemForm(null)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 dark:border-slate-700 dark:text-slate-100">Cancel</button><button onClick={saveItem} disabled={saving} className="px-4 py-2 rounded-lg bg-orange-600 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
