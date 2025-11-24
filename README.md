# EV Charger Simulator

*Automatically synced with your [v0.app](https://v0.app) deployments*

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/joulepoint/v0-ev-charger-simulator)
[![Built with v0](https://img.shields.io/badge/Built%20with-v0.app-black?style=for-the-badge)](https://v0.app/chat/projects/LHzHyhADXLP)

## Overview

This repository will stay in sync with your deployed chats on [v0.app](https://v0.app).
Any changes you make to your deployed app will be automatically pushed to this repository from [v0.app](https://v0.app).

## Deployment

Your project is live at:

**[https://vercel.com/joulepoint/v0-ev-charger-simulator](https://vercel.com/joulepoint/v0-ev-charger-simulator)**

## Development

```bash
pnpm install
pnpm dev        # start Next.js in development mode
pnpm lint       # run next/core-web-vitals lint rules
pnpm test       # execute Vitest unit tests
pnpm build      # production build
```

## Project structure

```
src/
├─ app/                 # App Router routes, layouts, and providers
├─ components/          # Reusable UI primitives (layout, common, charts, simulator)
├─ features/            # Feature modules (auth, dashboard, simulators, sessions, etc.)
├─ hooks/               # Cross-cutting React hooks (tenant API, websockets)
├─ lib/                 # API client, tenant resolution helpers, query keys, utilities
├─ store/               # Zustand stores for layout, toasts, and theming
├─ styles/              # Global Tailwind layer plus simulator-specific styles
└─ types/               # Shared TypeScript models for simulator data contracts
```

Key improvements:

- A single `@/*` path alias resolves to `src`, eliminating the legacy `@ocpp` namespace.
- Duplicate and unused modules (legacy auth components, unused simulator badge/KPI card, stale utils) were removed.
- Strict Next.js linting is enforced through `next/core-web-vitals`, and the TypeScript config targets `ES2022` with `allowJs` disabled for stronger type-safety.
- `AppShell`, shared providers, hooks, and stores are colocated with their respective domains to keep feature boundaries clear.

## Build your app

Continue building your app on:

**[https://v0.app/chat/projects/LHzHyhADXLP](https://v0.app/chat/projects/LHzHyhADXLP)**
