// src/components/admin/BillingImport.tsx
// Invoice import wizard — ported from CVHC BillingImport.jsx. A CSV exported from an insurer portal
// (or any spreadsheet) becomes draft invoices, one per client per calendar month of service.
// Rows are matched to clients by Medicaid / member ID, then by name; every line needs a caregiver,
// matched from the provider column or picked here.
import React, { useState, useEffect, useRef } from 'react';
import { apiCall } from '../../config';
import { toast } from '../Toast';
import { useAuth } from '../../contexts/AuthContext';

// Column header aliases → canonical field names
const HEADER_MAP = {
  'member id': 'medicaidId', 'medicaid id': 'medicaidId', 'medicaid #': 'medicaidId',
  'mco id': 'medicaidId', 'mco member id': 'medicaidId', 'memberid': 'medicaidId',
  'member name': 'memberName', 'client name': 'memberName', 'patient name': 'memberName',
  'first name': 'firstName', 'firstname': 'firstName',
  'last name': 'lastName', 'lastname': 'lastName',
  'service date': 'serviceDate', 'date of service': 'serviceDate', 'dos': 'serviceDate', 'date': 'serviceDate',
  'units': 'hours', 'hours': 'hours', 'qty': 'hours', 'quantity': 'hours',
  'rate': 'rate', 'hourly rate': 'rate', 'unit rate': 'rate',
  'amount': 'amount', 'total': 'amount', 'charge': 'amount', 'billed amount': 'amount',
  'procedure code': 'procedureCode', 'service code': 'procedureCode', 'hcpcs': 'procedureCode',
  'provider': 'providerName', 'provider name': 'providerName', 'caregiver': 'providerName',
  'description': 'description', 'service description': 'description',
};

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  function splitRow(line) {
    const fields = [];
    let current = '', inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    fields.push(current.trim());
    return fields;
  }
  const headers = splitRow(lines[0]);
  const rows = lines.slice(1).map(l => {
    const vals = splitRow(l);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  }).filter(r => Object.values(r).some(v => v));
  return { headers, rows };
}

const mapHeaders = (rawHeaders) => {
  const mapping = {};
  for (const h of rawHeaders) {
    const key = h.toLowerCase().trim();
    if (HEADER_MAP[key]) mapping[h] = HEADER_MAP[key];
  }
  return mapping;
};

