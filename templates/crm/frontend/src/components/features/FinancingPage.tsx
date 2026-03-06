import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, CreditCard, DollarSign, TrendingUp, Clock, Check, Edit2, Trash2, ExternalLink, Calculator, Percent } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardHeader, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog, Tabs, TabsList, TabsTrigger, TabsContent } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

const statusOptions = [
  { value: 'pending', label: 'Pending Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
  { value: 'funded', label: 'Funded' },
  { value: 'expired', label: 'Expired' },
];

// FINANCING APPLICATION FORM
function FinancingForm({ item, contacts, onSave, onClose }) {
  const [form, setForm] = useState(item || { 
    contactId: '', amount: '', term: 12, jobDescription: '', status: 'pending', apr: 0, monthlyPayment: 0 
  });
  
  // Calculate monthly payment
  const calcPayment = (amt, months, rate) => {
    if (!amt || !months) return 0;
    const principal = Number(amt);
    const monthlyRate = (rate / 100) / 12;
    if (monthlyRate === 0) return (principal / months).toFixed(2);
    return ((principal * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1)).toFixed(2);
  };

  const handleSubmit = (e) => { 
    e.preventDefault(); 
    const monthlyPayment = calcPayment(form.amount, form.term, form.apr);
    onSave({ ...form, amount: Number(form.amount), monthlyPayment: Number(monthlyPayment), createdAt: item?.createdAt || new Date().toISOString() }); 
    onClose(); 
  };
  
  const clients = contacts.filter(c => c.type === 'client' || c.type === 'lead');
  
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label="Customer" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })} options={clients.map(c => ({ value: c.id, label: c.name }))} placeholder="Select customer" required />
      <div className="grid grid-cols-3 gap-4">
        <Input label="Amount ($)" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="5000" required />
        <Select label="Term (months)" value={form.term} onChange={(e) => setForm({ ...form, term: Number(e.target.value) })} options={[
          { value: 6, label: '6 months' },
          { value: 12, label: '12 months' },
          { value: 24, label: '24 months' },
          { value: 36, label: '36 months' },
          { value: 48, label: '48 months' },
          { value: 60, label: '60 months' },
        ]} />
        <Input label="APR (%)" type="number" step="0.1" value={form.apr} onChange={(e) => setForm({ ...form, apr: Number(e.target.value) })} placeholder="0 for promo" />
      </div>
      <Input label="Job Description" value={form.jobDescription} onChange={(e) => setForm({ ...form, jobDescription: e.target.value })} placeholder="e.g. Kitchen remodel, HVAC replacement" />
      <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={statusOptions} />
      
      {form.amount && form.term && (
        <div className="p-4 bg-slate-800/50 rounded-lg">
          <p className="text-sm text-slate-400">Estimated Monthly Payment</p>
          <p className="text-2xl font-bold text-white">${calcPayment(form.amount, form.term, form.apr)}/mo</p>
          <p className="text-xs text-slate-500 mt-1">{form.term} months at {form.apr}% APR</p>
        </div>
      )}
      
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Create'}</Button></div>
    </form>
  );
}

