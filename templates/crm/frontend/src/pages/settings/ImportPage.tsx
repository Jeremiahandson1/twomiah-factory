import { useState, useCallback } from 'react';
import { 
  Upload, Download, FileText, Check, X, AlertCircle, 
  Loader2, Users, FolderKanban, Briefcase, Package 
} from 'lucide-react';
import api from '../../services/api';

const IMPORT_TYPES = [
  { id: 'contacts', label: 'Contacts', icon: Users, description: 'Import customers, vendors, and leads' },
  { id: 'projects', label: 'Projects', icon: FolderKanban, description: 'Import project records' },
  { id: 'jobs', label: 'Jobs', icon: Briefcase, description: 'Import work orders and jobs' },
  { id: 'products', label: 'Products/Services', icon: Package, description: 'Import products and service items' },
];

export default function ImportPage() {
  const [selectedType, setSelectedType] = useState('contacts');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [options, setOptions] = useState({
    skipDuplicates: true,
    updateExisting: false,
    defaultType: 'client',
  });

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setResults(null);
    setError(null);

    // Preview the file
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const previewData = await api.upload(`/import/preview/${selectedType}`, formData);
      setPreview(previewData);
    } catch (err) {
      setError(err.message || 'Failed to preview file');
      setPreview(null);
    }
  };

  const handleImport = async () => {
    if (!file) return;

    setImporting(true);
    setError(null);
    setResults(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      Object.entries(options).forEach(([key, value]) => {
        formData.append(key, String(value));
      });

      const result = await api.upload(`/import/${selectedType}`, formData);
      setResults(result);
    } catch (err) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    window.open(`${api.baseUrl}/import/template/${selectedType}`, '_blank');
  };

  const resetImport = () => {
    setFile(null);
    setPreview(null);
    setResults(null);
    setError(null);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Import Data</h1>
        <p className="text-gray-500">Import contacts, projects, jobs, and more from CSV files</p>
      </div>

      {/* Type Selection */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="font-semibold text-gray-900 mb-4">What do you want to import?</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {IMPORT_TYPES.map((type) => {
            const Icon = type.icon;
            return (
              <button
                key={type.id}
                onClick={() => {
                  setSelectedType(type.id);
                  resetImport();
                }}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  selectedType === type.id
                    ? 'border-orange-500 bg-orange-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <Icon className={`w-6 h-6 mb-2 ${
                  selectedType === type.id ? 'text-orange-600' : 'text-gray-400'
                }`} />
                <p className="font-medium text-gray-900">{type.label}</p>
                <p className="text-xs text-gray-500 mt-1">{type.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Template Download */}
      <div className="bg-blue-50 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="font-medium text-blue-900">Need a template?</p>
          <p className="text-sm text-blue-700">Download a sample CSV with the correct format</p>
        </div>
        <button
          onClick={handleDownloadTemplate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Download className="w-4 h-4" />
          Download Template
        </button>
      </div>

      {/* File Upload */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Upload CSV File</h2>
        
        {!file ? (
          <label className="block border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-orange-400 hover:bg-orange-50 transition-colors text-gray-900">
            <Upload className="w-12 h-12 mx-auto text-gray-400 mb-3" />
            <p className="text-gray-600 mb-1">Drop your CSV file here or click to browse</p>
            <p className="text-sm text-gray-400">Maximum file size: 10MB</p>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
        ) : (
          <div className="space-y-4">
            {/* Selected file */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-3">
                <FileText className="w-8 h-8 text-orange-500" />
                <div>
                  <p className="font-medium text-gray-900">{file.name}</p>
                  <p className="text-sm text-gray-500">
                    {(file.size / 1024).toFixed(1)} KB
                    {preview && ` • ${preview.rowCount} rows`}
                  </p>
                </div>
              </div>
              <button
                onClick={resetImport}
                className="p-2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Preview */}
            {preview && !results && (
              <div>
                <h3 className="font-medium text-gray-900 mb-2">Preview (first 5 rows)</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm border rounded-lg overflow-hidden">
                    <thead className="bg-gray-50">
                      <tr>
                        {preview.columns.map((col, i) => (
                          <th key={i} className="px-3 py-2 text-left font-medium text-gray-700 border-b">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview.map((row, i) => (
                        <tr key={i} className="border-b last:border-0">
                          {preview.columns.map((col, j) => (
                            <td key={j} className="px-3 py-2 text-gray-600 truncate max-w-48">
                              {row[col]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Options */}
      {file && !results && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Import Options</h2>
          <div className="space-y-3">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={options.skipDuplicates}
                onChange={(e) => setOptions({ ...options, skipDuplicates: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-gray-900"
              />
              <span className="text-gray-700">Skip duplicate records</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={options.updateExisting}
                onChange={(e) => setOptions({ ...options, updateExisting: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-gray-900"
              />
              <span className="text-gray-700">Update existing records if found</span>
            </label>
            {selectedType === 'contacts' && (
              <div className="flex items-center gap-3">
                <span className="text-gray-700">Default contact type:</span>
                <select
                  value={options.defaultType}
                  onChange={(e) => setOptions({ ...options, defaultType: e.target.value })}
                  className="px-3 py-1.5 border rounded-lg"
                >
                  <option value="client">Client</option>
                  <option value="lead">Lead</option>
                  <option value="vendor">Vendor</option>
                  <option value="subcontractor">Subcontractor</option>
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Import Results</h2>
          
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-3xl font-bold text-gray-900">{results.total}</p>
              <p className="text-sm text-gray-500">Total Rows</p>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <p className="text-3xl font-bold text-green-600">{results.imported}</p>
              <p className="text-sm text-gray-500">Imported</p>
            </div>
            <div className="text-center p-4 bg-yellow-50 rounded-lg">
              <p className="text-3xl font-bold text-yellow-600">{results.skipped}</p>
              <p className="text-sm text-gray-500">Skipped</p>
            </div>
          </div>

          {results.errors?.length > 0 && (
            <div>
              <h3 className="font-medium text-gray-900 mb-2">Errors ({results.errors.length})</h3>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {results.errors.map((err, i) => (
                  <div key={i} className="text-sm text-red-600 bg-red-50 px-3 py-1.5 rounded">
                    Row {err.row}: {err.error}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button
              onClick={resetImport}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
            >
              Import More
            </button>
            <a
              href={`/${selectedType}`}
              className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-center"
            >
              View {IMPORT_TYPES.find(t => t.id === selectedType)?.label}
            </a>
          </div>
        </div>
      )}

      {/* Import Button */}
      {file && preview && !results && (
        <div className="flex justify-end">
          <button
            onClick={handleImport}
            disabled={importing}
            className="flex items-center gap-2 px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
          >
            {importing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="w-5 h-5" />
                Import {preview.rowCount} Records
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
