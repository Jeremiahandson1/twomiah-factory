import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Link2, Unlink, RefreshCw, Download, Upload, Check, X, 
  AlertCircle, Loader2, Building2, Users, FileText, CreditCard 
} from 'lucide-react';
import api from '../../services/api';

export default function QuickBooksSettings() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [companyInfo, setCompanyInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(null);
  const [syncResults, setSyncResults] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    loadStatus();

    // Check for callback params
    const qbo = searchParams.get('qbo');
    const error = searchParams.get('error');
    
    if (qbo === 'connected') {
      setMessage({ type: 'success', text: 'Successfully connected to QuickBooks!' });
    } else if (error) {
      setMessage({ type: 'error', text: `Connection failed: ${error}` });
    }
  }, [searchParams]);

  const loadStatus = async () => {
    try {
      const statusRes = await api.get('/quickbooks/status');
      setStatus(statusRes);

      if (statusRes.connected) {
        try {
          const info = await api.get('/quickbooks/company-info');
          setCompanyInfo(info);
        } catch (e) {
          // Company info is optional
        }
      }
    } catch (error) {
      console.error('Failed to load QuickBooks status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    try {
      const { url } = await api.get('/quickbooks/auth-url');
      window.location.href = url;
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to start connection' });
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect QuickBooks? This will stop all syncing.')) return;

    try {
      await api.post('/quickbooks/disconnect');
      setStatus({ connected: false });
      setCompanyInfo(null);
      setMessage({ type: 'success', text: 'QuickBooks disconnected' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to disconnect' });
    }
  };

  const handleSync = async (type) => {
    setSyncing(type);
    setSyncResults(null);

    try {
      let result;
      switch (type) {
        case 'customers':
          result = await api.post('/quickbooks/sync/customers');
          break;
        case 'invoices':
          result = await api.post('/quickbooks/sync/invoices');
          break;
        case 'import-customers':
          result = await api.post('/quickbooks/import/customers');
          break;
        default:
          throw new Error('Unknown sync type');
      }

      setSyncResults({
        type,
        ...result,
      });
      setMessage({ type: 'success', text: `Sync completed: ${result.successful || result.total} items processed` });
      loadStatus();
    } catch (error) {
      setMessage({ type: 'error', text: `Sync failed: ${error.message}` });
    } finally {
      setSyncing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Message */}
      {message && (
        <div className={`p-4 rounded-lg flex items-center gap-3 ${
          message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
        }`}>
          {message.type === 'success' ? <Check className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Connection Status */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
              <img 
                src="https://www.vectorlogo.zone/logos/intikibooks/intikibooks-icon.svg" 
                alt="QuickBooks"
                className="w-8 h-8"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">QuickBooks Online</h2>
              <p className="text-gray-500">
                {status?.connected ? 'Connected' : 'Not connected'}
              </p>
            </div>
          </div>

          {status?.connected ? (
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-2 px-4 py-2 text-red-600 border border-red-300 rounded-lg hover:bg-red-50"
            >
              <Unlink className="w-4 h-4" />
              Disconnect
            </button>
          ) : (
            <button
              onClick={handleConnect}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              <Link2 className="w-4 h-4" />
              Connect QuickBooks
            </button>
          )}
        </div>

        {/* Connected company info */}
        {status?.connected && companyInfo && (
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center gap-3">
              <Building2 className="w-5 h-5 text-gray-400" />
              <div>
                <p className="font-medium text-gray-900">{companyInfo.CompanyName}</p>
                <p className="text-sm text-gray-500">
                  Realm ID: {status.realmId}
                  {status.lastSyncAt && ` • Last synced: ${new Date(status.lastSyncAt).toLocaleString()}`}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sync Options */}
      {status?.connected && (
        <>
          {/* Sync to QuickBooks */}
          <div className="bg-white rounded-xl border p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Sync to QuickBooks
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Push your Twomiah Build data to QuickBooks
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SyncCard
                icon={Users}
                title="Sync Customers"
                description="Push all clients to QuickBooks"
                onClick={() => handleSync('customers')}
                loading={syncing === 'customers'}
              />
              <SyncCard
                icon={FileText}
                title="Sync Invoices"
                description="Push sent invoices to QuickBooks"
                onClick={() => handleSync('invoices')}
                loading={syncing === 'invoices'}
              />
            </div>
          </div>

          {/* Import from QuickBooks */}
          <div className="bg-white rounded-xl border p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Download className="w-5 h-5" />
              Import from QuickBooks
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Pull data from QuickBooks into Twomiah Build
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SyncCard
                icon={Users}
                title="Import Customers"
                description="Import customers from QuickBooks"
                onClick={() => handleSync('import-customers')}
                loading={syncing === 'import-customers'}
              />
            </div>
          </div>

          {/* Sync Results */}
          {syncResults && (
            <div className="bg-white rounded-xl border p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Sync Results</h3>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-2xl font-bold">{syncResults.total}</p>
                  <p className="text-sm text-gray-500">Total</p>
                </div>
                <div className="text-center p-3 bg-green-50 rounded-lg">
                  <p className="text-2xl font-bold text-green-600">{syncResults.successful || syncResults.created || 0}</p>
                  <p className="text-sm text-gray-500">Successful</p>
                </div>
                <div className="text-center p-3 bg-red-50 rounded-lg">
                  <p className="text-2xl font-bold text-red-600">{syncResults.failed || 0}</p>
                  <p className="text-sm text-gray-500">Failed</p>
                </div>
              </div>

              {syncResults.results?.some(r => !r.success) && (
                <div className="mt-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">Errors:</p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {syncResults.results
                      .filter(r => !r.success)
                      .map((r, i) => (
                        <div key={i} className="text-sm text-red-600 bg-red-50 px-3 py-1 rounded">
                          {r.number || r.id}: {r.error}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Auto-sync settings */}
          <div className="bg-white rounded-xl border p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <RefreshCw className="w-5 h-5" />
              Automatic Sync
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Configure automatic syncing (coming soon)
            </p>

            <div className="space-y-3 opacity-50">
              <label className="flex items-center gap-3">
                <input type="checkbox" disabled className="rounded" />
                <span className="text-sm">Auto-sync new customers</span>
              </label>
              <label className="flex items-center gap-3">
                <input type="checkbox" disabled className="rounded" />
                <span className="text-sm">Auto-sync sent invoices</span>
              </label>
              <label className="flex items-center gap-3">
                <input type="checkbox" disabled className="rounded" />
                <span className="text-sm">Auto-sync payments</span>
              </label>
            </div>
          </div>
        </>
      )}

      {/* Setup instructions when not connected */}
      {!status?.connected && (
        <div className="bg-blue-50 rounded-xl p-6">
          <h3 className="font-semibold text-blue-900 mb-2">How to Connect</h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800">
            <li>Click "Connect QuickBooks" above</li>
            <li>Sign in to your QuickBooks Online account</li>
            <li>Authorize Twomiah Build to access your data</li>
            <li>You'll be redirected back here once connected</li>
          </ol>
          <p className="mt-4 text-xs text-blue-600">
            Twomiah Build will only access customer and invoice data. Your financial reports and 
            sensitive information remain private.
          </p>
        </div>
      )}
    </div>
  );
}

function SyncCard({ icon: Icon, title, description, onClick, loading }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 disabled:opacity-50 text-left transition-colors"
    >
      <div className="p-2 bg-orange-100 rounded-lg">
        {loading ? (
          <Loader2 className="w-5 h-5 text-orange-600 animate-spin" />
        ) : (
          <Icon className="w-5 h-5 text-orange-600" />
        )}
      </div>
      <div>
        <p className="font-medium text-gray-900">{title}</p>
        <p className="text-sm text-gray-500">{description}</p>
      </div>
    </button>
  );
}
