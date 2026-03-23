import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Megaphone, Star, Mail, Users, TrendingUp, Edit2, Trash2, Send, Check, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardHeader, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog, Tabs, TabsList, TabsTrigger, TabsContent } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

interface OutletContextType {
  instance: Record<string, unknown>;
}

const campaignStatusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'sent', label: 'Sent' },
  { value: 'completed', label: 'Completed' },
];

const reviewStatusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'sent', label: 'Request Sent' },
  { value: 'received', label: 'Review Received' },
  { value: 'declined', label: 'Declined' },
];

interface CampaignFormProps {
  item: Record<string, unknown> | null;
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

interface CampaignFormData {
  name: string;
  subject: string;
  content: string;
  scheduledDate: string;
  status: string;
  recipientCount: string | number;
  createdAt?: string;
}

// CAMPAIGN FORM
function CampaignForm({ item, onSave, onClose }: CampaignFormProps) {
  const [form, setForm] = useState<CampaignFormData>((item as unknown as CampaignFormData) || { name: '', subject: '', content: '', scheduledDate: '', status: 'draft', recipientCount: 0 });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...form, recipientCount: Number(form.recipientCount) || 0, createdAt: item?.createdAt || new Date().toISOString() }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Campaign Name" value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Spring Newsletter" required />
      <Input label="Email Subject" value={form.subject} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, subject: e.target.value })} placeholder="Subject line" />
      <Textarea label="Content Preview" value={form.content} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, content: e.target.value })} placeholder="Email content..." rows={4} />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Scheduled Date" type="datetime-local" value={form.scheduledDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, scheduledDate: e.target.value })} />
        <Input label="Recipients" type="number" value={form.recipientCount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, recipientCount: e.target.value })} placeholder="Number of recipients" />
      </div>
      <Select label="Status" value={form.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, status: e.target.value })} options={campaignStatusOptions} />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Create'}</Button></div>
    </form>
  );
}

interface ReviewRequestFormProps {
  item: Record<string, unknown> | null;
  contacts: Record<string, unknown>[];
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

interface ReviewRequestFormData {
  contactId: string;
  jobDescription: string;
  requestDate: string;
  status: string;
  rating: string | number;
  reviewText: string;
  createdAt?: string;
}

// REVIEW REQUEST FORM
function ReviewRequestForm({ item, contacts, onSave, onClose }: ReviewRequestFormProps) {
  const [form, setForm] = useState<ReviewRequestFormData>((item as unknown as ReviewRequestFormData) || { contactId: '', jobDescription: '', requestDate: '', status: 'pending', rating: '', reviewText: '' });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...form, rating: Number(form.rating) || 0, createdAt: item?.createdAt || new Date().toISOString() }); onClose(); };
  const clients = contacts.filter((c: Record<string, unknown>) => c.type === 'client');
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label="Customer" value={form.contactId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, contactId: e.target.value })} options={clients.map((c: Record<string, unknown>) => ({ value: c.id as string, label: c.name as string }))} placeholder="Select customer" required />
      <Input label="Job Description" value={form.jobDescription} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, jobDescription: e.target.value })} placeholder="What work was done?" />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Request Date" type="date" value={form.requestDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, requestDate: e.target.value })} />
        <Select label="Status" value={form.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, status: e.target.value })} options={reviewStatusOptions} />
      </div>
      {form.status === 'received' && (
        <>
          <Input label="Rating (1-5)" type="number" min="1" max="5" value={form.rating} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, rating: e.target.value })} />
          <Textarea label="Review Text" value={form.reviewText} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, reviewText: e.target.value })} rows={3} />
        </>
      )}
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Create'}</Button></div>
    </form>
  );
}

