// Contact detail — one page for every CRM. Header (convert / edit / delete), contact info, notes,
// related lists (projects, quotes, events, patients, equipment, locations, SMS thread — whichever the
// vertical enables), summary counts, activity, quick actions and customer-portal access.
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Edit, Trash2, Mail, Phone, MapPin, Building2, FileText, Briefcase, Receipt, MessageSquare,
  Wrench, Shield, Plus, Globe, Send, Loader2, ToggleLeft, ToggleRight, MapPinned, ChevronRight, X,
  CalendarDays, PawPrint,
} from 'lucide-react'
import { StatusBadge, Modal, ConfirmModal, Button, NavLink, Field, inputCls, dateOnly, dateTime, errMsg } from '../invoicing/ui'
import { resolveContactsConfig } from './types'
import type { ContactsPageProps, ContactRow, QuickActionIcon } from './types'

type Related = { id: string; name?: string; number?: string; total?: unknown; status?: string; eventDate?: string }
type Equipment = { id: string; name: string; manufacturer?: string | null; model?: string | null; serialNumber?: string | null; location?: string | null; purchaseDate?: string | null; warrantyExpiry?: string | null }
type Site = { id: string; name: string; address?: string | null; city?: string | null; state?: string | null; zip?: string | null; accessNotes?: string | null; equipment?: Equipment[]; jobs?: any[] }
type Patient = { id: string; name: string; species?: string | null; breed?: string | null; deceased?: boolean | null }
type ContactDetail = ContactRow & { projects?: Related[]; quotes?: Related[]; invoices?: Related[]; events?: Related[]; patients?: Patient[]; equipment?: Equipment[]; sites?: Site[] }

const ACTION_ICONS: Record<QuickActionIcon, React.ComponentType<{ className?: string }>> = {
  quote: FileText, job: Briefcase, invoice: Receipt, event: CalendarDays, patients: PawPrint, appointment: CalendarDays,
}

const card = 'bg-white rounded-lg shadow-sm dark:bg-slate-900'
const cardPad = `${card} p-6`
const h2 = 'font-semibold text-gray-900 dark:text-slate-100'
const rowLink = 'p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800'
const quickBtn = 'w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-900 dark:text-slate-100'
const money = (v: unknown) => `$${Number(v || 0).toLocaleString()}`

function RelatedList({ title, rows, href, icon: Icon, render }: { title: string; rows: Related[]; href: (r: Related) => string; icon: React.ComponentType<{ className?: string }>; render: (r: Related) => React.ReactNode }) {
  return (
    <div className={card}>
      <div className="p-4 border-b dark:border-slate-800 flex items-center justify-between">
        <h2 className={h2}>{title}</h2>
        <span className="text-sm text-gray-500 dark:text-slate-400">{rows.length}</span>
      </div>
      <div className="divide-y dark:divide-slate-800">
        {rows.map((r) => (
          <NavLink key={r.id} to={href(r)} className={rowLink}>
            <div className="flex items-center gap-3">
              <Icon className="w-5 h-5 text-gray-400" />
              {render(r)}
            </div>
          </NavLink>
        ))}
      </div>
    </div>
  )
}

