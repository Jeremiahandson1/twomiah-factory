import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, MessageSquare, Mail, Send, Bell, FileText, Edit2, Trash2, Check, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardHeader, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog, Tabs, TabsList, TabsTrigger, TabsContent } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

interface OutletContextType {
  instance: Record<string, unknown>;
}

const messageTypeOptions = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'internal', label: 'Internal Note' },
];

const templateTypeOptions = [
  { value: 'quote_followup', label: 'Quote Follow-up' },
  { value: 'job_complete', label: 'Job Complete' },
  { value: 'invoice_reminder', label: 'Invoice Reminder' },
  { value: 'review_request', label: 'Review Request' },
  { value: 'appointment_reminder', label: 'Appointment Reminder' },
  { value: 'welcome', label: 'Welcome Message' },
  { value: 'custom', label: 'Custom' },
];

interface MessageFormData {
  contactId: string;
  type: string;
  subject: string;
  body: string;
  status: string;
  createdAt?: string;
}

interface MessageFormProps {
  item: Record<string, unknown> | null;
  contacts: Record<string, unknown>[];
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

// MESSAGE FORM
function MessageForm({ item, contacts, onSave, onClose }: MessageFormProps) {
  const [form, setForm] = useState<MessageFormData>((item as unknown as MessageFormData) || { contactId: '', type: 'email', subject: '', body: '', status: 'draft' });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...form, createdAt: item?.createdAt || new Date().toISOString() }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Select label="Recipient" value={form.contactId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, contactId: e.target.value })} options={contacts.map((c: Record<string, unknown>) => ({ value: c.id as string, label: `${c.name} (${c.email || c.phone || 'no contact'})` }))} placeholder="Select contact" required />
        <Select label="Type" value={form.type} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, type: e.target.value })} options={messageTypeOptions} />
      </div>
      {form.type === 'email' && <Input label="Subject" value={form.subject} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, subject: e.target.value })} placeholder="Email subject" />}
      <Textarea label="Message" value={form.body} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, body: e.target.value })} placeholder="Write your message..." rows={5} required />
      <Select label="Status" value={form.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, status: e.target.value })} options={[{ value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' }, { value: 'delivered', label: 'Delivered' }, { value: 'read', label: 'Read' }]} />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Save'}</Button></div>
    </form>
  );
}

interface TemplateFormData {
  name: string;
  type: string;
  channel: string;
  subject: string;
  body: string;
  active: boolean;
  createdAt?: string;
}

interface TemplateFormProps {
  item: Record<string, unknown> | null;
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

// TEMPLATE FORM
function TemplateForm({ item, onSave, onClose }: TemplateFormProps) {
  const [form, setForm] = useState<TemplateFormData>((item as unknown as TemplateFormData) || { name: '', type: 'custom', channel: 'email', subject: '', body: '', active: true });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...form, createdAt: item?.createdAt || new Date().toISOString() }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Template Name" value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Job Complete Thank You" required />
      <div className="grid grid-cols-2 gap-4">
        <Select label="Template Type" value={form.type} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, type: e.target.value })} options={templateTypeOptions} />
        <Select label="Channel" value={form.channel} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, channel: e.target.value })} options={[{ value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }, { value: 'both', label: 'Both' }]} />
      </div>
      {(form.channel === 'email' || form.channel === 'both') && <Input label="Subject" value={form.subject} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, subject: e.target.value })} placeholder="Email subject line" />}
      <Textarea label="Message Body" value={form.body} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, body: e.target.value })} placeholder="Use {{customer_name}}, {{job_name}}, etc. for merge fields" rows={5} required />
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.active} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, active: e.target.checked })} className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
        <span className="text-sm text-slate-300">Active (available for use)</span>
      </label>
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Create'}</Button></div>
    </form>
  );
}

