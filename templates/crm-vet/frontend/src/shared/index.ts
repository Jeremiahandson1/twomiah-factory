// Template-repo shim. At generation the Factory vendors packages/tenant-ui/src/** into this folder,
// replacing this file with the real index. Inside the monorepo it re-exports that same package so the
// template type-checks against the real components instead of a hand-written stub.
export * from '../../../../../packages/tenant-ui/src/index'
