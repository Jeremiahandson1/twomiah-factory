import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Wrench, Shield, ChevronRight, Loader2 } from 'lucide-react';
import portalApi from './portalApi';

export default function PortalEquipment() {
  const [equipment, setEquipment] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    portalApi.get('/api/portal/equipment').then(setEquipment).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const warrantyStatus = (expiry: string | null) => {
    if (!expiry) return { label: 'Unknown', color: 'text-gray-400', bg: 'bg-gray-100' };
    return new Date(expiry) > new Date()
      ? { label: 'Warranty Active', color: 'text-green-700', bg: 'bg-green-100' }
      : { label: 'Warranty Expired', color: 'text-red-700', bg: 'bg-red-100' };
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
  }

  return (
    <div className="px-4 py-6 max-w-lg mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-4">Your Equipment</h1>

      {equipment.length === 0 ? (
        <div className="text-center py-16">
          <Wrench className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No equipment registered yet</p>
          <p className="text-sm text-gray-400 mt-1">Contact your service provider to add your systems</p>
        </div>
      ) : (
        <div className="space-y-3">
          {equipment.map((eq) => {
            const ws = warrantyStatus(eq.warrantyExpiry);
            return (
              <Link
                key={eq.id}
                to={`/portal/equipment/${eq.id}`}
                className="block bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Wrench className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900">{eq.name}</h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {[eq.manufacturer, eq.model].filter(Boolean).join(' ') || 'No model info'}
                    </p>
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${ws.bg} ${ws.color}`}>
                        <Shield className="w-3 h-3" />
                        {ws.label}
                      </span>
                      {eq.purchaseDate && (
                        <span className="text-xs text-gray-400">
                          Installed {new Date(eq.purchaseDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {eq.lastServiceDate && (
                      <p className="text-xs text-gray-400 mt-1">
                        Last serviced {new Date(eq.lastServiceDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-300 flex-shrink-0 mt-1" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
