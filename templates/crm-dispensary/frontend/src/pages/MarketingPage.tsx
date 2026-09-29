// Marketing — email and SMS campaigns.
//
// T45 H23: email_campaigns and sms_campaigns were switched on as features and there was no screen
// anywhere in the product. The API had campaigns, templates, sending, scheduling and stats behind
// it; an owner had no way to reach any of it.
//
// The part the report was most pointed about is the audience. A campaign you cannot see the
// recipients of before you send it is a campaign you send blind — so the audience count sits beside
// the Send button and updates as the audience is chosen, and Send is refused when it is zero.
import { useState, useEffect, useCallback } from 'react';
import { Mail, MessageSquare, Plus, Send, Trash2, Users, Clock } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { Button, DataTable, StatusBadge, PageHeader } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { formatDate } from '../utils/date';

const CHANNELS = [
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'sms', label: 'SMS', icon: MessageSquare },
];

const AUDIENCES = [
  { value: 'all', label: 'Every customer' },
  { value: 'segment', label: 'Customers of one type' },
];

const CONTACT_TYPES = ['customer', 'lead', 'vendor'];

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  sending: 'bg-amber-100 text-amber-700',
  sent: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

const emptyForm = {
  name: '',
  type: 'email',
  subject: '',
  content: '',
  audienceType: 'all',
  contactType: 'customer',
};

