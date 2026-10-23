// Moved from templates/crm/frontend/src/components/features/AIReceptionistPage.tsx.
import React, { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Phone, MessageSquare, Bot, Edit2, Trash2, Check, PhoneIncoming, VoicemailIcon, Zap, Loader2 } from 'lucide-react'
import { Card, CardHeader, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog, Tabs, TabsList, TabsTrigger, TabsContent } from '../ui'
import { PageError, errorText, ModuleNotEnabled, featureNotEnabled, usePermissions, CallTrackingSettings } from '../../shared'
import { verticalScreens } from '../vertical'
import { api as client } from '../../api'
import { whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'

// The template read a token from localStorage and did nothing without one. This app's session is the server's
// httpOnly cookie (the page never holds a credential), so that check would have left every list empty; client.raw
// sends the session either way. (date-fns, which the template formatted the call time with, is not a library this app
// has: the browser's own toLocaleString gives the same "Oct 18, 2:05 PM".)

/**
 * Throw the REFUSAL, not just a sentence.
 *
 * featureNotEnabled() in the shared ui reads `err.status` and `err.data.code` — the server's own
 * code rather than its wording, because wording changes and codes do not. A plain Error carries
 * neither, so "this module is switched off" and "this actually broke" were indistinguishable by the
 * time they reached the page. (T58d)
 */
async function refusal(res: Response): Promise<Error> {
  const text = await res.text().catch(() => '');
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  const message = (data && typeof data.error === 'string' && data.error.trim())
    ? data.error
    : res.status === 401 ? 'Your session has expired. Sign in again.'
    : res.status === 403 ? 'Your account does not have access to this.'
    : `The server answered ${res.status}.`;
  const err = new Error(message) as Error & { status?: number; data?: unknown };
  err.status = res.status;
  err.data = data;
  return err;
}

async function api(path: string, opts: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await client.raw(`/api/ai-receptionist${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) throw await refusal(res);
  return res.json();
}

async function callApi(path: string): Promise<Record<string, unknown>> {
  const res = await client.raw(`/api/calltracking${path}`);
  if (!res.ok) throw await refusal(res);
  return res.json();
}

interface AutoReplyFormData {
  name: string;
  trigger: string;
  channel: string;
  messageTemplate: string;
  delayMinutes: number;
  isActive: boolean;
  keywordMatch: string;
}

interface AutoReplyFormProps {
  item: Record<string, unknown> | null;
  onSave: (data: AutoReplyFormData) => void;
  onClose: () => void;
}

// AUTO-REPLY FORM
function AutoReplyForm({ item, onSave, onClose }: AutoReplyFormProps) {
  const [form, setForm] = useState<AutoReplyFormData>(item ? {
    name: item.name as string,
    trigger: item.trigger as string,
    channel: item.channel as string,
    messageTemplate: (item.messageTemplate || item.message || '') as string,
    delayMinutes: (item.delayMinutes ?? item.delay ?? 0) as number,
    isActive: (item.isActive ?? item.active ?? true) as boolean,
    keywordMatch: (item.keywordMatch || '') as string,
  } : {
    trigger: 'after_hours', name: '', messageTemplate: '', channel: 'sms', isActive: true, delayMinutes: 0, keywordMatch: '',
  });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave(form); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Rule Name" value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })} placeholder="e.g. After Hours Reply" required />
      <div className="grid grid-cols-2 gap-4">
        <Select label="Trigger" value={form.trigger} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, trigger: e.target.value })} options={[
          { value: 'after_hours', label: 'After Hours' },
          { value: 'missed_call', label: 'Missed Call' },
          { value: 'voicemail', label: 'Voicemail Received' },
          { value: 'new_lead', label: 'New Lead' },
          { value: 'booking_request', label: 'Booking Request' },
          { value: 'keyword', label: 'Keyword Match' },
        ]} />
        <Select label="Channel" value={form.channel} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, channel: e.target.value })} options={[
          { value: 'sms', label: 'SMS' },
          { value: 'email', label: 'Email' },
          { value: 'both', label: 'SMS + Email' },
        ]} />
      </div>
      {form.trigger === 'keyword' && (
        <Input label="Keywords (comma-separated)" value={form.keywordMatch} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, keywordMatch: e.target.value })} placeholder="emergency, urgent, leak" />
      )}
      <Input label="Delay (minutes)" type="number" min="0" value={form.delayMinutes} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, delayMinutes: parseInt(e.target.value) || 0 })} placeholder="0 = immediate" />
      <Textarea label="Auto-Reply Message" value={form.messageTemplate} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, messageTemplate: e.target.value })} placeholder="Thanks for contacting {{company}}! We'll get back to you shortly..." rows={4} required />
      <p className="text-xs text-slate-500 dark:text-slate-400">Use {'{{company}}'} for company name, {'{{name}}'} for caller name</p>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.isActive} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, isActive: e.target.checked })} className="w-4 h-4 rounded border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800" />
        <span className="text-sm text-slate-700 dark:text-slate-300">Active</span>
      </label>
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Create'}</Button></div>
    </form>
  );
}

/**
 * What the AI Receptionist does and how it is connected, on the first screen while no call has reached it (live test
 * 10/22: "Disabled" with Enable AI / Create Rule and no explanation). Read from the server, not assumed:
 *   · calls reach it only through Twilio's call callbacks (aiReceptionist.ts /webhook/status and /webhook/recording), which
 *     nothing in the app sets up on its own — so connecting the phone line is Twomiah's to do, by email;
 *   · a call nobody answered (no-answer, busy, failed) runs the rules — an after-hours rule only outside the hours set
 *     here; a recording is written out (Whisper) so keyword and booking rules can
 *     read it (aiReceptionistService.ts evaluateRules / processRecordingWebhook);
 *   · a text reply goes out through the business's own texting (services.sms) — Settings › Texting; email needs nothing.
 */
function ReceptionistSetup({ enabled, hasRules }: { enabled: boolean; hasRules: boolean }) {
  const navigate = useNavigate()
  const done = 'text-emerald-700 dark:text-emerald-300'
  return (
    <section aria-label="How the AI Receptionist works" className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <h2 className="font-semibold text-slate-900 dark:text-slate-100">How the AI Receptionist works</h2>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
        A call to your business number rings your forwarding number — your own phone — for 20 seconds. If nobody picks up, or you have no
        forwarding number, the caller hears your greeting and can leave a voicemail. Then it gets back to them for you, by text, email or both,
        with the reply you write in a rule — at any hour, or only outside your business hours. A voicemail is written out, so a rule can answer
        what they asked for, like a booking. It does not talk with callers or book appointments itself.
      </p>
      <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-slate-100">How to set it up</h3>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
        <li>Connect your phone line. Email <a href="mailto:support@twomiah.com?subject=Connect%20my%20phone%20line%20to%20the%20AI%20Receptionist" className="font-medium text-brand-700 hover:underline dark:text-brand-200">support@twomiah.com</a> and we point your business number at it. Calls then show under Call Log.</li>
        <li>On the Settings tab, enter your forwarding number (the phone that rings first) and the greeting a caller hears before leaving a message.</li>
        <li>For text replies, turn on texting in <button type="button" onClick={() => navigate('/crm/settings/texting')} className="font-medium text-brand-700 hover:underline dark:text-brand-200">Settings › Texting</button> — replies go out from your business&rsquo;s own number. Email replies need nothing.</li>
        <li className={hasRules ? done : undefined}>Write a rule: what happened (a missed call, a voicemail, after hours, a new caller) and the reply to send.{hasRules ? ' ✓ Done' : ''}</li>
        <li className={enabled ? done : undefined}>Press Enable AI. Until then no reply is sent.{enabled ? ' ✓ On' : ''}</li>
      </ol>
    </section>
  )
}

/**
 * The phone line's two settings, saved together with a button (they were saved on every keystroke, and nothing used
 * them): the number a call rings first, and the greeting a caller hears before leaving a message (server
 * aiReceptionist.ts /webhook/voice and /webhook/dial-result).
 */
function LineSettings({ settings, mayEdit, onSave }: { settings: AISettings; mayEdit: boolean; onSave: (u: Partial<AISettings>) => Promise<boolean> }) {
  const [forwardingNumber, setForwarding] = useState<string>(settings.forwardingNumber || '')
  const [greetingText, setGreeting] = useState<string>(settings.greetingText || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setForwarding(settings.forwardingNumber || ''); setGreeting(settings.greetingText || '') }, [settings.forwardingNumber, settings.greetingText])
  const dirty = forwardingNumber !== (settings.forwardingNumber || '') || greetingText !== (settings.greetingText || '')
  const save = async () => {
    setSaving(true); setSaved(false)
    const ok = await onSave({ forwardingNumber: forwardingNumber.trim() || null, greetingText: greetingText.trim() || null } as any)
    setSaving(false); setSaved(ok)
  }
  return (
    <div className="space-y-4" data-testid="line-settings">
      <div>
        <label htmlFor="ai-forwarding" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Forward calls to</label>
        <Input id="ai-forwarding" value={forwardingNumber} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setForwarding(e.target.value); setSaved(false) }} disabled={!mayEdit} placeholder="(608) 555-0123" inputMode="tel" />
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Your own phone. A call to your business number rings here for 20 seconds first. Left blank, every call goes straight to your greeting and voicemail.</p>
      </div>
      <div>
        <label htmlFor="ai-greeting" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Voicemail greeting</label>
        <Textarea id="ai-greeting" value={greetingText} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setGreeting(e.target.value); setSaved(false) }} disabled={!mayEdit} placeholder="Thanks for calling. We can't take your call right now. Please leave a message after the tone and we'll get back to you." rows={3} />
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Read out to a caller nobody picked up, before the beep. Left blank, they hear &ldquo;Thanks for calling&rdquo; with your business name and are asked to leave a message.</p>
      </div>
      {mayEdit && <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</Button>
        {saved && !dirty && <span className="text-sm text-emerald-700 dark:text-emerald-400" role="status">Saved</span>}
      </div>}
    </div>
  )
}

/** The zone by the name an owner uses (Settings › Company's own list); any other as itself. */
const ZONE_NAMES: Record<string, string> = { 'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Phoenix': 'Arizona', 'America/Los_Angeles': 'Pacific', 'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii' }
const zoneWords = (z?: string) => (z ? ZONE_NAMES[z] || z.replace(/_/g, ' ') : '')

interface AISettings {
  isEnabled: boolean;
  businessHoursStart: string;
  businessHoursEnd: string;
  greetingText: string | null;
  timezone?: string;
  forwardingNumber?: string | null;
}

export function AIReceptionistPage() {
  const [rules, setRules] = useState<Record<string, unknown>[]>([]);
  const [settings, setSettings] = useState<AISettings>({ isEnabled: false, businessHoursStart: '09:00', businessHoursEnd: '17:00', greetingText: '' });
  const [calls, setCalls] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<string>('rules');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editItem, setEditItem] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which of the two is off, if either. The module being off is a whole-page state; call tracking
  // being off is one tab's, and conflating them is what put "this module is not enabled" on a page
  // whose module is perfectly enabled. (T58d)
  const [moduleOff, setModuleOff] = useState(false);
  const [callsOff, setCallsOff] = useState(false);
  /**
   * The controls follow the server. (T60: "the AI Receptionist rules and settings are offered to the
   * manager, but the server refuses them.") routes/aiReceptionist.ts asks for ai-receptionist:create /
   * :update / :delete, which only admins and the owner hold; a manager holds :read. The manager still
   * SEES the rules and the settings — reading them is allowed — but is not handed switches that 403.
   * Hide only when we know (PermissionsContext's convention); the server refuses either way.
   */
  const { can, known } = usePermissions();
  const mayCreate = !known || can('ai-receptionist:create');
  const mayEdit = !known || can('ai-receptionist:update');
  const mayDelete = !known || can('ai-receptionist:delete');
  /**
   * Where the vertical sells no Call Tracking (roofing), the call log and the CallRail key ride this page's switch
   * (verticalScreens().callTrackingSwitch) and the key is set here, as roofing's page did: the owner and admins
   * (integrations:update, the API's own right).
   */
  const callsRideThisPage = verticalScreens().callTrackingSwitch === 'ai_receptionist';
  const maySetUpCallRail = callsRideThisPage && known && can('integrations:update');

  const fetchRules = useCallback(async () => {
    try {
      const data = await api('/rules');
      setRules((data.data as Record<string, unknown>[]) || []);
    } catch (e) {
      if (featureNotEnabled(e)) { setModuleOff(true); return; }
      setError(errorText(e, 'The auto-reply rules could not be loaded.'));
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await api('/settings');
      setSettings(data as unknown as AISettings);
    } catch (e) {
      if (featureNotEnabled(e)) { setModuleOff(true); return; }
      setError(errorText(e, 'The AI Receptionist settings could not be loaded.'));
    }
  }, []);

  const fetchCalls = useCallback(async () => {
    try {
      const data = await callApi('/calls?limit=20');
      setCalls((data.data as Record<string, unknown>[]) || []);
    } catch (e) {
      // Call Tracking is a separate feature. On Showcase the AI Receptionist is ON and this one is
      // OFF, which is a perfectly ordinary setup — it must not take the page down with it.
      if (featureNotEnabled(e)) { setCallsOff(true); return; }
      setError(errorText(e, 'The recent calls could not be loaded.'));
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchRules(), fetchSettings(), fetchCalls()]).finally(() => setLoading(false));
  }, [fetchRules, fetchSettings, fetchCalls]);

  const handleSave = async (data: AutoReplyFormData) => {
    try {
      if (editItem) {
        await api(`/rules/${editItem.id}`, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        await api('/rules', { method: 'POST', body: JSON.stringify(data) });
      }
      fetchRules();
      setError(null);
    } catch (e) { setError(errorText(e, 'The rule could not be saved.')); }
    setEditItem(null);
    setShowForm(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api(`/rules/${deleteTarget.id}`, { method: 'DELETE' });
      fetchRules();
      setError(null);
    } catch (e) { setError(errorText(e, 'The rule could not be deleted.')); }
    setDeleteTarget(null);
  };

  const toggleRuleActive = async (rule: Record<string, unknown>) => {
    try {
      await api(`/rules/${rule.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !rule.isActive }) });
      setError(null);
      fetchRules();
    } catch (e) { setError(errorText(e, 'That rule could not be switched over.')); }
  };

  const toggleEnabled = async () => {
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify({ isEnabled: !settings.isEnabled }) });
      setError(null);
      fetchSettings();
    } catch (e) { setError(errorText(e, 'The AI Receptionist could not be switched over.')); }
  };

  const updateSettings = async (updates: Partial<AISettings>): Promise<boolean> => {
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify(updates) });
      setError(null);
      fetchSettings();
      return true;
    } catch (e) { setError(errorText(e, 'Those settings could not be saved.')); return false; }
  };

  const activeRules = rules.filter((r: Record<string, unknown>) => r.isActive).length;

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-slate-600 dark:text-slate-400" /></div>;

  // The server said this module is off. Say that, once, instead of a red banner over a page of
  // controls that cannot work. (T58d)
  if (moduleOff) return <ModuleNotEnabled title="AI Receptionist" what="Missed-call text-back, voicemail with a written-out transcript, and replies by text or email are part of your product but are not enabled on this account." />;

  return (
    <div className="space-y-6">
      <PageError message={error} onDismiss={() => setError(null)} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-slate-900 dark:text-white">AI Receptionist</h1><p className="text-slate-600 dark:text-slate-400 mt-1">Rings your phone first, then takes a voicemail, writes it out and texts or emails the caller back</p></div>
        <div className="flex gap-2">
          {mayEdit && <Button variant={settings.isEnabled ? 'primary' : 'secondary'} onClick={toggleEnabled} icon={settings.isEnabled ? Check : Zap}>
            {settings.isEnabled ? 'Enabled' : 'Enable AI'}
          </Button>}
          {mayCreate && <Button onClick={() => { setEditItem(null); setShowForm(true); }} icon={Plus}>New Rule</Button>}
        </div>
      </div>

      {calls.length === 0 && <ReceptionistSetup enabled={settings.isEnabled} hasRules={rules.length > 0} />}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Status', value: settings.isEnabled ? 'Active' : 'Disabled', icon: Bot, color: settings.isEnabled ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400' },
          { label: 'Auto-Reply Rules', value: rules.length, icon: MessageSquare },
          { label: 'Active Rules', value: activeRules, icon: Zap, color: 'text-emerald-700 dark:text-emerald-400' },
          { label: 'Recent Calls', value: calls.length, icon: Phone },
        ].map((s, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className={`text-xl font-bold ${s.color || 'text-slate-900 dark:text-white'}`}>{s.value}</p><p className="text-sm text-slate-600 dark:text-slate-400">{s.label}</p></div><s.icon className="w-8 h-8 text-brand-600 dark:text-brand-300" /></div></Card>
        ))}
      </div>

      <Tabs value={activeTab} onChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="rules">Auto-Reply Rules ({rules.length})</TabsTrigger>
          <TabsTrigger value="calls">Call Log</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="rules">
          <Card>
            {rules.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Rule</TableHeader><TableHeader>Trigger</TableHeader><TableHeader>Channel</TableHeader><TableHeader>Message Preview</TableHeader><TableHeader>Status</TableHeader>{(mayEdit || mayDelete) && <TableHeader>Actions</TableHeader>}</TableRow></TableHead><TableBody>
                {rules.map((rule: Record<string, unknown>) => (
                  <TableRow key={rule.id as string}>
                    <TableCell className="font-medium text-slate-900 dark:text-white">{rule.name as string}</TableCell>
                    <TableCell><span className="px-2 py-0.5 rounded text-xs bg-brand-500/10 text-brand-700 dark:text-brand-200">{(rule.trigger as string)?.replace('_', ' ')}</span></TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">{rule.channel as string}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400 text-sm max-w-xs truncate">{((rule.messageTemplate as string) || '').substring(0, 50)}...</TableCell>
                    <TableCell>{rule.isActive ? <span className="text-emerald-700 dark:text-emerald-400 text-sm">Active</span> : <span className="text-slate-500 text-sm dark:text-slate-400">Inactive</span>}</TableCell>
                    {(mayEdit || mayDelete) && <TableCell><div className="flex gap-1">
                      {mayEdit && <button aria-label="Turn rule on or off" onClick={() => toggleRuleActive(rule)} className={`p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded ${rule.isActive ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}><Check className="w-4 h-4" /></button>}
                      {mayEdit && <button aria-label="Edit rule" onClick={() => { setEditItem(rule); setShowForm(true); }} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-600 dark:text-slate-400" /></button>}
                      {mayDelete && <button aria-label="Delete rule" onClick={() => setDeleteTarget(rule)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-700 dark:text-red-400" /></button>}
                    </div></TableCell>}
                  </TableRow>
                ))}
              </TableBody></Table>
            ) : (<CardBody><EmptyState icon={Bot} title="No auto-reply rules" description="Create rules to automatically respond to missed calls, voicemails, and after-hours inquiries" action={mayCreate ? <Button onClick={() => setShowForm(true)} icon={Plus}>Create Rule</Button> : undefined} /></CardBody>)}
          </Card>
        </TabsContent>

        <TabsContent value="calls">
          <Card>
            {calls.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Type</TableHeader><TableHeader>Number</TableHeader><TableHeader>Duration</TableHeader><TableHeader>Status</TableHeader><TableHeader>AI Summary</TableHeader><TableHeader>Time</TableHeader></TableRow></TableHead><TableBody>
                {calls.map((call: Record<string, unknown>) => (
                  <TableRow key={call.id as string}>
                    <TableCell><div className="flex items-center gap-2">
                      {call.status === 'completed' && <PhoneIncoming className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />}
                      {call.status === 'missed' && <Phone className="w-4 h-4 text-red-700 dark:text-red-400" />}
                      {call.status === 'voicemail' && <VoicemailIcon className="w-4 h-4 text-amber-700 dark:text-amber-400" />}
                      <span className="text-slate-700 dark:text-slate-300">{(call.direction as string) || 'inbound'}</span>
                    </div></TableCell>
                    <TableCell className="font-medium text-slate-900 dark:text-white">{(call.caller_number as string) || (call.callerNumber as string) || '-'}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">{call.duration ? `${Math.floor((call.duration as number) / 60)}:${String((call.duration as number) % 60).padStart(2, '0')}` : '-'}</TableCell>
                    <TableCell><StatusBadge status={call.status === 'completed' ? 'completed' : call.ai_response_sent ? 'pending' : 'in_progress'} /></TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400 text-sm max-w-xs truncate">{(call.ai_summary as string) || (call.aiSummary as string) || (call.transcription ? 'Transcribed' : '-')}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400 text-sm">{call.start_time || call.startTime ? whenDateTime((call.start_time || call.startTime) as string, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            ) : (
              <CardBody>{callsOff
                    ? <EmptyState icon={Phone} title="Call Tracking isn't switched on" description="The AI Receptionist works without it — rules and auto-replies above are live. Turn Call Tracking on under Settings › Features to see the calls it handled." />
                    : <EmptyState icon={Phone} title="No calls yet" description="Calls will appear here once your tracking numbers receive calls" />}</CardBody>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card><CardHeader title="AI Receptionist Settings" /><CardBody className="space-y-6">
            {!mayEdit && <p className="text-sm text-slate-600 dark:text-slate-400">You can see these settings. Only an owner or admin can change them.</p>}
            <div className="flex items-center justify-between p-4 bg-slate-100 dark:bg-slate-800/50 rounded-lg">
              <div><p className="font-medium text-slate-900 dark:text-white">AI Receptionist</p><p className="text-sm text-slate-600 dark:text-slate-400">Send your rules&rsquo; replies to missed calls and voicemails. Off, calls still ring your forwarding number and still go to voicemail, but nobody is replied to.</p></div>
              {mayEdit
                ? <Button variant={settings.isEnabled ? 'primary' : 'secondary'} onClick={toggleEnabled}>{settings.isEnabled ? 'Enabled' : 'Disabled'}</Button>
                : <span className="text-sm font-medium text-slate-900 dark:text-white">{settings.isEnabled ? 'Enabled' : 'Disabled'}</span>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Business Hours Start</label><Input type="time" value={settings.businessHoursStart || '09:00'} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSettings({ businessHoursStart: e.target.value })} disabled={!mayEdit} /></div>
              <div><label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Business Hours End</label><Input type="time" value={settings.businessHoursEnd || '17:00'} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSettings({ businessHoursEnd: e.target.value })} disabled={!mayEdit} /></div>
            </div>
            {/* ONE CLOCK: after hours is judged on the business's time zone, set once under Settings › Company (coordinator
                10/23); the receptionist kept one of its own, defaulting to Chicago. */}
            <div>
              <span className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Time zone</span>
              <p className="text-sm text-slate-900 dark:text-white">{zoneWords(settings.timezone)} — your business&rsquo;s time zone. <Link to="/crm/settings" className="font-medium text-brand-700 hover:underline dark:text-brand-200">Change it in Settings › Company</Link></p>
            </div>
            <LineSettings settings={settings} mayEdit={mayEdit} onSave={updateSettings} />
          </CardBody></Card>
          {maySetUpCallRail && <div className="mt-6"><CallTrackingSettings /></div>}
        </TabsContent>
      </Tabs>

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditItem(null); }} title={editItem ? 'Edit Rule' : 'Create Auto-Reply Rule'} size="lg">
        <AutoReplyForm item={editItem} onSave={handleSave} onClose={() => { setShowForm(false); setEditItem(null); }} />
      </Modal>

      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete Rule" message={`Delete "${deleteTarget?.name}"?`} confirmText="Delete" variant="danger" />
    </div>
  );
}
