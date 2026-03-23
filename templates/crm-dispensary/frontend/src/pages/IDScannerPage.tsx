import { useState, useEffect } from 'react';
import { ScanLine, Shield, AlertTriangle, CheckCircle, XCircle, User, Clock, Search, RefreshCw, CreditCard } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const scanMethods = [
  { value: 'barcode', label: 'Barcode Scanner' },
  { value: 'magnetic', label: 'Magnetic Stripe' },
  { value: 'manual', label: 'Manual Entry' },
];

const verificationColors: Record<string, string> = {
  verified: 'bg-green-100 text-green-700',
  underage: 'bg-red-100 text-red-700',
  expired: 'bg-red-100 text-red-700',
  flagged: 'bg-orange-100 text-orange-700',
  pending: 'bg-yellow-100 text-yellow-700',
};

export default function IDScannerPage() {
  const { isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('scan');

  // Scan
  const [scanMethod, setScanMethod] = useState('barcode');
  const [rawData, setRawData] = useState('');
  const [manualForm, setManualForm] = useState({ name: '', dob: '', idNumber: '', state: '', expiry: '' });
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);

  // History
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState('');
  const [historySearch, setHistorySearch] = useState('');

  // Flagged
  const [flagged, setFlagged] = useState<any[]>([]);
  const [loadingFlagged, setLoadingFlagged] = useState(false);

  // Stats
  const [stats, setStats] = useState<any>({ scansToday: 0, underageAttempts: 0, expiredIds: 0 });

  useEffect(() => {
    loadStats();
  }, []);

  useEffect(() => {
    if (tab === 'history') loadHistory();
    if (tab === 'flagged') loadFlagged();
  }, [tab, historyFilter, historySearch]);

  const loadStats = async () => {
    try {
      const data = await api.get('/api/id-scanner/stats');
      if (data) setStats(data);
    } catch (err) {
      console.error('Failed to load scanner stats:', err);
    }
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const params: any = { limit: 50 };
      if (historyFilter) params.status = historyFilter;
      if (historySearch) params.search = historySearch;
      const data = await api.get('/api/id-scanner/history', params);
      setHistory(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load scan history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadFlagged = async () => {
    setLoadingFlagged(true);
    try {
      const data = await api.get('/api/id-scanner/flagged');
      setFlagged(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load flagged scans:', err);
    } finally {
      setLoadingFlagged(false);
    }
  };

  const handleScan = async () => {
    if (scanMethod === 'manual') {
      if (!manualForm.name || !manualForm.dob || !manualForm.idNumber) {
        toast.error('Name, date of birth, and ID number are required');
        return;
      }
    } else {
      if (!rawData.trim()) {
        toast.error('Please scan or enter ID data');
        return;
      }
    }

    setScanning(true);
    setScanResult(null);
    try {
      const payload = scanMethod === 'manual'
        ? { method: 'manual', ...manualForm }
        : { method: scanMethod, rawData };
      const result = await api.post('/api/id-scanner/scan', payload);
      setScanResult(result);
      toast.success('ID scanned successfully');
      loadStats();
    } catch (err: any) {
      toast.error(err.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const calculateAge = (dob: string) => {
    if (!dob) return null;
    const birth = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  };

  const tabs = [
    { id: 'scan', label: 'Scan ID', icon: ScanLine },
    { id: 'history', label: 'Scan History', icon: Clock },
    { id: 'flagged', label: 'Flagged', icon: AlertTriangle },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ID Scanner</h1>
          <p className="text-gray-600">Verify customer identity and age compliance</p>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
            <ScanLine className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.scansToday || 0}</p>
            <p className="text-sm text-gray-500">Scans Today</p>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
            <XCircle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.underageAttempts || 0}</p>
            <p className="text-sm text-gray-500">Underage Attempts</p>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.expiredIds || 0}</p>
            <p className="text-sm text-gray-500">Expired IDs</p>
          </div>
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

      {/* Scan Tab */}
      {tab === 'scan' && (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Scan Interface */}
          <div className="bg-white rounded-lg shadow-sm p-6 space-y-6">
            <h3 className="text-lg font-semibold text-gray-900">Scan Interface</h3>

            {/* Method Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Scan Method</label>
              <div className="flex gap-2">
                {scanMethods.map(m => (
                  <button
                    key={m.value}
                    onClick={() => { setScanMethod(m.value); setRawData(''); setScanResult(null); }}
                    className={`px-4 py-2 text-sm font-medium rounded-lg ${
                      scanMethod === m.value
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Input */}
            {scanMethod !== 'manual' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Raw Scan Data</label>
                <textarea
                  value={rawData}
                  onChange={(e) => setRawData(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 font-mono text-sm"
                  rows={4}
                  placeholder={scanMethod === 'barcode' ? 'Scan barcode or paste PDF417 data...' : 'Swipe magnetic stripe or paste data...'}
                />
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    value={manualForm.name}
                    onChange={(e) => setManualForm({ ...manualForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                    placeholder="John Doe"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth *</label>
                    <input
                      type="date"
                      value={manualForm.dob}
                      onChange={(e) => setManualForm({ ...manualForm, dob: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">ID Number *</label>
                    <input
                      type="text"
                      value={manualForm.idNumber}
                      onChange={(e) => setManualForm({ ...manualForm, idNumber: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                      placeholder="D1234567"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                    <input
                      type="text"
                      value={manualForm.state}
                      onChange={(e) => setManualForm({ ...manualForm, state: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                      placeholder="CA"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date</label>
                    <input
                      type="date"
                      value={manualForm.expiry}
                      onChange={(e) => setManualForm({ ...manualForm, expiry: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                    />
                  </div>
                </div>
              </div>
            )}

            <Button onClick={handleScan} disabled={scanning}>
              <ScanLine className="w-4 h-4 mr-2 inline" />
              {scanning ? 'Scanning...' : 'Scan ID'}
            </Button>
          </div>

          {/* Scan Result */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Scan Result</h3>
            {scanResult ? (
              <div className="space-y-4">
                {/* Verification Status */}
                <div className={`p-4 rounded-lg flex items-center gap-3 ${
                  scanResult.status === 'verified' ? 'bg-green-50 border border-green-200' :
                  scanResult.status === 'underage' || scanResult.status === 'expired' ? 'bg-red-50 border border-red-200' :
                  'bg-yellow-50 border border-yellow-200'
                }`}>
                  {scanResult.status === 'verified' ? (
                    <CheckCircle className="w-8 h-8 text-green-600 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-8 h-8 text-red-600 flex-shrink-0" />
                  )}
                  <div>
                    <p className="font-semibold text-gray-900">
                      {scanResult.status === 'verified' ? 'Identity Verified' :
                       scanResult.status === 'underage' ? 'UNDERAGE - DO NOT SERVE' :
                       scanResult.status === 'expired' ? 'EXPIRED ID' :
                       'Flagged - Review Required'}
                    </p>
                    <div className="flex gap-2 mt-1">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${verificationColors[scanResult.status]}`}>
                        {scanResult.status}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Parsed Data */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-500 w-24">Name:</span>
                    <span className="font-medium text-gray-900">{scanResult.name || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <CreditCard className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-500 w-24">ID Number:</span>
                    <span className="font-medium text-gray-900">{scanResult.idNumber || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-500 w-24">Date of Birth:</span>
                    <span className="font-medium text-gray-900">
                      {scanResult.dob ? new Date(scanResult.dob).toLocaleDateString() : '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-4 h-4 text-gray-400 text-center font-bold">A</span>
                    <span className="text-gray-500 w-24">Age:</span>
                    <span className={`font-bold text-lg ${
                      (scanResult.age || calculateAge(scanResult.dob)) >= 21 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {scanResult.age || calculateAge(scanResult.dob) || '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Shield className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-500 w-24">State:</span>
                    <span className="font-medium text-gray-900">{scanResult.state || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-500 w-24">Expires:</span>
                    <span className={`font-medium ${
                      scanResult.expiry && new Date(scanResult.expiry) < new Date() ? 'text-red-600' : 'text-gray-900'
                    }`}>
                      {scanResult.expiry ? new Date(scanResult.expiry).toLocaleDateString() : '—'}
                      {scanResult.expiry && new Date(scanResult.expiry) < new Date() && (
                        <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">EXPIRED</span>
                      )}
                    </span>
                  </div>
                </div>

                {/* Customer Match */}
                {scanResult.customerId && (
                  <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-700">
                      <User className="w-4 h-4 inline mr-1" />
                      Matched to existing customer profile
                    </p>
                    <button className="text-sm text-blue-600 hover:underline mt-1 font-medium">
                      View Customer Profile
                    </button>
                  </div>
                )}

                <Button variant="secondary" onClick={() => { setScanResult(null); setRawData(''); setManualForm({ name: '', dob: '', idNumber: '', state: '', expiry: '' }); }}>
                  Clear & Scan Next
                </Button>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <ScanLine className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No scan result yet</p>
                <p className="text-sm text-gray-400 mt-1">Scan an ID to see verification results</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* History Tab */}
      {tab === 'history' && (
        <div>
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name or ID..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              />
            </div>
            <select
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            >
              <option value="">All Statuses</option>
              <option value="verified">Verified</option>
              <option value="underage">Underage</option>
              <option value="expired">Expired</option>
              <option value="flagged">Flagged</option>
            </select>
          </div>
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">DOB</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Age</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID Number</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">State</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingHistory ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center">
                        <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : history.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500">No scan history found</td>
                    </tr>
                  ) : history.map(scan => (
                    <tr key={scan.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {scan.createdAt ? new Date(scan.createdAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{scan.name || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {scan.dob ? new Date(scan.dob).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 font-medium">{scan.age || calculateAge(scan.dob) || '—'}</td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-600">{scan.idNumber || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{scan.state || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{scan.method || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${verificationColors[scan.status] || 'bg-gray-100 text-gray-600'}`}>
                          {scan.status || 'unknown'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Flagged Tab */}
      {tab === 'flagged' && (
        <div>
          {loadingFlagged ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : flagged.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Shield className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No flagged scans</p>
              <p className="text-sm text-gray-400 mt-1">Suspicious or failed scans will appear here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {flagged.map(scan => (
                <div key={scan.id} className="bg-white rounded-lg shadow-sm p-5 border-l-4 border-red-400">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <AlertTriangle className="w-5 h-5 text-red-500" />
                        <span className="font-semibold text-gray-900">{scan.name || 'Unknown'}</span>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${verificationColors[scan.status]}`}>
                          {scan.status}
                        </span>
                      </div>
                      <div className="grid md:grid-cols-3 gap-3 text-sm text-gray-600">
                        <span>ID: {scan.idNumber || '—'}</span>
                        <span>DOB: {scan.dob ? new Date(scan.dob).toLocaleDateString() : '—'}</span>
                        <span>Scanned: {scan.createdAt ? new Date(scan.createdAt).toLocaleString() : '—'}</span>
                      </div>
                      {scan.flagReason && (
                        <p className="text-sm text-red-600 mt-2">Reason: {scan.flagReason}</p>
                      )}
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">
                        Dismiss
                      </button>
                      <button className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200">
                        Report
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
