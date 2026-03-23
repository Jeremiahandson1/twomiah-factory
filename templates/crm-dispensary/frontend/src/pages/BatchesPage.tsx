import { useState, useEffect } from 'react';
import { Layers, Plus, Search, AlertTriangle, ArrowLeft, Shield, Trash2, Clock, FlaskConical, ChevronDown } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

const BATCH_STATUSES = ['active', 'quarantine', 'depleted', 'recalled', 'expired'];

const statusBadge: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  quarantine: 'bg-yellow-100 text-yellow-700',
  depleted: 'bg-gray-100 text-gray-500',
  recalled: 'bg-red-100 text-red-700',
  expired: 'bg-orange-100 text-orange-700',
};

const initialBatchForm = {
  batchNumber: '',
  productId: '',
  productName: '',
  strain: '',
  quantity: '',
  unit: 'grams',
  thcPercent: '',
  cbdPercent: '',
  harvestDate: '',
  packageDate: '',
  expirationDate: '',
  labTestId: '',
  metrcTag: '',
  grower: '',
  notes: '',
};

export default function BatchesPage() {
  const { isManager } = useAuth();
  const toast = useToast();

  // List
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Create/Edit
  const [batchModal, setBatchModal] = useState(false);
  const [editingBatch, setEditingBatch] = useState<any>(null);
  const [batchForm, setBatchForm] = useState(initialBatchForm);
  const [savingBatch, setSavingBatch] = useState(false);
  const [products, setProducts] = useState<any[]>([]);

  // Detail view
  const [viewingBatch, setViewingBatch] = useState<any>(null);
  const [batchDetail, setBatchDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Expiring batches
  const [expiringBatches, setExpiringBatches] = useState<any[]>([]);

  // Quick actions
  const [actionConfirmOpen, setActionConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ batchId: string; action: string; label: string } | null>(null);
  const [performingAction, setPerformingAction] = useState(false);

  useEffect(() => {
    loadBatches();
    loadExpiringBatches();
  }, [page, statusFilter, productFilter]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      setPage(1);
      loadBatches();
    }, 300);
    return () => clearTimeout(debounce);
  }, [search]);

  const loadBatches = async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (productFilter) params.productId = productFilter;
      const data = await api.get('/api/batches', params);
      setBatches(Array.isArray(data) ? data : data?.data || []);
      setTotal(data?.total || 0);
    } catch (err) {
      console.error('Failed to load batches:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadExpiringBatches = async () => {
    try {
      const data = await api.get('/api/batches/expiring');
      setExpiringBatches(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load expiring batches:', err);
    }
  };

  const loadProducts = async () => {
    try {
      const data = await api.get('/api/products', { limit: 200 });
      setProducts(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load products:', err);
    }
  };

  const openCreateBatch = async () => {
    setEditingBatch(null);
    setBatchForm(initialBatchForm);
    setBatchModal(true);
    await loadProducts();
  };

  const openEditBatch = async (batch: any) => {
    setEditingBatch(batch);
    setBatchForm({
      batchNumber: batch.batchNumber || '',
      productId: batch.productId || '',
      productName: batch.productName || '',
      strain: batch.strain || '',
      quantity: String(batch.quantity || ''),
      unit: batch.unit || 'grams',
      thcPercent: String(batch.thcPercent ?? ''),
      cbdPercent: String(batch.cbdPercent ?? ''),
      harvestDate: batch.harvestDate ? batch.harvestDate.slice(0, 10) : '',
      packageDate: batch.packageDate ? batch.packageDate.slice(0, 10) : '',
      expirationDate: batch.expirationDate ? batch.expirationDate.slice(0, 10) : '',
      labTestId: batch.labTestId || '',
      metrcTag: batch.metrcTag || '',
      grower: batch.grower || '',
      notes: batch.notes || '',
    });
    setBatchModal(true);
    await loadProducts();
  };

  const handleSaveBatch = async () => {
    if (!batchForm.batchNumber.trim()) {
      toast.error('Batch number is required');
      return;
    }
    setSavingBatch(true);
    try {
      const payload = {
        ...batchForm,
        quantity: parseFloat(batchForm.quantity) || 0,
        thcPercent: batchForm.thcPercent ? parseFloat(batchForm.thcPercent) : null,
        cbdPercent: batchForm.cbdPercent ? parseFloat(batchForm.cbdPercent) : null,
      };
      if (editingBatch) {
        await api.put(`/api/batches/${editingBatch.id}`, payload);
        toast.success('Batch updated');
      } else {
        await api.post('/api/batches', payload);
        toast.success('Batch created');
      }
      setBatchModal(false);
      loadBatches();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save batch');
    } finally {
      setSavingBatch(false);
    }
  };

  const viewBatchDetail = async (batch: any) => {
    setViewingBatch(batch);
    setLoadingDetail(true);
    try {
      const data = await api.get(`/api/batches/${batch.id}`);
      setBatchDetail(data);
    } catch (err) {
      console.error('Failed to load batch detail:', err);
      setBatchDetail(batch);
    } finally {
      setLoadingDetail(false);
    }
  };

  const confirmAction = (batchId: string, action: string, label: string) => {
    setPendingAction({ batchId, action, label });
    setActionConfirmOpen(true);
  };

  const executeAction = async () => {
    if (!pendingAction) return;
    setPerformingAction(true);
    try {
      await api.post(`/api/batches/${pendingAction.batchId}/${pendingAction.action}`);
      toast.success(`Batch ${pendingAction.label.toLowerCase()}d`);
      setActionConfirmOpen(false);
      setPendingAction(null);
      loadBatches();
      loadExpiringBatches();
      if (viewingBatch?.id === pendingAction.batchId) {
        viewBatchDetail(viewingBatch);
      }
    } catch (err: any) {
      toast.error(err.message || `Failed to ${pendingAction.label.toLowerCase()} batch`);
    } finally {
      setPerformingAction(false);
    }
  };

  // Detail view
  if (viewingBatch) {
    const detail = batchDetail || viewingBatch;
    return (
      <div>
        <button
          onClick={() => { setViewingBatch(null); setBatchDetail(null); }}
          className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Batches
        </button>

        {loadingDetail ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Batch {detail.batchNumber}</h1>
                <p className="text-gray-600">{detail.productName || 'Unknown Product'}</p>
              </div>
              <span className={`px-3 py-1 text-sm font-medium rounded-full ${statusBadge[detail.status] || 'bg-gray-100 text-gray-600'}`}>
                {detail.status || 'unknown'}
              </span>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Product Info */}
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Batch Information</h3>
                <dl className="space-y-3">
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Batch Number</dt>
                    <dd className="text-sm font-mono text-gray-900">{detail.batchNumber}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Product</dt>
                    <dd className="text-sm text-gray-900">{detail.productName || '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Strain</dt>
                    <dd className="text-sm text-gray-900">{detail.strain || '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Quantity</dt>
                    <dd className="text-sm text-gray-900">{detail.quantity} {detail.unit}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">THC</dt>
                    <dd className="text-sm text-gray-900">{detail.thcPercent != null ? `${detail.thcPercent}%` : '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">CBD</dt>
                    <dd className="text-sm text-gray-900">{detail.cbdPercent != null ? `${detail.cbdPercent}%` : '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Grower</dt>
                    <dd className="text-sm text-gray-900">{detail.grower || '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Metrc Tag</dt>
                    <dd className="text-sm font-mono text-gray-900">{detail.metrcTag || '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Harvest Date</dt>
                    <dd className="text-sm text-gray-900">{detail.harvestDate ? new Date(detail.harvestDate).toLocaleDateString() : '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Package Date</dt>
                    <dd className="text-sm text-gray-900">{detail.packageDate ? new Date(detail.packageDate).toLocaleDateString() : '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Expiration</dt>
                    <dd className="text-sm text-gray-900">{detail.expirationDate ? new Date(detail.expirationDate).toLocaleDateString() : '—'}</dd>
                  </div>
                </dl>
              </div>

              {/* Quick Actions + Lab Test */}
              <div className="space-y-6">
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h3 className="font-semibold text-gray-900 mb-4">Quick Actions</h3>
                  <div className="flex flex-wrap gap-2">
                    {detail.status === 'active' && (
                      <>
                        <Button variant="secondary" size="sm" onClick={() => confirmAction(detail.id, 'quarantine', 'Quarantine')}>
                          <Shield className="w-4 h-4 mr-1 inline" /> Quarantine
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => confirmAction(detail.id, 'deplete', 'Deplete')}>
                          <Trash2 className="w-4 h-4 mr-1 inline" /> Deplete
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => confirmAction(detail.id, 'recall', 'Recall')}>
                          <AlertTriangle className="w-4 h-4 mr-1 inline" /> Recall
                        </Button>
                      </>
                    )}
                    {detail.status === 'quarantine' && (
                      <>
                        <Button variant="secondary" size="sm" onClick={() => confirmAction(detail.id, 'activate', 'Activate')}>
                          Release
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => confirmAction(detail.id, 'recall', 'Recall')}>
                          <AlertTriangle className="w-4 h-4 mr-1 inline" /> Recall
                        </Button>
                      </>
                    )}
                    {(detail.status === 'depleted' || detail.status === 'expired' || detail.status === 'recalled') && (
                      <p className="text-sm text-gray-500">No actions available for {detail.status} batches.</p>
                    )}
                  </div>
                </div>

                {/* Lab Test Link */}
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <FlaskConical className="w-5 h-5 text-purple-600" /> Lab Test
                  </h3>
                  {detail.labTestId ? (
                    <div className="space-y-2">
                      <p className="text-sm text-gray-600">Test ID: <span className="font-mono">{detail.labTestId}</span></p>
                      {detail.labTestStatus && (
                        <span className={`px-2 py-0.5 text-xs rounded-full ${
                          detail.labTestStatus === 'passed' ? 'bg-green-100 text-green-700' :
                          detail.labTestStatus === 'failed' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {detail.labTestStatus}
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No lab test linked</p>
                  )}
                </div>
              </div>
            </div>

            {/* Status History */}
            {detail.statusHistory && detail.statusHistory.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-600" /> Status History
                </h3>
                <div className="space-y-3">
                  {detail.statusHistory.map((entry: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-4 text-sm">
                      <span className="text-gray-500 w-40">{entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '—'}</span>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${statusBadge[entry.status] || 'bg-gray-100 text-gray-600'}`}>
                        {entry.status}
                      </span>
                      <span className="text-gray-600">{entry.note || entry.user || ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Inventory Adjustments */}
            {detail.adjustments && detail.adjustments.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Inventory Adjustments</h3>
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Quantity</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {detail.adjustments.map((adj: any, idx: number) => (
                      <tr key={idx}>
                        <td className="px-4 py-2 text-sm text-gray-500">{adj.date ? new Date(adj.date).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{adj.type}</td>
                        <td className={`px-4 py-2 text-sm text-right font-medium ${adj.quantity < 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {adj.quantity > 0 ? '+' : ''}{adj.quantity}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-600">{adj.reason || '—'}</td>
                        <td className="px-4 py-2 text-sm text-gray-500">{adj.user || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {detail.notes && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="font-semibold text-gray-900 mb-2">Notes</h3>
                <p className="text-sm text-gray-600">{detail.notes}</p>
              </div>
            )}
          </div>
        )}

        <ConfirmModal
          isOpen={actionConfirmOpen}
          onClose={() => { setActionConfirmOpen(false); setPendingAction(null); }}
          onConfirm={executeAction}
          title={`${pendingAction?.label} Batch`}
          message={`Are you sure you want to ${pendingAction?.label.toLowerCase()} batch ${viewingBatch?.batchNumber}?`}
          confirmText={pendingAction?.label || 'Confirm'}
        />
      </div>
    );
  }

  // List view
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Batches</h1>
          <p className="text-gray-600">Batch and lot lifecycle management</p>
        </div>
        <Button onClick={openCreateBatch}>
          <Plus className="w-4 h-4 mr-2 inline" />
          New Batch
        </Button>
      </div>

      {/* Expiring Alert */}
      {expiringBatches.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-orange-600" />
            <h3 className="font-semibold text-orange-800">Expiring Batches</h3>
          </div>
          <div className="space-y-1">
            {expiringBatches.slice(0, 5).map(b => (
              <p key={b.id} className="text-sm text-orange-700">
                <span className="font-mono">{b.batchNumber}</span> ({b.productName}) expires {b.expirationDate ? new Date(b.expirationDate).toLocaleDateString() : 'soon'}
              </p>
            ))}
            {expiringBatches.length > 5 && (
              <p className="text-sm text-orange-600">+{expiringBatches.length - 5} more</p>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search batches..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
        >
          <option value="">All Statuses</option>
          {BATCH_STATUSES.map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Batches Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Batch #</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Strain</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Quantity</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">THC %</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Expiration</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center">
                    <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  </td>
                </tr>
              ) : batches.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    {search || statusFilter ? 'No batches match your filters' : 'No batches created yet'}
                  </td>
                </tr>
              ) : batches.map(batch => (
                <tr key={batch.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => viewBatchDetail(batch)}>
                  <td className="px-4 py-3 text-sm font-mono font-medium text-gray-900">{batch.batchNumber}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{batch.productName || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{batch.strain || '—'}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-900">{batch.quantity} {batch.unit || ''}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600">{batch.thcPercent != null ? `${batch.thcPercent}%` : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusBadge[batch.status] || 'bg-gray-100 text-gray-600'}`}>
                      {batch.status || 'unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {batch.expirationDate ? new Date(batch.expirationDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-2">
                      {batch.status === 'active' && (
                        <>
                          <button onClick={() => confirmAction(batch.id, 'quarantine', 'Quarantine')} className="text-xs text-yellow-600 hover:text-yellow-700">Quarantine</button>
                          <button onClick={() => confirmAction(batch.id, 'deplete', 'Deplete')} className="text-xs text-gray-600 hover:text-gray-900">Deplete</button>
                          <button onClick={() => confirmAction(batch.id, 'recall', 'Recall')} className="text-xs text-red-600 hover:text-red-700">Recall</button>
                        </>
                      )}
                      {batch.status === 'quarantine' && (
                        <button onClick={() => confirmAction(batch.id, 'activate', 'Activate')} className="text-xs text-green-600 hover:text-green-700">Release</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > 25 && (
          <div className="px-4 py-3 border-t flex items-center justify-between">
            <span className="text-sm text-gray-500">
              Page {page} of {Math.ceil(total / 25)} ({total} total)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50 hover:bg-gray-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page >= Math.ceil(total / 25)}
                className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Batch Modal */}
      <Modal
        isOpen={batchModal}
        onClose={() => setBatchModal(false)}
        title={editingBatch ? 'Edit Batch' : 'New Batch'}
        size="lg"
      >
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Batch Number *</label>
              <input
                type="text"
                value={batchForm.batchNumber}
                onChange={(e) => setBatchForm({ ...batchForm, batchNumber: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
                placeholder="BATCH-2026-001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Product</label>
              <select
                value={batchForm.productId}
                onChange={(e) => {
                  const product = products.find(p => p.id === e.target.value);
                  setBatchForm({
                    ...batchForm,
                    productId: e.target.value,
                    productName: product?.name || '',
                    strain: product?.strain || batchForm.strain,
                  });
                }}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              >
                <option value="">Select product</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Strain</label>
              <input
                type="text"
                value={batchForm.strain}
                onChange={(e) => setBatchForm({ ...batchForm, strain: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Grower / Cultivator</label>
              <input
                type="text"
                value={batchForm.grower}
                onChange={(e) => setBatchForm({ ...batchForm, grower: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Quantity</label>
              <input
                type="number"
                step="0.01"
                value={batchForm.quantity}
                onChange={(e) => setBatchForm({ ...batchForm, quantity: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Unit</label>
              <select
                value={batchForm.unit}
                onChange={(e) => setBatchForm({ ...batchForm, unit: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              >
                <option value="grams">Grams</option>
                <option value="ounces">Ounces</option>
                <option value="pounds">Pounds</option>
                <option value="units">Units</option>
                <option value="ml">Milliliters</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Metrc Tag</label>
              <input
                type="text"
                value={batchForm.metrcTag}
                onChange={(e) => setBatchForm({ ...batchForm, metrcTag: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">THC %</label>
              <input
                type="number"
                step="0.01"
                value={batchForm.thcPercent}
                onChange={(e) => setBatchForm({ ...batchForm, thcPercent: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">CBD %</label>
              <input
                type="number"
                step="0.01"
                value={batchForm.cbdPercent}
                onChange={(e) => setBatchForm({ ...batchForm, cbdPercent: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Harvest Date</label>
              <input
                type="date"
                value={batchForm.harvestDate}
                onChange={(e) => setBatchForm({ ...batchForm, harvestDate: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Package Date</label>
              <input
                type="date"
                value={batchForm.packageDate}
                onChange={(e) => setBatchForm({ ...batchForm, packageDate: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Expiration Date</label>
              <input
                type="date"
                value={batchForm.expirationDate}
                onChange={(e) => setBatchForm({ ...batchForm, expirationDate: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Lab Test ID</label>
            <input
              type="text"
              value={batchForm.labTestId}
              onChange={(e) => setBatchForm({ ...batchForm, labTestId: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
            <textarea
              value={batchForm.notes}
              onChange={(e) => setBatchForm({ ...batchForm, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setBatchModal(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleSaveBatch} disabled={savingBatch}>
            {savingBatch ? 'Saving...' : editingBatch ? 'Update' : 'Create'}
          </Button>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={actionConfirmOpen}
        onClose={() => { setActionConfirmOpen(false); setPendingAction(null); }}
        onConfirm={executeAction}
        title={`${pendingAction?.label} Batch`}
        message={`Are you sure you want to ${pendingAction?.label.toLowerCase()} this batch?`}
        confirmText={pendingAction?.label || 'Confirm'}
      />
    </div>
  );
}
