export type FactoryConfig = {
  tenant_id: string
  tenant_name: string
  tenant_slug: string
  products: string[]
  company: {
    name: string; email: string; phone: string; address: string
    city: string; state: string; zip: string; domain: string
    ownerName: string; industry: string; serviceRegion: string
    nearbyCities: string[]
  }
  branding: {
    primaryColor: string; secondaryColor: string
    logo: string | null; logoFilename: string | null
    favicon: string | null; faviconFilename: string | null
    heroPhoto: string | null; heroPhotoFilename: string | null
  }
  features: { website: string[]; crm: string[]; paid_ads: boolean }
  integrations: {
    twilio: { accountSid: string; authToken: string; phoneNumber: string }
    sendgrid: { apiKey: string }
    stripe: { secretKey: string; publishableKey: string; webhookSecret: string }
    googleMaps: { apiKey: string }
    sentry: { dsn: string }
  }
  content: {
    services: string[]; customServices: { id: string; name: string; desc: string }[]
    heroTagline: string; aboutText: string; ctaText: string
  }
}

export const DEFAULT_CONFIG: FactoryConfig = {
  tenant_id: '', tenant_name: '', tenant_slug: '',
  products: [],
  company: { name: '', email: '', phone: '', address: '', city: '', state: '', zip: '', domain: '', ownerName: '', industry: '', serviceRegion: '', nearbyCities: ['', '', '', ''] },
  branding: { primaryColor: '#f97316', secondaryColor: '#1e3a5f', logo: null, logoFilename: null, favicon: null, faviconFilename: null, heroPhoto: null, heroPhotoFilename: null },
  features: { website: [], crm: [], paid_ads: false },
  integrations: { twilio: { accountSid: '', authToken: '', phoneNumber: '' }, sendgrid: { apiKey: '' }, stripe: { secretKey: '', publishableKey: '', webhookSecret: '' }, googleMaps: { apiKey: '' }, sentry: { dsn: '' } },
  content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '' },
}
