import { useState, useEffect } from 'react';
import { Search, Globe, Eye, RefreshCw, Edit, CheckCircle, XCircle, ExternalLink, FileText } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

export default function SEOPagesPage() {
  const toast = useToast();
  const [tab, setTab] = useState('pages');
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [regeneratingSitemap, setRegeneratingSitemap] = useState(false);

  // Edit modal
  const [editModal, setEditModal] = useState(false);
  const [editingPage, setEditingPage] = useState<any>(null);
  const [editForm, setEditForm] = useState({ metaTitle: '', metaDescription: '', customContent: '' });
  const [saving, setSaving] = useState(false);

  // Preview
  const [previewPage, setPreviewPage] = useState<any>(null);

  useEffect(() => {
    loadPages();
  }, []);

  const loadPages = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/seo-pages');
      setPages(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load SEO pages');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateAll = async () => {
    setGenerating(true);
    try {
      await api.post('/api/seo-pages/generate-all');
      toast.success('All SEO pages generated');
      loadPages();
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate pages');
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerateSitemap = async () => {
    setRegeneratingSitemap(true);
    try {
      await api.post('/api/seo-pages/sitemap/regenerate');
      toast.success('Sitemap regenerated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to regenerate sitemap');
    } finally {
      setRegeneratingSitemap(false);
    }
  };

  const openEdit = (page: any) => {
    setEditingPage(page);
    setEditForm({
      metaTitle: page.metaTitle || '',
      metaDescription: page.metaDescription || '',
      customContent: page.customContent || '',
    });
    setEditModal(true);
  };

  const handleSave = async () => {
    if (!editingPage) return;
    setSaving(true);
    try {
      await api.put(`/api/seo-pages/${editingPage.id}`, editForm);
      toast.success('SEO page updated');
      setEditModal(false);
      loadPages();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update page');
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'pages', label: 'Pages', icon: FileText },
    { id: 'sitemap', label: 'Sitemap', icon: Globe },
    { id: 'preview', label: 'Preview', icon: Eye },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">SEO Product Pages</h1>
          <p className="text-gray-600">Manage product page SEO and search appearance</p>
        </div>
        <button onClick={loadPages} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">
          <RefreshCw className="w-5 h-5" />
        </button>
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

      {/* Pages Tab */}
      {tab === 'pages' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={handleGenerateAll} disabled={generating}>
              <RefreshCw className={`w-4 h-4 mr-2 inline ${generating ? 'animate-spin' : ''}`} />
              {generating ? 'Generating...' : 'Generate All'}
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Slug</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Meta Title</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Published</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Indexed</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pages.map(page => (
                    <tr key={page.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{page.productName || page.product || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 font-mono">{page.slug || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{page.metaTitle || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        {page.published ? (
                          <CheckCircle className="w-4 h-4 text-green-500 mx-auto" />
                        ) : (
                          <XCircle className="w-4 h-4 text-gray-300 mx-auto" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {page.lastIndexed ? new Date(page.lastIndexed).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openEdit(page)}
                          className="text-sm text-green-600 hover:text-green-700 flex items-center gap-1 ml-auto"
                        >
                          <Edit className="w-3 h-3" /> Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {pages.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                        <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                        <p>No SEO pages generated yet</p>
                        <p className="text-sm mt-1">Click "Generate All" to create pages for your products</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Sitemap Tab */}
      {tab === 'sitemap' && (
        <div className="max-w-xl space-y-6">
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Globe className="w-5 h-5 text-green-600" />
              Sitemap
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Your sitemap is automatically generated from published SEO pages.
            </p>
            <div className="flex items-center gap-3">
              <a
                href="/api/seo-pages/sitemap"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100"
              >
                <ExternalLink className="w-4 h-4" />
                View Sitemap
              </a>
              <Button onClick={handleRegenerateSitemap} disabled={regeneratingSitemap}>
                <RefreshCw className={`w-4 h-4 mr-2 inline ${regeneratingSitemap ? 'animate-spin' : ''}`} />
                {regeneratingSitemap ? 'Regenerating...' : 'Regenerate'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Tab */}
      {tab === 'preview' && (
        <div className="space-y-6">
          <div className="max-w-md">
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Product Page</label>
            <select
              value={previewPage?.id || ''}
              onChange={(e) => setPreviewPage(pages.find(p => p.id === e.target.value) || null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            >
              <option value="">Choose a page...</option>
              {pages.map(p => (
                <option key={p.id} value={p.id}>{p.productName || p.product || p.slug}</option>
              ))}
            </select>
          </div>

          {previewPage ? (
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 max-w-2xl">
              <h3 className="text-sm font-medium text-gray-500 mb-4">Google Search Preview</h3>
              <div className="space-y-1">
                <p className="text-xl text-blue-700 hover:underline cursor-pointer leading-snug">
                  {previewPage.metaTitle || previewPage.productName || 'Untitled Page'}
                </p>
                <p className="text-sm text-green-700">
                  {window.location.origin}/products/{previewPage.slug || 'product-name'}
                </p>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {previewPage.metaDescription || 'No meta description set. Add one to improve click-through rates.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Eye className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>Select a product page to preview its search appearance</p>
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      <Modal
        isOpen={editModal}
        onClose={() => setEditModal(false)}
        title="Edit SEO Page"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Meta Title</label>
            <input
              type="text"
              value={editForm.metaTitle}
              onChange={(e) => setEditForm({ ...editForm, metaTitle: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="Product Name | Your Dispensary"
              maxLength={60}
            />
            <p className="text-xs text-gray-400 mt-1">{editForm.metaTitle.length}/60 characters</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Meta Description</label>
            <textarea
              value={editForm.metaDescription}
              onChange={(e) => setEditForm({ ...editForm, metaDescription: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="A compelling description for search results..."
              maxLength={160}
            />
            <p className="text-xs text-gray-400 mt-1">{editForm.metaDescription.length}/160 characters</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Custom Content</label>
            <textarea
              value={editForm.customContent}
              onChange={(e) => setEditForm({ ...editForm, customContent: e.target.value })}
              rows={5}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="Additional page content..."
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setEditModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