export default function MarketingPage() {
  const toast = useToast();
  const { can } = usePermissions() as any;
  const canCreate = can ? can('marketing:create') : true;
  const canSend = can ? can('marketing:update') : true;
  const canDelete = can ? can('marketing:delete') : true;

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [audience, setAudience] = useState<any>(null);
  const [checkingAudience, setCheckingAudience] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, s] = await Promise.all([
        api.get('/api/marketing/campaigns'),
        api.get('/api/marketing/stats').catch(() => null),
      ]);
      setCampaigns(Array.isArray(list) ? list : (list as any)?.data || []);
      setStats(s);
    } catch {
      toast.error('Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The audience the current choices reach, asked for as the choices change. This is the number
  // the owner needs before pressing Send, not after. (T45 H23)
  const audienceFilter = () => (form.audienceType === 'segment' ? { type: form.contactType } : {});

  const refreshAudience = useCallback(async (audienceType: string, filter: any, channel: string) => {
    setCheckingAudience(true);
    try {
      const data = await api.get('/api/marketing/audience-preview', {
        audienceType,
        filter: JSON.stringify(filter),
        // The channel is part of the question. A text message needs an opt-in and an email needs
        // the absence of an opt-out, so the same audience is two different numbers. (T46 N9)
        channel,
      });
      setAudience(data);
    } catch {
      setAudience(null);
    } finally {
      setCheckingAudience(false);
    }
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    refreshAudience(form.audienceType, form.audienceType === 'segment' ? { type: form.contactType } : {}, form.type);
  }, [modalOpen, form.audienceType, form.contactType, form.type, refreshAudience]);

  // How many of the audience this channel can actually REACH — the server's own answer, because
  // the rule differs by channel and only it knows who opted in. This used to count every contact
  // holding a phone number, so an SMS campaign showed an audience of 26 when the number who had
  // agreed to be texted was nought. (T46 N9)
  const reachable = audience ? Number(audience.reachable || 0) : null;

  const openCreate = () => { setForm(emptyForm); setAudience(null); setModalOpen(true); };

  const save = async (andSend: boolean) => {
    if (!form.name.trim()) { toast.error('Give the campaign a name'); return; }
    if (form.type === 'email' && !form.subject.trim()) { toast.error('An email needs a subject line'); return; }
    if (!form.content.trim()) { toast.error('Write the message'); return; }
    if (andSend && reachable === 0) {
      toast.error(form.type === 'sms'
        ? 'Nobody in this audience has opted in to text messages — this would reach no one'
        : 'Nobody in this audience has an email address — this would reach no one');
      return;
    }
    setSaving(true);
    try {
      const created = await api.post('/api/marketing/campaigns', {
        name: form.name,
        type: form.type,
        subject: form.subject || null,
        content: form.content,
        audienceFilter: audienceFilter(),
      }) as any;
      if (andSend) {
        const result = await api.post(`/api/marketing/campaigns/${created.id}/send`) as any;
        toast.success(`Sent to ${result?.sent ?? 0} of ${result?.total ?? 0}${result?.failed ? `, ${result.failed} failed` : ''}`);
      } else {
        toast.success('Campaign saved as a draft');
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save the campaign');
    } finally {
      setSaving(false);
    }
  };

  const sendExisting = async (campaign: any) => {
    if (sendingId) return;
    setSendingId(campaign.id);
    try {
      const result = await api.post(`/api/marketing/campaigns/${campaign.id}/send`) as any;
      toast.success(`Sent to ${result?.sent ?? 0} of ${result?.total ?? 0}${result?.failed ? `, ${result.failed} failed` : ''}`);
      load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to send');
    } finally {
      setSendingId(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/api/marketing/campaigns/${deleting.id}`);
      toast.success('Campaign deleted');
      setDeleting(null);
      load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete');
    }
  };

  const columns = [
    { key: 'name', label: 'Campaign', render: (v: string) => <span className="font-medium text-gray-900 dark:text-slate-100">{v || 'Untitled'}</span> },
    {
      key: 'type', label: 'Channel', render: (v: string) => (
        <span className="flex items-center gap-1 text-gray-700 dark:text-slate-200">
          {v === 'sms' ? <MessageSquare className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
          {v === 'sms' ? 'SMS' : 'Email'}
        </span>
      ),
    },
    { key: 'subject', label: 'Subject', render: (v: string) => v || <span className="text-gray-500 dark:text-slate-400">--</span> },
    { key: 'status', label: 'Status', render: (v: string) => <StatusBadge status={v || 'draft'} statusColors={statusColors} /> },
    { key: 'sentCount', label: 'Sent', render: (v: number) => <span className="tabular-nums text-gray-700 dark:text-slate-200">{Number(v || 0)}</span> },
    { key: 'createdAt', label: 'Created', render: (v: string) => (v ? formatDate(v) : '--') },
  ];

  // DataTable takes a list of actions, not a render function.
  const tableActions = [
    ...(canSend ? [{
      label: 'Send',
      icon: Send,
      onClick: (row: any) => {
        if (row.status === 'sent') { toast.error('That campaign has already been sent'); return; }
        sendExisting(row);
      },
    }] : []),
    ...(canDelete ? [{ label: 'Delete', icon: Trash2, onClick: (row: any) => setDeleting(row) }] : []),
  ];

  return (
    <div>
      <PageHeader title="Marketing" subtitle="Email and SMS campaigns to your customers" />

      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white border rounded-xl p-4 dark:bg-slate-900 dark:border-slate-700">
            <p className="text-sm text-gray-500 dark:text-slate-400">Customers</p>
            <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-slate-100">{stats.totalContacts}</p>
          </div>
          <div className="bg-white border rounded-xl p-4 dark:bg-slate-900 dark:border-slate-700">
            <p className="text-sm text-gray-500 dark:text-slate-400">Reachable by email</p>
            <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-slate-100">{stats.contactsWithEmail}</p>
          </div>
          <div className="bg-white border rounded-xl p-4 dark:bg-slate-900 dark:border-slate-700">
            <p className="text-sm text-gray-500 dark:text-slate-400">Opted in to SMS</p>
            <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-slate-100">{stats.smsOptedIn}</p>
          </div>
        </div>
      )}

      <div className="flex justify-end mb-4">
        {canCreate && (
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2 inline" />New Campaign
          </Button>
        )}
      </div>

      <DataTable data={campaigns} columns={columns} loading={loading} actions={tableActions} emptyMessage="No campaigns yet" />

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="New Campaign" size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Name *</label>
            <input
              type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-green-500"
              placeholder="October flower promo"
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Channel</label>
              <select
                value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-green-500"
              >
                {CHANNELS.map(ch => <option key={ch.value} value={ch.value}>{ch.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Audience</label>
              <select
                value={form.audienceType} onChange={(e) => setForm({ ...form, audienceType: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-green-500"
              >
                {AUDIENCES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
          </div>

          {form.audienceType === 'segment' && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Customer type</label>
              <select
                value={form.contactType} onChange={(e) => setForm({ ...form, contactType: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-green-500"
              >
                {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}

          {/* Who this reaches, before it is sent. */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
            <div className="flex items-center gap-2 text-slate-200">
              <Users className="w-4 h-4" />
              {checkingAudience ? (
                <span className="text-sm">Counting…</span>
              ) : audience ? (
                <span className="text-sm">
                  <span className="font-semibold tabular-nums">{reachable}</span>
                  {' '}of {audience.total} {audience.total === 1 ? 'customer' : 'customers'} will get this
                  {form.type === 'sms' ? ' text' : ' email'}
                </span>
              ) : (
                <span className="text-sm text-slate-400">Audience unavailable</span>
              )}
            </div>
            {audience && reachable === 0 && (
              <p className="text-xs text-amber-300 mt-2">
                {form.type === 'sms'
                  ? `Nobody in this audience has opted in to text messages, so this would reach no one. ${Number(audience.withPhone || 0)} have a number on file — they have to agree to be texted first.`
                  : 'Nobody in this audience has an email address on file, so this would reach no one.'}
              </p>
            )}
          </div>

          {form.type === 'email' && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Subject *</label>
              <input
                type="text" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-green-500"
                placeholder="20% off flower this weekend"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Message *</label>
            <textarea
              value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={form.type === 'sms' ? 4 : 8}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-green-500"
              placeholder={form.type === 'sms' ? 'Keep it short — this goes out as a text.' : 'Write the email.'}
            />
            {form.type === 'sms' && (
              <p className="text-xs text-slate-400 mt-1">{form.content.length} characters</p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="px-4 py-2 border border-slate-600 text-slate-200 rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50"
          >
            <Clock className="w-4 h-4 mr-2 inline" />Save as draft
          </button>
          <Button onClick={() => save(true)} disabled={saving || reachable === 0}>
            {saving ? 'Working…' : <><Send className="w-4 h-4 mr-2 inline" />Send now</>}
          </Button>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete campaign"
        message={`Delete "${deleting?.name || 'this campaign'}"? This cannot be undone.`}
        confirmText="Delete"
      />
    </div>
  );
}
