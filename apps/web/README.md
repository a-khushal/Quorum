# Web App

Next.js frontend for Quorum.

## Run

From repo root:

```bash
pnpm --filter web dev
```

Or run all apps with Turborepo:

```bash
pnpm dev
```

## Scope

- Interview room UI
- Monaco editor integration
- Yjs collaboration client
- WebRTC call UI
- Execution output panel

## Notes

- Keep database access server-side; browser clients should call API routes/services.
- Shared lint and TypeScript configs come from workspace packages.
