// Online stores (templates/crm-store, the back office, and templates/website-store, the storefront;
// docs/UNIFIED_STORE_PLAN.md). The catalogue, orders, refunds, payments, shipping, suppliers, discounts, product reviews
// and loyalty are the store's add-on (server/crm/store, web/src/crm/pages/store); its shoppers are the CRM's contacts
// (decision 2) and its loyalty the shared programme, by contact.
import { BASE_CRM, type VerticalSettings } from '../../server/core/vertical.ts'

const store: VerticalSettings = {
  // 'store': industryRouting's vertical id (apps/api/src/config/industryRouting.ts) and what the Factory calls it.
  id: 'store',
  label: 'Online Store',
  vocabulary: { customer: { one: 'customer', many: 'customers' }, work: null, team: { one: 'team member', many: 'team' }, reviewAfter: null, gallery: 'Gallery' },
  mfaIssuer: 'Twomiah Store',
  featureSet: 'crm-store',
  // templates/crm-store middleware/permissions.ts — the store's three seats (owner's decision, 2026-10-10):
  //   owner    everything — payments, settings, logins and the integrations stay here
  //   manager  runs the shop: refunds and cancellations, discount codes, the carrier account, deleting from the
  //            catalogue, the loyalty programme (the shared matrix's manager row already holds orders:*, products:*,
  //            discounts:*, shipping:*, reviews:*)
  //   staff    does the work: packs and ships orders, adds and edits products and stock, answers reviews
  // The store keeps its floor seat as `staff`; the shared hierarchy calls that rung `field`.
  roleMapping: { staff: 'field' },
  roleLabels: { field: 'Staff' },
  extraRolePermissions: {
    field: [
      // Fulfilment: read an order, write tracking and a note, move it on, buy the label. Cancelling and refunding
      // (whether it was paid) is orders:refund, which this seat does not hold.
      'orders:read', 'orders:update', 'shipping:read', 'shipping:label',
      // The catalogue, short of removing anything from sale.
      'products:read', 'products:create', 'products:update',
      // Sees the codes to answer a shopper; writing one is giving money away.
      'discounts:read',
      // Publishes or rejects a review; deleting one for good is the manager's.
      'reviews:read', 'reviews:update',
    ],
    // The fleet's manager runs a loyalty programme but loyalty:configure is admin's; a shop has no admin seat.
    manager: ['loyalty:configure'],
  },
  crm: {
    // The base CRM's documents, technician view and portal: a store's features never switch the last two on (featureRegistry
    // offers crm-store no technicians or customer portal — its shoppers check out as guests).
    ...BASE_CRM,
    store: true,
    // A shopper is a customer (decision 2): checkout makes the contact a 'customer', and one with orders is kept.
    contacts: { types: ['customer', 'lead', 'vendor'], customerType: 'customer', guards: ['storeOrder'] },
    // The logins the owner hands out: manager or staff (the field rung) — a shop has no admin seat, and its one owner is
    // provisioned, never a button (templates/crm-store routes/users.ts ASSIGNABLE_ROLES). A login given no role is staff.
    team: { roles: ['manager', 'field'] },
  },
  screens: {
    // The store's own home and screens (web/src/crm/verticals/store.tsx).
    home: 'store',
    // Its customers are shoppers (decision 2). A shopper's page lists their store orders (the server's `orders` relation,
    // server/modules/crm.ts); a store has no projects or quotes, so those lists and their counts are off.
    contacts: {
      types: [{ value: 'customer', label: 'Customer' }, { value: 'lead', label: 'Lead' }, { value: 'vendor', label: 'Vendor' }],
      sections: { orders: true, projects: false, quotes: false, portal: true },
    },
    // The first-run wizard follows the money, as templates/crm-store's did: a store can't sell without a payment account
    // and a product. Its own Domain page, not the CRM's CNAME guide; no Jobber, Angi, Thumbtack or Google LSA.
    onboarding: {
      integrations: ['store_domain', 'store_payments', 'store_first_product', 'quickbooks', 'twilio'],
      emailProduct: 'crm-store',
      extra: [
        {
          id: 'store_domain', label: 'Your web address', category: 'dns',
          description: 'Buy a domain for your store, or connect one you already own.',
          guideSteps: ['Open Domain', 'Search for a name and buy it, or enter one you already own', 'Follow the steps shown there — your store moves to it once it is live'],
          open: { to: '/crm/domain', label: 'Open Domain' },
        },
        {
          id: 'store_payments', label: 'Payments', category: 'payments',
          description: 'Connect Stripe, Square or PayPal. You are paid directly; Twomiah never holds the money.',
          guideSteps: ['Open Payments', 'Choose Stripe, Square or PayPal and connect your account', 'Your storefront can’t check anyone out until one is connected'],
          open: { to: '/crm/payments', label: 'Open Payments' },
        },
        {
          id: 'store_first_product', label: 'Your first product', category: 'catalog',
          description: 'Add a product so the storefront has something to sell.',
          guideSteps: ['Open the product editor', 'Add a name, price, photos and stock', 'Save it — one product is enough to go live'],
          open: { to: '/crm/products/new', label: 'Open the product editor' },
        },
      ],
    },
  },
  site: {
    design: 'classic',
    words: {
      contactAddressLabel: 'Address',
      contactMessageLabel: 'Your message',
      contactMessageRequired: 'Tell us how we can help.',
    },
  },
}

export default store
