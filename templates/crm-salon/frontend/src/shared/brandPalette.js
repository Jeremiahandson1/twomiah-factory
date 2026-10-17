// Template-repo shim. At generation the Factory vendors packages/tenant-ui/src/** into this folder,
// replacing this file with the real one. Inside the monorepo it re-exports that same module, so
// tailwind.config.js builds against the one generatePalette the running app also uses.
export * from '../../../../../packages/tenant-ui/src/brandPalette.js'
