import { useState, useEffect, useRef } from 'react';
import {
  ArrowRight, Upload, Check, X, AlertCircle, Loader2, Download,
  Database, FileSpreadsheet, Link, ChevronRight, RefreshCw, Shield,
} from 'lucide-react';
import api from '../../services/api';

interface Provider {
  id: string;
  name: string;
  description: string;
  hasApi: boolean;
  csvEntityTypes: string[];
}

const ENTITY_LABELS: Record<string, string> = {
  contacts: 'Contacts & Customers',
  jobs: 'Jobs & Work Orders',
  projects: 'Projects',
  products: 'Products & Services',
  invoices: 'Invoices',
};

const CREDENTIAL_FIELDS: Record<string, Array<{ key: string; label: string; type: string; help: string }>> = {
  jobber: [
    { key: 'accessToken', label: 'API Access Token', type: 'password', help: 'Generate from Jobber Developer Portal → Apps → Your App → Access Token' },
  ],
  servicetitan: [
    { key: 'clientId', label: 'Client ID (App Key)', type: 'text', help: 'From ServiceTitan Developer Portal → My Apps' },
    { key: 'clientSecret', label: 'Client Secret', type: 'password', help: 'From ServiceTitan Developer Portal → My Apps' },
    { key: 'tenantId', label: 'Tenant ID', type: 'text', help: 'Your ServiceTitan account/tenant ID' },
  ],
  housecallpro: [
    { key: 'apiKey', label: 'API Key', type: 'password', help: 'From Housecall Pro → Settings → API' },
  ],
};

