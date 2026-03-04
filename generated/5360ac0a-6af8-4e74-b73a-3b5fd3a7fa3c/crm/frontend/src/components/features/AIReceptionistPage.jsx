import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Phone, MessageSquare, Bot, Clock, Settings, Edit2, Trash2, Check, PhoneIncoming, PhoneOutgoing, VoicemailIcon, Zap } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardHeader, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog, Tabs, TabsList, TabsTrigger, TabsContent } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

// AUTO-REPLY FORM
function AutoReplyForm({ item, onSave, onClose }) {
  const [form, setForm] = useState(item || { 
    trigger: 'after_hours', name: '', message: '', channel: 'sms', active: true, delay: 0 
  });
  const handleSubmit = (e) => { e.preventDefault(); onSave({ ...form, createdAt: item?.createdAt || new Date().toISOString() }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Rule Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. After Hours Reply" required />
      <div className="grid grid-cols-2 gap-4">
        <Select label="Trigger" value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })} options={[
          { value: 'after_hours', label: 'After Hours' },
          { value: 'missed_call', label: 'Missed Call' },
          { value: 'voicemail', label: 'Voicemail Received' },
          { value: 'new_lead', label: 'New Lead' },
          { value: 'booking_request', label: 'Booking Request' },
          { value: 'keyword', label: 'Keyword Match' },
        ]} />
        <Select label="Channel" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} options={[
          { value: 'sms', label: 'SMS' },
          { value: 'email', label: 'Email' },
          { value: 'both', label: 'SMS + Email' },
        ]} />
      </div>
      <Input label="Delay (minutes)" type="number" min="0" value={form.delay} onChange={(e) => setForm({ ...form, delay: e.target.value })} placeholder="0 = immediate" />
      <Textarea label="Auto-Reply Message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Thanks for contacting us! We'll get back to you shortly..." rows={4} required />
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
        <span className="text-sm text-slate-300">Active</span>
      </label>
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Create'}</Button></div>
    </form>
  );
}

