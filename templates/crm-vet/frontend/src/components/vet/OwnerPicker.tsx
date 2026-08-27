import { useState, useEffect, useRef } from 'react';
import { Search, User, Check, Loader2 } from 'lucide-react';
import api from '../../services/api';

/**
 * Owner (contact) picker — debounced search against /api/contacts?search=.
 * Used by the New Patient modal and anywhere an owner must be chosen.
 */

export interface ContactLite {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

function contactName(c: ContactLite): string {
  return c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unnamed contact';
}

interface OwnerPickerProps {
  value: string;
  onChange: (id: string, contact: ContactLite | null) => void;
  initialLabel?: string;
}

export default function OwnerPicker({ value, onChange, initialLabel }: OwnerPickerProps) {
  const [search, setSearch] = useState<string>('');
  const [results, setResults] = useState<ContactLite[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [open, setOpen] = useState<boolean>(false);
  const [selectedLabel, setSelectedLabel] = useState<string>(initialLabel || '');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get(`/api/contacts?search=${encodeURIComponent(search)}&limit=20`);
        setResults(res.data || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [search, open]);

  const pick = (c: ContactLite) => {
    onChange(c.id, c);
    setSelectedLabel(contactName(c));
    setOpen(false);
    setSearch('');
  };

  return (
    <div className="relative">
      {value && !open ? (
        <div className="flex items-center justify-between px-3 py-2 border rounded-lg bg-gray-50 dark:bg-slate-900">
          <span className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
            <User className="w-4 h-4 text-gray-400" />
            {selectedLabel || 'Selected owner'}
          </span>
          <button
            type="button"
            onClick={() => { setOpen(true); }}
            className="text-xs text-teal-600 hover:text-teal-700"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onFocusCapture={() => setOpen(true)}
              onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
              placeholder="Search owners by name, phone, email..."
              className="w-full pl-10 pr-4 py-2 border rounded-lg"
            />
          </div>
          {open && (
            <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto dark:bg-slate-900">
              {loading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                </div>
              ) : results.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No contacts found</p>
              ) : (
                results.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => pick(c)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between"
                  >
                    <span>
                      <span className="block text-sm font-medium text-gray-900 dark:text-slate-100">{contactName(c)}</span>
                      <span className="block text-xs text-gray-500 dark:text-slate-400">
                        {[c.phone, c.email].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {value === c.id && <Check className="w-4 h-4 text-teal-600" />}
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
