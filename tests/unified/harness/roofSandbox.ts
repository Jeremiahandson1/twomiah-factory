// Roofing's helpers the roofing tests import by the template's paths (src/services/*.ts), each backed by the unified
// module that holds it now (server/crm/roof), for the suite (roof.ts) and its adapted copies (adapted.ts). `@app/` is
// apps/unified.
export const ROOF_SANDBOX: Record<string, string> = {
  // insurance (t39, t41): buildSupplementItems and the export, unchanged names and signatures.
  'src/services/xactimate.ts': "export * from '@app/server/crm/roof/insurance/xactimate.ts'\n",
}
