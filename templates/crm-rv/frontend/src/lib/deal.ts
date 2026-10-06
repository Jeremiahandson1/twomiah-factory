// The desked deal — one calculation for Desking and F&I, so the amount F&I finances is the amount the desk
// structured. The inputs are saved on the lead (PUT /api/sales-leads/:id/deal), which applies the same rules as
// dealErrors below. (RV T19 H1: F&I financed the sticker price with no discount, tax, fees or payoff; M5)

export interface Deal {
  price: number; discount: number; accessories: number; tradeAllow: number; tradePayoff: number;
  doc: number; freight: number; titleReg: number; prep: number; taxRate: number; down: number;
}

export const DEAL_DEFAULTS: Deal = { price: 0, discount: 0, accessories: 0, tradeAllow: 0, tradePayoff: 0, doc: 399, freight: 695, titleReg: 250, prep: 199, taxRate: 5.5, down: 0 };

export const DEAL_KEYS = Object.keys(DEAL_DEFAULTS) as (keyof Deal)[];

export const DEAL_LABELS: Record<keyof Deal, string> = {
  price: 'Selling price', discount: 'Discount', accessories: 'Accessories / add-ons', tradeAllow: 'Trade allowance',
  tradePayoff: 'Trade payoff', doc: 'Doc fee', freight: 'Freight / setup', titleReg: 'Title & reg', prep: 'Dealer prep',
  down: 'Down payment', taxRate: 'Tax rate',
};

const MONEY_KEYS = DEAL_KEYS.filter((k) => k !== 'taxRate');
const DEAL_MAX = 10_000_000;

export interface DealTotals { sellingPrice: number; taxable: number; tax: number; fees: number; outTheDoor: number; netTrade: number; financed: number }

/** Sales tax is charged on the selling price plus add-ons, net of the trade allowance. */
export function dealTotals(d: Deal): DealTotals {
  const sellingPrice = Math.max(0, d.price - d.discount);
  const taxable = Math.max(0, sellingPrice + d.accessories - d.tradeAllow);
  const tax = (d.taxRate / 100) * taxable;
  const fees = d.doc + d.freight + d.titleReg + d.prep;
  const outTheDoor = sellingPrice + d.accessories + tax + fees;
  const netTrade = d.tradeAllow - d.tradePayoff;
  const financed = Math.max(0, outTheDoor - d.down - netTrade);
  return { sellingPrice, taxable, tax, fees, outTheDoor, netTrade, financed };
}

/** Raw text from the inputs → numbers, or an error per field. Blank counts as 0. */
export function parseDeal(raw: Record<keyof Deal, string>): { deal: Deal; errors: Partial<Record<keyof Deal, string>> } {
  const deal = { ...DEAL_DEFAULTS };
  const errors: Partial<Record<keyof Deal, string>> = {};
  for (const k of DEAL_KEYS) {
    const text = String(raw[k] ?? '').trim();
    const n = text === '' ? 0 : Number(text);
    if (!Number.isFinite(n)) { errors[k] = `${DEAL_LABELS[k]} must be a number`; continue; }
    deal[k] = n;
  }
  Object.assign(errors, dealErrors(deal, errors));
  return { deal, errors };
}

/** The rules the server enforces on save. */
export function dealErrors(d: Deal, already: Partial<Record<keyof Deal, string>> = {}): Partial<Record<keyof Deal, string>> {
  const errors: Partial<Record<keyof Deal, string>> = {};
  for (const k of MONEY_KEYS) {
    if (already[k]) continue;
    if (d[k] < 0) errors[k] = `${DEAL_LABELS[k]} can't be negative`;
    else if (d[k] > DEAL_MAX) errors[k] = `${DEAL_LABELS[k]} is too large`;
  }
  if (!already.taxRate && (d.taxRate < 0 || d.taxRate > 25)) errors.taxRate = 'Tax rate must be between 0% and 25%';
  /**
   * …and not when the PRICE is the thing that is wrong. (T58d)
   *
   * With a price of −3, `discount > price` is 0 > −3, so a deal with one bad field reported two and
   * sent the salesperson to an input that is fine. The server skipped it; the screen did not, which
   * is the divergence check-rv-deal-rules-agree.ts found the moment it was written.
   */
  if (!already.discount && !errors.discount && !already.price && !errors.price && d.discount > d.price) {
    errors.discount = "Discount can't be more than the selling price";
  }
  /**
   * A DOWN PAYMENT CANNOT EXCEED THE DEAL. (T42 → T58d)
   *
   * Owner: "a down payment of 999,999 is accepted." The only ceiling was DEAL_MAX — ten million —
   * which guards a typo in any money field rather than saying anything about this one. $999,999 down
   * on a $30,000 trailer is not a deal; `financed` clamps at 0 and the overpayment silently vanishes.
   *
   * Checked last, and only when the figures it is derived from are themselves valid, so a bad price
   * does not also produce a confusing complaint about the down payment. The server applies the same
   * rule in salesLeads.ts dealInput() — and check-rv-deal-rules-agree.ts runs both over the same
   * cases, because the comment at the top of this function has claimed they match before and was
   * wrong about exactly this.
   */
  const moneyOk = MONEY_KEYS.every((k) => !already[k] && !errors[k]);
  if (!already.down && !errors.down && moneyOk && !already.taxRate && !errors.taxRate) {
    const otd = dealTotals(d).outTheDoor;
    if (d.down > otd + 0.01) {
      errors.down = `Down payment can't be more than the out-the-door total of ${otd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`;
    }
  }
  return errors;
}

export const dealToText = (d: Deal): Record<keyof Deal, string> =>
  Object.fromEntries(DEAL_KEYS.map((k) => [k, String(d[k] ?? 0)])) as Record<keyof Deal, string>;