interface ReferralFormProps {
  item: Record<string, unknown> | null;
  contacts: Record<string, unknown>[];
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

interface ReferralFormData {
  referrerId: string;
  referredName: string;
  referredEmail: string;
  referredPhone: string;
  status: string;
  rewardAmount: string | number;
  rewardPaid: boolean;
  notes: string;
  createdAt?: string;
}

// REFERRAL FORM
function ReferralForm({ item, contacts, onSave, onClose }: ReferralFormProps) {
  const [form, setForm] = useState<ReferralFormData>((item as unknown as ReferralFormData) || { referrerId: '', referredName: '', referredEmail: '', referredPhone: '', status: 'pending', rewardAmount: '', rewardPaid: false, notes: '' });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...form, rewardAmount: Number(form.rewardAmount) || 0, createdAt: item?.createdAt || new Date().toISOString() }); onClose(); };
  const clients = contacts.filter((c: Record<string, unknown>) => c.type === 'client');
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label="Referred By" value={form.referrerId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, referrerId: e.target.value })} options={clients.map((c: Record<string, unknown>) => ({ value: c.id as string, label: c.name as string }))} placeholder="Who referred them?" required />
      <Input label="New Customer Name" value={form.referredName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, referredName: e.target.value })} placeholder="Name of referred person" required />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Email" type="email" value={form.referredEmail} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, referredEmail: e.target.value })} />
        <Input label="Phone" value={form.referredPhone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, referredPhone: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Select label="Status" value={form.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, status: e.target.value })} options={[{ value: 'pending', label: 'Pending' }, { value: 'contacted', label: 'Contacted' }, { value: 'converted', label: 'Converted' }, { value: 'lost', label: 'Lost' }]} />
        <Input label="Reward Amount ($)" type="number" value={form.rewardAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, rewardAmount: e.target.value })} />
      </div>
      {form.status === 'converted' && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.rewardPaid} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, rewardPaid: e.target.checked })} className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
          <span className="text-sm text-slate-300">Reward Paid</span>
        </label>
      )}
      <Textarea label="Notes" value={form.notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, notes: e.target.value })} rows={2} />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Create'}</Button></div>
    </form>
  );
}

