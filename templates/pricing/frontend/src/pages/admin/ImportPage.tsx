import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../services/api';

interface ColumnMapping {
  detected: string;
  mappedTo: string;
}

interface PreviewRow {
  [key: string]: string | number;
}

interface ImportHistoryEntry {
  id: string;
  filename: string;
  rowsImported: number;
  rowsSkipped: number;
  importedAt: string;
  importedBy: string;
}

const SCHEMA_FIELDS = [
  { value: '', label: '-- Skip --' },
  { value: 'category', label: 'Category' },
  { value: 'productName', label: 'Product Name' },
  { value: 'measurementType', label: 'Measurement Type' },
  { value: 'rangeMin', label: 'Range Min' },
  { value: 'rangeMax', label: 'Range Max' },
  { value: 'parPrice', label: 'Par Price' },
  { value: 'retailPrice', label: 'Retail Price' },
  { value: 'addonName', label: 'Addon Name' },
  { value: 'addonPrice', label: 'Addon Price' },
  { value: 'addonType', label: 'Addon Type' },
  { value: 'addonGroup', label: 'Addon Group' },
];

export default function ImportPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);

  // After upload
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnMapping[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [errorRows, setErrorRows] = useState<number[]>([]);

  // History
  const [history, setHistory] = useState<ImportHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    async function loadHistory() {
      try {
        const data = await api.get('/api/import/history');
        setHistory(data);
      } catch {
        // handle
      } finally {
        setLoadingHistory(false);
      }
    }
    loadHistory();
  }, []);

  const handleFile = useCallback(async (file: File) => {
    const validTypes = [
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    const validExtensions = ['.csv', '.xlsx', '.xls'];
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();

    if (!validTypes.includes(file.type) && !validExtensions.includes(ext)) {
      alert('Please upload a CSV or XLSX file.');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const result = await api.upload('/api/import/upload', formData);
      setUploadId(result.uploadId);
      setColumns(result.columns);
      setPreviewRows(result.preview);
      setErrorRows(result.errorRows || []);
    } catch {
      alert('Failed to upload file. Please try again.');
    } finally {
      setUploading(false);
    }
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function updateMapping(index: number, mappedTo: string) {
    const updated = [...columns];
    updated[index] = { ...updated[index], mappedTo };
    setColumns(updated);
  }

  async function handleImport() {
    if (!uploadId) return;
    setImporting(true);
    try {
      const mappings: Record<string, string> = {};
      columns.forEach((col) => {
        if (col.mappedTo) {
          mappings[col.detected] = col.mappedTo;
        }
      });
      await api.post('/api/import/execute', { uploadId, mappings });
      // Reload history
      const data = await api.get('/api/import/history');
      setHistory(data);
      // Reset
      setUploadId(null);
      setColumns([]);
      setPreviewRows([]);
      setErrorRows([]);
    } catch {
      alert('Import failed. Please check your data and try again.');
    } finally {
      setImporting(false);
    }
  }

  function handleDownloadTemplate() {
    window.open('/api/import/template', '_blank');
  }

  const columnHeaders = columns.map((c) => c.detected);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Import Pricebook</h1>
          <button
            onClick={handleDownloadTemplate}
            className="px-5 py-3 bg-gray-800 text-white font-semibold rounded-xl hover:bg-gray-900 transition-colors text-sm min-h-[48px]"
          >
            <svg className="w-4 h-4 inline-block mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download Template
          </button>
        </div>

        {/* Upload Zone */}
        {!uploadId && (
          <div
            className={`bg-white rounded-xl shadow-lg p-12 text-center border-2 border-dashed transition-colors mb-6 ${
              dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {uploading ? (
              <div>
                <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-lg text-gray-600">Processing file...</p>
              </div>
            ) : (
              <>
                <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-xl font-bold text-gray-700 mb-2">
                  Drag & drop your file here
                </p>
                <p className="text-gray-500 mb-4">Accepts CSV and XLSX files</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors min-h-[48px]"
                >
                  Browse Files
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileInput}
                  className="hidden"
                />
              </>
            )}
          </div>
        )}

        {/* Column Mapping */}
        {uploadId && columns.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Column Mapping</h2>
            <p className="text-sm text-gray-500 mb-4">
              Map each detected column to the correct field in the pricebook schema.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
              {columns.map((col, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{col.detected}</p>
                  </div>
                  <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                  <select
                    value={col.mappedTo}
                    onChange={(e) => updateMapping(i, e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 min-h-[44px] w-44"
                  >
                    {SCHEMA_FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Preview Table */}
            <h3 className="font-bold text-gray-900 mb-3">
              Preview (first {previewRows.length} rows)
            </h3>
            <div className="overflow-x-auto border border-gray-200 rounded-lg mb-6">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">#</th>
                    {columnHeaders.map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-bold text-gray-500 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {previewRows.map((row, i) => {
                    const isError = errorRows.includes(i);
                    return (
                      <tr
                        key={i}
                        className={isError ? 'bg-red-50' : 'hover:bg-gray-50'}
                      >
                        <td className="px-3 py-2 text-gray-500">
                          {i + 1}
                          {isError && (
                            <svg className="w-4 h-4 inline-block ml-1 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                        </td>
                        {columnHeaders.map((h) => (
                          <td key={h} className={`px-3 py-2 whitespace-nowrap ${isError ? 'text-red-700' : 'text-gray-700'}`}>
                            {String(row[h] ?? '')}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {errorRows.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-red-700 font-medium text-sm">
                  {errorRows.length} row{errorRows.length > 1 ? 's' : ''} with errors detected.
                  These rows will be skipped during import.
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setUploadId(null);
                  setColumns([]);
                  setPreviewRows([]);
                  setErrorRows([]);
                }}
                className="flex-1 py-4 bg-gray-200 text-gray-700 text-lg font-bold rounded-xl hover:bg-gray-300 transition-colors min-h-[56px]"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={importing || columns.every((c) => !c.mappedTo)}
                className="flex-1 py-4 bg-blue-600 text-white text-lg font-bold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-[56px]"
              >
                {importing ? 'Importing...' : 'Import Data'}
              </button>
            </div>
          </div>
        )}

        {/* Import History */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Import History</h2>
          {loadingHistory ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No imports yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{entry.filename}</p>
                      <p className="text-xs text-gray-500">
                        by {entry.importedBy} on {new Date(entry.importedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-green-600 font-semibold">{entry.rowsImported} imported</span>
                    {entry.rowsSkipped > 0 && (
                      <span className="text-red-500 font-semibold">{entry.rowsSkipped} skipped</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
