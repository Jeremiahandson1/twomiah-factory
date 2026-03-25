import React, { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Phone, MessageSquare, Bot, Edit2, Trash2, Check, PhoneIncoming, VoicemailIcon, Zap, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardHeader, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog, Tabs, TabsList, TabsTrigger, TabsContent } from '../ui';

interface OutletContextType {
  instance: Record<string, unknown>;
}

function useAuth(): { token: string | null } {
  const token = localStorage.getItem('token');
  return { token };
}

async function api(path: string, token: string, opts: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/ai-receptionist${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function callApi(path: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/calltracking${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
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
      <p className="text-xs text-slate-500">Use {'{{company}}'} for company name, {'{{name}}'} for caller name</p>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.isActive} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, isActive: e.target.checked })} className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
        <span className="text-sm text-slate-300">Active</span>
      </label>
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Create'}</Button></div>
    </form>
  );
}

interface AISettings {
  isEnabled: boolean;
  businessHoursStart: string;
  businessHoursEnd: string;
  greetingText: string;
  timezone?: string;
  forwardingNumber?: string;
}

export function AIReceptionistPage() {
  const outletContext = useOutletContext<OutletContextType | undefined>();
  const instance = outletContext?.instance || {} as Record<string, unknown>;
  const { token } = useAuth();
  const [rules, setRules] = useState<Record<string, unknown>[]>([]);
  const [settings, setSettings] = useState<AISettings>({ isEnabled: false, businessHoursStart: '09:00', businessHoursEnd: '17:00', greetingText: '' });
  const [calls, setCalls] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<string>('rules');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editItem, setEditItem] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const primaryColor = (instance?.primaryColor as string) || '{{PRIMARY_COLOR}}';

  const fetchRules = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api('/rules', token);
      setRules((data.data as Record<string, unknown>[]) || []);
    } catch {}
  }, [token]);

  const fetchSettings = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api('/settings', token);
      setSettings(data as unknown as AISettings);
    } catch {}
  }, [token]);

  const fetchCalls = useCallback(async () => {
    if (!token) return;
    try {
      const data = await callApi('/calls?limit=20', token);
      setCalls((data.data as Record<string, unknown>[]) || []);
    } catch {}
  }, [token]);

  useEffect(() => {
    Promise.all([fetchRules(), fetchSettings(), fetchCalls()]).finally(() => setLoading(false));
  }, [fetchRules, fetchSettings, fetchCalls]);

  const handleSave = async (data: AutoReplyFormData) => {
    if (!token) return;
    try {
      if (editItem) {
        await api(`/rules/${editItem.id}`, token, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        await api('/rules', token, { method: 'POST', body: JSON.stringify(data) });
      }
      fetchRules();
    } catch {}
    setEditItem(null);
    setShowForm(false);
  };

  const handleDelete = async () => {
    if (!token || !deleteTarget) return;
    try {
      await api(`/rules/${deleteTarget.id}`, token, { method: 'DELETE' });
      fetchRules();
    } catch {}
    setDeleteTarget(null);
  };

  const toggleRuleActive = async (rule: Record<string, unknown>) => {
    if (!token) return;
    await api(`/rules/${rule.id}`, token, { method: 'PUT', body: JSON.stringify({ isActive: !rule.isActive }) });
    fetchRules();
  };

  const toggleEnabled = async () => {
    if (!token) return;
    await api('/settings', token, { method: 'PUT', body: JSON.stringify({ isEnabled: !settings.isEnabled }) });
    fetchSettings();
  };

  const updateSettings = async (updates: Partial<AISettings>) => {
    if (!token) return;
    await api('/settings', token, { method: 'PUT', body: JSON.stringify(updates) });
    fetchSettings();
  };

  const activeRules = rules.filter((r: Record<string, unknown>) => r.isActive).length;

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">AI Receptionist</h1><p className="text-slate-400 mt-1">Automatic call handling with AI transcription & smart replies</p></div>
        <div className="flex gap-2">
          <Button variant={settings.isEnabled ? 'primary' : 'secondary'} onClick={toggleEnabled} icon={settings.isEnabled ? Check : Zap}>
            {settings.isEnabled ? 'Enabled' : 'Enable AI'}
          </Button>
          <Button onClick={() => { setEditItem(null); setShowForm(true); }} icon={Plus}>New Rule</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Status', value: settings.isEnabled ? 'Active' : 'Disabled', icon: Bot, color: settings.isEnabled ? 'text-emerald-400' : 'text-slate-400' },
          { label: 'Auto-Reply Rules', value: rules.length, icon: MessageSquare },
          { label: 'Active Rules', value: activeRules, icon: Zap, color: 'text-emerald-400' },
          { label: 'Recent Calls', value: calls.length, icon: Phone },
        ].map((s, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className={`text-xl font-bold ${s.color || 'text-white'}`}>{s.value}</p><p className="text-sm text-slate-400">{s.label}</p></div><s.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
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
              <Table><TableHead><TableRow><TableHeader>Rule</TableHeader><TableHeader>Trigger</TableHeader><TableHeader>Channel</TableHeader><TableHeader>Message Preview</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
                {rules.map((rule: Record<string, unknown>) => (
                  <TableRow key={rule.id as string}>
                    <TableCell className="font-medium text-white">{rule.name as string}</TableCell>
                    <TableCell><span className="px-2 py-0.5 rounded text-xs" style={{ backgroundColor: `${primaryColor}20`, color: primaryColor }}>{(rule.trigger as string)?.replace('_', ' ')}</span></TableCell>
                    <TableCell className="text-slate-400">{rule.channel as string}</TableCell>
                    <TableCell className="text-slate-400 text-sm max-w-xs truncate">{((rule.messageTemplate as string) || '').substring(0, 50)}...</TableCell>
                    <TableCell>{rule.isActive ? <span className="text-emerald-400 text-sm">Active</span> : <span className="text-slate-500 text-sm">Inactive</span>}</TableCell>
                    <TableCell><div className="flex gap-1">
                      <button onClick={() => toggleRuleActive(rule)} className={`p-1.5 hover:bg-slate-700 rounded ${rule.isActive ? 'text-emerald-400' : 'text-slate-500'}`}><Check className="w-4 h-4" /></button>
                      <button onClick={() => { setEditItem(rule); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                      <button onClick={() => setDeleteTarget(rule)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            ) : (<CardBody><EmptyState icon={Bot} title="No auto-reply rules" description="Create rules to automatically respond to missed calls, voicemails, and after-hours inquiries" action={<Button onClick={() => setShowForm(true)} icon={Plus}>Create Rule</Button>} /></CardBody>)}
          </Card>
        </TabsContent>

        <TabsContent value="calls">
          <Card>
            {calls.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Type</TableHeader><TableHeader>Number</TableHeader><TableHeader>Duration</TableHeader><TableHeader>Status</TableHeader><TableHeader>AI Summary</TableHeader><TableHeader>Time</TableHeader></TableRow></TableHead><TableBody>
                {calls.map((call: Record<string, unknown>) => (
                  <TableRow key={call.id as string}>
                    <TableCell><div className="flex items-center gap-2">
                      {call.status === 'completed' && <PhoneIncoming className="w-4 h-4 text-emerald-400" />}
                      {call.status === 'missed' && <Phone className="w-4 h-4 text-red-400" />}
                      {call.status === 'voicemail' && <VoicemailIcon className="w-4 h-4 text-amber-400" />}
                      <span className="text-slate-300">{(call.direction as string) || 'inbound'}</span>
                    </div></TableCell>
                    <TableCell className="font-medium text-white">{(call.caller_number as string) || (call.callerNumber as string) || '-'}</TableCell>
                    <TableCell className="text-slate-400">{call.duration ? `${Math.floor((call.duration as number) / 60)}:${String((call.duration as number) % 60).padStart(2, '0')}` : '-'}</TableCell>
                    <TableCell><StatusBadge status={call.status === 'completed' ? 'completed' : call.ai_response_sent ? 'pending' : 'in_progress'} /></TableCell>
                    <TableCell className="text-slate-400 text-sm max-w-xs truncate">{(call.ai_summary as string) || (call.aiSummary as string) || (call.transcription ? 'Transcribed' : '-')}</TableCell>
                    <TableCell className="text-slate-400 text-sm">{call.start_time || call.startTime ? format(new Date((call.start_time || call.startTime) as string), 'MMM d, h:mm a') : '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            ) : (
              <CardBody><EmptyState icon={Phone} title="No calls yet" description="Calls will appear here once your tracking numbers receive calls" /></CardBody>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card><CardHeader title="AI Receptionist Settings" /><CardBody className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg">
              <div><p className="font-medium text-white">AI Receptionist</p><p className="text-sm text-slate-400">Automatically transcribe voicemails and send smart replies</p></div>
              <Button variant={settings.isEnabled ? 'primary' : 'secondary'} onClick={toggleEnabled}>{settings.isEnabled ? 'Enabled' : 'Disabled'}</Button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm text-slate-400 mb-1">Business Hours Start</label><Input type="time" value={settings.businessHoursStart || '09:00'} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSettings({ businessHoursStart: e.target.value })} /></div>
              <div><label className="block text-sm text-slate-400 mb-1">Business Hours End</label><Input type="time" value={settings.businessHoursEnd || '17:00'} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSettings({ businessHoursEnd: e.target.value })} /></div>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Timezone</label>
              <Select value={settings.timezone || 'America/Chicago'} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateSettings({ timezone: e.target.value })} options={[
                { value: 'America/New_York', label: 'Eastern' },
                { value: 'America/Chicago', label: 'Central' },
                { value: 'America/Denver', label: 'Mountain' },
                { value: 'America/Los_Angeles', label: 'Pacific' },
              ]} />
            </div>
            <div><label className="block text-sm text-slate-400 mb-1">Default Greeting</label><Textarea value={settings.greetingText || ''} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateSettings({ greetingText: e.target.value })} placeholder="Hi, thanks for calling! We're currently away but will get back to you soon." rows={3} /></div>
            <div><label className="block text-sm text-slate-400 mb-1">Forwarding Number</label><Input value={settings.forwardingNumber || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSettings({ forwardingNumber: e.target.value })} placeholder="(555) 123-4567" /></div>
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