export default function MigrationPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [mode, setMode] = useState<'select' | 'csv' | 'api'>('select');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [migrationId, setMigrationId] = useState<string | null>(null);
  const [progress, setProgress] = useState<any>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvEntityType, setCsvEntityType] = useState('contacts');
  const [csvPreview, setCsvPreview] = useState<any>(null);
  const [csvResults, setCsvResults] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.get('/api/migration/providers').then(setProviders).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const selectProvider = (p: Provider) => {
    setSelectedProvider(p);
    setMode('select');
    setCredentials({});
    setMigrationId(null);
    setProgress(null);
    setCsvFile(null);
    setCsvPreview(null);
    setCsvResults(null);
    setError(null);
  };

  const startApiMigration = async () => {
    if (!selectedProvider) return;
    setError(null);
    setImporting(true);

    try {
      const res = await api.post('/api/migration/start', {
        provider: selectedProvider.id,
        credentials: { provider: selectedProvider.id, ...credentials },
      });
      setMigrationId(res.migrationId);

      // Poll progress
      pollRef.current = setInterval(async () => {
        try {
          const p = await api.get(`/api/migration/progress/${res.migrationId}`);
          setProgress(p);
          if (p.status === 'complete' || p.status === 'error') {
            if (pollRef.current) clearInterval(pollRef.current);
            setImporting(false);
          }
        } catch { /* ignore */ }
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to start migration');
      setImporting(false);
    }
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProvider) return;
    setCsvFile(file);
    setCsvResults(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const preview = await api.request(`/api/import/preview/${csvEntityType}`, { method: 'POST', body: formData });
      setCsvPreview(preview);
    } catch (err: any) {
      setError(err.message || 'Failed to preview file');
      setCsvPreview(null);
    }
  };

  const runCsvImport = async () => {
    if (!csvFile || !selectedProvider) return;
    setImporting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', csvFile);
      const results = await api.request(`/api/migration/csv/${selectedProvider.id}/${csvEntityType}`, { method: 'POST', body: formData });
      setCsvResults(results);
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const resetAll = () => {
    setSelectedProvider(null);
    setMode('select');
    setCredentials({});
    setMigrationId(null);
    setProgress(null);
    setCsvFile(null);
    setCsvPreview(null);
    setCsvResults(null);
    setError(null);
    if (pollRef.current) clearInterval(pollRef.current);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Migrate Your Data</h1>
        <p className="text-gray-500 dark:text-gray-400">
          Import your existing data from another platform — automatically via API or from CSV exports
        </p>
      </div>

      {/* Provider Selection */}
      {!selectedProvider && (
        <div className="space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-white">Where are you migrating from?</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={() => selectProvider(p)}
                className="p-5 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 text-left hover:border-blue-400 hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                    <Database className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  {p.hasApi && (
                    <span className="text-xs font-medium px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full">
                      Auto-Migrate
                    </span>
                  )}
                </div>
                <p className="font-semibold text-gray-900 dark:text-white">{p.name}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{p.description}</p>
                <div className="flex items-center gap-1 mt-3 text-sm text-blue-600 dark:text-blue-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  Get started <ChevronRight className="w-4 h-4" />
                </div>
              </button>
            ))}
          </div>

          {/* Generic CSV option */}
          <div className="pt-4 border-t dark:border-slate-700">
            <button
              onClick={() => { setSelectedProvider({ id: 'generic', name: 'Other / CSV', description: '', hasApi: false, csvEntityTypes: ['contacts', 'projects', 'jobs', 'products'] }); setMode('csv'); }}
              className="w-full p-5 bg-gray-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-gray-300 dark:border-slate-600 text-left hover:border-blue-400 transition-colors"
            >
              <div className="flex items-center gap-4">
                <FileSpreadsheet className="w-8 h-8 text-gray-400" />
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">Other Platform / Generic CSV</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Upload a CSV file from any source — we'll auto-detect the columns</p>
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Provider Selected — Choose Method */}
      {selectedProvider && mode === 'select' && (
        <div className="space-y-4">
          <button onClick={resetAll} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            ← Back to provider list
          </button>

          <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              Migrate from {selectedProvider.name}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">Choose how you'd like to import your data</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {selectedProvider.hasApi && (
                <button
                  onClick={() => setMode('api')}
                  className="p-5 border-2 border-gray-200 dark:border-slate-600 rounded-xl text-left hover:border-green-400 transition-colors"
                >
                  <Link className="w-8 h-8 text-green-600 mb-3" />
                  <p className="font-semibold text-gray-900 dark:text-white">Automatic API Migration</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Connect directly and import everything — contacts, jobs, invoices, and more
                  </p>
                  <div className="flex items-center gap-1.5 mt-3 text-sm text-green-600 font-medium">
                    <Shield className="w-4 h-4" /> Recommended
                  </div>
                </button>
              )}

              <button
                onClick={() => setMode('csv')}
                className="p-5 border-2 border-gray-200 dark:border-slate-600 rounded-xl text-left hover:border-blue-400 transition-colors"
              >
                <FileSpreadsheet className="w-8 h-8 text-blue-600 mb-3" />
                <p className="font-semibold text-gray-900 dark:text-white">CSV File Import</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Export your data from {selectedProvider.name} as CSV and upload here
                </p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-3">
                  We auto-detect {selectedProvider.name} column formats
                </p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* API Migration Flow */}
      {selectedProvider && mode === 'api' && (
        <div className="space-y-4">
          <button onClick={() => setMode('select')} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            ← Back
          </button>

          {!migrationId ? (
            <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6 space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Connect to {selectedProvider.name}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Enter your API credentials. Your data is imported directly — nothing is stored on third-party servers.
                </p>
              </div>

              {(CREDENTIAL_FIELDS[selectedProvider.id] || []).map((field) => (
                <div key={field.key}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    {field.label}
                  </label>
                  <input
                    type={field.type}
                    value={credentials[field.key] || ''}
                    onChange={(e) => setCredentials({ ...credentials, [field.key]: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                    placeholder={field.label}
                  />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{field.help}</p>
                </div>
              ))}

              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-3 rounded-lg flex items-center gap-2 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
                </div>
              )}

              <button
                onClick={startApiMigration}
                disabled={importing || Object.values(credentials).some(v => !v)}
                className="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-semibold flex items-center justify-center gap-2"
              >
                {importing ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Connecting...</>
                ) : (
                  <><ArrowRight className="w-5 h-5" /> Start Migration</>
                )}
              </button>
            </div>
          ) : (
            /* Migration Progress */
            <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Migration Progress
                </h2>
                {progress?.status === 'complete' && (
                  <span className="flex items-center gap-1.5 text-green-600 font-medium text-sm">
                    <Check className="w-4 h-4" /> Complete
                  </span>
                )}
                {progress?.status === 'error' && (
                  <span className="flex items-center gap-1.5 text-red-600 font-medium text-sm">
                    <X className="w-4 h-4" /> Error
                  </span>
                )}
              </div>

              {progress && (
                <>
                  <div className="flex items-center gap-3">
                    {(progress.status === 'fetching' || progress.status === 'importing' || progress.status === 'connecting') && (
                      <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                    )}
                    <span className="text-gray-700 dark:text-gray-300">{progress.phase}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{progress.total}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Total Records</p>
                    </div>
                    <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                      <p className="text-2xl font-bold text-green-600">{progress.imported}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Imported</p>
                    </div>
                    <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                      <p className="text-2xl font-bold text-yellow-600">{progress.skipped}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Skipped</p>
                    </div>
                  </div>

                  {progress.errors?.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Errors ({progress.errors.length})
                      </p>
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {progress.errors.slice(0, 20).map((err: any, i: number) => (
                          <div key={i} className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-1.5 rounded">
                            {err.entity}: {err.name} — {err.error}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {progress.status === 'complete' && (
                    <button onClick={resetAll} className="w-full py-2.5 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-900 dark:text-white font-medium">
                      Done — Return to Provider List
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* CSV Import Flow */}
      {selectedProvider && mode === 'csv' && (
        <div className="space-y-4">
          <button onClick={() => selectedProvider.id === 'generic' ? resetAll() : setMode('select')} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            ← Back
          </button>

          {/* Entity type picker */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-4">What are you importing?</h2>
            <div className="flex flex-wrap gap-2">
              {(selectedProvider.csvEntityTypes || ['contacts', 'projects', 'jobs', 'products']).map((type) => (
                <button
                  key={type}
                  onClick={() => { setCsvEntityType(type); setCsvFile(null); setCsvPreview(null); setCsvResults(null); }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    csvEntityType === type
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                  }`}
                >
                  {ENTITY_LABELS[type] || type}
                </button>
              ))}
            </div>
          </div>

          {/* Template download */}
          {selectedProvider.id !== 'generic' && (
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-blue-900 dark:text-blue-300">
                  Exporting from {selectedProvider.name}?
                </p>
                <p className="text-sm text-blue-700 dark:text-blue-400">
                  We auto-detect {selectedProvider.name}'s column names — just export and upload
                </p>
              </div>
              <button
                onClick={() => window.open(`${api.baseUrl}/api/import/template/${csvEntityType}`, '_blank')}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm whitespace-nowrap"
              >
                <Download className="w-4 h-4" /> Sample CSV
              </button>
            </div>
          )}

          {/* File upload */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6">
            {!csvFile ? (
              <label className="block border-2 border-dashed border-gray-300 dark:border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 transition-colors">
                <Upload className="w-12 h-12 mx-auto text-gray-400 mb-3" />
                <p className="text-gray-600 dark:text-gray-300">Drop your CSV file here or click to browse</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Supports .csv files up to 10MB</p>
                <input type="file" accept=".csv" onChange={handleCsvUpload} className="hidden" />
              </label>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="w-6 h-6 text-blue-500" />
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white text-sm">{csvFile.name}</p>
                      <p className="text-xs text-gray-500">
                        {(csvFile.size / 1024).toFixed(1)} KB
                        {csvPreview && ` · ${csvPreview.rowCount} rows`}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => { setCsvFile(null); setCsvPreview(null); setCsvResults(null); }} className="p-1.5 text-gray-400 hover:text-gray-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Preview */}
                {csvPreview && !csvResults && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Preview (first 5 rows)</p>
                    <div className="overflow-x-auto rounded-lg border dark:border-slate-600">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50 dark:bg-slate-700">
                          <tr>
                            {csvPreview.columns?.map((col: string, i: number) => (
                              <th key={i} className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300 border-b dark:border-slate-600">{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {csvPreview.preview?.slice(0, 5).map((row: any, i: number) => (
                            <tr key={i} className="border-b dark:border-slate-700 last:border-0">
                              {csvPreview.columns?.map((col: string, j: number) => (
                                <td key={j} className="px-3 py-2 text-gray-600 dark:text-gray-400 truncate max-w-40">{row[col]}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Results */}
                {csvResults && (
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{csvResults.total || (csvResults.imported + csvResults.skipped)}</p>
                      <p className="text-xs text-gray-500">Total</p>
                    </div>
                    <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                      <p className="text-2xl font-bold text-green-600">{csvResults.imported}</p>
                      <p className="text-xs text-gray-500">Imported</p>
                    </div>
                    <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                      <p className="text-2xl font-bold text-yellow-600">{csvResults.skipped}</p>
                      <p className="text-xs text-gray-500">Skipped</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-3 rounded-xl flex items-center gap-2 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}

          {/* Import button */}
          {csvFile && csvPreview && !csvResults && (
            <div className="flex justify-end">
              <button
                onClick={runCsvImport}
                disabled={importing}
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-semibold"
              >
                {importing ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Importing...</>
                ) : (
                  <><Upload className="w-5 h-5" /> Import {csvPreview.rowCount} Records</>
                )}
              </button>
            </div>
          )}

          {/* Post-import actions */}
          {csvResults && (
            <div className="flex gap-3">
              <button
                onClick={() => { setCsvFile(null); setCsvPreview(null); setCsvResults(null); }}
                className="flex-1 py-2.5 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-900 dark:text-white font-medium"
              >
                Import More
              </button>
              <button onClick={resetAll} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
