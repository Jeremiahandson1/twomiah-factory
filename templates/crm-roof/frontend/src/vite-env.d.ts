/// <reference types="vite/client" />

// The two variables crm-roof reads (services/api.ts, pages/CustomerPortal.tsx,
// components/common/AddressAutocomplete.tsx). Without this file `import.meta.env` was untyped.
interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_GOOGLE_MAPS_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
