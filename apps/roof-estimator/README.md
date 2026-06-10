# Roof Estimator

Standalone roof measurement product (EagleView/Roofr competitor direction): visual roof measurement from satellite/aerial imagery with detailed reports. Deployed as its own Render service pair — see `render.yaml` (frontend static site + Bun backend + Postgres).

Distinct from the measurement tooling embedded in `templates/crm-roof`; this is the standalone offering, like the Exterior Visualizer.

## Layout

```
backend/    Bun + Hono + Drizzle (Postgres). `bun run dev` to watch,
            `bun run start` pushes schema then serves.
frontend/   Vite + React. `bun run dev` / `bun run build`.
render.yaml Service + database definitions for Render
```

## Run

```bash
cd backend && bun install && bun run dev
cd frontend && bun install && bun run dev
```
