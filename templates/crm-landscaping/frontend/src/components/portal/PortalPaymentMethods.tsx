import { useState, useEffect, useCallback } from 'react';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { CreditCard, Loader2, Lock, Check, Trash2 } from 'lucide-react';
import { usePortal } from '../../contexts/PortalContext';

interface SavedCard { id: string; brand?: string; last4?: string; expMonth?: number; expYear?: number }

let stripePromise: Promise<Stripe | null> | null = null;
const getStripe = async (publishableKey: string): Promise<Stripe | null> => {
  if (!stripePromise) stripePromise = loadStripe(publishableKey);
  return stripePromise;
};

/**
 * Card on file. Agreements set to autopay are charged against this, and it
 * saves the customer re-typing a card on every invoice.
 */
export default function PortalPaymentMethods() {
  const { token } = usePortal() as { token?: string };
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCards = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/portal/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portalToken: token }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load your cards');
      setCards(body.data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load your cards');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadCards(); }, [loadCards]);

  const startAdd = async () => {
    setError(null);
    try {
      const res = await fetch('/api/stripe/portal/setup-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portalToken: token }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Card setup is unavailable');
      if (!body.publishableKey) throw new Error('Card payments are not set up yet. Please contact us.');
      setStripe(await getStripe(body.publishableKey));
      setClientSecret(body.clientSecret);
      setAdding(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not start card setup');
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Payment Method</h1>
        <p className="text-gray-600">Keep a card on file for invoices and any recurring service plan.</p>
      </div>

      {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="bg-white rounded-xl border p-10 text-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" /></div>
      ) : (
        <div className="space-y-3 mb-6">
          {cards.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <CreditCard className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No card saved yet.</p>
            </div>
          ) : cards.map((card) => (
            <div key={card.id} className="bg-white rounded-xl border p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CreditCard className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="font-medium text-gray-900 capitalize">{card.brand || 'Card'} ending {card.last4}</p>
                  <p className="text-xs text-gray-500">Expires {card.expMonth}/{card.expYear}</p>
                </div>
              </div>
              <span className="text-xs text-green-600 flex items-center gap-1"><Check className="w-3 h-3" /> On file</span>
            </div>
          ))}
        </div>
      )}

      {!adding && (
        <button onClick={startAdd} className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600">
          <CreditCard className="w-4 h-4" /> {cards.length ? 'Add another card' : 'Add a card'}
        </button>
      )}

      {adding && clientSecret && stripe && (
        <div className="bg-white rounded-xl border p-6 max-w-md">
          <Elements stripe={stripe} options={{ clientSecret }}>
            <SaveCardForm
              onSaved={() => { setAdding(false); setClientSecret(null); loadCards(); }}
              onCancel={() => { setAdding(false); setClientSecret(null); }}
            />
          </Elements>
        </div>
      )}
    </div>
  );
}

function SaveCardForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);
    setError(null);
    const result = await stripe.confirmSetup({ elements, redirect: 'if_required' });
    if (result.error) {
      setError(result.error.message || 'That card could not be saved.');
      setSaving(false);
      return;
    }
    onSaved();
  };

  return (
    <form onSubmit={submit}>
      <PaymentElement />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <p className="mt-3 text-xs text-gray-500 flex items-center gap-1">
        <Lock className="w-3 h-3" /> Your card is stored by our payment processor, never by us.
      </p>
      <div className="flex gap-3 mt-4">
        <button type="button" onClick={onCancel} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>
        <button type="submit" disabled={!stripe || saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg disabled:opacity-50">
          {saving ? 'Saving...' : 'Save card'}
        </button>
      </div>
    </form>
  );
}
