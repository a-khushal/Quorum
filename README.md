# Quorum

Real-time technical interview platform with collaborative coding, WebRTC video, and sandboxed code execution.

## Workspace

- `apps/web`: Next.js frontend
- `apps/api`: HTTP API service (Express, planned)
- `apps/ws`: single-process WebSocket service for Yjs sync, signaling, and relay
- `packages/db`: Prisma schema and client
- `packages/eslint-config`: shared ESLint configs
- `packages/typescript-config`: shared TypeScript configs

## Tooling

- Turborepo + pnpm workspaces
- TypeScript + ESLint + Prettier
- Prisma for Postgres data access

## Commands

From repo root:

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm check-types
pnpm db:generate
pnpm db:migrate
```

## Database

Prisma lives in `packages/db`.

- Schema: `packages/db/prisma/schema.prisma`
- Config: `packages/db/prisma.config.ts`
- Client entry: `packages/db/src/index.ts`

Copy `packages/db/.env.example` to `packages/db/.env` and set `DATABASE_URL` before running migrations.

## Notes

- App naming convention is currently plain app names (`web`, `api`, `ws`) and scoped package names (`@repo/*`).
- WebSocket architecture is one process/port with route-based channels:
  - `/ws/yjs`
  - `/ws/signal`
  - `/ws/relay`
