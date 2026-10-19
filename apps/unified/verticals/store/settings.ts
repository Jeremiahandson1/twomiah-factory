// Online stores (templates/crm-store, the back office, and templates/website-store, the storefront;
// docs/UNIFIED_STORE_PLAN.md). The catalogue, orders, refunds, payments, shipping, suppliers, discounts, product reviews
// and loyalty are the store's add-on (server/crm/store, web/src/crm/pages/store); its shoppers are the CRM's contacts
// (decision 2) and its loyalty the shared programme, by contact.
import { BASE_CRM, type VerticalSettings } from '../../server/core/vertical.ts'

const store: VerticalSettings = {
  // 'store': industryRouting's vertical id (apps/api/src/config/industryRouting.ts) and what the Factory calls it.
  id: 'store',
  label: 'Online Store',
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
  },
  // Filled as the store's screens land (plan step 4).
  screens: {},
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
