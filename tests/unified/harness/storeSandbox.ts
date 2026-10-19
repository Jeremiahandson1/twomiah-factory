// The store's helpers the store tests import by the template's paths (src/lib, src/payments, src/suppliers,
// src/services), each backed by the unified module that holds it now (server/crm/store), for the suite (store.ts) and
// its adapted copies (adapted.ts). `@app/` is apps/unified.
export const STORE_SANDBOX: Record<string, string> = {
  // The credentials' encryption and the payment adapters: moved as they were.
  'src/lib/crypto.ts': "export * from '@app/server/crm/store/lib/crypto.ts'\n",
  'src/lib/money.ts': "export * from '@app/server/crm/store/lib/money.ts'\n",
  'src/payments/types.ts': "export * from '@app/server/crm/store/payments/types.ts'\n",
  'src/payments/stripe.ts': "export * from '@app/server/crm/store/payments/stripe.ts'\n",
  'src/payments/square.ts': "export * from '@app/server/crm/store/payments/square.ts'\n",
  'src/payments/paypal.ts': "export * from '@app/server/crm/store/payments/paypal.ts'\n",
  // The supplier routes: a router file outside routes/, so the runner does not forward it — the app serves its paths.
  'src/suppliers/routes.ts': "import { forward } from '../unified.ts'\nexport default forward()\n",
  // The store's messages, as the template exposed its builders (the adapted copies read them through the app's).
  'src/services/storeEmails.ts': "export * from '@app/server/crm/store/emails.ts'\n",
}
