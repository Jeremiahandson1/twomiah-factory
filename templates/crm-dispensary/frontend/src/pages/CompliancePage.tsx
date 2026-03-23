import { useState, useEffect } from 'react';
import { ShieldCheck, FileText, Trash2, Plus, Edit, AlertTriangle, CheckCircle, Clock, Save, Send } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

const LICENSE_TYPES = [
  'Retail',
  'Cultivation',
  'Manufacturing',
  'Distribution',
  'Testing',
  'Microbusiness',
  'Delivery',
];

const REPORT_TYPES = [
  { value: 'sales_tax', label: 'Sales Tax Report' },
  { value: 'excise_tax', label: 'Excise Tax Report' },
  { value: 'inventory_summary', label: 'Inventory Summary' },
  { value: 'waste_disposal', label: 'Waste Disposal Report' },
  { value: 'track_trace', label: 'Track & Trace Report' },
  { value: 'patient_count', label: 'Patient Count Report' },
  { value: 'diversion_prevention', label: 'Diversion Prevention' },
];

const WASTE_TYPES = ['Plant Material', 'Trim', 'Stems', 'Expired Product', 'Contaminated', 'Damaged', 'Other'];
const WASTE_METHODS = ['Composting', 'Incineration', 'Rendering', 'Landfill', 'Other'];
const WASTE_REASONS = ['Expired', 'Failed Lab Test', 'Contamination', 'Damaged', 'Overstock', 'Recall', 'Other'];

const initialLicenseForm = {
  type: 'Retail',
  licenseNumber: '',
  issuedBy: '',
  issuedDate: '',
  expirationDate: '',
  status: 'active',
  notes: '',
};

const initialWasteForm = {
  productId: '',
  productName: '',
  batchNumber: '',
  wasteType: 'Plant Material',
  quantity: '',
  unit: 'grams',
  reason: 'Expired',
  method: 'Composting',
  witness: '',
  notes: '',
};

