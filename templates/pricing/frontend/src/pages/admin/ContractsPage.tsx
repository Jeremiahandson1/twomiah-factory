import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';

interface ContractTemplate {
  id: string;
  name: string;
  product: string;
  state: string;
  version: number;
  content: string;
  createdAt: string;
  updatedAt: string;
  versions?: Array<{
    version: number;
    updatedAt: string;
    updatedBy: string;
  }>;
}

const MERGE_FIELDS = [
  '{customer_name}',
  '{address}',
  '{product}',
  '{price}',
  '{rep_name}',
  '{date}',
  '{rescission_date}',
];

export default function ContractsPage() {
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<ContractTemplate | null>(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.get('/api/contracts/templates');
        setTemplates(data);
      } catch {
        // handle
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function selectTemplate(t: ContractTemplate) {
    setSelectedTemplate(t);
    setEditContent(t.content);
    setShowPreview(false);
    setPreviewHtml('');
  }

  function insertMergeField(field: string) {
    const textarea = document.getElementById('contract-editor') as HTMLTextAreaElement;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = editContent;
    const newText = text.substring(0, start) + field + text.substring(end);
    setEditContent(newText);
    // Refocus
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + field.length, start + field.length);
    }, 0);
  }

  async function handleSave() {
    if (!selectedTemplate) return;
    setSaving(true);
    try {
      const updated = await api.put(`/api/contracts/templates/${selectedTemplate.id}`, {
        content: editContent,
      });
      setSelectedTemplate(updated);
      setTemplates(templates.map((t) => (t.id === updated.id ? updated : t)));
    } catch {
      // handle
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview() {
    if (!selectedTemplate) return;
    try {
      const result = await api.get(`/api/contracts/templates/${selectedTemplate.id}/preview`);
      setPreviewHtml(result.html);
      setShowPreview(true);
    } catch {
      // handle
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex h-screen">
        {/* Template List */}
        <div className="w-72 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">Contract Templates</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => selectTemplate(t)}
                className={`w-full text-left p-4 border-b border-gray-100 transition-colors min-h-[72px] ${
                  selectedTemplate?.id === t.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : 'hover:bg-gray-50'
                }`}
              >
                <p className="font-semibold text-gray-900 text-sm">{t.name}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-500">{t.product}</span>
                  <span className="text-xs text-gray-400">|</span>
                  <span className="text-xs text-gray-500">{t.state}</span>
                  <span className="text-xs text-gray-400">|</span>
                  <span className="text-xs text-gray-500">v{t.version}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedTemplate ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <p className="text-lg">Select a template to edit</p>
            </div>
          ) : (
            <>
              <div className="p-4 bg-white border-b border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">{selectedTemplate.name}</h3>
                    <p className="text-sm text-gray-500">
                      {selectedTemplate.product} | {selectedTemplate.state} | Version {selectedTemplate.version}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handlePreview}
                      className="px-5 py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-colors text-sm min-h-[48px]"
                    >
                      Preview
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="px-5 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:bg-gray-300 transition-colors text-sm min-h-[48px]"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>

                {/* Merge Fields */}
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs font-semibold text-gray-500 self-center mr-1">Insert:</span>
                  {MERGE_FIELDS.map((field) => (
                    <button
                      key={field}
                      onClick={() => insertMergeField(field)}
                      className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-mono font-semibold hover:bg-blue-100 transition-colors min-h-[36px]"
                    >
                      {field}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rescission Notice (always shown) */}
              <div className="mx-4 mt-4 bg-yellow-50 border border-yellow-300 rounded-lg p-3">
                <p className="text-xs font-bold text-yellow-800">
                  RESCISSION NOTICE (auto-included, cannot be removed): Customer has the right to cancel
                  within the legally required period. This section is automatically appended to all contracts.
                </p>
              </div>

              {showPreview ? (
                <div className="flex-1 overflow-y-auto p-4">
                  <div className="bg-white rounded-xl shadow-lg p-8 max-w-3xl mx-auto">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-bold text-gray-900">Contract Preview</h4>
                      <button
                        onClick={() => setShowPreview(false)}
                        className="px-4 py-2 bg-gray-100 rounded-lg text-sm font-semibold hover:bg-gray-200 min-h-[44px]"
                      >
                        Back to Editor
                      </button>
                    </div>
                    <div
                      className="prose prose-lg max-w-none"
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex-1 p-4 flex flex-col gap-4 overflow-hidden">
                  <textarea
                    id="contract-editor"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="flex-1 w-full px-4 py-4 border border-gray-300 rounded-xl font-mono text-sm leading-relaxed resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter contract HTML content..."
                  />

                  {/* Version History */}
                  {selectedTemplate.versions && selectedTemplate.versions.length > 0 && (
                    <div className="bg-white rounded-xl shadow p-4">
                      <h4 className="font-bold text-gray-900 text-sm mb-2">Version History</h4>
                      <div className="space-y-1.5 max-h-32 overflow-y-auto">
                        {selectedTemplate.versions.map((v) => (
                          <div key={v.version} className="flex items-center justify-between py-1.5 text-sm border-b border-gray-50 last:border-0">
                            <span className="font-medium text-gray-700">v{v.version}</span>
                            <span className="text-gray-500">
                              {new Date(v.updatedAt).toLocaleDateString()} by {v.updatedBy}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