export function MarketingPage() {
  const { instance } = useOutletContext<OutletContextType>();
  const store = useCRMDataStore();
  const contacts = store.contacts as Record<string, unknown>[];
  const campaigns = (store.campaigns || []) as Record<string, unknown>[];
  const reviewRequests = (store.reviewRequests || []) as Record<string, unknown>[];
  const referrals = (store.referrals || []) as Record<string, unknown>[];
  const addCampaign = store.addCampaign as ((item: Record<string, unknown>) => void) | undefined;
  const updateCampaign = store.updateCampaign as ((id: unknown, updates: Record<string, unknown>) => void) | undefined;
  const deleteCampaign = store.deleteCampaign as ((id: unknown) => void) | undefined;
  const addReviewRequest = store.addReviewRequest as ((item: Record<string, unknown>) => void) | undefined;
  const updateReviewRequest = store.updateReviewRequest as ((id: unknown, updates: Record<string, unknown>) => void) | undefined;
  const deleteReviewRequest = store.deleteReviewRequest as ((id: unknown) => void) | undefined;
  const addReferral = store.addReferral as ((item: Record<string, unknown>) => void) | undefined;
  const updateReferral = store.updateReferral as ((id: unknown, updates: Record<string, unknown>) => void) | undefined;
  const deleteReferral = store.deleteReferral as ((id: unknown) => void) | undefined;
  const [activeTab, setActiveTab] = useState<string>('campaigns');
  const [search, setSearch] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editItem, setEditItem] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const primaryColor = (instance.primaryColor as string) || '{{PRIMARY_COLOR}}';

  const filteredCampaigns = useMemo(() => (campaigns || []).filter((c: Record<string, unknown>) => !search || (c.name as string)?.toLowerCase().includes(search.toLowerCase())), [campaigns, search]);
  const filteredReviews = useMemo(() => (reviewRequests || []).filter((r: Record<string, unknown>) => !search || (contacts.find((c: Record<string, unknown>) => c.id === r.contactId)?.name as string)?.toLowerCase().includes(search.toLowerCase())), [reviewRequests, contacts, search]);
  const filteredReferrals = useMemo(() => (referrals || []).filter((r: Record<string, unknown>) => !search || (r.referredName as string)?.toLowerCase().includes(search.toLowerCase())), [referrals, search]);

  const getContactName = (id: string): string => (contacts.find((c: Record<string, unknown>) => c.id === id)?.name as string) || '-';

  const handleSave = (data: Record<string, unknown>) => {
    if (activeTab === 'campaigns') { editItem ? updateCampaign?.(editItem.id, data) : addCampaign?.(data); }
    else if (activeTab === 'reviews') { editItem ? updateReviewRequest?.(editItem.id, data) : addReviewRequest?.(data); }
    else if (activeTab === 'referrals') { editItem ? updateReferral?.(editItem.id, data) : addReferral?.(data); }
    setEditItem(null); setShowForm(false);
  };

  const handleDelete = () => {
    if (activeTab === 'campaigns') deleteCampaign?.(deleteTarget?.id);
    else if (activeTab === 'reviews') deleteReviewRequest?.(deleteTarget?.id);
    else if (activeTab === 'referrals') deleteReferral?.(deleteTarget?.id);
    setDeleteTarget(null);
  };

  const totalSent = campaigns.filter((c: Record<string, unknown>) => c.status === 'sent' || c.status === 'completed').reduce((s: number, c: Record<string, unknown>) => s + ((c.recipientCount as number) || 0), 0);
  const reviewsReceived = reviewRequests.filter((r: Record<string, unknown>) => r.status === 'received').length;
  const avgRating = reviewRequests.filter((r: Record<string, unknown>) => r.rating).length > 0 ? (reviewRequests.filter((r: Record<string, unknown>) => r.rating).reduce((s: number, r: Record<string, unknown>) => s + (r.rating as number), 0) / reviewRequests.filter((r: Record<string, unknown>) => r.rating).length).toFixed(1) : '-';
  const referralRevenue = referrals.filter((r: Record<string, unknown>) => r.status === 'converted').reduce((s: number, r: Record<string, unknown>) => s + ((r.rewardAmount as number) || 0) * 10, 0); // Assume 10x ROI

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Marketing</h1><p className="text-slate-400 mt-1">Campaigns, reviews, and referrals</p></div>
        <Button onClick={() => { setEditItem(null); setShowForm(true); }} icon={Plus}>
          {activeTab === 'campaigns' ? 'New Campaign' : activeTab === 'reviews' ? 'Request Review' : 'Add Referral'}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Emails Sent', value: totalSent.toLocaleString(), icon: Mail },
          { label: 'Reviews Received', value: reviewsReceived, icon: Star },
          { label: 'Avg Rating', value: avgRating, icon: Star, color: 'text-amber-400' },
          { label: 'Referral Revenue', value: '$' + referralRevenue.toLocaleString(), icon: TrendingUp, color: 'text-emerald-400' },
        ].map((s, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className={`text-xl font-bold ${s.color || 'text-white'}`}>{s.value}</p><p className="text-sm text-slate-400">{s.label}</p></div><s.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>

      <Card><CardBody className="p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="input pl-11" /></div></CardBody></Card>

      <Tabs value={activeTab} onChange={(v: string) => { setActiveTab(v); setSearch(''); }}>
        <TabsList>
          <TabsTrigger value="campaigns">Campaigns ({campaigns.length})</TabsTrigger>
          <TabsTrigger value="reviews">Review Requests ({reviewRequests.length})</TabsTrigger>
          <TabsTrigger value="referrals">Referrals ({referrals.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns">
          <Card>
            {filteredCampaigns.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Campaign</TableHeader><TableHeader>Subject</TableHeader><TableHeader>Recipients</TableHeader><TableHeader>Scheduled</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
                {filteredCampaigns.map((c: Record<string, unknown>) => (
                  <TableRow key={c.id as string}>
                    <TableCell className="font-medium text-white">{c.name as string}</TableCell>
                    <TableCell className="text-slate-300 max-w-xs truncate">{(c.subject as string) || '-'}</TableCell>
                    <TableCell className="text-slate-300">{(c.recipientCount as number) || 0}</TableCell>
                    <TableCell className="text-slate-300">{c.scheduledDate ? format(new Date(c.scheduledDate as string), 'MMM d, h:mm a') : '-'}</TableCell>
                    <TableCell><StatusBadge status={c.status === 'sent' ? 'completed' : c.status as string} /></TableCell>
                    <TableCell><div className="flex gap-1">
                      {c.status === 'draft' && <button onClick={() => updateCampaign?.(c.id, { status: 'sent', recipientCount: (c.recipientCount as number) || 100 })} className="p-1.5 hover:bg-blue-500/20 rounded text-blue-400" title="Send"><Send className="w-4 h-4" /></button>}
                      <button onClick={() => { setEditItem(c); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                      <button onClick={() => setDeleteTarget(c)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            ) : (<CardBody><EmptyState icon={Mail} title="No campaigns" action={<Button onClick={() => setShowForm(true)} icon={Plus}>New Campaign</Button>} /></CardBody>)}
          </Card>
        </TabsContent>

        <TabsContent value="reviews">
          <Card>
            {filteredReviews.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Customer</TableHeader><TableHeader>Job</TableHeader><TableHeader>Requested</TableHeader><TableHeader>Rating</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
                {filteredReviews.map((r: Record<string, unknown>) => (
                  <TableRow key={r.id as string}>
                    <TableCell className="font-medium text-white">{getContactName(r.contactId as string)}</TableCell>
                    <TableCell className="text-slate-300">{(r.jobDescription as string) || '-'}</TableCell>
                    <TableCell className="text-slate-300">{r.requestDate ? format(new Date(r.requestDate as string), 'MMM d') : '-'}</TableCell>
                    <TableCell>{r.rating ? <span className="text-amber-400">{'★'.repeat(r.rating as number)}{'☆'.repeat(5-(r.rating as number))}</span> : '-'}</TableCell>
                    <TableCell><StatusBadge status={r.status === 'received' ? 'completed' : r.status as string} /></TableCell>
                    <TableCell><div className="flex gap-1">
                      {r.status === 'pending' && <button onClick={() => updateReviewRequest?.(r.id, { status: 'sent', requestDate: format(new Date(), 'yyyy-MM-dd') })} className="p-1.5 hover:bg-blue-500/20 rounded text-blue-400" title="Send Request"><Send className="w-4 h-4" /></button>}
                      <button onClick={() => { setEditItem(r); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                      <button onClick={() => setDeleteTarget(r)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            ) : (<CardBody><EmptyState icon={Star} title="No review requests" action={<Button onClick={() => setShowForm(true)} icon={Plus}>Request Review</Button>} /></CardBody>)}
          </Card>
        </TabsContent>

        <TabsContent value="referrals">
          <Card>
            {filteredReferrals.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Referred By</TableHeader><TableHeader>New Customer</TableHeader><TableHeader>Contact</TableHeader><TableHeader>Reward</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
                {filteredReferrals.map((r: Record<string, unknown>) => (
                  <TableRow key={r.id as string}>
                    <TableCell className="font-medium text-white">{getContactName(r.referrerId as string)}</TableCell>
                    <TableCell className="text-slate-300">{r.referredName as string}</TableCell>
                    <TableCell className="text-slate-400 text-sm">{(r.referredEmail as string) || (r.referredPhone as string) || '-'}</TableCell>
                    <TableCell><span className="text-emerald-400">${(r.rewardAmount as number) || 0}</span>{(r.rewardPaid as boolean) && <Check className="w-3 h-3 inline ml-1 text-emerald-400" />}</TableCell>
                    <TableCell><StatusBadge status={r.status === 'converted' ? 'completed' : r.status === 'lost' ? 'rejected' : r.status as string} /></TableCell>
                    <TableCell><div className="flex gap-1">
                      {r.status === 'pending' && <button onClick={() => updateReferral?.(r.id, { status: 'contacted' })} className="p-1.5 hover:bg-blue-500/20 rounded text-blue-400" title="Mark Contacted"><Send className="w-4 h-4" /></button>}
                      {r.status === 'contacted' && <button onClick={() => updateReferral?.(r.id, { status: 'converted' })} className="p-1.5 hover:bg-emerald-500/20 rounded text-emerald-400" title="Mark Converted"><Check className="w-4 h-4" /></button>}
                      <button onClick={() => { setEditItem(r); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                      <button onClick={() => setDeleteTarget(r)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            ) : (<CardBody><EmptyState icon={Users} title="No referrals" action={<Button onClick={() => setShowForm(true)} icon={Plus}>Add Referral</Button>} /></CardBody>)}
          </Card>
        </TabsContent>
      </Tabs>

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditItem(null); }} title={activeTab === 'campaigns' ? (editItem ? 'Edit Campaign' : 'New Campaign') : activeTab === 'reviews' ? (editItem ? 'Edit Review Request' : 'Request Review') : (editItem ? 'Edit Referral' : 'Add Referral')} size="lg">
        {activeTab === 'campaigns' && <CampaignForm item={editItem} onSave={handleSave} onClose={() => { setShowForm(false); setEditItem(null); }} />}
        {activeTab === 'reviews' && <ReviewRequestForm item={editItem} contacts={contacts} onSave={handleSave} onClose={() => { setShowForm(false); setEditItem(null); }} />}
        {activeTab === 'referrals' && <ReferralForm item={editItem} contacts={contacts} onSave={handleSave} onClose={() => { setShowForm(false); setEditItem(null); }} />}
      </Modal>

      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete" message="Delete this item?" confirmText="Delete" variant="danger" />
    </div>
  );
}
