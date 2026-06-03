// Confirm the show-first preview includes the "Request changes" widget
// (CSS, button, modal, fetch script). Runs the same render path as the
// preview endpoint and greps the output. If any required token is missing,
// the widget injection regressed.
import { renderHomepagePreview } from '../src/services/previewRenderer'
import type { GenerateConfig } from '../src/services/generator'

const config: GenerateConfig = {
  products: ['website'],
  company: {
    name: 'Widget Check Co',
    industry: 'landscaping',
    phone: '555-867-5309',
    email: 'hello@example.com',
    city: 'Madison',
    state: 'WI',
    stateFull: 'Wisconsin',
    address: '1 Test St',
    zip: '53703',
    nearbyCities: ['Madison'],
  },
  branding: { primaryColor: '#2563eb', secondaryColor: '#0f172a' },
  features: { website: [], crm: [] },
}

const REQUIRED = [
  'id="__preview_fab"',
  'id="__preview_modal"',
  'id="__preview_form"',
  'id="__preview_msg"',
  'id="__preview_email"',
  '/public/intake/',
  '/feedback',
  'Request changes',
]

;(async () => {
  const result = await renderHomepagePreview(config)
  let missing = 0
  for (const token of REQUIRED) {
    const has = result.html.includes(token)
    console.log(`${has ? 'OK  ' : 'MISS'} ${token}`)
    if (!has) missing++
  }
  console.log(`\n${REQUIRED.length - missing}/${REQUIRED.length} widget tokens present in rendered HTML.`)
  process.exit(missing === 0 ? 0 : 1)
})()
