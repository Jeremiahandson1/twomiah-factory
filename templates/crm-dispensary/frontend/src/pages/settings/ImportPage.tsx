// Settings → Import.
//
// T45 H4: onboarding told owners to bring their customers and products across at "Settings >
// Import", and there was no such screen anywhere in the product — the API had been there the whole
// time with a template, a preview and two importers behind it, and nothing called any of them. An
// owner moving off Dutchie had no way in but the API.
//
// The flow is deliberately three steps: pick a file, SEE what the file contains and what would be
// refused, then import. An import that reports "24 imported, 6 skipped" after the fact is not a
// thing anyone can act on; the preview is what makes it one.
import { useState } from 'react';
import { Upload, Download, FileText, Users, Package, AlertCircle, Check, Loader2 } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

type ImportType = 'contacts' | 'products';

const TYPES: Array<{ id: ImportType; label: string; icon: any; blurb: string }> = [
  {
    id: 'contacts',
    label: 'Customers',
    icon: Users,
    blurb: 'Name, email, phone, date of birth and medical card number. A customer under 21 with no medical card is refused, not imported.',
  },
  {
    id: 'products',
    label: 'Products',
    icon: Package,
    blurb: 'Name, SKU, category, strain, potency, price and stock. A negative price or an unknown category is refused.',
  },
];

