// @twomiah/roof-core — shared roof estimator services
// Used by both the standalone roof-estimator app and the crm-roof template.

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