export function CommunicationPage() {
  const { instance } = useOutletContext<OutletContextType>();
  const store = useCRMDataStore();
  const contacts = store.contacts as Record<string, unknown>[];
  const messages = (store.messages || []) as Record<string, unknown>[];
  const templates = (store.templates || []) as Record<string, unknown>[];
  const addMessage = store.addMessage as ((item: Record<string, unknown>) => void) | undefined;
  const updateMessage = store.updateMessage as ((id: unknown, updates: Record<string, unknown>) => void) | undefined;
  const deleteMessage = store.deleteMessage as ((id: unknown) => void) | undefined;
  const addTemplate = store.addTemplate as ((item: Record<string, unknown>) => void) | undefined;
  const updateTemplate = store.updateTemplate as ((id: unknown, updates: Record<string, unknown>) => void) | undefined;
  const deleteTemplate = store.deleteTemplate as ((id: unknown) => void) | undefined;
  const [activeTab, setActiveTab] = useState<string>('messages');
  const [search, setSearch] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editItem, setEditItem] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const primaryColor = (instance.primaryColor as string) || '{{PRIMARY_COLOR}}';

  const filteredMessages = useMemo(() => (messages || []).filter((m: Record<string, unknown>) => !search || (m.body as string)?.toLowerCase().includes(search.toLowerCase()) || (m.subject as string)?.toLowerCase().includes(search.toLowerCase())), [messages, search]);
  const filteredTemplates = useMemo(() => (templates || []).filter((t: Record<string, unknown>) => !search || (t.name as string)?.toLowerCase().includes(search.toLowerCase())), [templates, search]);

  const getContactName = (id: string): string => (contacts.find((c: Record<string, unknown>) => c.id === id)?.name as string) || '-';

  const handleSave = (data: Record<string, unknown>) => {
    if (activeTab === 'messages') { editItem ? updateMessage?.(editItem.id, data) : addMessage?.(data); }
    else if (activeTab === 'templates') { editItem ? updateTemplate?.(editItem.id, data) : addTemplate?.(data); }
    setEditItem(null); setShowForm(false);
  };

  const handleDelete = () => {
    if (activeTab === 'messages') deleteMessage?.(deleteTarget?.id);
    else if (activeTab === 'templates') deleteTemplate?.(deleteTarget?.id);
    setDeleteTarget(null);
  };

  const handleSend = (msg: Record<string, unknown>) => updateMessage?.(msg.id, { status: 'sent', sentAt: new Date().toISOString() });

  const sentCount = messages.filter((m: Record<string, unknown>) => m.status !== 'draft').length;
  const emailCount = messages.filter((m: Record<string, unknown>) => m.type === 'email').length;
  const smsCount = messages.filter((m: Record<string, unknown>) => m.type === 'sms').length;
  const activeTemplates = templates.filter((t: Record<string, unknown>) => t.active).length;

  const typeIcons: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = { email: Mail, sms: MessageSquare, internal: FileText };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Communication</h1><p className="text-slate-400 mt-1">Messages and templates</p></div>
        <Button onClick={() => { setEditItem(null); setShowForm(true); }} icon={Plus}>
          {activeTab === 'messages' ? 'New Message' : 'New Template'}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Messages', value: messages.length, icon: MessageSquare },
          { label: 'Emails Sent', value: emailCount, icon: Mail },
          { label: 'SMS Sent', value: smsCount, icon: Send },
          { label: 'Active Templates', value: activeTemplates, icon: FileText },
        ].map((s, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className="text-xl font-bold text-white">{s.value}</p><p className="text-sm text-slate-400">{s.label}</p></div><s.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>

      <Card><CardBody className="p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="input pl-11" /></div></CardBody></Card>

      <Tabs value={activeTab} onChange={(v: string) => { setActiveTab(v); setSearch(''); }}>
        <TabsList>
          <TabsTrigger value="messages">Messages ({messages.length})</TabsTrigger>
          <TabsTrigger value="templates">Templates ({templates.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="messages">
          <Card>
            {filteredMessages.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Type</TableHeader><TableHeader>Recipient</TableHeader><TableHeader>Subject / Preview</TableHeader><TableHeader>Date</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
                {filteredMessages.map((m: Record<string, unknown>) => {
                  const Icon = typeIcons[m.type as string] || MessageSquare;
                  return (
                    <TableRow key={m.id as string}>
                      <TableCell><div className="flex items-center gap-2"><Icon className="w-4 h-4" style={{ color: primaryColor }} /><span className="text-slate-400 text-sm">{m.type as string}</span></div></TableCell>
                      <TableCell className="font-medium text-white">{getContactName(m.contactId as string)}</TableCell>
                      <TableCell><span className="text-slate-300">{(m.subject as string) || (m.body as string)?.substring(0, 40) + '...'}</span></TableCell>
                      <TableCell className="text-slate-400 text-sm">{m.createdAt ? format(new Date(m.createdAt as string), 'MMM d, h:mm a') : '-'}</TableCell>
                      <TableCell><StatusBadge status={m.status === 'sent' || m.status === 'delivered' || m.status === 'read' ? 'completed' : 'draft'} /></TableCell>
                      <TableCell><div className="flex gap-1">
                        {m.status === 'draft' && <button onClick={() => handleSend(m)} className="p-1.5 hover:bg-blue-500/20 rounded text-blue-400" title="Send"><Send className="w-4 h-4" /></button>}
                        <button onClick={() => { setEditItem(m); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                        <button onClick={() => setDeleteTarget(m)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                      </div></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody></Table>
            ) : (<CardBody><EmptyState icon={MessageSquare} title="No messages" action={<Button onClick={() => setShowForm(true)} icon={Plus}>New Message</Button>} /></CardBody>)}
          </Card>
        </TabsContent>

        <TabsContent value="templates">
          <Card>
            {filteredTemplates.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Name</TableHeader><TableHeader>Type</TableHeader><TableHeader>Channel</TableHeader><TableHeader>Preview</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
                {filteredTemplates.map((t: Record<string, unknown>) => (
                  <TableRow key={t.id as string}>
                    <TableCell className="font-medium text-white">{t.name as string}</TableCell>
                    <TableCell><span className="text-slate-400 text-sm">{(t.type as string)?.replace('_', ' ')}</span></TableCell>
                    <TableCell><span className="px-2 py-0.5 rounded text-xs" style={{ backgroundColor: `${primaryColor}20`, color: primaryColor }}>{t.channel as string}</span></TableCell>
                    <TableCell className="text-slate-400 text-sm max-w-xs truncate">{(t.body as string)?.substring(0, 50)}...</TableCell>
                    <TableCell>{t.active ? <span className="text-emerald-400 text-sm">Active</span> : <span className="text-slate-500 text-sm">Inactive</span>}</TableCell>
                    <TableCell><div className="flex gap-1">
                      <button onClick={() => updateTemplate?.(t.id, { active: !t.active })} className={`p-1.5 hover:bg-slate-700 rounded ${t.active ? 'text-emerald-400' : 'text-slate-500'}`} title={t.active ? 'Deactivate' : 'Activate'}><Check className="w-4 h-4" /></button>
                      <button onClick={() => { setEditItem(t); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                      <button onClick={() => setDeleteTarget(t)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            ) : (<CardBody><EmptyState icon={FileText} title="No templates" description="Create reusable message templates" action={<Button onClick={() => setShowForm(true)} icon={Plus}>New Template</Button>} /></CardBody>)}
          </Card>
        </TabsContent>
      </Tabs>

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditItem(null); }} title={activeTab === 'messages' ? (editItem ? 'Edit Message' : 'New Message') : (editItem ? 'Edit Template' : 'New Template')} size="lg">
        {activeTab === 'messages' && <MessageForm item={editItem} contacts={contacts} onSave={handleSave} onClose={() => { setShowForm(false); setEditItem(null); }} />}
        {activeTab === 'templates' && <TemplateForm item={editItem} onSave={handleSave} onClose={() => { setShowForm(false); setEditItem(null); }} />}
      </Modal>

      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete" message="Delete this item?" confirmText="Delete" variant="danger" />
    </div>
  );
}
