// The feature registry lives in packages/tenant-backend so the SAME file is vendored into every
// tenant (backend/src/shared/featureRegistry.ts) and consumed here by the Factory. One vocabulary —
// see the header of that file. Do not define feature ids anywhere else.
export * from '../../../../packages/tenant-backend/src/featureRegistry.ts'