export function FinancingPage() {
  const { instance } = useOutletContext();
  const { contacts, financingApplications = [], addFinancingApplication, updateFinancingApplication, deleteFinancingApplication, financingSettings = {} } = useCRMDataStore();
  const [activeTab, setActiveTab] = useState('applications');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const primaryColor = instance.primaryColor || '#ec7619';

  const filtered = useMemo(() => (financingApplications || []).filter(a => {
    const contact = contacts.find(c => c.id === a.contactId);
    const matchesSearch = !search || contact?.name?.toLowerCase().includes(search.toLowerCase()) || a.jobDescription?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || a.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [financingApplications, contacts, search, statusFilter]);

  const getContactName = (id) => contacts.find(c => c.id === id)?.name || '-';

  const handleSave = (data) => { editItem ? updateFinancingApplication?.(editItem.id, data) : addFinancingApplication?.(data); setEditItem(null); setShowForm(false); };
  const handleDelete = () => { deleteFinancingApplication?.(deleteTarget?.id); setDeleteTarget(null); };

  const totalFinanced = financingApplications.filter(a => a.status === 'funded').reduce((s, a) => s + (a.amount || 0), 0);
  const approvedCount = financingApplications.filter(a => a.status === 'approved').length;
  const pendingCount = financingApplications.filter(a => a.status === 'pending').length;
  const approvalRate = financingApplications.filter(a => ['approved', 'funded', 'declined'].includes(a.status)).length > 0
    ? Math.round(financingApplications.filter(a => ['approved', 'funded'].includes(a.status)).length / financingApplications.filter(a => ['approved', 'funded', 'declined'].includes(a.status)).length * 100)
    : 0;

  const statusColors = { approved: 'text-emerald-400', funded: 'text-emerald-400', pending: 'text-amber-400', declined: 'text-red-400', expired: 'text-slate-400' };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Consumer Financing</h1><p className="text-slate-400 mt-1">Offer customers payment plans via Wisetack</p></div>
        <Button onClick={() => { setEditItem(null); setShowForm(true); }} icon={Plus}>New Application</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Financed', value: '$' + totalFinanced.toLocaleString(), icon: DollarSign, color: 'text-emerald-400' },
          { label: 'Approved', value: approvedCount, icon: Check },
          { label: 'Pending', value: pendingCount, icon: Clock, color: 'text-amber-400' },
          { label: 'Approval Rate', value: approvalRate + '%', icon: TrendingUp },
        ].map((s, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className={`text-xl font-bold ${s.color || 'text-white'}`}>{s.value}</p><p className="text-sm text-slate-400">{s.label}</p></div><s.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>

      <Tabs value={activeTab} onChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="applications">Applications ({financingApplications.length})</TabsTrigger>
          <TabsTrigger value="calculator">Payment Calculator</TabsTrigger>
          <TabsTrigger value="settings">Integration</TabsTrigger>
        </TabsList>

        <TabsContent value="applications">
          <Card><CardBody className="p-4"><div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-11" /></div>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={[{ value: '', label: 'All Status' }, ...statusOptions]} className="sm:w-48" />
          </div></CardBody></Card>
          <Card className="mt-4">
            {filtered.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Customer</TableHeader><TableHeader>Amount</TableHeader><TableHeader>Term</TableHeader><TableHeader>Monthly</TableHeader><TableHeader>Job</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
                {filtered.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell className="font-medium text-white">{getContactName(app.contactId)}</TableCell>
                    <TableCell className="text-white">${app.amount?.toLocaleString()}</TableCell>
                    <TableCell className="text-slate-400">{app.term} mo</TableCell>
                    <TableCell className="text-emerald-400">${app.monthlyPayment}/mo</TableCell>
                    <TableCell className="text-slate-400 text-sm max-w-xs truncate">{app.jobDescription || '-'}</TableCell>
                    <TableCell><span className={`font-medium ${statusColors[app.status]}`}>{app.status}</span></TableCell>
                    <TableCell><div className="flex gap-1">
                      {app.status === 'pending' && <><button onClick={() => updateFinancingApplication?.(app.id, { status: 'approved' })} className="p-1.5 hover:bg-emerald-500/20 rounded text-emerald-400" title="Approve"><Check className="w-4 h-4" /></button></>}
                      {app.status === 'approved' && <button onClick={() => updateFinancingApplication?.(app.id, { status: 'funded' })} className="p-1.5 hover:bg-emerald-500/20 rounded text-emerald-400" title="Mark Funded"><DollarSign className="w-4 h-4" /></button>}
                      <button onClick={() => { setEditItem(app); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                      <button onClick={() => setDeleteTarget(app)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            ) : (<CardBody><EmptyState icon={CreditCard} title="No applications" description="Offer financing to help customers afford larger projects" action={<Button onClick={() => setShowForm(true)} icon={Plus}>New Application</Button>} /></CardBody>)}
          </Card>
        </TabsContent>

        <TabsContent value="calculator">
          <Card><CardHeader title="Payment Calculator" subtitle="Show customers their monthly payment options" /><CardBody>
            <FinancingCalculator primaryColor={primaryColor} />
          </CardBody></Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card><CardHeader title="Wisetack Integration" /><CardBody>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-10 h-10" style={{ color: primaryColor }} />
                  <div><p className="font-medium text-white">Wisetack</p><p className="text-sm text-slate-400">Consumer financing for home services</p></div>
                </div>
                <Button variant="secondary" icon={ExternalLink}>Connect</Button>
              </div>
              <p className="text-sm text-slate-400">Connect your Wisetack account to offer customers instant financing at checkout. Typical approval rates of 80%+ with decisions in seconds.</p>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-4 bg-slate-800/30 rounded-lg"><p className="text-2xl font-bold text-white">0%</p><p className="text-xs text-slate-500">Promo APR available</p></div>
                <div className="p-4 bg-slate-800/30 rounded-lg"><p className="text-2xl font-bold text-white">60 mo</p><p className="text-xs text-slate-500">Max term</p></div>
                <div className="p-4 bg-slate-800/30 rounded-lg"><p className="text-2xl font-bold text-white">$25K</p><p className="text-xs text-slate-500">Max amount</p></div>
              </div>
            </div>
          </CardBody></Card>
        </TabsContent>
      </Tabs>

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditItem(null); }} title={editItem ? 'Edit Application' : 'New Financing Application'} size="lg">
        <FinancingForm item={editItem} contacts={contacts} onSave={handleSave} onClose={() => { setShowForm(false); setEditItem(null); }} />
      </Modal>

      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete Application" message="Delete this financing application?" confirmText="Delete" variant="danger" />
    </div>
  );
}

// Simple calculator component
function FinancingCalculator({ primaryColor }) {
  const [amount, setAmount] = useState(5000);
  const [term, setTerm] = useState(24);
  const [apr, setApr] = useState(0);

  const monthlyPayment = () => {
    const principal = Number(amount);
    const monthlyRate = (apr / 100) / 12;
    if (monthlyRate === 0) return (principal / term).toFixed(2);
    return ((principal * monthlyRate * Math.pow(1 + monthlyRate, term)) / (Math.pow(1 + monthlyRate, term) - 1)).toFixed(2);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div><label className="block text-sm text-slate-400 mb-1">Loan Amount</label><Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
        <div><label className="block text-sm text-slate-400 mb-1">Term (months)</label>
          <div className="flex gap-2">
            {[12, 24, 36, 48, 60].map(t => (
              <button key={t} onClick={() => setTerm(t)} className={`px-3 py-2 rounded text-sm ${term === t ? 'text-white' : 'bg-slate-800 text-slate-400'}`} style={term === t ? { backgroundColor: primaryColor } : {}}>{t}</button>
            ))}
          </div>
        </div>
        <div><label className="block text-sm text-slate-400 mb-1">APR (%)</label><Input type="number" step="0.1" value={apr} onChange={(e) => setApr(Number(e.target.value))} /></div>
      </div>
      <div className="flex items-center justify-center">
        <div className="text-center p-6 bg-slate-800/50 rounded-xl">
          <p className="text-slate-400 text-sm">Monthly Payment</p>
          <p className="text-4xl font-bold text-white mt-2">${monthlyPayment()}</p>
          <p className="text-slate-500 text-sm mt-2">{term} months at {apr}% APR</p>
          <p className="text-slate-500 text-xs mt-1">Total: ${(Number(monthlyPayment()) * term).toFixed(2)}</p>
        </div>
      </div>
    </div>
  );
}
