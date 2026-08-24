import { useState, useEffect, useMemo } from 'react';
import { X, Loader2, Calculator } from 'lucide-react';
import api from '../../services/api';

/**
 * Deal Desk — payment calculator for an RV / powersports deal.
 *
 * Prefills the unit price from the lead's unit (internetPrice/listedPrice via
 * /api/units), then computes taxable amount, tax, amount financed, and an
 * estimated monthly payment using standard amortization. Desk inputs are
 * persisted into the lead's notes JSON via PUT /api/sales-leads/:id so the
 * numbers survive a reload — but the math is fully client-side either way.
 */

export interface DealDeskLead {
  id: string;
  unitId?: string | null;
  notes?: string | null;
}

interface DealDeskInputs {
  unitPrice: string;
  downPayment: string;
  tradeAllowance: string;
  tradePayoff: string;
  docFees: string;
  titleFees: string;
  taxRate: string;
  apr: string;
  termMonths: string;
}

const DEFAULTS: DealDeskInputs = {
  unitPrice: '',
  downPayment: '',
  tradeAllowance: '',
  tradePayoff: '',
  docFees: '',
  titleFees: '',
  taxRate: '',
  apr: '',
  termMonths: '60',
};

const NOTE_KEY = 'dealDesk';

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

/**
 * Parse the lead's notes column. Desk inputs live under a `dealDesk` key in a
 * JSON object; if notes is free text (or absent) we fall back to defaults and
 * preserve the original text when we save.
 */
function parseNotes(notes?: string | null): { freeText: string; desk: Partial<DealDeskInputs> | null } {
  if (!notes) return { freeText: '', desk: null };
  try {
    const parsed = JSON.parse(notes);
    if (parsed && typeof parsed === 'object') {
      const { [NOTE_KEY]: desk, ...rest } = parsed as Record<string, unknown>;
      const freeText = typeof rest.text === 'string' ? rest.text : '';
      return { freeText, desk: (desk as Partial<DealDeskInputs>) || null };
    }
  } catch {
    /* notes is plain text — keep it */
  }
  return { freeText: notes, desk: null };
}

interface DealDeskModalProps {
  lead: DealDeskLead;
  onClose: () => void;
  onSaved?: () => void;
}

export default function DealDeskModal({ lead, onClose, onSaved }: DealDeskModalProps) {
  const [form, setForm] = useState<DealDeskInputs>(DEFAULTS);
  const [freeText, setFreeText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  const set = (k: keyof DealDeskInputs, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Hydrate from saved notes, then prefill unit price if none saved.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { freeText: text, desk } = parseNotes(lead.notes);
      let next: DealDeskInputs = { ...DEFAULTS, ...(desk || {}) };

      // Prefill price from the unit only when the desk hasn't stored one yet.
      if (!next.unitPrice && lead.unitId) {
        try {
          const res = await api.get(`/api/units/${lead.unitId}`);
          const u = res?.data ?? res;
          const price = u?.internetPrice || u?.listedPrice || u?.msrp;
          if (price) next = { ...next, unitPrice: String(price) };
        } catch {
          /* unit lookup is best-effort */
        }
      }

      if (!cancelled) {
        setForm(next);
        setFreeText(text);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [lead.id, lead.unitId, lead.notes]);

  // ── Deal math ──────────────────────────────────────────────────────────────
  const calc = useMemo(() => {
    const price = num(form.unitPrice);
    const down = num(form.downPayment);
    const tradeAllowance = num(form.tradeAllowance);
    const tradePayoff = num(form.tradePayoff);
    const docFees = num(form.docFees);
    const titleFees = num(form.titleFees);
    const taxRate = num(form.taxRate);
    const apr = num(form.apr);
    const term = Math.max(0, Math.round(num(form.termMonths)));

    // Trade equity reduces the taxable price (trade tax credit, common in most states).
    const netTrade = Math.max(0, tradeAllowance - tradePayoff);
    const taxableAmount = Math.max(0, price - tradeAllowance);
    const tax = taxableAmount * (taxRate / 100);

    // Amount financed = price + fees + tax − cash down − net trade equity.
    const amountFinanced = Math.max(0, price + docFees + titleFees + tax - down - netTrade);

    // Standard amortization for the estimated monthly payment.
    let monthlyPayment = 0;
    if (term > 0) {
      const monthlyRate = apr / 100 / 12;
      if (monthlyRate > 0) {
        const factor = Math.pow(1 + monthlyRate, term);
        monthlyPayment = (amountFinanced * monthlyRate * factor) / (factor - 1);
      } else {
        monthlyPayment = amountFinanced / term;
      }
    }
    const totalOfPayments = monthlyPayment * term;
    const totalInterest = Math.max(0, totalOfPayments - amountFinanced);

    return { netTrade, taxableAmount, tax, amountFinanced, monthlyPayment, totalOfPayments, totalInterest, term };
  }, [form]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = JSON.stringify({ text: freeText, [NOTE_KEY]: form });
      await api.put(`/api/sales-leads/${lead.id}`, { notes: payload });
      onSaved?.();
      onClose();
    } catch (err) {
      alert((err as Error).message || 'Failed to save deal desk');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white text-gray-900 rounded-xl shadow-xl max-w-2xl w-full p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Calculator className="w-5 h-5 text-orange-500" /> Deal Desk
            </h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Inputs */}
              <div className="space-y-3">
                {numField('Unit Price', form.unitPrice, (v) => set('unitPrice', v))}
                {numField('Down Payment', form.downPayment, (v) => set('downPayment', v))}
                {numField('Trade Allowance', form.tradeAllowance, (v) => set('tradeAllowance', v))}
                {numField('Payoff on Trade', form.tradePayoff, (v) => set('tradePayoff', v))}
                <div className="grid grid-cols-2 gap-3">
                  {numField('Doc Fee', form.docFees, (v) => set('docFees', v))}
                  {numField('Title Fee', form.titleFees, (v) => set('titleFees', v))}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {numField('Tax %', form.taxRate, (v) => set('taxRate', v), '0.01')}
                  {numField('APR %', form.apr, (v) => set('apr', v), '0.01')}
                  {numField('Term (mo)', form.termMonths, (v) => set('termMonths', v), '1')}
                </div>
              </div>

              {/* Breakdown */}
              <div className="bg-gray-50 border rounded-lg p-4 flex flex-col">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Breakdown</h3>
                <dl className="space-y-2 text-sm">
                  {row('Net Trade Equity', money(calc.netTrade))}
                  {row('Taxable Amount', money(calc.taxableAmount))}
                  {row('Sales Tax', money(calc.tax))}
                  {row('Amount Financed', money(calc.amountFinanced), true)}
                  {row('Total Interest', money(calc.totalInterest))}
                  {row('Total of Payments', money(calc.totalOfPayments))}
                </dl>
                <div className="mt-4 pt-4 border-t">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Est. Monthly Payment</p>
                  <p className="text-3xl font-bold text-orange-600">
                    {calc.term > 0 ? money(calc.monthlyPayment) : '—'}
                  </p>
                  {calc.term > 0 && (
                    <p className="text-xs text-gray-400 mt-1">over {calc.term} months</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {!loading && (
            <div className="flex gap-3 pt-6">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Close</button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save to Lead'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function numField(label: string, value: string, onChange: (v: string) => void, step = '0.01') {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border rounded-lg"
      />
    </div>
  );
}

function row(label: string, value: string, bold = false) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className={bold ? 'font-semibold text-gray-900' : 'text-gray-700'}>{value}</dd>
    </div>
  );
}
