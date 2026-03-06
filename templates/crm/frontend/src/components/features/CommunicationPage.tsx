import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, MessageSquare, Mail, Send, Bell, FileText, Edit2, Trash2, Check, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardHeader, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog, Tabs, TabsList, TabsTrigger, TabsContent } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

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

// MESSAGE FORM
function MessageForm({ item, contacts, onSave, onClose }) {
  const [form, setForm] = useState(item || { contactId: '', type: 'email', subject: '', body: '', status: 'draft' });
  const handleSubmit = (e) => { e.preventDefault(); onSave({ ...form, createdAt: item?.createdAt || new Date().toISOString() }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Select label="Recipient" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })} options={contacts.map(c => ({ value: c.id, label: `${c.name} (${c.email || c.phone || 'no contact'})` }))} placeholder="Select contact" required />
        <Select label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={messageTypeOptions} />
      </div>
      {form.type === 'email' && <Input label="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Email subject" />}
      <Textarea label="Message" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Write your message..." rows={5} required />
      <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={[{ value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' }, { value: 'delivered', label: 'Delivered' }, { value: 'read', label: 'Read' }]} />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Save'}</Button></div>
    </form>
  );
}

// TEMPLATE FORM
function TemplateForm({ item, onSave, onClose }) {
  const [form, setForm] = useState(item || { name: '', type: 'custom', channel: 'email', subject: '', body: '', active: true });
  const handleSubmit = (e) => { e.preventDefault(); onSave({ ...form, createdAt: item?.createdAt || new Date().toISOString() }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Template Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Job Complete Thank You" required />
      <div className="grid grid-cols-2 gap-4">
        <Select label="Template Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={templateTypeOptions} />
        <Select label="Channel" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} options={[{ value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }, { value: 'both', label: 'Both' }]} />
      </div>
      {(form.channel === 'email' || form.channel === 'both') && <Input label="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Email subject line" />}
      <Textarea label="Message Body" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Use {{customer_name}}, {{job_name}}, etc. for merge fields" rows={5} required />
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
        <span className="text-sm text-slate-300">Active (available for use)</span>
      </label>
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Create'}</Button></div>
    </form>
  );
}

export function CommunicationPage() {
  const { instance } = useOutletContext();
  const { contacts, messages = [], templates = [], addMessage, updateMessage, deleteMessage, addTemplate, updateTemplate, deleteTemplate } = useCRMDataStore();
  const [activeTab, setActiveTab] = useState('messages');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const primaryColor = instance.primaryColor || '#ec7619';

  const filteredMessages = useMemo(() => (messages || []).filter(m => !search || m.body?.toLowerCase().includes(search.toLowerCase()) || m.subject?.toLowerCase().includes(search.toLowerCase())), [messages, search]);
  const filteredTemplates = useMemo(() => (templates || []).filter(t => !search || t.name?.toLowerCase().includes(search.toLowerCase())), [templates, search]);

  const getContactName = (id) => contacts.find(c => c.id === id)?.name || '-';

  const handleSave = (data) => {
    if (activeTab === 'messages') { editItem ? updateMessage?.(editItem.id, data) : addMessage?.(data); }
    else if (activeTab === 'templates') { editItem ? updateTemplate?.(editItem.id, data) : addTemplate?.(data); }
    setEditItem(null); setShowForm(false);
  };

  const handleDelete = () => {
    if (activeTab === 'messages') deleteMessage?.(deleteTarget?.id);
    else if (activeTab === 'templates') deleteTemplate?.(deleteTarget?.id);
    setDeleteTarget(null);
  };

  const handleSend = (msg) => updateMessage?.(msg.id, { status: 'sent', sentAt: new Date().toISOString() });

  const sentCount = messages.filter(m => m.status !== 'draft').length;
  const emailCount = messages.filter(m => m.type === 'email').length;
  const smsCount = messages.filter(m => m.type === 'sms').length;
  const activeTemplates = templates.filter(t => t.active).length;

  const typeIcons = { email: Mail, sms: MessageSquare, internal: FileText };

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

      <Card><CardBody className="p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-11" /></div></CardBody></Card>

      <Tabs value={activeTab} onChange={(v) => { setActiveTab(v); setSearch(''); }}>
        <TabsList>
          <TabsTrigger value="messages">Messages ({messages.length})</TabsTrigger>
          <TabsTrigger value="templates">Templates ({templates.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="messages">
          <Card>
            {filteredMessages.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Type</TableHeader><TableHeader>Recipient</TableHeader><TableHeader>Subject / Preview</TableHeader><TableHeader>Date</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
                {filteredMessages.map((m) => {
                  const Icon = typeIcons[m.type] || MessageSquare;
                  return (
                    <TableRow key={m.id}>
                      <TableCell><div className="flex items-center gap-2"><Icon className="w-4 h-4" style={{ color: primaryColor }} /><span className="text-slate-400 text-sm">{m.type}</span></div></TableCell>
                      <TableCell className="font-medium text-white">{getContactName(m.contactId)}</TableCell>
                      <TableCell><span className="text-slate-300">{m.subject || m.body?.substring(0, 40) + '...'}</span></TableCell>
                      <TableCell className="text-slate-400 text-sm">{m.createdAt ? format(new Date(m.createdAt), 'MMM d, h:mm a') : '-'}</TableCell>
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
                {filteredTemplates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium text-white">{t.name}</TableCell>
                    <TableCell><span className="text-slate-400 text-sm">{t.type?.replace('_', ' ')}</span></TableCell>
                    <TableCell><span className="px-2 py-0.5 rounded text-xs" style={{ backgroundColor: `${primaryColor}20`, color: primaryColor }}>{t.channel}</span></TableCell>
                    <TableCell className="text-slate-400 text-sm max-w-xs truncate">{t.body?.substring(0, 50)}...</TableCell>
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
