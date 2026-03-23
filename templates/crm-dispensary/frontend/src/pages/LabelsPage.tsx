import { useState, useEffect } from 'react';
import { Tag, Printer, History, Plus, Edit, Trash2, Eye, QrCode, Barcode, Image, X } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

const LABEL_FIELD_OPTIONS = [
  { value: 'productName', label: 'Product Name' },
  { value: 'strain', label: 'Strain' },
  { value: 'thc', label: 'THC %' },
  { value: 'cbd', label: 'CBD %' },
  { value: 'weight', label: 'Weight' },
  { value: 'price', label: 'Price' },
  { value: 'batchNumber', label: 'Batch Number' },
  { value: 'metrcTag', label: 'Metrc Tag' },
  { value: 'harvestDate', label: 'Harvest Date' },
  { value: 'packageDate', label: 'Package Date' },
  { value: 'expirationDate', label: 'Expiration Date' },
  { value: 'terpenes', label: 'Terpenes' },
  { value: 'grower', label: 'Grower/Cultivator' },
];

const LABEL_TYPES = ['product', 'shelf', 'bag', 'jar', 'preroll', 'custom'];
const ORIENTATIONS = ['portrait', 'landscape'];

const initialTemplateForm = {
  name: '',
  type: 'product',
  width: '2',
  height: '1',
  orientation: 'landscape',
  fields: ['productName', 'strain', 'thc', 'weight', 'price'] as string[],
  showQrCode: true,
  showBarcode: false,
  showLogo: true,
  showThcWarning: true,
  showLabResults: false,
};

