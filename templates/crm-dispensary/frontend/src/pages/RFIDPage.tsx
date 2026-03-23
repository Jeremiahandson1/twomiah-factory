import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Radio, Scan, ClipboardList, History, Tag, MapPin, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const tagStatuses = [
  { value: '', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'lost', label: 'Lost' },
  { value: 'damaged', label: 'Damaged' },
];

const scanTypes = [
  { value: 'inventory_count', label: 'Inventory Count' },
  { value: 'receiving', label: 'Receiving' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'sale', label: 'Sale' },
  { value: 'audit', label: 'Audit' },
];

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-gray-100 text-gray-700',
  lost: 'bg-red-100 text-red-700',
  damaged: 'bg-amber-100 text-amber-700',
};

const tabs = [
  { id: 'tags', label: 'Tags', icon: Tag },
  { id: 'scan', label: 'Scan', icon: Scan },
  { id: 'inventory-count', label: 'Inventory Count', icon: ClipboardList },
  { id: 'history', label: 'Scan History', icon: History },
];

export default function RFIDPage() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('tags');

  return (
    <div>
      <PageHeader title="RFID Management" subtitle="Track and manage RFID tags" />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'bg-orange-500 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'tags' && <TagsTab />}
      {activeTab === 'scan' && <ScanTab />}
      {activeTab === 'inventory-count' && <InventoryCountTab />}
      {activeTab === 'history' && <ScanHistoryTab />}
    </div>
  );
}