export function ContactDetailPage({ api, toast, config }: ContactsPageProps) {
  const cfg = resolveContactsConfig(config)
  const { hasFeature, sections } = cfg
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const [contact, setContact] = useState<ContactDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const [portalStatus, setPortalStatus] = useState<any>(null)
  const [portalLoading, setPortalLoading] = useState(false)

  const [siteModalOpen, setSiteModalOpen] = useState(false)
  const [siteForm, setSiteForm] = useState({ name: '', address: '', city: '', state: '', zip: '', accessNotes: '' })
  const [savingSite, setSavingSite] = useState(false)
  const [siteDetail, setSiteDetail] = useState<Site | null>(null)

  const [smsMessages, setSmsMessages] = useState<any[]>([])
  const [smsLoading, setSmsLoading] = useState(false)
  const [smsInput, setSmsInput] = useState('')
  const [smsSending, setSmsSending] = useState(false)

  const showPortal = !!sections.portal && (cfg.portalGate === false || hasFeature(cfg.portalGate))
  const gated = (feature: string) => !cfg.gateByFeature || hasFeature(feature)

  const loadContact = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setContact(await api.get(`/api/contacts/${id}`))
    } catch (err) {
      setError(errMsg(err, 'Unknown error'))
      toast.error('Failed to load contact')
    } finally {
      setLoading(false)
    }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadPortalStatus = async () => {
    try { setPortalStatus(await api.get(`/api/portal/contacts/${id}/status`)) } catch { /* panel stays "Disabled" */ }
  }
  const loadSms = async () => {
    setSmsLoading(true)
    try {
      const res = await api.get('/api/sms/conversations', { contactId: id })
      if (res?.data?.length > 0) {
        const convo = await api.get(`/api/sms/conversations/${res.data[0].conversation.id}`)
        setSmsMessages(convo?.messages || [])
      } else {
        setSmsMessages([])
      }
    } catch { /* optional */ } finally { setSmsLoading(false) }
  }

  useEffect(() => {
    loadContact()
    if (showPortal) loadPortalStatus()
    if (sections.sms) loadSms()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const togglePortal = async () => {
    setPortalLoading(true)
    try {
      if (portalStatus?.enabled) { await api.post(`/api/portal/contacts/${id}/disable`); toast.success('Portal access disabled') }
      else { await api.post(`/api/portal/contacts/${id}/enable`); toast.success('Portal access enabled') }
      await loadPortalStatus()
    } catch (err) { toast.error(errMsg(err, 'Failed to update portal access')) } finally { setPortalLoading(false) }
  }
  const resendPortalInvite = async () => {
    setPortalLoading(true)
    try { await api.post(`/api/portal/contacts/${id}/send-link`); toast.success('Portal invite sent') }
    catch (err) { toast.error(errMsg(err, 'Failed to send invite')) } finally { setPortalLoading(false) }
  }
  const handleDelete = async () => {
    try { await api.delete('/api/contacts', id); toast.success('Contact deleted'); navigate('/crm/contacts') }
    catch (err) { toast.error(errMsg(err, 'Failed to delete contact')) }
  }
  const handleConvert = async () => {
    try { await api.post(`/api/contacts/${id}/convert`); toast.success(`Lead converted to ${cfg.convertLabel.toLowerCase()}`); loadContact() }
    catch (err) { toast.error(errMsg(err, 'Failed to convert lead')) }
  }
  const createSite = async () => {
    if (!siteForm.name.trim()) return
    setSavingSite(true)
    try {
      await api.post(`/api/contacts/${id}/sites`, siteForm)
      toast.success('Location added')
      setSiteModalOpen(false)
      setSiteForm({ name: '', address: '', city: '', state: '', zip: '', accessNotes: '' })
      loadContact()
    } catch (err) { toast.error(errMsg(err, 'Failed to add location')) } finally { setSavingSite(false) }
  }
  const openSiteDetail = async (siteId: string) => {
    try { setSiteDetail(await api.get(`/api/contacts/sites/${siteId}`)) } catch { toast.error('Failed to load site details') }
  }
  const sendSms = async () => {
    if (!smsInput.trim()) return
    setSmsSending(true)
    try { await api.post('/api/sms/send', { contactId: id, message: smsInput }); setSmsInput(''); loadSms() }
    catch (err) { toast.error(errMsg(err, 'Failed to send message')) } finally { setSmsSending(false) }
  }
  const toggleOptOut = async () => {
    if (!contact) return
    try {
      await api.put(`/api/contacts/${id}`, { optedOutSms: !contact.optedOutSms })
      toast.success(contact.optedOutSms ? 'SMS opted back in' : 'SMS opted out')
      loadContact()
    } catch (err) { toast.error(errMsg(err, 'Failed to update opt-out')) }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse" aria-busy="true">
        <div className="h-8 w-64 bg-gray-200 dark:bg-slate-800 rounded" />
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-48 bg-gray-200 dark:bg-slate-800 rounded-lg" />
          <div className="h-48 bg-gray-200 dark:bg-slate-800 rounded-lg" />
        </div>
      </div>
    )
  }
  if (error || !contact) {
    return (
      <div className={`${cardPad} text-center`}>
        <p className="font-medium text-gray-900 dark:text-slate-100">{error ? 'Error loading contact' : 'Contact not found'}</p>
        {error && <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{error}</p>}
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => navigate('/crm/contacts')}>Back to contacts</Button>
          {error && <Button onClick={loadContact}>Retry</Button>}
        </div>
      </div>
    )
  }

  const typeLabel = cfg.types.find((t) => t.value === contact.type)?.label || contact.type
  const projects = sections.projects && gated('projects') ? (contact.projects || []) : []
  const quotes = sections.quotes && gated('quotes') ? (contact.quotes || []) : []
  const events = sections.events && hasFeature('event_bookings') ? (contact.events || []) : []
  const showInvoices = gated('invoices')
  const quickActions = cfg.quickActions.filter((a) => !a.feature || hasFeature(a.feature))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => navigate('/crm/contacts')} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg" aria-label="Back to contacts">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{contact.name}</h1>
              <StatusBadge status={contact.type} />
            </div>
            {contact.company && (
              <p className="text-gray-500 flex items-center gap-1 mt-1 dark:text-slate-400"><Building2 className="w-4 h-4" />{contact.company}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {contact.type === 'lead' && <Button variant="success" onClick={handleConvert}>Convert to {cfg.convertLabel}</Button>}
          <NavLink to={`/crm/contacts?edit=${id}`} className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 flex items-center gap-2">
            <Edit className="w-4 h-4" />Edit
          </NavLink>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}><Trash2 className="w-4 h-4 inline mr-2" />Delete</Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          <div className={cardPad}>
            <h2 className={`${h2} mb-4`}>Contact Information</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {contact.email && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-lg flex items-center justify-center"><Mail className="w-5 h-5 text-blue-500" /></div>
                  <div><p className="text-sm text-gray-500 dark:text-slate-400">Email</p><a href={`mailto:${contact.email}`} className="text-blue-600 dark:text-blue-400 hover:underline break-all">{contact.email}</a></div>
                </div>
              )}
              {contact.phone && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-50 dark:bg-green-900/30 rounded-lg flex items-center justify-center"><Phone className="w-5 h-5 text-green-500" /></div>
                  <div><p className="text-sm text-gray-500 dark:text-slate-400">Phone</p><a href={`tel:${contact.phone}`} className="text-gray-900 hover:underline dark:text-slate-100">{contact.phone}</a></div>
                </div>
              )}
              {contact.mobile && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-50 dark:bg-purple-900/30 rounded-lg flex items-center justify-center"><Phone className="w-5 h-5 text-purple-500" /></div>
                  <div><p className="text-sm text-gray-500 dark:text-slate-400">Mobile</p><a href={`tel:${contact.mobile}`} className="text-gray-900 hover:underline dark:text-slate-100">{contact.mobile}</a></div>
                </div>
              )}
              {(contact.address || contact.city) && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-50 dark:bg-orange-900/30 rounded-lg flex items-center justify-center"><MapPin className="w-5 h-5 text-orange-500" /></div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-slate-400">Address</p>
                    <p className="text-gray-900 dark:text-slate-100">
                      {contact.address && <span>{contact.address}<br /></span>}
                      {contact.city && `${contact.city}, `}{contact.state} {contact.zip}
                    </p>
                  </div>
                </div>
              )}
              {!contact.email && !contact.phone && !contact.mobile && !contact.address && !contact.city && (
                <p className="text-sm text-gray-400 md:col-span-2">No contact details on file.</p>
              )}
            </div>
          </div>

          {contact.notes && (
            <div className={cardPad}>
              <h2 className={`${h2} mb-4`}>Notes</h2>
              <p className="text-gray-600 whitespace-pre-wrap dark:text-slate-400">{contact.notes}</p>
            </div>
          )}

          {events.length > 0 && (
            <RelatedList title="Events" rows={events} icon={CalendarDays} href={(r) => `/crm/events/${r.id}`} render={(r) => (
              <div className="flex-1 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-gray-900 dark:text-slate-100">{r.name || 'Untitled event'}</p>
                  <p className="text-sm text-gray-500 dark:text-slate-400">{r.eventDate ? dateOnly(r.eventDate) : ''}</p>
                </div>
                {r.status && <StatusBadge status={r.status} />}
              </div>
            )} />
          )}

          {sections.patients && (
            <div className={card}>
              <div className="p-4 border-b dark:border-slate-800 flex items-center justify-between">
                <h2 className={h2}>Patients</h2>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500 dark:text-slate-400">{contact.patients?.length || 0}</span>
                  <NavLink to="/crm/patients" className="px-3 py-1.5 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 flex items-center gap-1"><Plus className="w-3 h-3" />Add Patient</NavLink>
                </div>
              </div>
              {contact.patients && contact.patients.length > 0 ? (
                <div className="divide-y dark:divide-slate-800">
                  {contact.patients.map((p) => (
                    <NavLink key={p.id} to={`/crm/patients/${p.id}`} className={rowLink}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-orange-50 dark:bg-orange-900/30 rounded-lg flex items-center justify-center"><PawPrint className="w-5 h-5 text-orange-500" /></div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-slate-100">{p.name}</p>
                          <p className="text-sm text-gray-500 dark:text-slate-400 capitalize">{[p.species, p.breed].filter(Boolean).join(' · ') || 'No species on file'}</p>
                        </div>
                      </div>
                      {p.deceased ? <span className="text-xs text-gray-400">Deceased</span> : <ChevronRight className="w-5 h-5 text-gray-300" />}
                    </NavLink>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-gray-400"><PawPrint className="w-8 h-8 mx-auto mb-2 opacity-50" /><p className="text-sm">No patients on file for this owner</p></div>
              )}
            </div>
          )}

          {projects.length > 0 && (
            <RelatedList title="Projects" rows={projects} icon={Briefcase} href={(r) => `/crm/projects/${r.id}`} render={(r) => (
              <div className="flex-1 flex items-center justify-between gap-3">
                <p className="font-medium text-gray-900 dark:text-slate-100">{r.name}</p>
                {r.status && <StatusBadge status={r.status} />}
              </div>
            )} />
          )}

          {quotes.length > 0 && (
            <RelatedList title="Quotes" rows={quotes} icon={FileText} href={(r) => `/crm/quotes/${r.id}`} render={(r) => (
              <div className="flex-1 flex items-center justify-between gap-3">
                <p className="font-medium text-gray-900 dark:text-slate-100">{r.number}</p>
                <div className="text-right"><p className="font-medium text-gray-900 dark:text-slate-100">{money(r.total)}</p>{r.status && <StatusBadge status={r.status} />}</div>
              </div>
            )} />
          )}

          {sections.equipment && (
            <div className={card}>
              <div className="p-4 border-b dark:border-slate-800 flex items-center justify-between">
                <h2 className={h2}>Equipment</h2>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500 dark:text-slate-400">{contact.equipment?.length || 0}</span>
                  <NavLink to={`/crm/equipment?contactId=${id}`} className="px-3 py-1.5 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 flex items-center gap-1"><Plus className="w-3 h-3" />Add Equipment</NavLink>
                </div>
              </div>
              {contact.equipment && contact.equipment.length > 0 ? (
                <div className="divide-y dark:divide-slate-800">
                  {contact.equipment.map((eq) => {
                    const active = !!eq.warrantyExpiry && new Date(eq.warrantyExpiry) > new Date()
                    return (
                      <NavLink key={eq.id} to="/crm/equipment" className={rowLink}>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-orange-50 dark:bg-orange-900/30 rounded-lg flex items-center justify-center"><Wrench className="w-5 h-5 text-orange-500" /></div>
                          <div>
                            <p className="font-medium text-gray-900 dark:text-slate-100">{eq.name}</p>
                            <p className="text-sm text-gray-500 dark:text-slate-400">
                              {[eq.manufacturer, eq.model].filter(Boolean).join(' ') || 'No model info'}
                              {eq.serialNumber && <span className="ml-2 font-mono text-xs">S/N: {eq.serialNumber}</span>}
                            </p>
                          </div>
                        </div>
                        <div className="text-right text-sm">
                          {eq.warrantyExpiry && (
                            <div className="flex items-center gap-1 justify-end">
                              <Shield className={`w-3.5 h-3.5 ${active ? 'text-green-500' : 'text-gray-400'}`} />
                              <span className={active ? 'text-green-600' : 'text-gray-400'}>Warranty {active ? 'active' : 'expired'}</span>
                            </div>
                          )}
                          {eq.purchaseDate && <p className="text-gray-400">Installed {dateOnly(eq.purchaseDate)}</p>}
                          {eq.location && <p className="text-gray-400">{eq.location}</p>}
                        </div>
                      </NavLink>
                    )
                  })}
                </div>
              ) : (
                <div className="p-6 text-center text-gray-400"><Wrench className="w-8 h-8 mx-auto mb-2 opacity-50" /><p className="text-sm">No equipment on file</p></div>
              )}
            </div>
          )}

          {sections.sites && ((contact.sites?.length || 0) > 0 || contact.type === 'client') && (
            <div className={card}>
              <div className="p-4 border-b dark:border-slate-800 flex items-center justify-between">
                <h2 className={h2}>Locations</h2>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500 dark:text-slate-400">{contact.sites?.length || 0}</span>
                  <button type="button" onClick={() => setSiteModalOpen(true)} className="px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 flex items-center gap-1"><Plus className="w-3 h-3" />Add Location</button>
                </div>
              </div>
              {contact.sites && contact.sites.length > 0 ? (
                <div className="divide-y dark:divide-slate-800">
                  {contact.sites.map((s) => (
                    <button type="button" key={s.id} onClick={() => openSiteDetail(s.id)} className={`w-full text-left ${rowLink}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-lg flex items-center justify-center"><MapPinned className="w-5 h-5 text-blue-500" /></div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-slate-100">{s.name}</p>
                          <p className="text-sm text-gray-500 dark:text-slate-400">{[s.address, s.city].filter(Boolean).join(', ') || 'No address'}</p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-300" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-gray-400"><MapPinned className="w-8 h-8 mx-auto mb-2 opacity-50" /><p className="text-sm">No locations added — useful for commercial accounts with multiple sites</p></div>
              )}
            </div>
          )}

          {sections.sms && (
            <div className={card}>
              <div className="p-4 border-b dark:border-slate-800 flex items-center justify-between">
                <h2 className={`${h2} flex items-center gap-2`}><MessageSquare className="w-4 h-4" /> Messages</h2>
                <button type="button" onClick={toggleOptOut} className={`text-xs px-2 py-1 rounded ${contact.optedOutSms ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-200' : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                  {contact.optedOutSms ? 'Opted Out — Re-enable' : 'Opt Out SMS'}
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto p-4 space-y-2">
                {smsMessages.length === 0 && !smsLoading && <p className="text-center text-sm text-gray-400 py-6">No messages yet</p>}
                {smsMessages.map((m: any) => (
                  <div key={m.message.id} className={`flex ${m.message.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${m.message.direction === 'outbound' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-900 dark:bg-slate-800 dark:text-slate-100'}`}>
                      <p>{m.message.body}</p>
                      <p className={`text-[10px] mt-1 ${m.message.direction === 'outbound' ? 'text-blue-200' : 'text-gray-400'}`}>{dateTime(m.message.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
              {!contact.optedOutSms && (
                <div className="p-3 border-t dark:border-slate-800 flex gap-2">
                  <input value={smsInput} onChange={(e) => setSmsInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendSms()} placeholder="Type a message..." className={`${inputCls} flex-1 text-sm`} />
                  <Button onClick={sendSms} disabled={smsSending || !smsInput.trim()}>{smsSending ? '...' : 'Send'}</Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className={cardPad}>
            <h2 className={`${h2} mb-4`}>Summary</h2>
            <div className="space-y-4">
              {sections.events && hasFeature('event_bookings') && <div className="flex items-center justify-between"><span className="text-gray-500 dark:text-slate-400">Events</span><span className="font-medium">{contact.events?.length || 0}</span></div>}
              {sections.patients && <div className="flex items-center justify-between"><span className="text-gray-500 dark:text-slate-400">Patients</span><span className="font-medium">{contact.patients?.length || 0}</span></div>}
              {sections.projects && gated('projects') && <div className="flex items-center justify-between"><span className="text-gray-500 dark:text-slate-400">Projects</span><span className="font-medium">{contact.projects?.length || 0}</span></div>}
              {sections.quotes && gated('quotes') && <div className="flex items-center justify-between"><span className="text-gray-500 dark:text-slate-400">Quotes</span><span className="font-medium">{contact.quotes?.length || 0}</span></div>}
              {showInvoices && <div className="flex items-center justify-between"><span className="text-gray-500 dark:text-slate-400">Invoices</span><span className="font-medium">{contact.invoices?.length || 0}</span></div>}
              {sections.equipment && <div className="flex items-center justify-between"><span className="text-gray-500 dark:text-slate-400">Equipment</span><span className="font-medium">{contact.equipment?.length || 0}</span></div>}
              {contact.source && <div className="flex items-center justify-between"><span className="text-gray-500 dark:text-slate-400">Source</span><span className="font-medium">{contact.source}</span></div>}
              <div className="flex items-center justify-between"><span className="text-gray-500 dark:text-slate-400">Type</span><span className="font-medium">{typeLabel}</span></div>
            </div>
          </div>

          <div className={cardPad}>
            <h2 className={`${h2} mb-4`}>Activity</h2>
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-sm"><div className="w-2 h-2 rounded-full bg-green-500" /><span className="text-gray-500 dark:text-slate-400">Created</span><span className="text-gray-900 dark:text-slate-100">{dateOnly(contact.createdAt)}</span></div>
              <div className="flex items-center gap-3 text-sm"><div className="w-2 h-2 rounded-full bg-blue-500" /><span className="text-gray-500 dark:text-slate-400">Updated</span><span className="text-gray-900 dark:text-slate-100">{dateOnly(contact.updatedAt)}</span></div>
            </div>
          </div>

          {quickActions.length > 0 && (
            <div className={cardPad}>
              <h2 className={`${h2} mb-4`}>Quick Actions</h2>
              <div className="space-y-2">
                {quickActions.map((a) => {
                  const Icon = ACTION_ICONS[a.icon || 'invoice']
                  return <NavLink key={a.label} to={a.to.replace(':id', id)} className={quickBtn}><Icon className="w-4 h-4 text-gray-500 dark:text-slate-400" />{a.label}</NavLink>
                })}
              </div>
            </div>
          )}

          {showPortal && contact.email && (() => {
            const role = String(contact.type || 'client').toLowerCase()
            const isSub = role === 'subcontractor' || role === 'vendor' || role === 'supplier'
            const kind = isSub ? 'Subcontractor Portal' : 'Customer Portal'
            return (
              <div className={cardPad}>
                <h2 className={`${h2} mb-4 flex items-center gap-2`}><Globe className="w-4 h-4 text-blue-500" />{kind}</h2>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500 dark:text-slate-400">Status</span>
                    <button type="button" onClick={togglePortal} disabled={portalLoading} className="flex items-center gap-1.5" aria-label={portalStatus?.enabled ? 'Disable portal access' : 'Enable portal access'}>
                      {portalStatus?.enabled ? <ToggleRight className="w-6 h-6 text-green-500" /> : <ToggleLeft className="w-6 h-6 text-gray-400" />}
                      <span className={`text-sm font-medium ${portalStatus?.enabled ? 'text-green-600' : 'text-gray-400'}`}>{portalStatus?.enabled ? 'Enabled' : 'Disabled'}</span>
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-sm gap-3"><span className="text-gray-500 dark:text-slate-400">Email</span><span className="text-gray-900 dark:text-slate-100 break-all text-right">{contact.email}</span></div>
                  {portalStatus?.lastVisit && <div className="flex items-center justify-between text-sm"><span className="text-gray-500 dark:text-slate-400">Last Login</span><span className="text-gray-900 dark:text-slate-100">{dateOnly(portalStatus.lastVisit)}</span></div>}
                  {portalStatus?.enabled && (
                    <button type="button" onClick={resendPortalInvite} disabled={portalLoading} className="w-full mt-2 px-4 py-2 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 flex items-center justify-center gap-2 dark:bg-blue-900/30 dark:text-blue-200">
                      {portalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Resend Portal Invite
                    </button>
                  )}
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {sections.sites && (
        <Modal isOpen={siteModalOpen} onClose={() => setSiteModalOpen(false)} title="Add Location" size="md">
          <div className="space-y-4">
            <Field label="Location Name *"><input value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} className={inputCls} placeholder='e.g. "Main Warehouse", "Downtown Office"' /></Field>
            <Field label="Address"><input value={siteForm.address} onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })} className={inputCls} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="City"><input value={siteForm.city} onChange={(e) => setSiteForm({ ...siteForm, city: e.target.value })} className={inputCls} /></Field>
              <Field label="State"><input value={siteForm.state} onChange={(e) => setSiteForm({ ...siteForm, state: e.target.value })} className={inputCls} /></Field>
              <Field label="ZIP"><input value={siteForm.zip} onChange={(e) => setSiteForm({ ...siteForm, zip: e.target.value })} className={inputCls} /></Field>
            </div>
            <Field label="Access Notes"><textarea value={siteForm.accessNotes} onChange={(e) => setSiteForm({ ...siteForm, accessNotes: e.target.value })} rows={2} className={inputCls} placeholder="Gate codes, contact on site, parking instructions..." /></Field>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setSiteModalOpen(false)}>Cancel</Button>
              <Button onClick={createSite} disabled={savingSite || !siteForm.name.trim()}>{savingSite ? 'Saving...' : 'Add Location'}</Button>
            </div>
          </div>
        </Modal>
      )}

      {siteDetail && (
        <Modal isOpen onClose={() => setSiteDetail(null)} title={siteDetail.name} size="lg">
          <p className="text-sm text-gray-500 dark:text-slate-400 -mt-2 mb-4 flex items-center gap-2"><MapPinned className="w-4 h-4 text-blue-500" />{[siteDetail.address, siteDetail.city, siteDetail.state, siteDetail.zip].filter(Boolean).join(', ') || 'No address'}</p>
          {siteDetail.accessNotes && (
            <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-300 uppercase mb-1">Access Notes</p>
              <p className="text-sm text-yellow-800 dark:text-yellow-100">{siteDetail.accessNotes}</p>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2 dark:text-slate-100">Equipment at this location ({siteDetail.equipment?.length || 0})</h3>
              {siteDetail.equipment && siteDetail.equipment.length > 0 ? (
                <div className="divide-y dark:divide-slate-800 border dark:border-slate-800 rounded-lg">
                  {siteDetail.equipment.map((eq) => (
                    <div key={eq.id} className="p-3 flex items-center gap-3">
                      <Wrench className="w-4 h-4 text-orange-500" />
                      <div><p className="font-medium text-gray-900 text-sm dark:text-slate-100">{eq.name}</p><p className="text-xs text-gray-500 dark:text-slate-400">{[eq.manufacturer, eq.model].filter(Boolean).join(' ')}</p></div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">No equipment at this location</p>}
              <NavLink to={`/crm/equipment?contactId=${id}&siteId=${siteDetail.id}`} className="mt-2 inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700"><Plus className="w-3 h-3" /> Add Equipment to This Location</NavLink>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2 dark:text-slate-100">Service History ({siteDetail.jobs?.length || 0})</h3>
              {siteDetail.jobs && siteDetail.jobs.length > 0 ? (
                <div className="divide-y dark:divide-slate-800 border dark:border-slate-800 rounded-lg">
                  {siteDetail.jobs.map((j: any) => (
                    <NavLink key={j.id} to={`/crm/jobs/${j.id}`} className="p-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800">
                      <div><p className="font-medium text-gray-900 text-sm dark:text-slate-100">{j.title}</p><p className="text-xs text-gray-500 dark:text-slate-400">{j.number}{j.scheduledDate ? ` — ${dateOnly(j.scheduledDate)}` : ''}</p></div>
                      <StatusBadge status={j.status} />
                    </NavLink>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">No jobs at this location</p>}
            </div>
          </div>
          <div className="flex justify-end mt-4"><Button variant="secondary" onClick={() => setSiteDetail(null)}><X className="w-4 h-4 inline mr-1" />Close</Button></div>
        </Modal>
      )}

      <ConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Contact"
        message={`Are you sure you want to delete "${contact.name}"? This action cannot be undone.`}
        confirmText="Delete"
      />
    </div>
  )
}

export default ContactDetailPage
