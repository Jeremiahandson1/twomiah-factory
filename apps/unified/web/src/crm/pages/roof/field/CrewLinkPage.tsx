// The page a crew or subcontractor opens from the text the office sent: /w/<token> (server/crm/roof/crewLink.ts). No
// sign-in and no app chrome — the private link is the credential, as the vendor portal's is. It shows the work (scope,
// address, start date, the material list, the photos the office shared) and lets them accept, say no with a reason, add
// photos and mark it done. Self-contained on purpose (no auth context, no api client), built for a phone on a roof.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { whenDate } from '@twomiah/tenant-ui/src/time/companyClock'

const API = import.meta.env.VITE_API_URL || ''

interface Photo { id: string; url: string; caption: string | null }
interface Order {
  /** Row 27: the page's language (the office's choice). */
  language?: 'en' | 'es'
  title: string; scope: string | null; address: string | null; startDate: string | null; recipientName: string; status: string
  company: { name: string | null; phone: string | null }
  materials: Array<{ description: string; qty: number; unit: string }>
  photos: Photo[]; completionPhotos: Photo[]
  respondedByName: string | null; rejectReason: string | null; completedAt: string | null; completionNote: string | null
  can: { accept: boolean; reject: boolean; photos: boolean; complete: boolean; arrive?: boolean; leave?: boolean }
  cancelled: boolean
  /** Row 28 (crew_scheduling): the on-site checklist, what is ticked, and attendance. */
  checklist?: Array<{ id: string; text: string }>
  checks?: Record<string, string>
  arrivedAt?: string | null
  leftAt?: string | null
}

const STATUS_WORDS: Record<string, string> = {
  sent: 'Waiting for your answer', accepted: 'You accepted this', in_progress: 'In progress', rejected: 'You turned this down', completed: 'Done', cancelled: 'Cancelled by the office',
}

// Roofing parity row 27 (work_order_send_options): the crew page in Spanish — every fixed word here; the scope is the office's Spanish one.
const ES: Record<string, string> = {"I’m here": "Ya llegué", "Leaving for now": "Me voy por ahora", "On site since": "En el sitio desde", "Checklist": "Lista de verificación", "Loading…": "Cargando…", "For ": "Para ", "Where ": "Dónde ", "Start ": "Inicio ", "Materials": "Materiales", "Photos from the office": "Fotos de la oficina", "Your photos": "Sus fotos", "Your full name": "Su nombre completo", "Accept this work order": "Aceptar esta orden de trabajo", "Anything the office should know (optional)": "Algo que la oficina deba saber (opcional)", "Mark this work done": "Marcar este trabajo como terminado", "I can’t take this": "No puedo aceptarlo", "Why not?": "¿Por qué no?", "Send my answer": "Enviar mi respuesta", "This page is private to you. Please don’t share the link.": "Esta página es privada. Por favor no comparta el enlace.", "Add photos": "Agregar fotos", "Adding…": "Agregando…", "Job photo": "Foto del trabajo", "Work order": "Orden de trabajo", "Something went wrong. Try again.": "Algo salió mal. Inténtelo de nuevo."}
const ES_STATUS: Record<string, string> = { sent: 'Esperando su respuesta', accepted: 'Usted aceptó esto', in_progress: 'En curso', rejected: 'Usted lo rechazó', completed: 'Terminado', cancelled: 'Cancelado por la oficina' }

