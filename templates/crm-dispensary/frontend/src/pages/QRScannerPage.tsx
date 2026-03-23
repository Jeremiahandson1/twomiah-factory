import { useState, useEffect, useCallback } from 'react';
import {
  Camera, QrCode, BarChart3, Search, Plus, Package, Leaf, FlaskConical,
  ShoppingCart, Eye, ClipboardCopy, Printer, CheckCircle, XCircle,
  AlertTriangle, Clock, Layers, Scan, Keyboard, ChevronRight, Hash
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

/* ─── Constants ─── */

const scanContexts = [
  { value: 'pos_checkout', label: 'POS Checkout', icon: ShoppingCart },
  { value: 'inventory_count', label: 'Inventory Count', icon: Package },
  { value: 'input_application', label: 'Input Application', icon: Leaf },
  { value: 'receiving', label: 'Receiving', icon: Layers },
  { value: 'customer_info', label: 'Customer Info', icon: Search },
];

const entityTypes = [
  { value: 'product', label: 'Product' },
  { value: 'batch', label: 'Batch' },
  { value: 'plant', label: 'Plant' },
  { value: 'input', label: 'Input' },
];

const tabs = [
  { id: 'scanner', label: 'Scanner', icon: Camera },
  { id: 'generator', label: 'QR Generator', icon: QrCode },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
];

/* ─── Main Page ─── */

export default function QRScannerPage() {
  const [activeTab, setActiveTab] = useState('scanner');

  return (
    <div>
      <PageHeader title="QR Scanner" subtitle="Scan, generate, and track QR codes" />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'bg-orange-500 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'scanner' && <ScannerTab />}
      {activeTab === 'generator' && <GeneratorTab />}
      {activeTab === 'analytics' && <AnalyticsTab />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Scanner Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function ScannerTab() {
  const toast = useToast();
  const [context, setContext] = useState('pos_checkout');
  const [manualInput, setManualInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [recentScans, setRecentScans] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const loadRecentScans = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await api.get('/api/qr-scanner/history', { limit: 20 });
      setRecentScans(Array.isArray(data) ? data : data?.data || []);
    } catch {} finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => { loadRecentScans(); }, [loadRecentScans]);

  const handleScan = async (data?: string) => {
    const scanData = data || manualInput.trim();
    if (!scanData) { toast.error('Enter QR data or a SKU/barcode'); return; }
    setScanning(true);
    setResult(null);
    try {
      const res = await api.post('/api/qr-scanner/scan', {
        data: scanData,
        context,
      });
      setResult(res);
      setManualInput('');
      loadRecentScans();
    } catch (err: any) {
      toast.error(err.message || 'Scan failed — item not found');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Camera Viewport */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="bg-gray-900 aspect-video max-h-80 flex flex-col items-center justify-center relative">
          <div className="absolute inset-8 border-2 border-dashed border-gray-600 rounded-xl" />
          <Camera className="w-16 h-16 text-gray-600 mb-4" />
          <p className="text-gray-400 text-lg font-medium">Camera Preview</p>
          <p className="text-gray-500 text-sm mt-1">
            Point camera at QR code or barcode to scan
          </p>
          <p className="text-gray-600 text-xs mt-3">
            Requires html5-qrcode or @zxing/browser integration
          </p>
        </div>

        {/* Manual Entry */}
        <div className="p-4 border-t border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <Keyboard className="w-4 h-4 inline mr-1" />Manual Entry
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Paste QR data or type a product SKU/barcode..."
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScan()}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            />
            <Button onClick={() => handleScan()} disabled={scanning}>
              <Scan className="w-4 h-4 mr-2 inline" />
              {scanning ? 'Scanning...' : 'Scan'}
            </Button>
          </div>
        </div>

        {/* Context Selector */}
        <div className="p-4 border-t border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-2">Scan Context</label>
          <div className="flex flex-wrap gap-2">
            {scanContexts.map((ctx) => (
              <button
                key={ctx.value}
                onClick={() => setContext(ctx.value)}
                className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  context === ctx.value
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <ctx.icon className="w-4 h-4" />
                {ctx.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scan Result */}
      {result && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Scan Result</h3>

          {result.entityType === 'product' && (
            <ProductResultCard result={result} context={context} toast={toast} />
          )}

          {result.entityType === 'input' && (
            <InputResultCard result={result} context={context} toast={toast} />
          )}

          {result.entityType === 'batch' && (
            <BatchResultCard result={result} toast={toast} />
          )}

          {!['product', 'input', 'batch'].includes(result.entityType) && (
            <div className="text-gray-500">
              <p className="font-medium">Entity: {result.entityType || 'Unknown'}</p>
              <pre className="mt-2 p-3 bg-gray-50 rounded-lg text-xs overflow-auto">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Recent Scans */}
      <div className="bg-white rounded-lg shadow-sm">
        <div className="px-4 py-3 border-b">
          <h3 className="font-semibold text-gray-900">Recent Scans</h3>
        </div>
        {loadingHistory ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : recentScans.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-500 text-sm">No recent scans</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {recentScans.map((scan: any, i: number) => (
              <button
                key={scan.id || i}
                onClick={() => handleScan(scan.data)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    scan.entityType === 'product' ? 'bg-green-100' :
                    scan.entityType === 'input' ? 'bg-blue-100' :
                    scan.entityType === 'batch' ? 'bg-purple-100' :
                    'bg-gray-100'
                  }`}>
                    {scan.entityType === 'product' ? <Package className="w-4 h-4 text-green-600" /> :
                     scan.entityType === 'input' ? <Leaf className="w-4 h-4 text-blue-600" /> :
                     scan.entityType === 'batch' ? <Layers className="w-4 h-4 text-purple-600" /> :
                     <QrCode className="w-4 h-4 text-gray-600" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{scan.label || scan.data}</p>
                    <p className="text-xs text-gray-500">
                      {scan.context?.replace(/_/g, ' ')} — {scan.scannedAt ? new Date(scan.scannedAt).toLocaleString() : ''}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Result Cards ─── */

function ProductResultCard({ result, context, toast }: { result: any; context: string; toast: any }) {
  const product = result.product || result;
  const lab = result.labResults || product.labResults;

  const handleAddToCart = async () => {
    try {
      await api.post('/api/pos/cart/add', { productId: product.id, quantity: 1 });
      toast.success('Added to cart');
    } catch (err: any) {
      toast.error(err.message || 'Failed to add to cart');
    }
  };

  return (
    <div className="flex gap-4">
      {product.imageUrl ? (
        <img src={product.imageUrl} alt={product.name} className="w-20 h-20 object-cover rounded-lg" />
      ) : (
        <div className="w-20 h-20 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <Package className="w-8 h-8 text-gray-400" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <h4 className="text-lg font-semibold text-gray-900">{product.name}</h4>
        {product.strain && <p className="text-sm text-gray-500">{product.strain}</p>}
        <div className="flex flex-wrap gap-3 mt-2 text-sm">
          {lab && (
            <>
              <span className="px-2 py-0.5 bg-green-50 text-green-700 rounded-full font-medium">THC: {lab.thcPercent}%</span>
              <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium">CBD: {lab.cbdPercent}%</span>
            </>
          )}
          {product.price != null && (
            <span className="text-gray-900 font-semibold">${parseFloat(product.price).toFixed(2)}</span>
          )}
        </div>
        {product.batchNumber && (
          <p className="text-xs text-gray-400 mt-1">Batch: {product.batchNumber}</p>
        )}
        {lab && (
          <div className="flex items-center gap-2 mt-2">
            {lab.passed ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
                <CheckCircle className="w-3 h-3" /> Lab Passed
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
                <XCircle className="w-3 h-3" /> Lab Issues
              </span>
            )}
          </div>
        )}
        <div className="flex gap-2 mt-3">
          {context === 'pos_checkout' && (
            <Button onClick={handleAddToCart}>
              <ShoppingCart className="w-4 h-4 mr-2 inline" />Add to Cart
            </Button>
          )}
          <Button variant="secondary" onClick={() => window.open(`/products/${product.id}`, '_blank')}>
            <Eye className="w-4 h-4 mr-2 inline" />View Traceability
          </Button>
        </div>
      </div>
    </div>
  );
}

function InputResultCard({ result, context, toast }: { result: any; context: string; toast: any }) {
  const input = result.input || result;
  const typeColors: Record<string, string> = {
    nutrient: 'bg-green-100 text-green-700',
    pesticide: 'bg-red-100 text-red-700',
    soil: 'bg-amber-700/20 text-amber-800',
    amendment: 'bg-blue-100 text-blue-700',
  };

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <Leaf className="w-6 h-6 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-lg font-semibold text-gray-900">{input.name}</h4>
          {input.brand && <p className="text-sm text-gray-500">{input.brand}</p>}
          <div className="flex flex-wrap gap-2 mt-2">
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${typeColors[input.type] || 'bg-gray-100 text-gray-700'}`}>
              {input.type?.replace(/_/g, ' ')}
            </span>
            {input.isOrganic && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
                <Leaf className="w-3 h-3" /> Organic
              </span>
            )}
            {input.isOMRIListed && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-green-600 text-white">OMRI</span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm">
            <span className={`font-medium ${input.currentStock <= input.minStock ? 'text-red-600' : 'text-gray-700'}`}>
              Stock: {input.currentStock ?? 0} {input.unitOfMeasure}
              {input.currentStock <= input.minStock && <AlertTriangle className="w-3 h-3 inline ml-1" />}
            </span>
          </div>
          {result.complianceStatus && (
            <div className="mt-2">
              {result.complianceStatus === 'compliant' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
                  <CheckCircle className="w-3 h-3" /> Compliant
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
                  <XCircle className="w-3 h-3" /> Non-Compliant
                </span>
              )}
            </div>
          )}
          <div className="flex gap-2 mt-3">
            {context === 'input_application' && (
              <Button onClick={() => window.location.href = '/grow-inputs?tab=applications'}>
                <Leaf className="w-4 h-4 mr-2 inline" />Log Application
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BatchResultCard({ result, toast }: { result: any; toast: any }) {
  const batch = result.batch || result;
  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    quarantine: 'bg-yellow-100 text-yellow-700',
    depleted: 'bg-gray-100 text-gray-500',
    recalled: 'bg-red-100 text-red-700',
  };

  return (
    <div className="flex items-start gap-3">
      <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
        <Layers className="w-6 h-6 text-purple-600" />
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-lg font-semibold text-gray-900">Batch #{batch.batchNumber}</h4>
        {batch.productName && <p className="text-sm text-gray-500">{batch.productName}</p>}
        <div className="flex flex-wrap gap-2 mt-2">
          <span className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${statusColors[batch.status] || 'bg-gray-100 text-gray-700'}`}>
            {batch.status}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2 text-sm text-gray-600">
          <p>Quantity: {batch.quantity} {batch.unit}</p>
          {batch.harvestDate && <p>Harvested: {new Date(batch.harvestDate).toLocaleDateString()}</p>}
          {batch.thcPercent && <p>THC: {batch.thcPercent}%</p>}
          {batch.cbdPercent && <p>CBD: {batch.cbdPercent}%</p>}
        </div>
        <div className="flex gap-2 mt-3">
          <Button variant="secondary" onClick={() => window.open(`/batches?id=${batch.id}`, '_blank')}>
            <Eye className="w-4 h-4 mr-2 inline" />View Batch
          </Button>
          {batch.labTestId && (
            <Button variant="secondary" onClick={() => window.open(`/lab-tests/${batch.labTestId}`, '_blank')}>
              <FlaskConical className="w-4 h-4 mr-2 inline" />Lab Test
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   QR Generator Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function GeneratorTab() {
  const toast = useToast();
  const [entityType, setEntityType] = useState('product');
  const [entityId, setEntityId] = useState('');
  const [entities, setEntities] = useState<any[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [qrData, setQrData] = useState<any>(null);
  const [generating, setGenerating] = useState(false);

  // Load entities when type changes
  useEffect(() => {
    const loadEntities = async () => {
      setLoadingEntities(true);
      setEntityId('');
      setQrData(null);
      try {
        let data;
        if (entityType === 'product') {
          data = await api.get('/api/products', { limit: 200 });
        } else if (entityType === 'batch') {
          data = await api.get('/api/batches', { limit: 200 });
        } else if (entityType === 'plant') {
          data = await api.get('/api/cultivation/plants', { limit: 200 });
        } else if (entityType === 'input') {
          data = await api.get('/api/grow-inputs', { limit: 200 });
        }
        setEntities(Array.isArray(data) ? data : data?.data || []);
      } catch {} finally {
        setLoadingEntities(false);
      }
    };
    loadEntities();
  }, [entityType]);

  const getEntityLabel = (entity: any) => {
    if (entityType === 'product') return entity.name || entity.id;
    if (entityType === 'batch') return `${entity.batchNumber || entity.id} — ${entity.productName || ''}`;
    if (entityType === 'plant') return `${entity.metrcTag || entity.id} — ${entity.strainName || ''}`;
    if (entityType === 'input') return `${entity.name || entity.id} (${entity.brand || ''})`;
    return entity.name || entity.id;
  };

  const handleGenerate = async () => {
    if (!entityId) { toast.error('Select an entity'); return; }
    setGenerating(true);
    try {
      const data = await api.post('/api/qr-scanner/generate', {
        entityType,
        entityId,
      });
      setQrData(data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate QR data');
    } finally {
      setGenerating(false);
    }
  };

  const copyQRData = () => {
    if (!qrData?.payload) return;
    navigator.clipboard.writeText(JSON.stringify(qrData.payload, null, 2));
    toast.success('QR data copied to clipboard');
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Generate QR Code</h3>

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Entity Type</label>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-gray-900"
            >
              {entityTypes.map((et) => (
                <option key={et.value} value={et.value}>{et.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select {entityType}</label>
            <select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              disabled={loadingEntities}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-gray-900 disabled:opacity-50"
            >
              <option value="">{loadingEntities ? 'Loading...' : `Select ${entityType}...`}</option>
              {entities.map((entity: any) => (
                <option key={entity.id} value={entity.id}>{getEntityLabel(entity)}</option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <Button onClick={handleGenerate} disabled={generating || !entityId}>
              <QrCode className="w-4 h-4 mr-2 inline" />
              {generating ? 'Generating...' : 'Generate QR'}
            </Button>
          </div>
        </div>

        {/* QR Result */}
        {qrData && (
          <div className="border-t pt-6 space-y-4">
            <div className="flex gap-6">
              {/* QR Code Placeholder */}
              <div className="w-48 h-48 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center flex-shrink-0">
                <QrCode className="w-16 h-16 text-gray-400 mb-2" />
                <p className="text-xs text-gray-400 text-center px-4">
                  QR Code Image<br />
                  <span className="text-[10px]">(requires qrcode library)</span>
                </p>
              </div>

              {/* QR Data Preview */}
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Encoded Data</h4>
                <pre className="p-4 bg-gray-50 rounded-lg text-xs text-gray-700 overflow-auto max-h-40 border">
                  {JSON.stringify(qrData.payload || qrData, null, 2)}
                </pre>
                <div className="flex gap-2 mt-3">
                  <Button variant="secondary" onClick={copyQRData}>
                    <ClipboardCopy className="w-4 h-4 mr-2 inline" />Copy Data
                  </Button>
                  <Button variant="secondary" onClick={() => toast.success('Print dialog would open here — requires label printer integration')}>
                    <Printer className="w-4 h-4 mr-2 inline" />Print Label with QR
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Analytics Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function AnalyticsTab() {
  const toast = useToast();
  const [stats, setStats] = useState<any>(null);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [topInputs, setTopInputs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAnalytics = async () => {
      setLoading(true);
      try {
        const [statsData, topData] = await Promise.all([
          api.get('/api/qr-scanner/analytics/stats'),
          api.get('/api/qr-scanner/analytics/top-scanned'),
        ]);
        setStats(statsData);
        setTopProducts(topData?.products || []);
        setTopInputs(topData?.inputs || []);
      } catch {} finally {
        setLoading(false);
      }
    };
    loadAnalytics();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Scan Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4">
          <p className="text-sm text-gray-500">Today</p>
          <p className="text-2xl font-bold text-orange-600">{stats?.today || 0}</p>
          <p className="text-xs text-gray-400">scans</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4">
          <p className="text-sm text-gray-500">This Week</p>
          <p className="text-2xl font-bold text-blue-600">{stats?.thisWeek || 0}</p>
          <p className="text-xs text-gray-400">scans</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4">
          <p className="text-sm text-gray-500">This Month</p>
          <p className="text-2xl font-bold text-green-600">{stats?.thisMonth || 0}</p>
          <p className="text-xs text-gray-400">scans</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4">
          <p className="text-sm text-gray-500">All Time</p>
          <p className="text-2xl font-bold text-purple-600">{stats?.allTime || 0}</p>
          <p className="text-xs text-gray-400">scans</p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Scans by Entity Type */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Scans by Entity Type</h3>
          <div className="space-y-3">
            {(stats?.byEntityType || [
              { type: 'product', count: stats?.productScans || 0 },
              { type: 'batch', count: stats?.batchScans || 0 },
              { type: 'input', count: stats?.inputScans || 0 },
              { type: 'plant', count: stats?.plantScans || 0 },
            ]).map((item: any) => {
              const total = stats?.thisMonth || 1;
              const percent = Math.round((item.count / total) * 100) || 0;
              const colors: Record<string, string> = {
                product: 'bg-green-500',
                batch: 'bg-purple-500',
                input: 'bg-blue-500',
                plant: 'bg-amber-500',
              };
              return (
                <div key={item.type}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="capitalize text-gray-700">{item.type}</span>
                    <span className="text-gray-500">{item.count} ({percent}%)</span>
                  </div>
                  <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${colors[item.type] || 'bg-gray-400'}`} style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 mt-3 text-center italic">Pie chart placeholder — integrate with Recharts or Chart.js</p>
        </div>

        {/* Scans by Context */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Scans by Context</h3>
          <div className="space-y-3">
            {(stats?.byContext || [
              { context: 'pos_checkout', count: stats?.posScans || 0 },
              { context: 'inventory_count', count: stats?.inventoryScans || 0 },
              { context: 'input_application', count: stats?.inputAppScans || 0 },
              { context: 'receiving', count: stats?.receivingScans || 0 },
              { context: 'customer_info', count: stats?.customerScans || 0 },
            ]).map((item: any) => {
              const total = stats?.thisMonth || 1;
              const percent = Math.round((item.count / total) * 100) || 0;
              const colors: Record<string, string> = {
                pos_checkout: 'bg-orange-500',
                inventory_count: 'bg-blue-500',
                input_application: 'bg-green-500',
                receiving: 'bg-purple-500',
                customer_info: 'bg-cyan-500',
              };
              return (
                <div key={item.context}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="capitalize text-gray-700">{item.context?.replace(/_/g, ' ')}</span>
                    <span className="text-gray-500">{item.count}</span>
                  </div>
                  <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${colors[item.context] || 'bg-gray-400'}`} style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 mt-3 text-center italic">Bar chart placeholder — integrate with Recharts or Chart.js</p>
        </div>
      </div>

      {/* Most Scanned Tables */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Most Scanned Products */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="px-4 py-3 border-b">
            <h3 className="font-semibold text-gray-900">Most Scanned Products</h3>
          </div>
          {topProducts.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500 text-sm">No product scan data yet</div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">#</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Product</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Scans</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {topProducts.slice(0, 10).map((item: any, i: number) => (
                  <tr key={item.id || i} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm text-gray-400">{i + 1}</td>
                    <td className="px-4 py-2 text-sm font-medium text-gray-900">{item.name}</td>
                    <td className="px-4 py-2 text-sm text-right text-gray-700">{item.scanCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Most Scanned Inputs */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="px-4 py-3 border-b">
            <h3 className="font-semibold text-gray-900">Most Scanned Inputs</h3>
          </div>
          {topInputs.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500 text-sm">No input scan data yet</div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">#</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Input</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Scans</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {topInputs.slice(0, 10).map((item: any, i: number) => (
                  <tr key={item.id || i} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm text-gray-400">{i + 1}</td>
                    <td className="px-4 py-2 text-sm font-medium text-gray-900">{item.name}</td>
                    <td className="px-4 py-2 text-sm text-right text-gray-700">{item.scanCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Scan Timeline Placeholder */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Scan Timeline</h3>
        <div className="h-48 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 flex flex-col items-center justify-center">
          <BarChart3 className="w-12 h-12 text-gray-300 mb-2" />
          <p className="text-sm text-gray-400">Scans per hour — line/bar chart</p>
          <p className="text-xs text-gray-300 mt-1">Integrate with Recharts or Chart.js for visualization</p>
        </div>
      </div>
    </div>
  );
}
