// Template-repo shim. At generation the Factory vendors packages/tenant-backend/src/** into this folder,
// replacing this file with the real registry. Inside the monorepo it re-exports that same file so the
// template type-checks and bundles on its own. One vocabulary, one file.
export * from '../../../../../packages/tenant-backend/src/featureRegistry.ts'