/* ─── Tags Tab ─── */
function TagsTab() {
  const toast = useToast();
  const [tags, setTags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({ epc: '', tid: '', productId: '', batchId: '', location: '' });
  const [bulkData, setBulkData] = useState({ epcs: '', location: '', productId: '' });

  const loadTags = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (locationFilter) params.location = locationFilter;
      const data = await api.get('/api/rfid/tags', params);
      setTags(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch {
      toast.error('Failed to load RFID tags');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, locationFilter]);

  useEffect(() => { loadTags(); }, [loadTags]);
  useEffect(() => { setPage(1); }, [search, statusFilter, locationFilter]);

  const handleRegister = async () => {
    if (!formData.epc.trim()) { toast.error('EPC is required'); return; }
    setSaving(true);
    try {
      await api.post('/api/rfid/tags', formData);
      toast.success('Tag registered');
      setModalOpen(false);
      setFormData({ epc: '', tid: '', productId: '', batchId: '', location: '' });
      loadTags();
    } catch (err: any) {
      toast.error(err.message || 'Failed to register tag');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkRegister = async () => {
    const epcs = bulkData.epcs.split('\n').map(e => e.trim()).filter(Boolean);
    if (epcs.length === 0) { toast.error('Enter at least one EPC'); return; }
    setSaving(true);
    try {
      await api.post('/api/rfid/tags/bulk', { epcs, location: bulkData.location, productId: bulkData.productId || undefined });
      toast.success(`${epcs.length} tags registered`);
      setBulkModalOpen(false);
      setBulkData({ epcs: '', location: '', productId: '' });
      loadTags();
    } catch (err: any) {
      toast.error(err.message || 'Failed to bulk register');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'epc', label: 'EPC', render: (val: string) => <span className="font-mono text-sm text-gray-900">{val}</span> },
    { key: 'tid', label: 'TID', render: (val: string) => val ? <span className="font-mono text-xs text-gray-500">{val}</span> : <span className="text-gray-400">--</span> },
    { key: 'productName', label: 'Product', render: (val: string) => val || <span className="text-gray-400">Unassigned</span> },
    { key: 'batchId', label: 'Batch', render: (val: string) => val || <span className="text-gray-400">--</span> },
    { key: 'location', label: 'Location', render: (val: string) => val ? <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-gray-400" />{val}</span> : <span className="text-gray-400">--</span> },
    { key: 'status', label: 'Status', render: (val: string) => <StatusBadge status={val} statusColors={statusColors} /> },
    { key: 'lastScannedAt', label: 'Last Scanned', render: (val: string) => val ? new Date(val).toLocaleDateString() : <span className="text-gray-400">Never</span> },
  ];

  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search EPC..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500">
          {tagStatuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <input type="text" placeholder="Filter by location..." value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500" />
        <div className="flex gap-2 ml-auto">
          <Button variant="secondary" onClick={() => setBulkModalOpen(true)}>Bulk Register</Button>
          <Button onClick={() => { setFormData({ epc: '', tid: '', productId: '', batchId: '', location: '' }); setModalOpen(true); }}>
            <Plus className="w-4 h-4 mr-2 inline" />Register Tag
          </Button>
        </div>
      </div>

      <DataTable data={tags} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} emptyMessage="No RFID tags found" />

      {/* Register Tag Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Register RFID Tag" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">EPC *</label>
            <input type="text" value={formData.epc} onChange={(e) => setFormData({ ...formData, epc: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="E200001234567890" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">TID</label>
            <input type="text" value={formData.tid} onChange={(e) => setFormData({ ...formData, tid: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Product ID</label>
            <input type="text" value={formData.productId} onChange={(e) => setFormData({ ...formData, productId: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Batch ID</label>
            <input type="text" value={formData.batchId} onChange={(e) => setFormData({ ...formData, batchId: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Location</label>
            <input type="text" value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Sales Floor" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleRegister} disabled={saving}>{saving ? 'Registering...' : 'Register Tag'}</Button>
        </div>
      </Modal>

      {/* Bulk Register Modal */}
      <Modal isOpen={bulkModalOpen} onClose={() => setBulkModalOpen(false)} title="Bulk Register Tags" size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">EPCs (one per line) *</label>
            <textarea value={bulkData.epcs} onChange={(e) => setBulkData({ ...bulkData, epcs: e.target.value })} rows={8} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white font-mono text-sm focus:ring-2 focus:ring-orange-500" placeholder={"E200001234567890\nE200001234567891\nE200001234567892"} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Location</label>
            <input type="text" value={bulkData.location} onChange={(e) => setBulkData({ ...bulkData, location: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Vault" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Product ID (optional)</label>
            <input type="text" value={bulkData.productId} onChange={(e) => setBulkData({ ...bulkData, productId: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setBulkModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleBulkRegister} disabled={saving}>{saving ? 'Registering...' : 'Register All'}</Button>
        </div>
      </Modal>
    </>
  );
}

/* ─── Scan Tab ─── */
function ScanTab() {
  const toast = useToast();
  const [epc, setEpc] = useState('');
  const [scanType, setScanType] = useState('inventory_count');
  const [location, setLocation] = useState('');
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleScan = async () => {
    if (!epc.trim()) { toast.error('Enter an EPC'); return; }
    setScanning(true);
    setResult(null);
    try {
      const data = await api.post('/api/rfid/scan', { epc: epc.trim(), scanType, location: location || undefined });
      setResult(data);
      toast.success('Scan recorded');
    } catch (err: any) {
      toast.error(err.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center">
            <Radio className="w-6 h-6 text-orange-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">RFID Scanner</h2>
            <p className="text-sm text-gray-500">Enter EPC manually or connect a reader</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">EPC *</label>
            <input type="text" value={epc} onChange={(e) => setEpc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleScan()} className="w-full px-3 py-3 border border-gray-300 rounded-lg font-mono text-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900" placeholder="Scan or enter EPC..." autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Scan Type</label>
              <select value={scanType} onChange={(e) => setScanType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500">
                {scanTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500" placeholder="Sales Floor" />
            </div>
          </div>
          <Button onClick={handleScan} disabled={scanning} className="w-full" size="lg">
            <Scan className="w-5 h-5 mr-2 inline" />
            {scanning ? 'Scanning...' : 'Scan Tag'}
          </Button>
        </div>

        {/* Scan Result */}
        {result && (
          <div className={`mt-6 p-4 rounded-lg border ${result.matched ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
            <div className="flex items-center gap-2 mb-3">
              {result.matched ? <CheckCircle className="w-5 h-5 text-green-600" /> : <AlertTriangle className="w-5 h-5 text-amber-600" />}
              <span className={`font-semibold ${result.matched ? 'text-green-800' : 'text-amber-800'}`}>
                {result.matched ? 'Tag Matched' : 'Unknown Tag'}
              </span>
            </div>
            {result.matched && result.product && (
              <div className="space-y-1 text-sm">
                <p><span className="text-gray-500">Product:</span> <span className="text-gray-900 font-medium">{result.product.name}</span></p>
                {result.product.batch && <p><span className="text-gray-500">Batch:</span> <span className="text-gray-900">{result.product.batch}</span></p>}
                {result.product.location && <p><span className="text-gray-500">Location:</span> <span className="text-gray-900">{result.product.location}</span></p>}
                {result.product.strain && <p><span className="text-gray-500">Strain:</span> <span className="text-gray-900">{result.product.strain}</span></p>}
              </div>
            )}
            {!result.matched && (
              <p className="text-sm text-amber-700">This EPC is not registered in the system. Register it in the Tags tab.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Inventory Count Tab ─── */
function InventoryCountTab() {
  const toast = useToast();
  const [location, setLocation] = useState('');
  const [epcInput, setEpcInput] = useState('');
  const [scannedEpcs, setScannedEpcs] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<any>(null);

  const addEpc = () => {
    const epc = epcInput.trim();
    if (!epc) return;
    if (scannedEpcs.includes(epc)) { toast.error('EPC already scanned'); return; }
    setScannedEpcs(prev => [...prev, epc]);
    setEpcInput('');
  };

  const removeEpc = (epc: string) => {
    setScannedEpcs(prev => prev.filter(e => e !== epc));
  };

  const handleSubmit = async () => {
    if (!location.trim()) { toast.error('Select a location'); return; }
    if (scannedEpcs.length === 0) { toast.error('Scan at least one tag'); return; }
    setSubmitting(true);
    try {
      const data = await api.post('/api/rfid/scan/bulk', { epcs: scannedEpcs, location, scanType: 'inventory_count' });
      setResults(data);
      toast.success('Inventory count submitted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit count');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAccept = async () => {
    if (!results) return;
    try {
      await api.post('/api/rfid/inventory-count/accept', { location, scannedEpcs, results });
      toast.success('Inventory count accepted');
      setScannedEpcs([]);
      setResults(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to accept count');
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Bulk Inventory Count</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location *</label>
            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900" placeholder="Vault, Sales Floor, etc." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Scan EPCs</label>
            <div className="flex gap-2">
              <input type="text" value={epcInput} onChange={(e) => setEpcInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEpc()} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900" placeholder="Scan or enter EPC..." />
              <Button onClick={addEpc} variant="secondary">Add</Button>
            </div>
          </div>
        </div>

        {/* Scanned Tags */}
        {scannedEpcs.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Scanned Tags ({scannedEpcs.length})</span>
              <button onClick={() => setScannedEpcs([])} className="text-xs text-red-600 hover:text-red-800">Clear All</button>
            </div>
            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y">
              {scannedEpcs.map((epc, i) => (
                <div key={epc} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50">
                  <span className="font-mono text-sm text-gray-700">{epc}</span>
                  <button onClick={() => removeEpc(epc)} className="text-gray-400 hover:text-red-600"><XCircle className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4">
          <Button onClick={handleSubmit} disabled={submitting} className="w-full">
            {submitting ? 'Submitting...' : `Submit Count (${scannedEpcs.length} tags)`}
          </Button>
        </div>
      </div>

      {/* Results */}
      {results && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Count Results</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="p-4 bg-green-50 rounded-lg text-center">
              <p className="text-2xl font-bold text-green-700">{results.matched || 0}</p>
              <p className="text-sm text-green-600">Matched</p>
            </div>
            <div className="p-4 bg-amber-50 rounded-lg text-center">
              <p className="text-2xl font-bold text-amber-700">{results.unmatched || 0}</p>
              <p className="text-sm text-amber-600">Unmatched</p>
            </div>
            <div className="p-4 bg-red-50 rounded-lg text-center">
              <p className="text-2xl font-bold text-red-700">{results.missing || 0}</p>
              <p className="text-sm text-red-600">Missing (Shrinkage)</p>
            </div>
          </div>

          {results.missingTags && results.missingTags.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Missing Tags (Expected but not scanned)</p>
              <div className="max-h-32 overflow-y-auto border border-red-200 rounded-lg bg-red-50 p-3">
                {results.missingTags.map((tag: any) => (
                  <div key={tag.epc} className="flex items-center gap-2 text-sm text-red-700 py-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span className="font-mono">{tag.epc}</span>
                    {tag.productName && <span className="text-red-500">({tag.productName})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button onClick={handleAccept} className="w-full">
            <CheckCircle className="w-4 h-4 mr-2 inline" />
            Accept Count
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─── Scan History Tab ─── */
function ScanHistoryTab() {
  const toast = useToast();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [tagFilter, setTagFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (tagFilter) params.tag = tagFilter;
      if (locationFilter) params.location = locationFilter;
      if (typeFilter) params.scanType = typeFilter;
      const data = await api.get('/api/rfid/scan-log', params);
      setLogs(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch {
      toast.error('Failed to load scan history');
    } finally {
      setLoading(false);
    }
  }, [page, tagFilter, locationFilter, typeFilter]);

  useEffect(() => { loadLogs(); }, [loadLogs]);
  useEffect(() => { setPage(1); }, [tagFilter, locationFilter, typeFilter]);

  const columns = [
    { key: 'epc', label: 'EPC', render: (val: string) => <span className="font-mono text-sm text-gray-900">{val}</span> },
    { key: 'scanType', label: 'Type', render: (val: string) => <StatusBadge status={val} statusColors={{ inventory_count: 'bg-blue-100 text-blue-700', receiving: 'bg-green-100 text-green-700', transfer: 'bg-purple-100 text-purple-700', sale: 'bg-orange-100 text-orange-700', audit: 'bg-gray-100 text-gray-700' }} /> },
    { key: 'location', label: 'Location', render: (val: string) => val || <span className="text-gray-400">--</span> },
    { key: 'productName', label: 'Product', render: (val: string) => val || <span className="text-gray-400">--</span> },
    { key: 'scannedBy', label: 'Scanned By', render: (val: string) => val || <span className="text-gray-400">--</span> },
    { key: 'createdAt', label: 'Timestamp', render: (val: string) => val ? new Date(val).toLocaleString() : '--' },
  ];

  return (
    <>
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" placeholder="Filter by EPC..." value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500 font-mono" />
        <input type="text" placeholder="Filter by location..." value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500" />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500">
          <option value="">All Types</option>
          {scanTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <DataTable data={logs} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} emptyMessage="No scan history" />
    </>
  );
}
