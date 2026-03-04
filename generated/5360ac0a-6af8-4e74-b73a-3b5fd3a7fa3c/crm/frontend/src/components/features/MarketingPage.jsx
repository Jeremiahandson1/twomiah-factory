import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Megaphone, Star, Mail, Users, TrendingUp, Edit2, Trash2, Send, Check, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardHeader, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog, Tabs, TabsList, TabsTrigger, TabsContent } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

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

// CAMPAIGN FORM
function CampaignForm({ item, onSave, onClose }) {
  const [form, setForm] = useState(item || { name: '', subject: '', content: '', scheduledDate: '', status: 'draft', recipientCount: 0 });
  const handleSubmit = (e) => { e.preventDefault(); onSave({ ...form, recipientCount: Number(form.recipientCount) || 0, createdAt: item?.createdAt || new Date().toISOString() }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Campaign Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Spring Newsletter" required />
      <Input label="Email Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Subject line" />
      <Textarea label="Content Preview" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Email content..." rows={4} />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Scheduled Date" type="datetime-local" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
        <Input label="Recipients" type="number" value={form.recipientCount} onChange={(e) => setForm({ ...form, recipientCount: e.target.value })} placeholder="Number of recipients" />
      </div>
      <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={campaignStatusOptions} />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Create'}</Button></div>
    </form>
  );
}

// REVIEW REQUEST FORM
function ReviewRequestForm({ item, contacts, onSave, onClose }) {
  const [form, setForm] = useState(item || { contactId: '', jobDescription: '', requestDate: '', status: 'pending', rating: '', reviewText: '' });
  const handleSubmit = (e) => { e.preventDefault(); onSave({ ...form, rating: Number(form.rating) || 0, createdAt: item?.createdAt || new Date().toISOString() }); onClose(); };
  const clients = contacts.filter(c => c.type === 'client');
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label="Customer" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })} options={clients.map(c => ({ value: c.id, label: c.name }))} placeholder="Select customer" required />
      <Input label="Job Description" value={form.jobDescription} onChange={(e) => setForm({ ...form, jobDescription: e.target.value })} placeholder="What work was done?" />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Request Date" type="date" value={form.requestDate} onChange={(e) => setForm({ ...form, requestDate: e.target.value })} />
        <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={reviewStatusOptions} />
      </div>
      {form.status === 'received' && (
        <>
          <Input label="Rating (1-5)" type="number" min="1" max="5" value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} />
          <Textarea label="Review Text" value={form.reviewText} onChange={(e) => setForm({ ...form, reviewText: e.target.value })} rows={3} />
        </>
      )}
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Create'}</Button></div>
    </form>
  );
}

// REFERRAL FORM
function ReferralForm({ item, contacts, onSave, onClose }) {
  const [form, setForm] = useState(item || { referrerId: '', referredName: '', referredEmail: '', referredPhone: '', status: 'pending', rewardAmount: '', rewardPaid: false, notes: '' });
  const handleSubmit = (e) => { e.preventDefault(); onSave({ ...form, rewardAmount: Number(form.rewardAmount) || 0, createdAt: item?.createdAt || new Date().toISOString() }); onClose(); };
  const clients = contacts.filter(c => c.type === 'client');
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label="Referred By" value={form.referrerId} onChange={(e) => setForm({ ...form, referrerId: e.target.value })} options={clients.map(c => ({ value: c.id, label: c.name }))} placeholder="Who referred them?" required />
      <Input label="New Customer Name" value={form.referredName} onChange={(e) => setForm({ ...form, referredName: e.target.value })} placeholder="Name of referred person" required />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Email" type="email" value={form.referredEmail} onChange={(e) => setForm({ ...form, referredEmail: e.target.value })} />
        <Input label="Phone" value={form.referredPhone} onChange={(e) => setForm({ ...form, referredPhone: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={[{ value: 'pending', label: 'Pending' }, { value: 'contacted', label: 'Contacted' }, { value: 'converted', label: 'Converted' }, { value: 'lost', label: 'Lost' }]} />
        <Input label="Reward Amount ($)" type="number" value={form.rewardAmount} onChange={(e) => setForm({ ...form, rewardAmount: e.target.value })} />
      </div>
      {form.status === 'converted' && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.rewardPaid} onChange={(e) => setForm({ ...form, rewardPaid: e.target.checked })} className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
          <span className="text-sm text-slate-300">Reward Paid</span>
        </label>
      )}
      <Textarea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Create'}</Button></div>
    </form>
  );
}

