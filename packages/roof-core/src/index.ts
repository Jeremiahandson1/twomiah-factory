// @twomiah/roof-core — shared roof estimator services
// Used by the roofing CRM (apps/unified) and the crm-roof template. The standalone roof-estimator app that also used it
// was removed: the drawn report in the roofing CRM is the one roof report product.

export * from './googleSolar.ts'
export * from './dsmProcessor.ts'
export * from './roofReport.ts'
export * from './roofReportRenderer.ts'
export * from './nearmapImagery.ts'
export * from './nearmapAI.ts'
export * from './usgs3dep.ts'
export * from './elevationProvider.ts'
export * from './sam2Segmentation.ts'
export * from './sam2PostProcessor.ts'
export * from './pdfGenerator.ts'
// roofReport.ts (the geometry's result) and roofReportRenderer.ts (what the renderer draws) each export an interface
// named RoofReportData; the two stars made the name ambiguous, so neither was exported. Named here, one each.
export type { RoofReportData } from './roofReport.ts'
export type { RoofReportData as RenderableRoofReport } from './roofReportRenderer.ts'
