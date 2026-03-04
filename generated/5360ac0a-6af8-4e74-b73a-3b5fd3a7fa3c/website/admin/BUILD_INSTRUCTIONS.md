# CMS Admin Panel — Build Instructions

After token injection, you must build the React app:

```bash
cd admin   # (or /cms if standalone)
npm install
npm run build
```

The `dist/` folder is not pre-built because it contains
injected company branding that must be compiled.