export default function LabelsPage() {
  const { isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('templates');

  // Templates
  const [templates, setTemplates] = useState<any[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateModal, setTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [templateForm, setTemplateForm] = useState(initialTemplateForm);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<any>(null);
  const [deletingTemplate, setDeletingTemplate] = useState(false);
  const [previewModal, setPreviewModal] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');

  // Print
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [printProducts, setPrintProducts] = useState<any[]>([]);
  const [loadingPrintProducts, setLoadingPrintProducts] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [printQuantity, setPrintQuantity] = useState(1);
  const [generatingLabels, setGeneratingLabels] = useState(false);
  const [generatedPreview, setGeneratedPreview] = useState('');

  // Print History
  const [printJobs, setPrintJobs] = useState<any[]>([]);
  const [loadingPrintJobs, setLoadingPrintJobs] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    if (tab === 'print') loadPrintProducts();
    if (tab === 'history') loadPrintJobs();
  }, [tab]);

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const data = await api.get('/api/labels/templates');
      setTemplates(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load templates:', err);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const loadPrintProducts = async () => {
    setLoadingPrintProducts(true);
    try {
      const data = await api.get('/api/products', { limit: 200 });
      setPrintProducts(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load products:', err);
    } finally {
      setLoadingPrintProducts(false);
    }
  };

  const loadPrintJobs = async () => {
    setLoadingPrintJobs(true);
    try {
      const data = await api.get('/api/labels/print-jobs');
      setPrintJobs(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load print jobs:', err);
    } finally {
      setLoadingPrintJobs(false);
    }
  };

  const openCreateTemplate = () => {
    setEditingTemplate(null);
    setTemplateForm(initialTemplateForm);
    setTemplateModal(true);
  };

  const openEditTemplate = (tpl: any) => {
    setEditingTemplate(tpl);
    setTemplateForm({
      name: tpl.name || '',
      type: tpl.type || 'product',
      width: String(tpl.width || '2'),
      height: String(tpl.height || '1'),
      orientation: tpl.orientation || 'landscape',
      fields: tpl.fields || ['productName'],
      showQrCode: tpl.showQrCode ?? true,
      showBarcode: tpl.showBarcode ?? false,
      showLogo: tpl.showLogo ?? true,
      showThcWarning: tpl.showThcWarning ?? true,
      showLabResults: tpl.showLabResults ?? false,
    });
    setTemplateModal(true);
  };

  const handleSaveTemplate = async () => {
    if (!templateForm.name.trim()) {
      toast.error('Template name is required');
      return;
    }
    setSavingTemplate(true);
    try {
      const payload = {
        ...templateForm,
        width: parseFloat(templateForm.width) || 2,
        height: parseFloat(templateForm.height) || 1,
      };
      if (editingTemplate) {
        await api.put(`/api/labels/templates/${editingTemplate.id}`, payload);
        toast.success('Template updated');
      } else {
        await api.post('/api/labels/templates', payload);
        toast.success('Template created');
      }
      setTemplateModal(false);
      loadTemplates();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!templateToDelete) return;
    setDeletingTemplate(true);
    try {
      await api.delete(`/api/labels/templates/${templateToDelete.id}`);
      toast.success('Template deleted');
      setDeleteOpen(false);
      setTemplateToDelete(null);
      loadTemplates();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete template');
    } finally {
      setDeletingTemplate(false);
    }
  };

  const previewTemplate = async (tpl: any) => {
    try {
      const data = await api.get(`/api/labels/templates/${tpl.id}/preview`);
      setPreviewHtml(data?.html || '<p>Preview not available</p>');
      setPreviewModal(true);
    } catch (err) {
      toast.error('Failed to load preview');
    }
  };

  const toggleField = (field: string) => {
    setTemplateForm(prev => ({
      ...prev,
      fields: prev.fields.includes(field)
        ? prev.fields.filter(f => f !== field)
        : [...prev.fields, field],
    }));
  };

  const generateLabels = async () => {
    if (!selectedTemplate) {
      toast.error('Select a template');
      return;
    }
    if (selectedProductIds.length === 0) {
      toast.error('Select at least one product');
      return;
    }
    setGeneratingLabels(true);
    try {
      const result = await api.post('/api/labels/generate', {
        templateId: selectedTemplate,
        productIds: selectedProductIds,
        quantity: printQuantity,
      });
      setGeneratedPreview(result?.html || '');
      toast.success('Labels generated');
      loadPrintJobs();
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate labels');
    } finally {
      setGeneratingLabels(false);
    }
  };

  const printLabels = () => {
    if (!generatedPreview) return;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(generatedPreview);
      printWindow.document.close();
      printWindow.print();
    }
  };

  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds(prev =>
      prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
  };

  const tabs = [
    { id: 'templates', label: 'Templates', icon: Tag },
    { id: 'print', label: 'Print', icon: Printer },
    { id: 'history', label: 'Print History', icon: History },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Labels</h1>
          <p className="text-gray-600">Design and print product labels</p>
        </div>
      </div>

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

      {/* Templates Tab */}
      {tab === 'templates' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={openCreateTemplate}>
              <Plus className="w-4 h-4 mr-2 inline" />
              New Template
            </Button>
          </div>
          {loadingTemplates ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : templates.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm p-12 text-center">
              <Tag className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 mb-2">No label templates yet</p>
              <p className="text-sm text-gray-400">Create your first template to start printing labels</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map(tpl => (
                <div key={tpl.id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900">{tpl.name}</h3>
                      <p className="text-xs text-gray-500 capitalize">{tpl.type} label</p>
                    </div>
                    <span className="text-xs text-gray-400">{tpl.width}" x {tpl.height}"</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {(tpl.fields || []).slice(0, 5).map((f: string) => (
                      <span key={f} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">{f}</span>
                    ))}
                    {(tpl.fields || []).length > 5 && (
                      <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">+{tpl.fields.length - 5}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400 mb-3">
                    {tpl.showQrCode && <span className="flex items-center gap-1"><QrCode className="w-3 h-3" /> QR</span>}
                    {tpl.showBarcode && <span className="flex items-center gap-1"><Barcode className="w-3 h-3" /> Barcode</span>}
                    {tpl.showLogo && <span className="flex items-center gap-1"><Image className="w-3 h-3" /> Logo</span>}
                  </div>
                  <div className="flex gap-2 pt-3 border-t">
                    <button onClick={() => previewTemplate(tpl)} className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
                      <Eye className="w-3 h-3" /> Preview
                    </button>
                    <button onClick={() => openEditTemplate(tpl)} className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
                      <Edit className="w-3 h-3" /> Edit
                    </button>
                    <button onClick={() => { setTemplateToDelete(tpl); setDeleteOpen(true); }} className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1">
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Print Tab */}
      {tab === 'print' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Print Settings</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Template</label>
                  <select
                    value={selectedTemplate}
                    onChange={(e) => setSelectedTemplate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  >
                    <option value="">Select template</option>
                    {templates.map(tpl => (
                      <option key={tpl.id} value={tpl.id}>{tpl.name} ({tpl.width}" x {tpl.height}")</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quantity per Product</label>
                  <input
                    type="number"
                    min={1}
                    value={printQuantity}
                    onChange={(e) => setPrintQuantity(parseInt(e.target.value) || 1)}
                    className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Products ({selectedProductIds.length} selected)
                  </label>
                  <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg">
                    {loadingPrintProducts ? (
                      <div className="flex justify-center py-6">
                        <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : printProducts.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center py-6">No products found</p>
                    ) : printProducts.map(product => (
                      <label key={product.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b last:border-b-0">
                        <input
                          type="checkbox"
                          checked={selectedProductIds.includes(product.id)}
                          onChange={() => toggleProductSelection(product.id)}
                          className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                          <p className="text-xs text-gray-500">{product.sku || product.category || ''}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button onClick={generateLabels} disabled={generatingLabels}>
                    {generatingLabels ? 'Generating...' : 'Generate Labels'}
                  </Button>
                  {generatedPreview && (
                    <Button onClick={printLabels} variant="secondary">
                      <Printer className="w-4 h-4 mr-2 inline" />
                      Print
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Preview</h3>
            {generatedPreview ? (
              <div className="border border-gray-200 rounded-lg p-4 overflow-auto max-h-[500px]">
                <div dangerouslySetInnerHTML={{ __html: generatedPreview }} />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <QrCode className="w-12 h-12 mb-3" />
                <p className="text-sm">Generate labels to see preview</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Print History Tab */}
      {tab === 'history' && (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Template</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Products</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Labels</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Printed By</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loadingPrintJobs ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center">
                    <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  </td>
                </tr>
              ) : printJobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">No print jobs yet</td>
                </tr>
              ) : printJobs.map(job => (
                <tr key={job.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {job.createdAt ? new Date(job.createdAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{job.templateName || '—'}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600">{job.productCount || 0}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-900">{job.labelCount || 0}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{job.printedBy || job.userName || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      job.status === 'completed' ? 'bg-green-100 text-green-700' :
                      job.status === 'failed' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {job.status || 'pending'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Template Modal */}
      <Modal
        isOpen={templateModal}
        onClose={() => setTemplateModal(false)}
        title={editingTemplate ? 'Edit Template' : 'New Template'}
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Template Name *</label>
            <input
              type="text"
              value={templateForm.name}
              onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              placeholder="e.g., Standard Product Label"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Type</label>
              <select
                value={templateForm.type}
                onChange={(e) => setTemplateForm({ ...templateForm, type: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              >
                {LABEL_TYPES.map(t => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Orientation</label>
              <select
                value={templateForm.orientation}
                onChange={(e) => setTemplateForm({ ...templateForm, orientation: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              >
                {ORIENTATIONS.map(o => (
                  <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Width (inches)</label>
              <input
                type="number"
                step="0.25"
                value={templateForm.width}
                onChange={(e) => setTemplateForm({ ...templateForm, width: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Height (inches)</label>
              <input
                type="number"
                step="0.25"
                value={templateForm.height}
                onChange={(e) => setTemplateForm({ ...templateForm, height: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Fields</label>
            <div className="grid grid-cols-2 gap-2">
              {LABEL_FIELD_OPTIONS.map(field => (
                <label key={field.value} className="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded hover:bg-slate-800">
                  <input
                    type="checkbox"
                    checked={templateForm.fields.includes(field.value)}
                    onChange={() => toggleField(field.value)}
                    className="w-4 h-4 text-green-600 border-slate-500 rounded focus:ring-green-500"
                  />
                  <span className="text-sm text-slate-300">{field.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={templateForm.showQrCode}
                onChange={(e) => setTemplateForm({ ...templateForm, showQrCode: e.target.checked })}
                className="w-4 h-4 text-green-600 border-slate-500 rounded focus:ring-green-500"
              />
              <span className="text-sm text-slate-300">QR Code</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={templateForm.showBarcode}
                onChange={(e) => setTemplateForm({ ...templateForm, showBarcode: e.target.checked })}
                className="w-4 h-4 text-green-600 border-slate-500 rounded focus:ring-green-500"
              />
              <span className="text-sm text-slate-300">Barcode</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={templateForm.showLogo}
                onChange={(e) => setTemplateForm({ ...templateForm, showLogo: e.target.checked })}
                className="w-4 h-4 text-green-600 border-slate-500 rounded focus:ring-green-500"
              />
              <span className="text-sm text-slate-300">Company Logo</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={templateForm.showThcWarning}
                onChange={(e) => setTemplateForm({ ...templateForm, showThcWarning: e.target.checked })}
                className="w-4 h-4 text-green-600 border-slate-500 rounded focus:ring-green-500"
              />
              <span className="text-sm text-slate-300">THC Warning</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={templateForm.showLabResults}
                onChange={(e) => setTemplateForm({ ...templateForm, showLabResults: e.target.checked })}
                className="w-4 h-4 text-green-600 border-slate-500 rounded focus:ring-green-500"
              />
              <span className="text-sm text-slate-300">Lab Results</span>
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setTemplateModal(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleSaveTemplate} disabled={savingTemplate}>
            {savingTemplate ? 'Saving...' : editingTemplate ? 'Update' : 'Create'}
          </Button>
        </div>
      </Modal>

      {/* Preview Modal */}
      <Modal
        isOpen={previewModal}
        onClose={() => setPreviewModal(false)}
        title="Label Preview"
        size="lg"
      >
        <div className="border border-slate-600 rounded-lg p-6 bg-white overflow-auto max-h-96">
          <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      </Modal>

      <ConfirmModal
        isOpen={deleteOpen}
        onClose={() => { setDeleteOpen(false); setTemplateToDelete(null); }}
        onConfirm={handleDeleteTemplate}
        title="Delete Template"
        message={`Are you sure you want to delete "${templateToDelete?.name}"?`}
        confirmText="Delete"
      />
    </div>
  );
}