export function AIReceptionistPage() {
  const { instance } = useOutletContext();
  const { aiReceptionistRules = [], aiReceptionistSettings = {}, callLog = [], addAIReceptionistRule, updateAIReceptionistRule, deleteAIReceptionistRule, updateAIReceptionistSettings } = useCRMDataStore();
  const [activeTab, setActiveTab] = useState('rules');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const primaryColor = instance.primaryColor || '#ec7619';

  const activeRules = aiReceptionistRules.filter(r => r.active).length;
  const settings = aiReceptionistSettings || { enabled: false, businessHours: { start: '09:00', end: '17:00' }, greeting: '' };

  const handleSave = (data) => { editItem ? updateAIReceptionistRule?.(editItem.id, data) : addAIReceptionistRule?.(data); setEditItem(null); setShowForm(false); };
  const handleDelete = () => { deleteAIReceptionistRule?.(deleteTarget?.id); setDeleteTarget(null); };

  const toggleEnabled = () => updateAIReceptionistSettings?.({ ...settings, enabled: !settings.enabled });

  // Mock call log for demo
  const demoCallLog = callLog.length > 0 ? callLog : [
    { id: 1, type: 'incoming', number: '(555) 123-4567', duration: '2:34', status: 'answered', time: new Date(Date.now() - 3600000).toISOString() },
    { id: 2, type: 'missed', number: '(555) 987-6543', duration: '-', status: 'auto_replied', time: new Date(Date.now() - 7200000).toISOString() },
    { id: 3, type: 'voicemail', number: '(555) 456-7890', duration: '0:45', status: 'transcribed', time: new Date(Date.now() - 10800000).toISOString() },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">AI Receptionist</h1><p className="text-slate-400 mt-1">Automatic call and text handling</p></div>
        <div className="flex gap-2">
          <Button variant={settings.enabled ? 'primary' : 'secondary'} onClick={toggleEnabled} icon={settings.enabled ? Check : Zap}>
            {settings.enabled ? 'Enabled' : 'Enable AI'}
          </Button>
          <Button onClick={() => { setEditItem(null); setShowForm(true); }} icon={Plus}>New Rule</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Status', value: settings.enabled ? 'Active' : 'Disabled', icon: Bot, color: settings.enabled ? 'text-emerald-400' : 'text-slate-400' },
          { label: 'Auto-Reply Rules', value: aiReceptionistRules.length, icon: MessageSquare },
          { label: 'Active Rules', value: activeRules, icon: Zap, color: 'text-emerald-400' },
          { label: 'Calls Today', value: demoCallLog.filter(c => new Date(c.time) > new Date(Date.now() - 86400000)).length, icon: Phone },
        ].map((s, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className={`text-xl font-bold ${s.color || 'text-white'}`}>{s.value}</p><p className="text-sm text-slate-400">{s.label}</p></div><s.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>

      <Tabs value={activeTab} onChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="rules">Auto-Reply Rules ({aiReceptionistRules.length})</TabsTrigger>
          <TabsTrigger value="calls">Call Log</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="rules">
          <Card>
            {aiReceptionistRules.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Rule</TableHeader><TableHeader>Trigger</TableHeader><TableHeader>Channel</TableHeader><TableHeader>Message Preview</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
                {aiReceptionistRules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium text-white">{rule.name}</TableCell>
                    <TableCell><span className="px-2 py-0.5 rounded text-xs" style={{ backgroundColor: `${primaryColor}20`, color: primaryColor }}>{rule.trigger?.replace('_', ' ')}</span></TableCell>
                    <TableCell className="text-slate-400">{rule.channel}</TableCell>
                    <TableCell className="text-slate-400 text-sm max-w-xs truncate">{rule.message?.substring(0, 50)}...</TableCell>
                    <TableCell>{rule.active ? <span className="text-emerald-400 text-sm">Active</span> : <span className="text-slate-500 text-sm">Inactive</span>}</TableCell>
                    <TableCell><div className="flex gap-1">
                      <button onClick={() => updateAIReceptionistRule?.(rule.id, { active: !rule.active })} className={`p-1.5 hover:bg-slate-700 rounded ${rule.active ? 'text-emerald-400' : 'text-slate-500'}`}><Check className="w-4 h-4" /></button>
                      <button onClick={() => { setEditItem(rule); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                      <button onClick={() => setDeleteTarget(rule)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            ) : (<CardBody><EmptyState icon={Bot} title="No auto-reply rules" description="Create rules to automatically respond to calls and texts" action={<Button onClick={() => setShowForm(true)} icon={Plus}>Create Rule</Button>} /></CardBody>)}
          </Card>
        </TabsContent>

        <TabsContent value="calls">
          <Card>
            <Table><TableHead><TableRow><TableHeader>Type</TableHeader><TableHeader>Number</TableHeader><TableHeader>Duration</TableHeader><TableHeader>Status</TableHeader><TableHeader>Time</TableHeader></TableRow></TableHead><TableBody>
              {demoCallLog.map((call) => (
                <TableRow key={call.id}>
                  <TableCell><div className="flex items-center gap-2">
                    {call.type === 'incoming' && <PhoneIncoming className="w-4 h-4 text-emerald-400" />}
                    {call.type === 'missed' && <Phone className="w-4 h-4 text-red-400" />}
                    {call.type === 'voicemail' && <VoicemailIcon className="w-4 h-4 text-amber-400" />}
                    <span className="text-slate-300">{call.type}</span>
                  </div></TableCell>
                  <TableCell className="font-medium text-white">{call.number}</TableCell>
                  <TableCell className="text-slate-400">{call.duration}</TableCell>
                  <TableCell><StatusBadge status={call.status === 'answered' ? 'completed' : call.status === 'auto_replied' ? 'pending' : 'in_progress'} /></TableCell>
                  <TableCell className="text-slate-400 text-sm">{format(new Date(call.time), 'MMM d, h:mm a')}</TableCell>
                </TableRow>
              ))}
            </TableBody></Table>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card><CardHeader title="AI Receptionist Settings" /><CardBody className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg">
              <div><p className="font-medium text-white">AI Receptionist</p><p className="text-sm text-slate-400">Automatically handle calls and texts</p></div>
              <Button variant={settings.enabled ? 'primary' : 'secondary'} onClick={toggleEnabled}>{settings.enabled ? 'Enabled' : 'Disabled'}</Button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm text-slate-400 mb-1">Business Hours Start</label><Input type="time" value={settings.businessHours?.start || '09:00'} onChange={(e) => updateAIReceptionistSettings?.({ ...settings, businessHours: { ...settings.businessHours, start: e.target.value } })} /></div>
              <div><label className="block text-sm text-slate-400 mb-1">Business Hours End</label><Input type="time" value={settings.businessHours?.end || '17:00'} onChange={(e) => updateAIReceptionistSettings?.({ ...settings, businessHours: { ...settings.businessHours, end: e.target.value } })} /></div>
            </div>
            <div><label className="block text-sm text-slate-400 mb-1">Default Greeting</label><Textarea value={settings.greeting || ''} onChange={(e) => updateAIReceptionistSettings?.({ ...settings, greeting: e.target.value })} placeholder="Hi, thanks for calling! We're currently away but will get back to you soon." rows={3} /></div>
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