export default function ImportPage() {
  const toast = useToast();
  const { user } = useAuth() as any;
  const [type, setType] = useState<ImportType>('contacts');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);

  // The API is admin-only (src/routes/import.ts mounts requireRole('admin')). Say so rather than
  // hand a manager an upload box that answers 403.
  const role = String(user?.role || '').toLowerCase();
  const canImport = role === 'admin' || role === 'owner';

  const reset = () => { setFile(null); setPreview(null); setResult(null); };

  const pickType = (next: ImportType) => { setType(next); reset(); };

  const onFile = (f: File | null) => {
    setFile(f);
    setPreview(null);
    setResult(null);
  };

  const downloadTemplate = async () => {
    try {
      // The template endpoint answers a CSV body, not JSON — api.getText keeps the session's
      // auth header without routing the body through the JSON parser.
      const text = await api.getText(`/api/import/template/${type}`);
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}-template.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err.message || 'Could not download the template');
    }
  };

  const runPreview = async () => {
    if (!file) { toast.error('Choose a CSV file first'); return; }
    setPreviewing(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await api.upload(`/api/import/preview/${type}`, form) as any;
      setPreview(data);
      if (data?.valid === false) toast.error(data.error || 'That file cannot be imported');
    } catch (err: any) {
      toast.error(err.message || 'Could not read that file');
    } finally {
      setPreviewing(false);
    }
  };

  const runImport = async () => {
    if (!file) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await api.upload(`/api/import/${type}`, form) as any;
      setResult(data);
      const imported = Number(data?.imported || 0);
      const errors = (data?.errors || []).length;
      if (imported > 0 && errors === 0) toast.success(`${imported} ${type === 'contacts' ? 'customers' : 'products'} imported`);
      else if (imported > 0) toast.success(`${imported} imported, ${errors} row${errors === 1 ? '' : 's'} refused`);
      else toast.error('Nothing was imported — every row was refused');
    } catch (err: any) {
      toast.error(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const active = TYPES.find(t => t.id === type)!;

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2 dark:text-slate-100">Import</h1>
      <p className="text-gray-500 mb-6 dark:text-slate-400">
        Bring customers and products across from another system as a CSV file.
      </p>

      {!canImport && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg flex items-center gap-2 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-200">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          Importing is an owner or admin job. Ask one of them to run this.
        </div>
      )}

      {/* What to import */}
      <div className="flex gap-3 mb-6">
        {TYPES.map(t => (
          <button
            key={t.id}
            onClick={() => pickType(t.id)}
            className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition ${
              type === t.id
                ? 'border-green-500 bg-green-50 dark:bg-green-500/10 dark:border-green-500'
                : 'border-gray-200 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800'
            }`}
          >
            <t.icon className={`w-5 h-5 ${type === t.id ? 'text-green-600' : 'text-gray-400'}`} />
            <span className={`font-medium ${type === t.id ? 'text-green-700 dark:text-green-300' : 'text-gray-700 dark:text-slate-200'}`}>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border p-6 space-y-5 dark:bg-slate-900 dark:border-slate-700">
        <p className="text-sm text-gray-600 dark:text-slate-400">{active.blurb}</p>

        <div>
          <button
            onClick={downloadTemplate}
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Download className="w-4 h-4" />
            Download the {active.label.toLowerCase()} template
          </button>
          <p className="text-xs text-gray-500 mt-2 dark:text-slate-400">
            The template's column names are the ones this import understands. Extra columns are ignored.
          </p>
        </div>

        {/* File */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">CSV file</label>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={!canImport}
            onChange={(e) => onFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-green-50 file:text-green-700 file:font-medium hover:file:bg-green-100 disabled:opacity-50 dark:text-slate-300"
          />
          {file && (
            <p className="text-xs text-gray-500 mt-2 dark:text-slate-400">
              <FileText className="w-3 h-3 inline mr-1" />{file.name} ({Math.max(1, Math.round(file.size / 1024))} KB)
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={runPreview}
            disabled={!file || previewing || !canImport}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
          >
            {previewing ? <><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Checking…</> : 'Check the file'}
          </button>
          <button
            onClick={runImport}
            disabled={!file || importing || !canImport || preview?.valid === false}
            className="px-4 py-2 bg-green-700 text-white rounded-lg font-medium hover:bg-green-800 disabled:opacity-50"
          >
            {importing ? <><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Importing…</> : <><Upload className="w-4 h-4 inline mr-2" />Import</>}
          </button>
        </div>

        {/* What the file contains */}
        {preview && (
          <div className={`rounded-lg border p-4 ${preview.valid ? 'border-gray-200 bg-gray-50 dark:bg-slate-800 dark:border-slate-700' : 'border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800'}`}>
            {preview.valid === false ? (
              <div className="flex items-start gap-2 text-red-700 dark:text-red-300">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">This file cannot be imported</p>
                  <p className="text-sm mt-1">{preview.error}</p>
                  {preview.columns && (
                    <p className="text-xs mt-2">Columns found: {preview.columns.join(', ')}</p>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <p className="font-medium text-gray-900 dark:text-slate-100">
                  <Check className="w-4 h-4 inline mr-1 text-green-600 dark:text-green-300" />
                  {typeof preview.willImport === 'number'
                    ? `${preview.willImport} of ${preview.rowCount} row${preview.rowCount === 1 ? '' : 's'} will import`
                    : `${preview.rowCount} row${preview.rowCount === 1 ? '' : 's'} ready to import`}
                </p>
                {/* What the import WOULD refuse, before it is run. The check used to say only that
                    the file was readable, so a 2012-born customer and a duplicate SKU sailed
                    through it and were only reported after the import had committed. (T46 N20) */}
                {Array.isArray(preview.errors) && preview.errors.length > 0 && (
                  <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                      {preview.errors.length} row{preview.errors.length === 1 ? '' : 's'} will be refused
                    </p>
                    <ul className="mt-2 space-y-1">
                      {preview.errors.slice(0, 25).map((e: any, i: number) => (
                        <li key={i} className="text-xs text-amber-900 dark:text-amber-200">
                          Line {e.line}: {e.error}
                        </li>
                      ))}
                    </ul>
                    {preview.errors.length > 25 && (
                      <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">…and {preview.errors.length - 25} more.</p>
                    )}
                    <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
                      Importing now brings in the rest. Fix these rows in the file and import again to add them.
                    </p>
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">Columns: {(preview.columns || []).join(', ')}</p>
                {Array.isArray(preview.sample) && preview.sample.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500 dark:text-slate-400">
                          {Object.keys(preview.sample[0]).slice(0, 6).map((k: string) => (
                            <th key={k} className="py-1 pr-4 font-medium">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.sample.map((row: any, i: number) => (
                          <tr key={i} className="border-t dark:border-slate-700">
                            {Object.keys(preview.sample[0]).slice(0, 6).map((k: string) => (
                              <td key={k} className="py-1 pr-4 text-gray-700 dark:text-slate-200">{String(row[k] ?? '')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">First {preview.sample.length} rows.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* What happened */}
        {result && (
          <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
            <p className="font-medium text-gray-900 dark:text-slate-100">
              {Number(result.imported || 0)} imported
              {Number(result.skipped || 0) > 0 && `, ${result.skipped} skipped as duplicates`}
              {(result.errors || []).length > 0 && `, ${result.errors.length} refused`}
            </p>
            {(result.errors || []).length > 0 && (
              <div className="mt-3">
                {/* Every refusal names its row and its reason, so a bad file can be fixed and
                    re-uploaded rather than guessed at. */}
                <p className="text-sm font-medium text-gray-600 mb-2 dark:text-slate-400">Rows that were refused</p>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 dark:text-slate-400">
                        <th className="py-1 pr-4 font-medium w-16">Row</th>
                        <th className="py-1 font-medium">Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((e: any, i: number) => (
                        <tr key={i} className="border-t dark:border-slate-700">
                          <td className="py-1.5 pr-4 tabular-nums text-gray-500 dark:text-slate-400">{e.line}</td>
                          <td className="py-1.5 text-gray-700 dark:text-slate-200">{e.error}</td>
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
    </div>
  );
}