function normalizeRow(raw, headerMapping) {
  const mapped: any = {};
  for (const [rawHeader, value] of Object.entries(raw)) {
    const canonical = headerMapping[rawHeader];
    if (canonical) mapped[canonical] = value;
  }
  // "Member Name" → first/last when there are no separate columns ("Last, First" or "First Last")
  if (mapped.memberName && !mapped.firstName) {
    const parts = mapped.memberName.trim().split(/[,\s]+/);
    if (parts.length >= 2 && mapped.memberName.includes(',')) {
      mapped.lastName = parts[0];
      mapped.firstName = parts.slice(1).join(' ');
    } else {
      mapped.firstName = parts[0];
      mapped.lastName = parts.slice(1).join(' ');
    }
  }
  // Dates arrive as M/D/YYYY or YYYY-MM-DD; the server wants YYYY-MM-DD.
  const us = String(mapped.serviceDate || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) mapped.serviceDate = `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return mapped;
}

const nameKey = (first, last) => `${String(first || '').trim().toLowerCase()}|${String(last || '').trim().toLowerCase()}`;

const BillingImport = () => {
  const { token } = useAuth();
  const [step, setStep] = useState(1);
  const [clients, setClients] = useState([]);
  const [caregivers, setCaregivers] = useState([]);
  const [headerMapping, setHeaderMapping] = useState({});
  const [mappedRows, setMappedRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);
  const [source, setSource] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    apiCall('/api/clients', { method: 'GET' }, token)
      .then(data => setClients(Array.isArray(data) ? data : (data?.clients || [])))
      .catch(() => {});
    apiCall('/api/users?role=caregiver', { method: 'GET' }, token)
      .then(data => setCaregivers(Array.isArray(data) ? data : (data?.caregivers || data?.users || [])))
      .catch(() => {});
  }, [token]);

  const medicaidMap = {};
  const nameMap = {};
  for (const c of clients) {
    if (c.medicaid_id) medicaidMap[String(c.medicaid_id).trim()] = c;
    if (c.mco_member_id) medicaidMap[String(c.mco_member_id).trim()] = c;
    nameMap[nameKey(c.first_name, c.last_name)] = c;
  }
  const caregiverByName = {};
  for (const cg of caregivers) {
    caregiverByName[`${cg.first_name || ''} ${cg.last_name || ''}`.trim().toLowerCase()] = cg;
    caregiverByName[`${cg.last_name || ''}, ${cg.first_name || ''}`.trim().toLowerCase()] = cg;
  }

  const matchClient = (row) => {
    if (row.medicaidId && medicaidMap[row.medicaidId.trim()]) return { client: medicaidMap[row.medicaidId.trim()], matchType: 'Medicaid ID' };
    if (row.firstName && row.lastName && nameMap[nameKey(row.firstName, row.lastName)]) return { client: nameMap[nameKey(row.firstName, row.lastName)], matchType: 'Name' };
    return null;
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setSource(file.name.replace(/\.csv$/i, ''));
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { headers, rows } = parseCSV(String(ev.target?.result || ''));
      const mapping = mapHeaders(headers);
      setHeaderMapping(mapping);
      setMappedRows(rows.map((raw, idx) => {
        const norm = normalizeRow(raw, mapping);
        const match = matchClient(norm);
        const cg = norm.providerName ? caregiverByName[String(norm.providerName).trim().toLowerCase()] : null;
        return {
          idx: idx + 1, ...norm,
          clientId: match?.client?.id || null,
          clientName: match ? `${match.client.first_name} ${match.client.last_name}` : null,
          matchType: match?.matchType || null,
          caregiverId: cg?.id || null,
          included: !!match,
        };
      }));
      setStep(2);
    };
    reader.readAsText(file);
  };

  const updateRow = (i, patch) => setMappedRows(prev => prev.map((r, j) => j === i ? { ...r, ...patch } : r));
  const assignClient = (i, clientId) => {
    const c = clients.find(x => x.id === clientId);
    updateRow(i, { clientId: c?.id || null, clientName: c ? `${c.first_name} ${c.last_name}` : null, matchType: c ? 'Manual' : null, included: !!c });
  };
  const assignCaregiverToUnmatched = (caregiverId) => setMappedRows(prev => prev.map(r => (r.caregiverId ? r : { ...r, caregiverId: caregiverId || null })));

  const matchedCount = mappedRows.filter(r => r.clientId).length;
  const ready = mappedRows.filter(r => r.included && r.clientId && r.caregiverId);
  const missingCaregiver = mappedRows.filter(r => r.included && r.clientId && !r.caregiverId).length;

  const handleImport = async () => {
    const toImport = ready.map(r => ({
      clientId: r.clientId, caregiverId: r.caregiverId,
      serviceDate: r.serviceDate || null,
      hours: r.hours || '0', rate: r.rate || '0', amount: r.amount || '',
      description: r.procedureCode || r.description || '',
    }));
    if (toImport.length === 0) { toast('No rows to import', 'warning'); return; }
    setImporting(true);
    try {
      const res = await apiCall('/api/billing/import-csv', { method: 'POST', body: JSON.stringify({ rows: toImport, source }) }, token);
      if (!res) { toast('Import failed — rate limited, try again', 'error'); return; }
      setResults(res);
      setStep(3);
      toast(`Imported ${res.imported} line items into ${res.invoicesCreated} draft invoices`, 'success');
    } catch (err) {
      toast(err.message || 'Import failed', 'error');
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setStep(1); setHeaderMapping({}); setMappedRows([]); setFileName(''); setResults(null); setSource('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const th = 'whitespace-nowrap border-b-2 border-gray-200 px-2.5 py-2 text-left font-semibold text-gray-700 dark:border-slate-700 dark:text-slate-200';
  const td = 'whitespace-nowrap px-2.5 py-1.5 text-gray-900 dark:text-slate-100';

  if (step === 1) {
    return (
      <div className="p-6">
        <h2 className="mb-2">Invoice Import</h2>
        <p className="mb-6 text-gray-600 dark:text-slate-400">
          Upload a CSV exported from an insurer portal or a spreadsheet. Each client's rows become one draft invoice per month of service.
        </p>
        <button type="button" onClick={() => fileRef.current?.click()}
          className="w-full cursor-pointer rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-12 text-center text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
          <div className="mb-3 text-5xl" aria-hidden="true">📄</div>
          <p className="mb-1 font-semibold">Click to select a CSV file</p>
          <p className="text-sm text-gray-600 dark:text-slate-400">Member / Medicaid ID or name, service date, units or hours, rate or amount, provider</p>
        </button>
        <input ref={fileRef} type="file" accept=".csv" onChange={handleFileUpload} className="hidden" aria-label="CSV file to import" />
        <div className="mt-6 rounded-lg bg-sky-50 p-4 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          <strong>Supported columns:</strong> Member ID / Medicaid ID, Member Name (or First / Last Name), Service Date, Units/Hours, Rate, Amount, Procedure Code, Provider Name
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="mb-1">Preview Import</h2>
            <p className="text-sm text-gray-600 dark:text-slate-400">{fileName} — {mappedRows.length} rows</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={reset}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={handleImport} disabled={importing || ready.length === 0}>
              {importing ? 'Importing...' : `Import ${ready.length} rows`}
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-6 rounded-lg bg-gray-100 px-4 py-3 text-sm text-gray-900 dark:bg-slate-800 dark:text-slate-100">
          <span><strong>{mappedRows.length}</strong> total rows</span>
          <span className="text-emerald-700 dark:text-emerald-300"><strong>{matchedCount}</strong> matched</span>
          <span className="text-red-700 dark:text-red-300"><strong>{mappedRows.length - matchedCount}</strong> unmatched</span>
          <span className="text-blue-700 dark:text-blue-300"><strong>{ready.length}</strong> ready to import</span>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-4">
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="import-source">Imported from (printed on each invoice's notes)</label>
            <input id="import-source" type="text" value={source} onChange={(e) => setSource(e.target.value)} />
          </div>
          {missingCaregiver > 0 && (
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="import-cg">{missingCaregiver} row{missingCaregiver === 1 ? '' : 's'} need a caregiver — set all of them to</label>
              <select id="import-cg" value="" onChange={(e) => assignCaregiverToUnmatched(e.target.value)}>
                <option value="">Choose a caregiver…</option>
                {caregivers.map(cg => <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>)}
              </select>
            </div>
          )}
        </div>

        {Object.keys(headerMapping).length > 0 && (
          <div className="mb-4 text-xs text-gray-600 dark:text-slate-400">
            <strong>Detected columns:</strong> {Object.entries(headerMapping).map(([raw, mapped]) => `${raw} → ${mapped}`).join(', ')}
          </div>
        )}

        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="sticky top-0 z-[1] bg-gray-50 dark:bg-slate-900">
                <th className={th}>Include</th><th className={th}>#</th><th className={th}>CSV Name / ID</th>
                <th className={th}>Matched Client</th><th className={th}>Match</th><th className={th}>Caregiver</th>
                <th className={th}>Service Date</th><th className={th}>Hours</th><th className={th}>Rate</th><th className={th}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {mappedRows.map((row, i) => (
                <tr key={i} className={`border-b border-gray-200 dark:border-slate-700 ${row.included ? 'bg-white dark:bg-slate-800' : 'bg-red-50 dark:bg-red-950/30'}`}>
                  <td className={td}>
                    <input type="checkbox" aria-label={`Include row ${row.idx}`} checked={row.included} onChange={() => updateRow(i, { included: !row.included })} disabled={!row.clientId} />
                  </td>
                  <td className={td}>{row.idx}</td>
                  <td className={td}>{row.memberName || `${row.firstName || ''} ${row.lastName || ''}`.trim() || row.medicaidId || '—'}</td>
                  <td className={td}>
                    {row.clientId ? (
                      <span className="font-medium text-emerald-700 dark:text-emerald-300">{row.clientName}</span>
                    ) : (
                      <select aria-label={`Client for row ${row.idx}`} value="" onChange={(e) => assignClient(i, e.target.value)} className="max-w-[180px] text-xs">
                        <option value="">-- Assign client --</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name} {c.medicaid_id ? `(${c.medicaid_id})` : ''}</option>)}
                      </select>
                    )}
                  </td>
                  <td className={td}>
                    {row.matchType && (
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${row.matchType === 'Medicaid ID'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                        : row.matchType === 'Name' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'}`}>{row.matchType}</span>
                    )}
                  </td>
                  <td className={td}>
                    <select aria-label={`Caregiver for row ${row.idx}`} value={row.caregiverId || ''} onChange={(e) => updateRow(i, { caregiverId: e.target.value || null })} className="max-w-[180px] text-xs">
                      <option value="">{row.providerName ? `-- ${row.providerName}? --` : '-- Caregiver --'}</option>
                      {caregivers.map(cg => <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>)}
                    </select>
                  </td>
                  <td className={td}>{row.serviceDate || '—'}</td>
                  <td className={td}>{row.hours || '—'}</td>
                  <td className={td}>{row.rate ? `$${row.rate}` : '—'}</td>
                  <td className={td}>{row.amount ? `$${Number(parseFloat(row.amount || 0)).toFixed(2)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (step === 3 && results) {
    const stat = (label, value, tone) => (
      <div className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-800">
        <div className={`text-3xl font-bold ${tone}`}>{value}</div>
        <div className="text-sm text-gray-600 dark:text-slate-400">{label}</div>
      </div>
    );
    return (
      <div className="p-6">
        <h2 className="mb-4">Import Complete</h2>
        <div className="mb-6 flex flex-wrap gap-4">
          {stat('Line Items Imported', results.imported, 'text-emerald-700 dark:text-emerald-300')}
          {stat('Draft Invoices Created', results.invoicesCreated, 'text-blue-700 dark:text-blue-300')}
          {stat('Rows Skipped', results.skipped, 'text-amber-700 dark:text-amber-300')}
        </div>
        {results.errors?.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-2 text-sm">Errors ({results.errors.length})</h3>
            <div className="max-h-52 overflow-y-auto rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">
              {results.errors.map((err, i) => (
                <div key={i} className="border-b border-red-200 py-1 dark:border-red-800">{err.row ? `Row ${err.row}: ` : ''}{err.error}</div>
              ))}
            </div>
          </div>
        )}
        <button type="button" className="btn btn-primary" onClick={reset}>Import Another File</button>
      </div>
    );
  }
  return null;
};

export default BillingImport;