export default function CrewLinkPage() {
  const { token } = useParams<{ token: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const tr = (en: string) => (order?.language === 'es' ? ES[en] ?? en : en)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const call = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(`${API}/api/crew-link/${token}${path}`, init)
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.error || 'Something went wrong. Try again.')
    return json
  }, [token])

  const load = useCallback(async () => {
    try { setOrder(await call('')); setError('') } catch (err) { setError((err as Error).message); setOrder(null) }
  }, [call])
  useEffect(() => { load() }, [load])

  const post = async (path: string, body: unknown) => {
    setBusy(true); setNotice('')
    try {
      setOrder(await call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
      setError(''); setDeclining(false)
    } catch (err) { setNotice((err as Error).message) } finally { setBusy(false) }
  }

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true); setNotice('')
    let added = 0
    try {
      for (const f of Array.from(files)) {
        const form = new FormData()
        form.set('photo', f)
        await call('/photos', { method: 'POST', body: form })
        added++
      }
    } catch (err) { setNotice(`${added ? `${added} added. ` : ''}${(err as Error).message}`) }
    if (file.current) file.current.value = ''
    setBusy(false)
    await load()
  }

  const box = 'w-full text-base border rounded-lg px-3 py-3 dark:bg-slate-900 dark:border-slate-700'
  const big = 'w-full py-3 rounded-lg text-base font-semibold disabled:opacity-50'

  if (error && !order) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-gray-50 dark:bg-slate-950">
        <p role="alert" className="max-w-md text-center text-gray-800 dark:text-slate-100">{error}</p>
      </main>
    )
  }
  if (!order) return <main className="min-h-screen p-6 text-gray-600 dark:text-slate-400">{tr('Loading…')}</main>

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-slate-950 p-4" data-testid="crew-link">
      <div className="max-w-xl mx-auto space-y-4">
        <header>
          <p className="text-sm text-gray-600 dark:text-slate-400">{order.company.name || tr('Work order')}{order.company.phone ? ` · ${order.company.phone}` : ''}</p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{order.title}</h1>
          <p className="mt-1 text-sm font-medium text-orange-700 dark:text-orange-300">{(order.language === 'es' ? ES_STATUS[order.status] : STATUS_WORDS[order.status]) || STATUS_WORDS[order.status] || tr('Work order')}</p>
        </header>

        <section className="bg-white dark:bg-slate-900 rounded-xl border p-4 space-y-2 dark:border-slate-700">
          <p className="text-sm"><span className="text-gray-600 dark:text-slate-400">{tr('For ')}</span>{order.recipientName}</p>
          {order.address && <p className="text-sm"><span className="text-gray-600 dark:text-slate-400">{tr('Where ')}</span><a className="underline" href={`https://maps.google.com/?q=${encodeURIComponent(order.address)}`}>{order.address}</a></p>}
          {order.startDate && <p className="text-sm"><span className="text-gray-600 dark:text-slate-400">{tr('Start ')}</span>{whenDate(order.startDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, order.language === 'es' ? 'es-US' : undefined)}</p>}
          {order.scope && <p className="text-sm whitespace-pre-wrap pt-2">{order.scope}</p>}
        </section>

        {order.materials.length > 0 && (
          <section className="bg-white dark:bg-slate-900 rounded-xl border p-4 dark:border-slate-700">
            <h2 className="text-sm font-semibold mb-2">{tr('Materials')}</h2>
            <ul className="text-sm divide-y dark:divide-slate-700">
              {order.materials.map((m, i) => <li key={i} className="py-1.5 flex justify-between gap-3"><span>{m.description}</span><span className="text-gray-600 dark:text-slate-400 whitespace-nowrap">{m.qty} {m.unit}</span></li>)}
            </ul>
          </section>
        )}

        {order.photos.length > 0 && (
          <section className="bg-white dark:bg-slate-900 rounded-xl border p-4 dark:border-slate-700">
            <h2 className="text-sm font-semibold mb-2">{tr('Photos from the office')}</h2>
            <div className="grid grid-cols-2 gap-2">{order.photos.map((p) => <a key={p.id} href={`${API}${p.url}`}><img src={`${API}${p.url}`} alt={p.caption || tr('Job photo')} className="rounded-lg w-full h-32 object-cover" /></a>)}</div>
          </section>
        )}

        {order.status === 'rejected' && order.rejectReason && <p className="text-sm text-gray-700 dark:text-slate-300">You said: {order.rejectReason}</p>}
        {order.status === 'completed' && (
          <section className="bg-white dark:bg-slate-900 rounded-xl border p-4 dark:border-slate-700">
            <p className="text-sm">Marked done{order.respondedByName ? ` by ${order.respondedByName}` : ''}. Thank you.</p>
            {order.completionNote && <p className="text-sm mt-1 whitespace-pre-wrap">{order.completionNote}</p>}
          </section>
        )}

        {(order.completionPhotos.length > 0 || order.can.photos) && (
          <section className="bg-white dark:bg-slate-900 rounded-xl border p-4 dark:border-slate-700">
            <h2 className="text-sm font-semibold mb-2">{tr('Your photos')}</h2>
            {order.completionPhotos.length > 0 && <div className="grid grid-cols-3 gap-2 mb-3">{order.completionPhotos.map((p) => <img key={p.id} src={`${API}${p.url}`} alt="Your photo" className="rounded-lg w-full h-24 object-cover" />)}</div>}
            {order.can.photos && (
              <>
                <input ref={file} type="file" accept="image/*" multiple capture="environment" className="hidden" id="crew-photos" onChange={(e) => addPhotos(e.target.files)} />
                <label htmlFor="crew-photos" className={`${big} block text-center bg-gray-100 dark:bg-slate-800 cursor-pointer`}>{busy ? tr('Adding…') : tr('Add photos')}</label>
              </>
            )}
          </section>
        )}

        {notice && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{notice}</p>}

        {order.can.accept && (
          <section className="space-y-2">
            <label htmlFor="crew-name" className="text-sm text-gray-700 dark:text-slate-300">{tr('Your full name')}</label>
            <input id="crew-name" className={box} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            <button type="button" disabled={busy || name.trim().length < 2} onClick={() => post('/accept', { name })} className={`${big} bg-green-700 text-white`}>{tr('Accept this work order')}</button>
          </section>
        )}
        {(order.can.arrive || order.can.leave) && (
          <section className="space-y-2" data-testid="crew-attendance">
            {order.arrivedAt && !order.leftAt && <p className="text-sm text-gray-600 dark:text-slate-400">{tr('On site since')} {whenDate(order.arrivedAt, { hour: 'numeric', minute: '2-digit' }, order.language === 'es' ? 'es-US' : undefined)}</p>}
            {order.can.arrive && (order.status !== 'in_progress' || order.leftAt) && <button type="button" disabled={busy} onClick={() => post('/arrive', {})} className={`${big} bg-blue-700 text-white`}>{tr('I’m here')}</button>}
            {order.can.leave && !order.leftAt && <button type="button" disabled={busy} onClick={() => post('/leave', {})} className={`${big} bg-white border dark:bg-slate-900 dark:border-slate-700`}>{tr('Leaving for now')}</button>}
          </section>
        )}
        {order.checklist && order.checklist.length > 0 && (
          <section className="space-y-1" data-testid="crew-checklist">
            <h2 className="text-sm font-semibold mb-1">{tr('Checklist')}</h2>
            {order.checklist.map((item) => (
              <label key={item.id} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={busy || !(order.can.complete)} checked={!!order.checks?.[item.id]} onChange={(e) => post('/check', { itemId: item.id, done: e.target.checked })} />{item.text}</label>
            ))}
          </section>
        )}
        {order.can.complete && (
          <section className="space-y-2">
            <label htmlFor="crew-note" className="text-sm text-gray-700 dark:text-slate-300">{tr('Anything the office should know (optional)')}</label>
            <textarea id="crew-note" rows={3} className={box} value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="button" disabled={busy} onClick={() => post('/complete', { note })} className={`${big} bg-green-700 text-white`}>{tr('Mark this work done')}</button>
          </section>
        )}
        {order.can.reject && !declining && (
          <button type="button" onClick={() => setDeclining(true)} className={`${big} bg-white border text-red-700 dark:bg-slate-900 dark:text-red-300 dark:border-slate-700`}>{tr('I can’t take this')}</button>
        )}
        {order.can.reject && declining && (
          <section className="space-y-2">
            {!order.can.accept && (<><label htmlFor="crew-name2" className="text-sm text-gray-700 dark:text-slate-300">{tr('Your full name')}</label>
              <input id="crew-name2" className={box} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></>)}
            <label htmlFor="crew-reason" className="text-sm text-gray-700 dark:text-slate-300">{tr('Why not?')}</label>
            <textarea id="crew-reason" rows={3} className={box} value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="button" disabled={busy || name.trim().length < 2 || !reason.trim()} onClick={() => post('/reject', { name, reason })} className={`${big} bg-red-700 text-white`}>{tr('Send my answer')}</button>
          </section>
        )}
        <p className="text-xs text-gray-500 dark:text-slate-500 text-center pt-2">{tr('This page is private to you. Please don’t share the link.')}</p>
      </div>
    </main>
  )
}
