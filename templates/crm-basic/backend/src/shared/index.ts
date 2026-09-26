// Template-repo shim. At generation the Factory vendors packages/tenant-backend/src/** into this folder,
// replacing this file with the real index. Inside the monorepo it re-exports that same package so the
// template type-checks and bundles on its own.
export * from '../../../../../packages/tenant-backend/src/index.ts'
