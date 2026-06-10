# Twomiah Field App

React Native + Expo app for field technicians and crews of CRM tenants. One binary serves every vertical — the UI adapts per company via `VerticalContext` (fieldservice, homecare, roofing, dispensary, …).

## How it connects

Sign-in takes a server URL + email + password against the tenant's own CRM backend. Tokens live in `expo-secure-store`; `src/api/client.ts` auto-refreshes on 401 with request deduplication. Offline writes queue through `OfflineContext` and replay when connectivity returns.

## Layout

```
app/                Expo Router file-based screens
  (tabs)/           Main tabs — dashboard, jobs, quotes, contacts, pipeline,
                    canvass, driver, time-clock, POS, vertical-specific extras
  (details)/        Drill-in routes (job, lead, quote, invoice, order)
src/
  api/client.ts     Fetch wrapper: base URL, auth, refresh, upload
  contexts/         Auth, Vertical, Theme, Socket, Offline
  hooks/            useLocation, useCamera, useHaptics, …
  components/       Shared UI (skeletons, toasts, filter chips)
```

## Run

```bash
bun install
bunx expo start          # dev server; scan QR with Expo Go or a dev build
```

Builds ship through EAS (`EXPO_TOKEN` is passed through turbo for CI builds).