export default function CompliancePage() {
  const { isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('licenses');

  // Licenses
  const [licenses, setLicenses] = useState<any[]>([]);
  const [loadingLicenses, setLoadingLicenses] = useState(false);
  const [licenseModal, setLicenseModal] = useState(false);
  const [editingLicense, setEditingLicense] = useState<any>(null);
  const [licenseForm, setLicenseForm] = useState(initialLicenseForm);
  const [savingLicense, setSavingLicense] = useState(false);
  const [deleteLicenseOpen, setDeleteLicenseOpen] = useState(false);
  const [licenseToDelete, setLicenseToDelete] = useState<any>(null);
  const [deletingLicense, setDeletingLicense] = useState(false);

  // Reports
  const [reports, setReports] = useState<any[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [reportType, setReportType] = useState('sales_tax');
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const [generatingReport, setGeneratingReport] = useState(false);
  const [viewingReport, setViewingReport] = useState<any>(null);

  // Waste
  const [wasteEntries, setWasteEntries] = useState<any[]>([]);
  const [loadingWaste, setLoadingWaste] = useState(false);
  const [wasteModal, setWasteModal] = useState(false);
  const [wasteForm, setWasteForm] = useState(initialWasteForm);
  const [savingWaste, setSavingWaste] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [reportingToMetrc, setReportingToMetrc] = useState<string | null>(null);

  useEffect(() => {
    loadLicenses();
  }, []);

  useEffect(() => {
    if (tab === 'reports') loadReports();
    if (tab === 'waste') { loadWaste(); loadProducts(); }
  }, [tab]);

  const loadLicenses = async () => {
    setLoadingLicenses(true);
    try {
      const data = await api.get('/api/compliance/licenses');
      setLicenses(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load licenses:', err);
    } finally {
      setLoadingLicenses(false);
    }
  };

  const loadReports = async () => {
    setLoadingReports(true);
    try {
      const data = await api.get('/api/compliance/reports');
      setReports(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoadingReports(false);
    }
  };

  const loadWaste = async () => {
    setLoadingWaste(true);
    try {
      const data = await api.get('/api/compliance/waste');
      setWasteEntries(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load waste entries:', err);
    } finally {
      setLoadingWaste(false);
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

  // License CRUD
  const openCreateLicense = () => {
    setEditingLicense(null);
    setLicenseForm(initialLicenseForm);
    setLicenseModal(true);
  };

  const openEditLicense = (license: any) => {
    setEditingLicense(license);
    setLicenseForm({
      type: license.type || 'Retail',
      licenseNumber: license.licenseNumber || '',
      issuedBy: license.issuedBy || '',
      issuedDate: license.issuedDate ? license.issuedDate.slice(0, 10) : '',
      expirationDate: license.expirationDate ? license.expirationDate.slice(0, 10) : '',
      status: license.status || 'active',
      notes: license.notes || '',
    });
    setLicenseModal(true);
  };

  const handleSaveLicense = async () => {
    if (!licenseForm.licenseNumber.trim()) {
      toast.error('License number is required');
      return;
    }
    setSavingLicense(true);
    try {
      if (editingLicense) {
        await api.put(`/api/compliance/licenses/${editingLicense.id}`, licenseForm);
        toast.success('License updated');
      } else {
        await api.post('/api/compliance/licenses', licenseForm);
        toast.success('License created');
      }
      setLicenseModal(false);
      loadLicenses();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save license');
    } finally {
      setSavingLicense(false);
    }
  };

  const handleDeleteLicense = async () => {
    if (!licenseToDelete) return;
    setDeletingLicense(true);
    try {
      await api.delete(`/api/compliance/licenses/${licenseToDelete.id}`);
      toast.success('License deleted');
      setDeleteLicenseOpen(false);
      setLicenseToDelete(null);
      loadLicenses();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete license');
    } finally {
      setDeletingLicense(false);
    }
  };

  // Reports
  const generateReport = async () => {
    if (!reportStartDate || !reportEndDate) {
      toast.error('Select a date range');
      return;
    }
    setGeneratingReport(true);
    try {
      await api.post('/api/compliance/reports', {
        type: reportType,
        startDate: reportStartDate,
        endDate: reportEndDate,
      });
      toast.success('Report generated');
      loadReports();
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate report');
    } finally {
      setGeneratingReport(false);
    }
  };

  const submitReport = async (reportId: string) => {
    try {
      await api.post(`/api/compliance/reports/${reportId}/submit`);
      toast.success('Report submitted');
      loadReports();
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit report');
    }
  };

  // Waste
  const handleSaveWaste = async () => {
    if (!wasteForm.productName && !wasteForm.productId) {
      toast.error('Select a product');
      return;
    }
    if (!wasteForm.quantity) {
      toast.error('Quantity is required');
      return;
    }
    setSavingWaste(true);
    try {
      await api.post('/api/compliance/waste', {
        ...wasteForm,
        quantity: parseFloat(wasteForm.quantity) || 0,
      });
      toast.success('Waste entry recorded');
      setWasteModal(false);
      setWasteForm(initialWasteForm);
      loadWaste();
    } catch (err: any) {
      toast.error(err.message || 'Failed to record waste');
    } finally {
      setSavingWaste(false);
    }
  };

  const reportWasteToMetrc = async (wasteId: string) => {
    setReportingToMetrc(wasteId);
    try {
      await api.post(`/api/compliance/waste/${wasteId}/report-metrc`);
      toast.success('Reported to Metrc');
      loadWaste();
    } catch (err: any) {
      toast.error(err.message || 'Failed to report to Metrc');
    } finally {
      setReportingToMetrc(null);
    }
  };

  // Helpers
  const daysUntilExpiration = (dateStr: string) => {
    if (!dateStr) return Infinity;
    const exp = new Date(dateStr);
    const now = new Date();
    return Math.ceil((exp.getTime() - now.getTime()) / 86400000);
  };

  const licenseStatusBadge = (license: any) => {
    const days = daysUntilExpiration(license.expirationDate);
    if (license.status === 'expired' || days < 0) return 'bg-red-100 text-red-700';
    if (license.status === 'suspended') return 'bg-red-100 text-red-700';
    if (days <= 60) return 'bg-yellow-100 text-yellow-700';
    return 'bg-green-100 text-green-700';
  };

  const licenseStatusText = (license: any) => {
    const days = daysUntilExpiration(license.expirationDate);
    if (license.status === 'expired' || days < 0) return 'Expired';
    if (license.status === 'suspended') return 'Suspended';
    if (days <= 60) return `Expiring (${days}d)`;
    return 'Active';
  };

  const expiringLicenses = licenses.filter(l => {
    const days = daysUntilExpiration(l.expirationDate);
    return days > 0 && days <= 60;
  });

  const tabs = [
    { id: 'licenses', label: 'Licenses', icon: ShieldCheck },
    { id: 'reports', label: 'Reports', icon: FileText },
    { id: 'waste', label: 'Waste Log', icon: Trash2 },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance</h1>
          <p className="text-gray-600">Licenses, reports, and waste tracking</p>
        </div>
      </div>

      {/* Expiring Licenses Alert */}
      {expiringLicenses.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-yellow-600" />
            <h3 className="font-semibold text-yellow-800">Licenses Expiring Soon</h3>
          </div>
          <div className="space-y-1">
            {expiringLicenses.map(l => (
              <p key={l.id} className="text-sm text-yellow-700">
                <span className="font-medium">{l.type}</span> ({l.licenseNumber}) expires in {daysUntilExpiration(l.expirationDate)} days
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Licenses Tab */}
      {tab === 'licenses' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={openCreateLicense}>
              <Plus className="w-4 h-4 mr-2 inline" />
              Add License
            </Button>
          </div>
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">License #</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Issued By</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Issued</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Expires</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loadingLicenses ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center">
                      <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
                    </td>
                  </tr>
                ) : licenses.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">No licenses added yet</td>
                  </tr>
                ) : licenses.map(license => (
                  <tr key={license.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{license.type}</td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-900">{license.licenseNumber}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{license.issuedBy || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {license.issuedDate ? new Date(license.issuedDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {license.expirationDate ? new Date(license.expirationDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${licenseStatusBadge(license)}`}>
                        {licenseStatusText(license)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => openEditLicense(license)} className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
                          <Edit className="w-3 h-3" /> Edit
                        </button>
                        <button onClick={() => { setLicenseToDelete(license); setDeleteLicenseOpen(true); }} className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1">
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reports Tab */}
      {tab === 'reports' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm p-6 max-w-2xl">
            <h3 className="font-semibold text-gray-900 mb-4">Generate Report</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Report Type</label>
                <select
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                >
                  {REPORT_TYPES.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={reportStartDate}
                  onChange={(e) => setReportStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={reportEndDate}
                  onChange={(e) => setReportEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
            </div>
            <Button onClick={generateReport} disabled={generatingReport}>
              {generatingReport ? 'Generating...' : 'Generate Report'}
            </Button>
          </div>

          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date Generated</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loadingReports ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center">
                      <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
                    </td>
                  </tr>
                ) : reports.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">No reports generated yet</td>
                  </tr>
                ) : reports.map(report => (
                  <tr key={report.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {report.createdAt ? new Date(report.createdAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {REPORT_TYPES.find(r => r.value === report.type)?.label || report.type}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {report.startDate ? new Date(report.startDate).toLocaleDateString() : '—'} - {report.endDate ? new Date(report.endDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                        report.status === 'submitted' ? 'bg-green-100 text-green-700' :
                        report.status === 'draft' ? 'bg-gray-100 text-gray-600' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {report.status || 'draft'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => setViewingReport(report)} className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
                          <FileText className="w-3 h-3" /> View
                        </button>
                        {report.status !== 'submitted' && (
                          <button onClick={() => submitReport(report.id)} className="text-sm text-green-600 hover:text-green-700 flex items-center gap-1">
                            <Send className="w-3 h-3" /> Submit
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Waste Log Tab */}
      {tab === 'waste' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={() => { setWasteForm(initialWasteForm); setWasteModal(true); }}>
              <Plus className="w-4 h-4 mr-2 inline" />
              Log Waste
            </Button>
          </div>
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Batch</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Quantity</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Witness</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Metrc</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingWaste ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center">
                        <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : wasteEntries.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-gray-500">No waste entries recorded</td>
                    </tr>
                  ) : wasteEntries.map(entry => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">{entry.productName || '—'}</td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-600">{entry.batchNumber || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{entry.wasteType || '—'}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900">
                        {entry.quantity} {entry.unit}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{entry.reason || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{entry.method || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{entry.witness || '—'}</td>
                      <td className="px-4 py-3">
                        {entry.metrcReported ? (
                          <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">Reported</span>
                        ) : (
                          <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">Pending</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {!entry.metrcReported && (
                          <button
                            onClick={() => reportWasteToMetrc(entry.id)}
                            disabled={reportingToMetrc === entry.id}
                            className="text-sm text-green-600 hover:text-green-700 flex items-center gap-1 disabled:opacity-50"
                          >
                            <Send className="w-3 h-3" />
                            {reportingToMetrc === entry.id ? 'Reporting...' : 'Report to Metrc'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* License Modal */}
      <Modal
        isOpen={licenseModal}
        onClose={() => setLicenseModal(false)}
        title={editingLicense ? 'Edit License' : 'Add License'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">License Type *</label>
            <select
              value={licenseForm.type}
              onChange={(e) => setLicenseForm({ ...licenseForm, type: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
            >
              {LICENSE_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">License Number *</label>
            <input
              type="text"
              value={licenseForm.licenseNumber}
              onChange={(e) => setLicenseForm({ ...licenseForm, licenseNumber: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              placeholder="e.g., C10-0000001-LIC"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Issued By</label>
            <input
              type="text"
              value={licenseForm.issuedBy}
              onChange={(e) => setLicenseForm({ ...licenseForm, issuedBy: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              placeholder="e.g., Bureau of Cannabis Control"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Issued Date</label>
              <input
                type="date"
                value={licenseForm.issuedDate}
                onChange={(e) => setLicenseForm({ ...licenseForm, issuedDate: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Expiration Date</label>
              <input
                type="date"
                value={licenseForm.expirationDate}
                onChange={(e) => setLicenseForm({ ...licenseForm, expirationDate: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Status</label>
            <select
              value={licenseForm.status}
              onChange={(e) => setLicenseForm({ ...licenseForm, status: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
            >
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="suspended">Suspended</option>
              <option value="pending">Pending</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
            <textarea
              value={licenseForm.notes}
              onChange={(e) => setLicenseForm({ ...licenseForm, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setLicenseModal(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleSaveLicense} disabled={savingLicense}>
            {savingLicense ? 'Saving...' : editingLicense ? 'Update' : 'Create'}
          </Button>
        </div>
      </Modal>

      {/* Waste Modal */}
      <Modal
        isOpen={wasteModal}
        onClose={() => setWasteModal(false)}
        title="Log Waste Entry"
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Product *</label>
            <select
              value={wasteForm.productId}
              onChange={(e) => {
                const product = products.find(p => p.id === e.target.value);
                setWasteForm({
                  ...wasteForm,
                  productId: e.target.value,
                  productName: product?.name || '',
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
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Batch Number</label>
            <input
              type="text"
              value={wasteForm.batchNumber}
              onChange={(e) => setWasteForm({ ...wasteForm, batchNumber: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Waste Type</label>
              <select
                value={wasteForm.wasteType}
                onChange={(e) => setWasteForm({ ...wasteForm, wasteType: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              >
                {WASTE_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Reason</label>
              <select
                value={wasteForm.reason}
                onChange={(e) => setWasteForm({ ...wasteForm, reason: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              >
                {WASTE_REASONS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Quantity *</label>
              <input
                type="number"
                step="0.01"
                value={wasteForm.quantity}
                onChange={(e) => setWasteForm({ ...wasteForm, quantity: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Unit</label>
              <select
                value={wasteForm.unit}
                onChange={(e) => setWasteForm({ ...wasteForm, unit: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              >
                <option value="grams">Grams</option>
                <option value="ounces">Ounces</option>
                <option value="pounds">Pounds</option>
                <option value="units">Units</option>
                <option value="ml">Milliliters</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Disposal Method</label>
            <select
              value={wasteForm.method}
              onChange={(e) => setWasteForm({ ...wasteForm, method: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
            >
              {WASTE_METHODS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Witness Name</label>
            <input
              type="text"
              value={wasteForm.witness}
              onChange={(e) => setWasteForm({ ...wasteForm, witness: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              placeholder="Name of witness"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
            <textarea
              value={wasteForm.notes}
              onChange={(e) => setWasteForm({ ...wasteForm, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setWasteModal(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleSaveWaste} disabled={savingWaste}>
            {savingWaste ? 'Saving...' : 'Record Waste'}
          </Button>
        </div>
      </Modal>

      {/* View Report Modal */}
      <Modal
        isOpen={!!viewingReport}
        onClose={() => setViewingReport(null)}
        title={`Report: ${REPORT_TYPES.find(r => r.value === viewingReport?.type)?.label || viewingReport?.type || ''}`}
        size="lg"
      >
        {viewingReport && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-slate-400">Period:</span>
                <span className="text-white ml-2">
                  {viewingReport.startDate ? new Date(viewingReport.startDate).toLocaleDateString() : '—'} - {viewingReport.endDate ? new Date(viewingReport.endDate).toLocaleDateString() : '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Status:</span>
                <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                  viewingReport.status === 'submitted' ? 'bg-green-900 text-green-300' : 'bg-slate-700 text-slate-300'
                }`}>
                  {viewingReport.status}
                </span>
              </div>
            </div>
            {viewingReport.data ? (
              <pre className="bg-slate-800 rounded-lg p-4 text-sm text-slate-300 overflow-auto max-h-80">
                {JSON.stringify(viewingReport.data, null, 2)}
              </pre>
            ) : (
              <p className="text-slate-400 text-center py-8">No report data available</p>
            )}
          </div>
        )}
      </Modal>

      <ConfirmModal
        isOpen={deleteLicenseOpen}
        onClose={() => { setDeleteLicenseOpen(false); setLicenseToDelete(null); }}
        onConfirm={handleDeleteLicense}
        title="Delete License"
        message={`Are you sure you want to delete license "${licenseToDelete?.licenseNumber}"?`}
        confirmText="Delete"
      />
    </div>
  );
}
