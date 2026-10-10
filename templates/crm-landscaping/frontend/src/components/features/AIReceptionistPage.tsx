import React, { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Phone, MessageSquare, Bot, Edit2, Trash2, Check, PhoneIncoming, VoicemailIcon, Zap, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardHeader, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog, Tabs, TabsList, TabsTrigger, TabsContent } from '../ui';
import { PageError, errorText, ModuleNotEnabled, featureNotEnabled } from '../../shared';
import { usePermissions } from '../../contexts/PermissionsContext';

function useAuth() {
  // The canonical key is `accessToken`: AuthContext writes and reads that, and nothing in any CRM
  // template has written plain `token` since the rename. Reading only `token` meant this page was
  // signed out no matter who was signed in — every fetch below begins `if (!token) return`, so it
  // rendered its empty states in silence. That is the owner's "empty AI chat". The legacy key stays
  // as a fallback, matching the other screens that read both. (T58d)
  let token: string | null = null;
  try { token = localStorage.getItem('accessToken') || localStorage.getItem('token'); } catch { token = null; }
  return { token };
}

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

async function api(path: string, token: string, opts: RequestInit = {}) {
  const res = await fetch(`/api/ai-receptionist${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
  });
  if (!res.ok) throw await refusal(res);
  return res.json();
}

async function callApi(path: string, token: string) {
  const res = await fetch(`/api/calltracking${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await refusal(res);
  return res.json();
}

// AUTO-REPLY FORM
function AutoReplyForm({ item, onSave, onClose }: any) {
  const [form, setForm] = useState(item ? {
    name: item.name,
    trigger: item.trigger,
    channel: item.channel,
    messageTemplate: item.messageTemplate || item.message || '',
    delayMinutes: item.delayMinutes ?? item.delay ?? 0,
    isActive: item.isActive ?? item.active ?? true,
    keywordMatch: item.keywordMatch || '',
  } : {
    trigger: 'after_hours', name: '', messageTemplate: '', channel: 'sms', isActive: true, delayMinutes: 0, keywordMatch: '',
  });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave(form); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Rule Name" value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} placeholder="e.g. After Hours Reply" required />
      <div className="grid grid-cols-2 gap-4">
        <Select label="Trigger" value={form.trigger} onChange={(e: any) => setForm({ ...form, trigger: e.target.value })} options={[
          { value: 'after_hours', label: 'After Hours' },
          { value: 'missed_call', label: 'Missed Call' },
          { value: 'voicemail', label: 'Voicemail Received' },
          { value: 'new_lead', label: 'New Lead' },
          { value: 'booking_request', label: 'Booking Request' },
          { value: 'keyword', label: 'Keyword Match' },
        ]} />
        <Select label="Channel" value={form.channel} onChange={(e: any) => setForm({ ...form, channel: e.target.value })} options={[
          { value: 'sms', label: 'SMS' },
          { value: 'email', label: 'Email' },
          { value: 'both', label: 'SMS + Email' },
        ]} />
      </div>
      {form.trigger === 'keyword' && (
        <Input label="Keywords (comma-separated)" value={form.keywordMatch} onChange={(e: any) => setForm({ ...form, keywordMatch: e.target.value })} placeholder="emergency, urgent, leak" />
      )}
      <Input label="Delay (minutes)" type="number" min="0" value={form.delayMinutes} onChange={(e: any) => setForm({ ...form, delayMinutes: parseInt(e.target.value) || 0 })} placeholder="0 = immediate" />
      <Textarea label="Auto-Reply Message" value={form.messageTemplate} onChange={(e: any) => setForm({ ...form, messageTemplate: e.target.value })} placeholder="Thanks for contacting {{company}}! We'll get back to you shortly..." rows={4} required />
      <p className="text-xs text-slate-500 dark:text-slate-400">Use {'{{company}}'} for company name, {'{{name}}'} for caller name</p>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="w-4 h-4 rounded border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800" />
        <span className="text-sm text-slate-700 dark:text-slate-300">Active</span>
      </label>
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Create'}</Button></div>
    </form>
  );
}

export function AIReceptionistPage() {
  // This page is mounted without an outlet context, so useOutletContext() is
  // undefined — destructuring it directly crashed the whole page on load.
  const { instance } = (useOutletContext<any>() as any) || {};
  const { token } = useAuth();
  const [rules, setRules] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({ isEnabled: false, businessHoursStart: '09:00', businessHoursEnd: '17:00', greetingText: '' });
  const [calls, setCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('rules');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
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
  const primaryColor = instance?.primaryColor || '{{PRIMARY_COLOR}}';

  const fetchRules = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api('/rules', token);
      setRules(data.data || []);
    } catch (e) {
      if (featureNotEnabled(e)) { setModuleOff(true); return; }
      setError(errorText(e, 'The auto-reply rules could not be loaded.'));
    }
  }, [token]);

  const fetchSettings = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api('/settings', token);
      setSettings(data);
    } catch (e) {
      if (featureNotEnabled(e)) { setModuleOff(true); return; }
      setError(errorText(e, 'The AI Receptionist settings could not be loaded.'));
    }
  }, [token]);

  const fetchCalls = useCallback(async () => {
    if (!token) return;
    try {
      const data = await callApi('/calls?limit=20', token);
      setCalls(data.data || []);
    } catch (e) {
      // Call Tracking is a separate feature. On Showcase the AI Receptionist is ON and this one is
      // OFF, which is a perfectly ordinary setup — it must not take the page down with it.
      if (featureNotEnabled(e)) { setCallsOff(true); return; }
      setError(errorText(e, 'The recent calls could not be loaded.'));
    }
  }, [token]);

  useEffect(() => {
    Promise.all([fetchRules(), fetchSettings(), fetchCalls()]).finally(() => setLoading(false));
  }, [fetchRules, fetchSettings, fetchCalls]);

  const handleSave = async (data: any) => {
    if (!token) return;
    try {
      if (editItem) {
        await api(`/rules/${editItem.id}`, token, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        await api('/rules', token, { method: 'POST', body: JSON.stringify(data) });
      }
      fetchRules();
      setError(null);
    } catch (e) { setError(errorText(e, 'The rule could not be saved.')); }
    setEditItem(null);
    setShowForm(false);
  };

  const handleDelete = async () => {
    if (!token || !deleteTarget) return;
    try {
      await api(`/rules/${deleteTarget.id}`, token, { method: 'DELETE' });
      fetchRules();
      setError(null);
    } catch (e) { setError(errorText(e, 'The rule could not be deleted.')); }
    setDeleteTarget(null);
  };

  const toggleRuleActive = async (rule: any) => {
    if (!token) return;
    try {
      await api(`/rules/${rule.id}`, token, { method: 'PUT', body: JSON.stringify({ isActive: !rule.isActive }) });
      setError(null);
      fetchRules();
    } catch (e) { setError(errorText(e, 'That rule could not be switched over.')); }
  };

  const toggleEnabled = async () => {
    if (!token) return;
    try {
      await api('/settings', token, { method: 'PUT', body: JSON.stringify({ isEnabled: !settings.isEnabled }) });
      setError(null);
      fetchSettings();
    } catch (e) { setError(errorText(e, 'The AI Receptionist could not be switched over.')); }
  };

  const updateSettings = async (updates: any) => {
    if (!token) return;
    try {
      await api('/settings', token, { method: 'PUT', body: JSON.stringify(updates) });
      setError(null);
      fetchSettings();
    } catch (e) { setError(errorText(e, 'Those settings could not be saved.')); }
  };

  const activeRules = rules.filter(r => r.isActive).length;

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-slate-600 dark:text-slate-400" /></div>;

  // The server said this module is off. Say that, once, instead of a red banner over a page of
  // controls that cannot work. (T58d)
  if (moduleOff) return <ModuleNotEnabled title="AI Receptionist" what="Automatic call handling, transcription and smart replies are part of your product but are not enabled on this account." />;

  return (
    <div className="space-y-6">
      <PageError message={error} onDismiss={() => setError(null)} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-slate-900 dark:text-white">AI Receptionist</h1><p className="text-slate-600 dark:text-slate-400 mt-1">Automatic call handling with AI transcription & smart replies</p></div>
        <div className="flex gap-2">
          {mayEdit && <Button variant={settings.isEnabled ? 'primary' : 'secondary'} onClick={toggleEnabled} icon={settings.isEnabled ? Check : Zap}>
            {settings.isEnabled ? 'Enabled' : 'Enable AI'}
          </Button>}
          {mayCreate && <Button onClick={() => { setEditItem(null); setShowForm(true); }} icon={Plus}>New Rule</Button>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Status', value: settings.isEnabled ? 'Active' : 'Disabled', icon: Bot, color: settings.isEnabled ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400' },
          { label: 'Auto-Reply Rules', value: rules.length, icon: MessageSquare },
          { label: 'Active Rules', value: activeRules, icon: Zap, color: 'text-emerald-700 dark:text-emerald-400' },
          { label: 'Recent Calls', value: calls.length, icon: Phone },
        ].map((s, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className={`text-xl font-bold ${s.color || 'text-slate-900 dark:text-white'}`}>{s.value}</p><p className="text-sm text-slate-600 dark:text-slate-400">{s.label}</p></div><s.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
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
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium text-slate-900 dark:text-white">{rule.name}</TableCell>
                    <TableCell><span className="px-2 py-0.5 rounded text-xs" style={{ backgroundColor: `${primaryColor}20`, color: primaryColor }}>{rule.trigger?.replace('_', ' ')}</span></TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">{rule.channel}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400 text-sm max-w-xs truncate">{(rule.messageTemplate || '').substring(0, 50)}...</TableCell>
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
                {calls.map((call) => (
                  <TableRow key={call.id}>
                    <TableCell><div className="flex items-center gap-2">
                      {call.status === 'completed' && <PhoneIncoming className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />}
                      {call.status === 'missed' && <Phone className="w-4 h-4 text-red-700 dark:text-red-400" />}
                      {call.status === 'voicemail' && <VoicemailIcon className="w-4 h-4 text-amber-700 dark:text-amber-400" />}
                      <span className="text-slate-700 dark:text-slate-300">{call.direction || 'inbound'}</span>
                    </div></TableCell>
                    <TableCell className="font-medium text-slate-900 dark:text-white">{call.caller_number || call.callerNumber || '-'}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">{call.duration ? `${Math.floor(call.duration / 60)}:${String(call.duration % 60).padStart(2, '0')}` : '-'}</TableCell>
                    <TableCell><StatusBadge status={call.status === 'completed' ? 'completed' : call.ai_response_sent ? 'pending' : 'in_progress'} /></TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400 text-sm max-w-xs truncate">{call.ai_summary || call.aiSummary || (call.transcription ? 'Transcribed' : '-')}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400 text-sm">{call.start_time || call.startTime ? format(new Date(call.start_time || call.startTime), 'MMM d, h:mm a') : '-'}</TableCell>
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
              <div><p className="font-medium text-slate-900 dark:text-white">AI Receptionist</p><p className="text-sm text-slate-600 dark:text-slate-400">Automatically transcribe voicemails and send smart replies</p></div>
              {mayEdit
                ? <Button variant={settings.isEnabled ? 'primary' : 'secondary'} onClick={toggleEnabled}>{settings.isEnabled ? 'Enabled' : 'Disabled'}</Button>
                : <span className="text-sm font-medium text-slate-900 dark:text-white">{settings.isEnabled ? 'Enabled' : 'Disabled'}</span>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Business Hours Start</label><Input type="time" value={settings.businessHoursStart || '09:00'} onChange={(e: any) => updateSettings({ businessHoursStart: e.target.value })} disabled={!mayEdit} /></div>
              <div><label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Business Hours End</label><Input type="time" value={settings.businessHoursEnd || '17:00'} onChange={(e: any) => updateSettings({ businessHoursEnd: e.target.value })} disabled={!mayEdit} /></div>
            </div>
            <div>
              <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Timezone</label>
              <Select value={settings.timezone || 'America/Chicago'} onChange={(e: any) => updateSettings({ timezone: e.target.value })} disabled={!mayEdit} options={[
                { value: 'America/New_York', label: 'Eastern' },
                { value: 'America/Chicago', label: 'Central' },
                { value: 'America/Denver', label: 'Mountain' },
                { value: 'America/Los_Angeles', label: 'Pacific' },
              ]} />
            </div>
            <div><label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Default Greeting</label><Textarea value={settings.greetingText || ''} onChange={(e: any) => updateSettings({ greetingText: e.target.value })} disabled={!mayEdit} placeholder="Hi, thanks for calling! We're currently away but will get back to you soon." rows={3} /></div>
            <div><label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Forwarding Number</label><Input value={settings.forwardingNumber || ''} onChange={(e: any) => updateSettings({ forwardingNumber: e.target.value })} disabled={!mayEdit} placeholder="(555) 123-4567" /></div>
          </CardBody></Card>
        </TabsContent>
      </Tabs>

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditItem(null); }} title={editItem ? 'Edit Rule' : 'Create Auto-Reply Rule'} size="lg">
        <AutoReplyForm item={editItem} onSave={handleSave} onClose={() => { setShowForm(false); setEditItem(null); }} />
      </Modal>

      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete Rule" message={`Delete "${deleteTarget?.name}"?`} confirmText="Delete" variant="danger" />
    </div>
  );
}
