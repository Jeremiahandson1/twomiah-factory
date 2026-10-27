// Online stores (templates/crm-store, the back office, and templates/website-store, the storefront;
// docs/UNIFIED_STORE_PLAN.md). The catalogue, orders, refunds, payments, shipping, suppliers, discounts, product reviews
// and loyalty are the store's add-on (server/crm/store, web/src/crm/pages/store); its shoppers are the CRM's contacts
// (decision 2) and its loyalty the shared programme, by contact.
import { BASE_CRM, type VerticalSettings } from '../../server/core/vertical.ts'
import { BASE_STARTER, type StarterContent } from '../../server/core/starter.ts'

// What a new store finds in Help on day one (server/core/starter.ts; written once at provisioning, then the owner's).
// Store live test, 2026-10-26: a store's Help opened on the contractor's "Quotes & Invoices", "Scheduling" and "Time &
// Expenses" — none of them a store's. Each article names only screens and steps the store has (its onboarding steps,
// the Shipping and Product Reviews screens, the seats in roleMapping below).
const STARTER: StarterContent = {
  helpArticles: [
    { title: 'Getting started with your store', category: 'Getting Started', isFaq: true,
      content: 'Do these in order and you can take an order today. 1) Payments: connect Stripe, Square or PayPal — you are paid directly, and the storefront cannot check anyone out until one is connected. 2) Products: add a product with a name, price, photos and stock; one is enough to go live. 3) Open your storefront, add the product to the cart and place a test order. 4) Settings > Users: invite your managers and staff.' },
    { title: 'Adding and editing products', category: 'Products', isFaq: false,
      content: 'Go to Products and add a product: its name, price, photos and stock. A product shows in your shop once it is on sale; a draft stays hidden from shoppers. Each option a shopper can pick (a size, a colour) has its own price and stock, and an option with no stock left shows as sold out.' },
    { title: 'Orders and shipping', category: 'Orders', isFaq: true,
      content: 'Every paid order is on the Orders page. Open one to pack it, add its tracking number and mark it shipped. With a carrier account connected on Shipping (set up by the owner), you can buy and print the label from the order itself; without one, enter the tracking number by hand. Refunds and cancellations are for a manager or the owner.' },
    { title: 'Discount codes', category: 'Promotions', isFaq: false,
      content: 'On Discounts, a manager or the owner creates a code shoppers enter at checkout, and can switch a code off at any time.' },
    { title: 'Product reviews', category: 'Customers', isFaq: true,
      content: 'Shoppers can review a product from its page in your shop. A new review waits on Product Reviews until it is approved; only approved reviews show on the product page. A review from an email that bought the product is marked "Verified purchase".' },
    { title: 'Messages from your website', category: 'Customers', isFaq: false,
      content: "Messages sent through your website's contact form arrive in the Lead Inbox, and are emailed to you as well." },
  ],
  pricebookCategories: BASE_STARTER.pricebookCategories,
}

const store: VerticalSettings = {
  // 'store': industryRouting's vertical id (apps/api/src/config/industryRouting.ts) and what the Factory calls it.
  id: 'store',
  label: 'Online Store',
  vocabulary: { customer: { one: 'customer', many: 'customers' }, work: null, team: { one: 'team member', many: 'team' }, reviewAfter: null, gallery: 'Gallery', customerCompany: true },
  mfaIssuer: 'Twomiah Store',
  starter: STARTER,
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
      // No discounts: the codes are money given away, and a staff seat does not reach them (store live test, 2026-10-26 —
      // staff could open Discounts; "credentials, money and controls follow the seat", bda5a934a). Nor the carrier
      // account or the shipping rates: shipping:read is for buying a label from an order, never the Shipping screen.
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
    // A shop's enquiries come from its own website (store recheck, 2026-10-26: the inbox's source filter offered Angi,
    // HomeAdvisor, Thumbtack, Local Services and Houzz). Lead Sources, the forwarding guide, is hidden for a shop
    // (screens.navHidden), so nothing else can arrive. Same ids as screens.leads.platforms.
    leads: { platforms: ['website'] },
  },
  screens: {
    // The store's own home and screens (web/src/crm/verticals/store.tsx).
    home: 'store',
    // The Lead Inbox is the store's for its website's enquiries (featureRegistry lead_inbox, store live test 2026-10-26);
    // Lead Sources is the marketplaces' forwarding guide (Angi, Thumbtack, booking apps), which a shop does not sell on.
    navHidden: ['/crm/lead-sources'],
    leads: {
      platforms: [{
        value: 'website', label: 'Website contact form', color: '#2e7d32', tone: 'emerald',
        description: 'Every message sent from your website\'s contact form becomes an enquiry here.',
        instructions: ['Messages from the Contact page of your website arrive here by themselves'],
      }],
      jobTypeLabel: 'About',
    },
    // Settings in a shop's words (store live test, 2026-10-26): no License # (not a licensed trade, as vet and restaurant),
    // and its two seats described as what each does in a shop — the shared list said "view jobs, log time". It replaces
    // the shared list; a shop hands out only these two (crm.team.roles).
    settings: {
      licenseNumber: false,
      roles: [
        { value: 'field', label: 'Staff', description: 'packs and ships orders, adds and edits products and stock, answers reviews; not refunds, discount codes, shipping rates, payments or settings' },
        { value: 'manager', label: 'Manager', description: 'runs the shop: refunds and cancellations, discount codes, shipping rates, removing products, loyalty; not payments, the carrier account, company settings or logins' },
      ],
    },
    // Its customers are shoppers (decision 2). A shopper's page lists their store orders (the server's `orders` relation,
    // server/modules/crm.ts); a store has no projects or quotes, so those lists and their counts are off.
    contacts: {
      types: [{ value: 'customer', label: 'Customer' }, { value: 'lead', label: 'Lead' }, { value: 'vendor', label: 'Vendor' }],
      sections: { orders: true, projects: false, quotes: false, portal: true },
    },
    // The first-run wizard follows the money, as templates/crm-store's did: a store can't sell without a payment account
    // and a product. Its own Domain page, not the CRM's CNAME guide; no Jobber, Angi, Thumbtack or Google LSA.
    onboarding: {
      // No QuickBooks: the store is not offered it (featureRegistry quickbooks has no crm-store; store live test 2026-10-26).
      integrations: ['store_domain', 'store_payments', 'store_first_product', 'twilio'],
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
    // Made for a shop (site/designs/market.css); the owner can choose any look in their website settings.
    design: 'market',
    words: {
      contactAddressLabel: 'Address',
      contactMessageLabel: 'Your message',
      contactMessageRequired: 'Tell us how we can help.',
    },
  },
}

export default store