export function MarketingPage() {
  const { instance } = useOutletContext();
  const { contacts, campaigns = [], reviewRequests = [], referrals = [], addCampaign, updateCampaign, deleteCampaign, addReviewRequest, updateReviewRequest, deleteReviewRequest, addReferral, updateReferral, deleteReferral } = useCRMDataStore();
  const [activeTab, setActiveTab] = useState('campaigns');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const primaryColor = instance.primaryColor || '#ec7619';

  const filteredCampaigns = useMemo(() => (campaigns || []).filter(c => !search || c.name?.toLowerCase().includes(search.toLowerCase())), [campaigns, search]);
  const filteredReviews = useMemo(() => (reviewRequests || []).filter(r => !search || contacts.find(c => c.id === r.contactId)?.name?.toLowerCase().includes(search.toLowerCase())), [reviewRequests, contacts, search]);
  const filteredReferrals = useMemo(() => (referrals || []).filter(r => !search || r.referredName?.toLowerCase().includes(search.toLowerCase())), [referrals, search]);

  const getContactName = (id) => contacts.find(c => c.id === id)?.name || '-';

  const handleSave = (data) => {
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

  const totalSent = campaigns.filter(c => c.status === 'sent' || c.status === 'completed').reduce((s, c) => s + (c.recipientCount || 0), 0);
  const reviewsReceived = reviewRequests.filter(r => r.status === 'received').length;
  const avgRating = reviewRequests.filter(r => r.rating).length > 0 ? (reviewRequests.filter(r => r.rating).reduce((s, r) => s + r.rating, 0) / reviewRequests.filter(r => r.rating).length).toFixed(1) : '-';
  const referralRevenue = referrals.filter(r => r.status === 'converted').reduce((s, r) => s + (r.rewardAmount || 0) * 10, 0); // Assume 10x ROI

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

      <Card><CardBody className="p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-11" /></div></CardBody></Card>

      <Tabs value={activeTab} onChange={(v) => { setActiveTab(v); setSearch(''); }}>
        <TabsList>
          <TabsTrigger value="campaigns">Campaigns ({campaigns.length})</TabsTrigger>
          <TabsTrigger value="reviews">Review Requests ({reviewRequests.length})</TabsTrigger>
          <TabsTrigger value="referrals">Referrals ({referrals.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns">
          <Card>
            {filteredCampaigns.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Campaign</TableHeader><TableHeader>Subject</TableHeader><TableHeader>Recipients</TableHeader><TableHeader>Scheduled</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
                {filteredCampaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-white">{c.name}</TableCell>
                    <TableCell className="text-slate-300 max-w-xs truncate">{c.subject || '-'}</TableCell>
                    <TableCell className="text-slate-300">{c.recipientCount || 0}</TableCell>
                    <TableCell className="text-slate-300">{c.scheduledDate ? format(new Date(c.scheduledDate), 'MMM d, h:mm a') : '-'}</TableCell>
                    <TableCell><StatusBadge status={c.status === 'sent' ? 'completed' : c.status} /></TableCell>
                    <TableCell><div className="flex gap-1">
                      {c.status === 'draft' && <button onClick={() => updateCampaign?.(c.id, { status: 'sent', recipientCount: c.recipientCount || 100 })} className="p-1.5 hover:bg-blue-500/20 rounded text-blue-400" title="Send"><Send className="w-4 h-4" /></button>}
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
                {filteredReviews.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-white">{getContactName(r.contactId)}</TableCell>
                    <TableCell className="text-slate-300">{r.jobDescription || '-'}</TableCell>
                    <TableCell className="text-slate-300">{r.requestDate ? format(new Date(r.requestDate), 'MMM d') : '-'}</TableCell>
                    <TableCell>{r.rating ? <span className="text-amber-400">{'★'.repeat(r.rating)}{'☆'.repeat(5-r.rating)}</span> : '-'}</TableCell>
                    <TableCell><StatusBadge status={r.status === 'received' ? 'completed' : r.status} /></TableCell>
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
                {filteredReferrals.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-white">{getContactName(r.referrerId)}</TableCell>
                    <TableCell className="text-slate-300">{r.referredName}</TableCell>
                    <TableCell className="text-slate-400 text-sm">{r.referredEmail || r.referredPhone || '-'}</TableCell>
                    <TableCell><span className="text-emerald-400">${r.rewardAmount || 0}</span>{r.rewardPaid && <Check className="w-3 h-3 inline ml-1 text-emerald-400" />}</TableCell>
                    <TableCell><StatusBadge status={r.status === 'converted' ? 'completed' : r.status === 'lost' ? 'rejected' : r.status} /></TableCell>
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
