// Template-repo shim. At generation the Factory vendors packages/tenant-backend/src/** into this folder,
// replacing this file with the real module. Inside the monorepo it re-exports that same file.
export * from '../../../../../packages/tenant-backend/src/schemaReconcile.ts'
